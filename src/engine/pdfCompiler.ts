import fontkit from '@pdf-lib/fontkit';
import JSZip from 'jszip';
import {
  appendBezierCurve,
  clip,
  closePath,
  degrees,
  endPath,
  LineCapStyle,
  lineTo,
  moveTo,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFRef,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type * as MuPdfNamespace from 'mupdf';
import {
  getElementLayerTier,
  type CanvasElement,
  type HighlightElement,
  type ImageAddElement,
  type ImageReplacementElement,
  type ShapeReplacementElement,
  type SignatureElement,
  type StrokeElement,
  type TextAddElement,
  type TextEditElement,
} from '@/types/elements';
import type {
  BuiltinFontFamilyOption,
  FontFamilyOption,
  PageMeta,
  RectBox,
  RotationAngle,
  TextScriptMode,
} from '@/types/pdf';
import type {
  CompilePdfPayload,
  FontAssetPayload,
  InspectPdfResult,
  SplitPdfZipPayload,
} from '@/types/worker';
import {
  computePdfLibDrawPlacement,
  normalizeRotation,
  pointBaseVisualToPdfUserSpace,
  rectBaseVisualToMupdfRect,
} from './coordinates';
import {
  extractEmbeddedFontsFromPdfBytes,
  getExtractedFontAssetPayloads,
} from './embeddedFontExtractor';
import {
  filterTextForPdfFont,
  getFontCategory,
  getStandardPdfFont,
  isBuiltinFontFamily,
  parsePdfFontMetadata,
} from './fonts';
import { computePageNumberLayout } from './pageNumbers';
import { buildWrappedRichLines, ensureRunsFromElement } from './richText';
import {
  elementLocalToPage,
  flipSvgPath,
  parseSvgPathCommands,
  scaleSvgPath as scaleSvgPathCommands,
} from './imageMask';
import { pathPointsToSvgPath, shapeToSvgPath, strokeDashToArray } from './vectorShapes';

type PdfLibDrawPlacement = ReturnType<typeof computePdfLibDrawPlacement>;

export type MuPdfModule = Pick<typeof MuPdfNamespace, 'Document' | 'PDFDocument' | 'PDFPage'>;

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

function pdfRgb(hex: string) {
  const { r, g, b } = parseHexColor(hex);
  return rgb(r, g, b);
}

/**
 * Wraps text into lines respecting explicit newlines and maxWidth using font measurement.
 */
export function wrapTextLines(
  text: string,
  maxWidth: number,
  measureWidth: (str: string) => number,
): string[] {
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  const safeMaxWidth = Math.max(maxWidth, 12);

  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push('');
      continue;
    }
    const words = para.split(/(\s+)/);
    let currentLine = '';

    for (const token of words) {
      if (!token) continue;
      const candidate = currentLine + token;
      if (currentLine.length === 0 || measureWidth(candidate) <= safeMaxWidth) {
        currentLine = candidate;
      } else {
        const trimmed = currentLine.trimEnd();
        if (trimmed.length > 0) {
          lines.push(trimmed);
        }
        // If single long token exceeds maxWidth, break character-by-character
        const nextStart = token.trimStart();
        if (measureWidth(nextStart) > safeMaxWidth && nextStart.length > 1) {
          let chunk = '';
          for (const ch of nextStart) {
            if (chunk.length > 0 && measureWidth(chunk + ch) > safeMaxWidth) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          currentLine = chunk;
        } else {
          currentLine = nextStart;
        }
      }
    }
    lines.push(currentLine.trimEnd());
  }

  return lines.length > 0 ? lines : [''];
}

export function pointsToSmoothSvgPath(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): string {
  if (points.length === 0) return '';
  const abs = points.map((p) => ({
    x: p.x * width,
    y: p.y * height,
  }));
  if (abs.length === 1) {
    return `M ${abs[0].x.toFixed(2)} ${abs[0].y.toFixed(2)} L ${(abs[0].x + 0.1).toFixed(2)} ${(abs[0].y + 0.1).toFixed(2)}`;
  }
  if (abs.length === 2) {
    return `M ${abs[0].x.toFixed(2)} ${abs[0].y.toFixed(2)} L ${abs[1].x.toFixed(2)} ${abs[1].y.toFixed(2)}`;
  }
  let d = `M ${abs[0].x.toFixed(2)} ${abs[0].y.toFixed(2)}`;
  for (let i = 1; i < abs.length - 1; i++) {
    const midX = (abs[i].x + abs[i + 1].x) / 2;
    const midY = (abs[i].y + abs[i + 1].y) / 2;
    d += ` Q ${abs[i].x.toFixed(2)} ${abs[i].y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
  }
  const last = abs[abs.length - 1];
  d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return d;
}

/**
 * Inspects a PDF with MuPDF Wasm (handling encryption & password auth) and extracts
 * canonical page geometry via pdf-lib on the decrypted bytes.
 */
export async function inspectPdfDocument(
  mupdf: MuPdfModule,
  bytes: Uint8Array,
  password?: string,
): Promise<InspectPdfResult> {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const wasEncrypted = doc.needsPassword();
    if (wasEncrypted) {
      if (!password) {
        return {
          status: 'needs-password',
          wasEncrypted: true,
          pageCount: 0,
          pages: [],
        };
      }
      const auth = doc.authenticatePassword(password);
      if (!auth) {
        return {
          status: 'invalid-password',
          wasEncrypted: true,
          pageCount: 0,
          pages: [],
        };
      }
    }

    const pdfDoc = doc.asPDF();
    if (!pdfDoc) {
      throw new Error('Selected file is not a valid PDF document.');
    }

    let effectiveBytes: Uint8Array;
    if (wasEncrypted) {
      const buf = pdfDoc.saveToBuffer('encrypt=none');
      try {
        const raw = buf.asUint8Array();
        effectiveBytes = new Uint8Array(raw.byteLength);
        effectiveBytes.set(raw);
      } finally {
        buf.destroy();
      }
    } else {
      effectiveBytes = bytes;
    }

    const libDoc = await PDFDocument.load(effectiveBytes, { ignoreEncryption: true });
    const libPages = libDoc.getPages();
    const pages: InspectPdfResult['pages'] = [];

    for (let i = 0; i < libPages.length; i++) {
      const libPage = libPages[i];
      const mb = libPage.getMediaBox();
      const cb = libPage.getCropBox();
      const mediaBox: [number, number, number, number] = [
        mb.x,
        mb.y,
        mb.x + mb.width,
        mb.y + mb.height,
      ];
      const cropBox: [number, number, number, number] = [
        cb.x,
        cb.y,
        cb.x + cb.width,
        cb.y + cb.height,
      ];
      const intrinsicRotation = normalizeRotation(libPage.getRotation().angle);
      const swapped = intrinsicRotation === 90 || intrinsicRotation === 270;
      const baseWidth = swapped ? cb.height : cb.width;
      const baseHeight = swapped ? cb.width : cb.height;

      pages.push({
        sourcePageIndex: i,
        baseWidth,
        baseHeight,
        intrinsicRotation,
        mediaBox,
        cropBox,
      });
    }

    return {
      status: 'ok',
      decryptedBytes: wasEncrypted ? effectiveBytes : undefined,
      wasEncrypted,
      pageCount: pages.length,
      pages,
    };
  } finally {
    doc.destroy();
  }
}

function addMupdfRedactAnnotation(
  page: MuPdfNamespace.PDFPage,
  rect: RectBox,
  bounds: [number, number, number, number],
): void {
  const annot = page.createAnnotation('Redact');
  try {
    annot.setRect(rectBaseVisualToMupdfRect(rect, bounds));
    annot.update();
  } finally {
    annot.destroy();
  }
}

function applyRedactionsToMupdfPage(
  mupdf: MuPdfModule,
  page: MuPdfNamespace.PDFPage,
  textRects: RectBox[],
  imageRects: RectBox[],
  blackRedactRects: RectBox[] = [],
  shapeRects: RectBox[] = [],
): void {
  const bounds = page.getBounds('CropBox');

  // Pass 1: Remove original text stream operators inside edited/deleted text rects (no black box)
  if (textRects.length > 0) {
    for (const r of textRects) {
      const padX = Math.min(0.5, r.width * 0.05);
      const padY = Math.min(0.5, r.height * 0.05);
      const target: RectBox = {
        x: r.x + padX,
        y: r.y + padY,
        width: Math.max(1, r.width - padX * 2),
        height: Math.max(1, r.height - padY * 2),
      };
      const annot = page.createAnnotation('Redact');
      try {
        annot.setRect(rectBaseVisualToMupdfRect(target, bounds));
        annot.update();
      } finally {
        annot.destroy();
      }
    }
    page.applyRedactions(
      false,
      mupdf.PDFPage.REDACT_IMAGE_NONE,
      mupdf.PDFPage.REDACT_LINE_ART_NONE,
      mupdf.PDFPage.REDACT_TEXT_REMOVE,
    );
  }

  // Pass 2: Remove original image XObjects inside moved/deleted image rects (no black box)
  if (imageRects.length > 0) {
    for (const r of imageRects) {
      const padX = Math.min(0.5, r.width * 0.02);
      const padY = Math.min(0.5, r.height * 0.02);
      const target: RectBox = {
        x: r.x + padX,
        y: r.y + padY,
        width: Math.max(1, r.width - padX * 2),
        height: Math.max(1, r.height - padY * 2),
      };
      const annot = page.createAnnotation('Redact');
      try {
        annot.setRect(rectBaseVisualToMupdfRect(target, bounds));
        annot.update();
      } finally {
        annot.destroy();
      }
    }
    page.applyRedactions(
      false,
      mupdf.PDFPage.REDACT_IMAGE_REMOVE,
      mupdf.PDFPage.REDACT_LINE_ART_NONE,
      mupdf.PDFPage.REDACT_TEXT_NONE,
    );
  }

  // Pass 3: Apply explicit solid black redactions
  if (blackRedactRects.length > 0) {
    for (const r of blackRedactRects) {
      const annot = page.createAnnotation('Redact');
      try {
        annot.setRect(rectBaseVisualToMupdfRect(r, bounds));
        annot.update();
      } finally {
        annot.destroy();
      }
    }
    page.applyRedactions(
      true,
      mupdf.PDFPage.REDACT_IMAGE_REMOVE,
      mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
      mupdf.PDFPage.REDACT_TEXT_REMOVE,
    );
  }

  // Pass 4: Remove replaced/deleted vector background shapes cleanly without erasing overlapping foreground text
  if (shapeRects.length > 0) {
    for (const r of shapeRects) {
      addMupdfRedactAnnotation(page, r, bounds);
    }
    page.applyRedactions(
      false,
      mupdf.PDFPage.REDACT_IMAGE_NONE,
      mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
      mupdf.PDFPage.REDACT_TEXT_NONE,
    );
  }
}

/**
 * Produces a clean 1-page preview PDF with edited text / deleted or moved image XObject
 * stream operators removed via MuPDF Wasm, preserving underlying tables/lines/backgrounds.
 */
export function prepareCleanPreviewPagePdf(
  mupdf: MuPdfModule,
  srcPdfDoc: MuPdfNamespace.PDFDocument,
  sourcePageIndex: number,
  textRects: RectBox[],
  imageRects: RectBox[],
  shapeRects: RectBox[] = [],
): Uint8Array {
  const singleDoc = new mupdf.PDFDocument();
  try {
    singleDoc.graftPage(0, srcPdfDoc, sourcePageIndex);
    if (textRects.length > 0 || imageRects.length > 0 || shapeRects.length > 0) {
      const rawPage = singleDoc.loadPage(0);
      try {
        if (rawPage.isPDF()) {
          applyRedactionsToMupdfPage(
            mupdf,
            rawPage as MuPdfNamespace.PDFPage,
            textRects,
            imageRects,
            [],
            shapeRects,
          );
        }
      } finally {
        rawPage.destroy();
      }
    }
    const outBuf = singleDoc.saveToBuffer('compress');
    try {
      const raw = outBuf.asUint8Array();
      const copy = new Uint8Array(raw.byteLength);
      copy.set(raw);
      return copy;
    } finally {
      outBuf.destroy();
    }
  } finally {
    singleDoc.destroy();
  }
}

/**
 * Applies MuPDF Wasm content-stream redactions for edited/deleted original text blocks,
 * moved/deleted embedded images, and explicit redaction rectangles.
 */
function applyMupdfStreamRemovals(
  mupdf: MuPdfModule,
  assembledBytes: Uint8Array,
  pages: PageMeta[],
  elementsByPage: Map<string, CanvasElement[]>,
): Uint8Array {
  const pagesNeedingRedaction = new Map<
    number,
    {
      textRects: RectBox[];
      imageRects: RectBox[];
      blackRedactRects: RectBox[];
      shapeRects: RectBox[];
    }
  >();

  pages.forEach((pageMeta, pageIndex) => {
    const pageEls = elementsByPage.get(pageMeta.id) ?? [];
    const textRects: RectBox[] = [];
    const imageRects: RectBox[] = [];
    const blackRedactRects: RectBox[] = [];
    const shapeRects: RectBox[] = [];

    for (const el of pageEls) {
      if (el.kind === 'text-edit') {
        textRects.push(el.originalRect);
      } else if (el.kind === 'image-replacement') {
        imageRects.push(el.originalRect);
      } else if (el.kind === 'shape-replacement') {
        const pad = Math.max(0.5, (el.originalStrokeWidth ?? 0) / 2 + 0.5);
        shapeRects.push({
          x: Math.max(0, el.originalRect.x - pad),
          y: Math.max(0, el.originalRect.y - pad),
          width: el.originalRect.width + pad * 2,
          height: el.originalRect.height + pad * 2,
        });
      } else if (el.kind === 'highlight' && el.shape === 'redact') {
        blackRedactRects.push({ x: el.x, y: el.y, width: el.width, height: el.height });
      }
    }

    if (
      textRects.length > 0 ||
      imageRects.length > 0 ||
      blackRedactRects.length > 0 ||
      shapeRects.length > 0
    ) {
      pagesNeedingRedaction.set(pageIndex, {
        textRects,
        imageRects,
        blackRedactRects,
        shapeRects,
      });
    }
  });

  if (pagesNeedingRedaction.size === 0) {
    return assembledBytes;
  }

  const doc = mupdf.Document.openDocument(assembledBytes, 'application/pdf');
  try {
    const pdfDoc = doc.asPDF();
    if (!pdfDoc) {
      return assembledBytes;
    }

    for (const [pageIndex, ops] of pagesNeedingRedaction.entries()) {
      const rawPage = pdfDoc.loadPage(pageIndex);
      if (!rawPage.isPDF()) {
        rawPage.destroy();
        continue;
      }
      const page = rawPage as MuPdfNamespace.PDFPage;
      try {
        applyRedactionsToMupdfPage(
          mupdf,
          page,
          ops.textRects,
          ops.imageRects,
          ops.blackRedactRects,
          ops.shapeRects,
        );
      } finally {
        page.destroy();
      }
    }

    const outBuf = pdfDoc.saveToBuffer('garbage=2,compress');
    try {
      const raw = outBuf.asUint8Array();
      const copy = new Uint8Array(raw.byteLength);
      copy.set(raw);
      return copy;
    } finally {
      outBuf.destroy();
    }
  } finally {
    doc.destroy();
  }
}

interface EmbeddedFontEntry {
  font: PDFFont;
  supportedCodePoints: Set<number> | null;
}

interface FontPairEntry {
  primary: EmbeddedFontEntry;
  fallback: EmbeddedFontEntry | null;
}

type FontPairResolver = (bold: boolean, italic: boolean) => Promise<FontPairEntry>;

function splitTextByGlyphSupport(
  text: string,
  pair: FontPairEntry,
): Array<{ entry: EmbeddedFontEntry; text: string }> {
  const supported = pair.primary.supportedCodePoints;
  if (!supported || !pair.fallback) {
    return [
      {
        entry: pair.primary,
        text: filterTextForPdfFont(text, supported),
      },
    ];
  }

  const segments: Array<{ entry: EmbeddedFontEntry; text: string }> = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const usePrimary = cp === undefined || ch === ' ' || supported.has(cp);
    const targetEntry = usePrimary ? pair.primary : pair.fallback;
    const safeChar = filterTextForPdfFont(ch, targetEntry.supportedCodePoints);
    const prev = segments[segments.length - 1];
    if (prev && prev.entry === targetEntry) {
      prev.text += safeChar;
    } else {
      segments.push({ entry: targetEntry, text: safeChar });
    }
  }
  return segments;
}

function measureWithFontPair(
  text: string,
  pair: FontPairEntry,
  fontSize: number,
): number {
  let width = 0;
  for (const seg of splitTextByGlyphSupport(text, pair)) {
    if (!seg.text) continue;
    try {
      width += seg.entry.font.widthOfTextAtSize(seg.text, fontSize);
    } catch {
      width += seg.text.length * fontSize * 0.5;
    }
  }
  return width;
}

async function drawTextElementOnPage(
  page: PDFPage,
  pageMeta: PageMeta,
  el: TextEditElement | TextAddElement,
  resolvePair: FontPairResolver,
): Promise<void> {
  if ((el.kind === 'text-edit' && el.deleted) || el.text.length === 0) {
    return;
  }

  // Optional background fill
  if (el.kind === 'text-add' && el.backgroundColor) {
    const placement = computePdfLibDrawPlacement(
      { x: el.x, y: el.y, width: el.width, height: el.height },
      el.rotation,
      pageMeta,
    );
    page.drawRectangle({
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      rotate: degrees(placement.rotateDegCCW),
      color: pdfRgb(el.backgroundColor),
      opacity: el.opacity,
    });
  }

  const runs = ensureRunsFromElement(el.text, el.runs, el.bold, el.italic);
  const stylePairs = new Map<string, FontPairEntry>();
  const getStyleKey = (b: boolean, i: boolean) => `${b ? 1 : 0}_${i ? 1 : 0}`;
  const ensurePair = async (b: boolean, i: boolean) => {
    const k = getStyleKey(b, i);
    let p = stylePairs.get(k);
    if (!p) {
      p = await resolvePair(b, i);
      stylePairs.set(k, p);
    }
    return p;
  };

  await ensurePair(el.bold, el.italic);
  for (const r of runs) {
    await ensurePair(r.bold ?? el.bold, r.italic ?? el.italic);
  }

  const getPairSync = (b: boolean, i: boolean): FontPairEntry =>
    stylePairs.get(getStyleKey(b, i)) ?? stylePairs.get(getStyleKey(el.bold, el.italic))!;

  const charSpacing = el.letterSpacing ?? 0;
  const hScale = el.horizontalScale && el.horizontalScale > 0 ? el.horizontalScale : 1;

  const measurePiece = (
    text: string,
    bold: boolean,
    italic: boolean,
    script: TextScriptMode,
  ): number => {
    const scale = script === 'normal' ? 1 : 0.60;
    const baseW = measureWithFontPair(text, getPairSync(bold, italic), el.fontSize * scale);
    return baseW * hScale + Math.max(0, text.length - 1) * charSpacing;
  };

  const explicitLineCount = el.text.split('\n').length;
  const isSingleLine =
    explicitLineCount === 1 &&
    (el.renderedLineCount === 1 ||
      (el.renderedLineCount === undefined &&
        !el.widthResizedByUser &&
        el.height < el.fontSize * el.lineHeight * 1.65));

  const wrappedLines = buildWrappedRichLines(runs, el.width, measurePiece, el.bold, el.italic, {
    disableSoftWrap: isSingleLine,
    widthToleranceRatio: el.align === 'justify' && !isSingleLine ? 0 : 0.025,
    widthTolerancePt: el.align === 'justify' && !isSingleLine ? 0.5 : 2.0,
  });

  const lineBoxHeight = el.fontSize * el.lineHeight;
  const baselineFromLineTop =
    el.fontSize * 0.85 + Math.max(0, (el.lineHeight - 1) * el.fontSize * 0.35);

  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const radCW = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(radCW);
  const sin = Math.sin(radCW);

  // Determine base CCW angle for raw PDF space
  const pdfCenter = pointBaseVisualToPdfUserSpace(cx, cy, pageMeta.cropBox, pageMeta.intrinsicRotation);
  const pdfRight = pointBaseVisualToPdfUserSpace(
    cx + 1,
    cy,
    pageMeta.cropBox,
    pageMeta.intrinsicRotation,
  );
  const basePdfAngleCCW =
    (Math.atan2(pdfRight.y - pdfCenter.y, pdfRight.x - pdfCenter.x) * 180) / Math.PI;
  const drawAngleCCW = basePdfAngleCCW - el.rotation;
  const textColor = pdfRgb(el.color);

  for (let i = 0; i < wrappedLines.length; i++) {
    const line = wrappedLines[i];
    if (line.pieces.length === 0) continue;

    // `line.naturalWidth` already includes `hScale` (from `measurePiece`).
    const scaledLineWidth = line.naturalWidth;
    const fitScale =
      scaledLineWidth > el.width + 0.5 ? Math.max(0.88, el.width / scaledLineWidth) : 1;
    const effectiveHScale = hScale * fitScale;
    const effectiveLineWidth = scaledLineWidth * fitScale;
    const useTz = Math.abs(effectiveHScale - 1) > 0.005;

    let localStartX = 0;
    if (el.align === 'center') {
      localStartX = Math.max(0, (el.width - effectiveLineWidth) / 2);
    } else if (el.align === 'right') {
      localStartX = Math.max(0, el.width - effectiveLineWidth);
    }

    const shouldJustify =
      el.align === 'justify' &&
      !line.endsParagraph &&
      line.spaceCount > 0 &&
      el.width - effectiveLineWidth > 0.5 &&
      effectiveLineWidth > el.width * 0.38;
    const extraPerSpace = shouldJustify
      ? (el.width - effectiveLineWidth) / line.spaceCount
      : 0;

    let cursorX = localStartX;
    for (const piece of line.pieces) {
      const piecePair = getPairSync(piece.bold, piece.italic);
      const pieceSize = piece.script === 'normal' ? el.fontSize : el.fontSize * 0.60;
      const scriptDeltaY =
        piece.script === 'super'
          ? -el.fontSize * 0.30
          : piece.script === 'sub'
            ? el.fontSize * 0.15
            : 0;

      if (piece.isSpace) {
        cursorX +=
          measureWithFontPair(piece.text, piecePair, pieceSize) * effectiveHScale +
          extraPerSpace * piece.text.length;
        continue;
      }

      const glyphSegs = splitTextByGlyphSupport(piece.text, piecePair);
      for (const seg of glyphSegs) {
        if (!seg.text) continue;
        const localOffsetY = i * lineBoxHeight + baselineFromLineTop + scriptDeltaY;
        const relX = -el.width / 2 + cursorX;
        const relY = -el.height / 2 + localOffsetY;

        const visX = cx + (relX * cos - relY * sin);
        const visY = cy + (relX * sin + relY * cos);
        const pdfPt = pointBaseVisualToPdfUserSpace(
          visX,
          visY,
          pageMeta.cropBox,
          pageMeta.intrinsicRotation,
        );

        const pushOps: PDFOperator[] = [];
        if (charSpacing !== 0) {
          pushOps.push(setCharacterSpacing(charSpacing));
        }
        if (useTz) {
          pushOps.push(
            PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [
              PDFNumber.of(Number((effectiveHScale * 100).toFixed(2))),
            ]),
          );
        }
        if (pushOps.length > 0) {
          page.pushOperators(pushGraphicsState(), ...pushOps);
        }
        page.drawText(seg.text, {
          x: pdfPt.x,
          y: pdfPt.y,
          size: pieceSize,
          font: seg.entry.font,
          color: textColor,
          opacity: el.opacity,
          rotate: degrees(drawAngleCCW),
        });
        if (pushOps.length > 0) {
          page.pushOperators(popGraphicsState());
        }

        const advanceScale = useTz ? effectiveHScale : 1;
        try {
          cursorX +=
            seg.entry.font.widthOfTextAtSize(seg.text, pieceSize) * effectiveHScale +
            seg.text.length * charSpacing * advanceScale;
        } catch {
          cursorX +=
            seg.text.length * pieceSize * 0.5 * effectiveHScale +
            seg.text.length * charSpacing * advanceScale;
        }
      }
    }
  }
}

function drawSvgBoxOnPage(
  page: PDFPage,
  pageMeta: PageMeta,
  rect: RectBox,
  rotationDeg: number,
  svgPath: string,
  scaleX: number,
  scaleY: number,
  strokeColor: string,
  strokeWidth: number,
  opacity: number,
  extra?: {
    fillColor?: string;
    dashArray?: number[];
  },
): void {
  if (!svgPath) return;
  const fillHex = extra?.fillColor;
  const hasFill = Boolean(fillHex && fillHex !== 'transparent');
  const hasStroke = Boolean(strokeColor && strokeColor !== 'transparent' && strokeWidth > 0);
  if (!hasFill && !hasStroke) return;

  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const radCW = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radCW);
  const sin = Math.sin(radCW);

  // Top-left corner of the visual box rotated around center
  const relX = -rect.width / 2;
  const relY = -rect.height / 2;
  const tlVisX = cx + (relX * cos - relY * sin);
  const tlVisY = cy + (relX * sin + relY * cos);

  const tlPdf = pointBaseVisualToPdfUserSpace(
    tlVisX,
    tlVisY,
    pageMeta.cropBox,
    pageMeta.intrinsicRotation,
  );
  const pdfCenter = pointBaseVisualToPdfUserSpace(cx, cy, pageMeta.cropBox, pageMeta.intrinsicRotation);
  const pdfRight = pointBaseVisualToPdfUserSpace(
    cx + 1,
    cy,
    pageMeta.cropBox,
    pageMeta.intrinsicRotation,
  );
  const basePdfAngleCCW =
    (Math.atan2(pdfRight.y - pdfCenter.y, pdfRight.x - pdfCenter.x) * 180) / Math.PI;
  const drawAngleCCW = basePdfAngleCCW - rotationDeg;

  // pdf-lib drawSvgPath accepts single uniform `scale`; pre-scale non-uniform paths when needed
  const uniformScale = Math.abs(scaleX - scaleY) < 1e-4 ? scaleX : 1;
  const effectivePath =
    uniformScale === 1 && (Math.abs(scaleX - 1) > 1e-4 || Math.abs(scaleY - 1) > 1e-4)
      ? scaleSvgPath(svgPath, scaleX, scaleY)
      : svgPath;

  const drawOpts: Parameters<PDFPage['drawSvgPath']>[1] = {
    x: tlPdf.x,
    y: tlPdf.y,
    scale: uniformScale,
    rotate: degrees(drawAngleCCW),
    borderLineCap: LineCapStyle.Round,
  };
  if (hasFill && fillHex) {
    drawOpts.color = pdfRgb(fillHex);
    drawOpts.opacity = opacity;
  }
  if (hasStroke) {
    drawOpts.borderColor = pdfRgb(strokeColor);
    drawOpts.borderWidth = strokeWidth;
    drawOpts.borderOpacity = opacity;
    if (extra?.dashArray && extra.dashArray.length > 0) {
      drawOpts.borderDashArray = extra.dashArray;
    }
  } else {
    drawOpts.borderWidth = 0;
  }

  page.drawSvgPath(effectivePath, drawOpts);
}

function drawVectorElementOnPage(
  pdfPage: PDFPage,
  pageMeta: PageMeta,
  el: Extract<CanvasElement, { kind: 'shape' | 'path' }>,
): void {
  const rawSvgPath =
    el.kind === 'shape'
      ? shapeToSvgPath(el.shapeType, el.width, el.height, el.borderRadius ?? 0)
      : pathPointsToSvgPath(el.points, el.width, el.height, el.closed, el.smooth);
  const svgPath =
    el.kind === 'shape' && (el.flipX || el.flipY)
      ? flipSvgPath(rawSvgPath, el.width, el.height, el.flipX, el.flipY, 3)
      : rawSvgPath;
  const fillColor = el.kind === 'shape' || el.closed ? el.fillColor : 'transparent';
  drawSvgBoxOnPage(
    pdfPage,
    pageMeta,
    { x: el.x, y: el.y, width: el.width, height: el.height },
    el.rotation,
    svgPath,
    1,
    1,
    el.strokeColor,
    el.strokeWidth,
    el.opacity,
    {
      fillColor,
      dashArray: strokeDashToArray(el.strokeDash, el.strokeWidth),
    },
  );
}

function scaleSvgPath(d: string, sx: number, sy: number): string {
  // Scales numeric coordinate pairs in M/L/Q/C commands
  return d.replace(/([MLQC])\s*([^MLQCZ]+)/gi, (_match, cmd: string, coords: string) => {
    const nums = coords
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    const scaled: string[] = [];
    for (let i = 0; i < nums.length; i++) {
      const factor = i % 2 === 0 ? sx : sy;
      scaled.push((nums[i] * factor).toFixed(2));
    }
    return `${cmd} ${scaled.join(' ')} `;
  });
}

function drawRectShapeOnPage(
  pdfPage: PDFPage,
  pageMeta: PageMeta,
  box: RectBox,
  rotation: number,
  style: {
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    opacity: number;
    isHighlight?: boolean;
  },
): void {
  const placement = computePdfLibDrawPlacement(box, rotation, pageMeta);
  const fillHex = style.fillColor;
  const strokeHex = style.strokeColor;
  const borderWidth = strokeHex ? style.strokeWidth ?? 0 : 0;
  pdfPage.drawRectangle({
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    rotate: degrees(placement.rotateDegCCW),
    color: style.isHighlight || (fillHex && fillHex !== 'transparent') ? pdfRgb(fillHex ?? '#fef08a') : undefined,
    opacity: style.isHighlight ? Math.min(0.45, style.opacity) : style.opacity,
    borderColor: strokeHex && borderWidth > 0 ? pdfRgb(strokeHex) : undefined,
    borderWidth,
    borderOpacity: style.opacity,
  });
}

function drawPlacedImage(
  pdfPage: PDFPage,
  img: PDFImage,
  placement: PdfLibDrawPlacement,
  opacity: number,
  flipX?: boolean,
  flipY?: boolean,
): void {
  const theta = (placement.rotateDegCCW * Math.PI) / 180;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  const vx = -Math.sin(theta);
  const vy = Math.cos(theta);

  let drawX = placement.x;
  let drawY = placement.y;
  let drawW = placement.width;
  let drawH = placement.height;

  if (flipX) {
    drawX += placement.width * ux;
    drawY += placement.width * uy;
    drawW = -placement.width;
  }
  if (flipY) {
    drawX += placement.height * vx;
    drawY += placement.height * vy;
    drawH = -placement.height;
  }

  pdfPage.drawImage(img, {
    x: drawX,
    y: drawY,
    width: drawW,
    height: drawH,
    rotate: degrees(placement.rotateDegCCW),
    opacity,
  });
}

function appendSvgClipOperators(
  ops: PDFOperator[],
  svgPath: string,
  mapLocalToPdf: (lx: number, ly: number) => { x: number; y: number },
): void {
  const cmds = parseSvgPathCommands(svgPath);
  let curPdf = { x: 0, y: 0 };
  let startPdf = { x: 0, y: 0 };
  let emittedPath = false;

  for (const c of cmds) {
    if (c.cmd === 'M' && c.nums.length >= 2) {
      curPdf = mapLocalToPdf(c.nums[0], c.nums[1]);
      startPdf = curPdf;
      ops.push(moveTo(curPdf.x, curPdf.y));
      emittedPath = true;
      for (let i = 2; i + 1 < c.nums.length; i += 2) {
        curPdf = mapLocalToPdf(c.nums[i], c.nums[i + 1]);
        ops.push(lineTo(curPdf.x, curPdf.y));
      }
    } else if (c.cmd === 'L') {
      for (let i = 0; i + 1 < c.nums.length; i += 2) {
        curPdf = mapLocalToPdf(c.nums[i], c.nums[i + 1]);
        ops.push(lineTo(curPdf.x, curPdf.y));
        emittedPath = true;
      }
    } else if (c.cmd === 'Q') {
      for (let i = 0; i + 3 < c.nums.length; i += 4) {
        const pCp = mapLocalToPdf(c.nums[i], c.nums[i + 1]);
        const pEnd = mapLocalToPdf(c.nums[i + 2], c.nums[i + 3]);
        const c1 = {
          x: curPdf.x + (2 / 3) * (pCp.x - curPdf.x),
          y: curPdf.y + (2 / 3) * (pCp.y - curPdf.y),
        };
        const c2 = {
          x: pEnd.x + (2 / 3) * (pCp.x - pEnd.x),
          y: pEnd.y + (2 / 3) * (pCp.y - pEnd.y),
        };
        ops.push(appendBezierCurve(c1.x, c1.y, c2.x, c2.y, pEnd.x, pEnd.y));
        curPdf = pEnd;
        emittedPath = true;
      }
    } else if (c.cmd === 'C') {
      for (let i = 0; i + 5 < c.nums.length; i += 6) {
        const pC1 = mapLocalToPdf(c.nums[i], c.nums[i + 1]);
        const pC2 = mapLocalToPdf(c.nums[i + 2], c.nums[i + 3]);
        const pEnd = mapLocalToPdf(c.nums[i + 4], c.nums[i + 5]);
        ops.push(appendBezierCurve(pC1.x, pC1.y, pC2.x, pC2.y, pEnd.x, pEnd.y));
        curPdf = pEnd;
        emittedPath = true;
      }
    } else if (c.cmd === 'Z') {
      ops.push(closePath());
      curPdf = startPdf;
    }
  }

  if (emittedPath) {
    ops.push(clip(), endPath());
  }
}

function drawImageElementOnPage(
  pdfPage: PDFPage,
  pageMeta: PageMeta,
  img: PDFImage,
  el: ImageAddElement | ImageReplacementElement,
): void {
  const hasCropOrMask = Boolean(el.cropRect || el.clipMask?.unitSvgPath);
  if (!hasCropOrMask) {
    const placement = computePdfLibDrawPlacement(
      { x: el.x, y: el.y, width: el.width, height: el.height },
      el.rotation,
      pageMeta,
    );
    drawPlacedImage(pdfPage, img, placement, el.opacity, el.flipX, el.flipY);
    return;
  }

  const mapLocalToPdf = (lx: number, ly: number) => {
    const visPt = elementLocalToPage(lx, ly, el, el.rotation);
    return pointBaseVisualToPdfUserSpace(
      visPt.x,
      visPt.y,
      pageMeta.cropBox,
      pageMeta.intrinsicRotation,
    );
  };

  pdfPage.pushOperators(pushGraphicsState());

  // 1. Intersect with exact element box [0..el.width] x [0..el.height] (crop window)
  const p0 = mapLocalToPdf(0, 0);
  const p1 = mapLocalToPdf(el.width, 0);
  const p2 = mapLocalToPdf(el.width, el.height);
  const p3 = mapLocalToPdf(0, el.height);
  pdfPage.pushOperators(
    moveTo(p0.x, p0.y),
    lineTo(p1.x, p1.y),
    lineTo(p2.x, p2.y),
    lineTo(p3.x, p3.y),
    closePath(),
    clip(),
    endPath(),
  );

  // 2. Apply Illustrator vector clipping mask path inside screen coordinates if present
  if (el.clipMask?.unitSvgPath) {
    const scaled = scaleSvgPathCommands(
      el.clipMask.unitSvgPath,
      Math.max(1, el.width),
      Math.max(1, el.height),
      4,
    );
    const screenD = flipSvgPath(scaled, el.width, el.height, el.flipX, el.flipY, 4);
    const clipOps: PDFOperator[] = [];
    appendSvgClipOperators(clipOps, screenD, mapLocalToPdf);
    if (clipOps.length > 0) {
      pdfPage.pushOperators(...clipOps);
    }
  }

  // 3. Draw underlying image aligned so `cropRect` fills [0..el.width] x [0..el.height]
  const crop = el.cropRect ?? { x: 0, y: 0, width: 1, height: 1 };
  const lw = el.width / Math.max(0.02, crop.width);
  const lh = el.height / Math.max(0.02, crop.height);
  const lx = -(crop.x / Math.max(0.02, crop.width)) * el.width;
  const ly = -(crop.y / Math.max(0.02, crop.height)) * el.height;
  const effLx = el.flipX ? el.width - (lx + lw) : lx;
  const effLy = el.flipY ? el.height - (ly + lh) : ly;

  const imgCenterVis = elementLocalToPage(effLx + lw / 2, effLy + lh / 2, el, el.rotation);
  const placement = computePdfLibDrawPlacement(
    {
      x: imgCenterVis.x - lw / 2,
      y: imgCenterVis.y - lh / 2,
      width: lw,
      height: lh,
    },
    el.rotation,
    pageMeta,
  );
  drawPlacedImage(pdfPage, img, placement, el.opacity, el.flipX, el.flipY);

  pdfPage.pushOperators(popGraphicsState());
}

function mapDisplayRotatedPointToBaseVisual(
  vx: number,
  vy: number,
  baseWidth: number,
  baseHeight: number,
  userRotation: RotationAngle,
): { x: number; y: number } {
  const rot = normalizeRotation(userRotation);
  switch (rot) {
    case 90:
      return { x: vy, y: baseHeight - vx };
    case 180:
      return { x: baseWidth - vx, y: baseHeight - vy };
    case 270:
      return { x: baseWidth - vy, y: vx };
    default:
      return { x: vx, y: vy };
  }
}

/**
 * Compiles the edited multi-page document (including merges, reordering, rotations,
 * true stream redactions for edited text & moved/deleted images, custom text, images,
 * signatures, strokes, and annotations) into a single valid PDF byte buffer.
 */
export async function compilePdfDocument(
  mupdf: MuPdfModule,
  payload: CompilePdfPayload,
): Promise<Uint8Array> {
  if (payload.pages.length === 0) {
    throw new Error('Cannot compile an empty document with zero pages.');
  }

  // Stage 1: Load source documents and assemble selected pages in current order
  const loadedSources = new Map<string, PDFDocument>();
  for (const src of payload.sourceDocs) {
    if (!src.bytes) {
      throw new Error(`Missing source document bytes for "${src.id}" during compilation.`);
    }
    const doc = await PDFDocument.load(src.bytes, { ignoreEncryption: true });
    loadedSources.set(src.id, doc);
  }

  const assembledDoc = await PDFDocument.create();
  for (const pageMeta of payload.pages) {
    const srcDoc = loadedSources.get(pageMeta.sourceDocId);
    if (!srcDoc) {
      throw new Error(`Missing source document "${pageMeta.sourceDocId}" during compilation.`);
    }
    const [copiedPage] = await assembledDoc.copyPages(srcDoc, [pageMeta.sourcePageIndex]);
    assembledDoc.addPage(copiedPage);
  }

  const assembledBytes = await assembledDoc.save();

  // Group elements by pageId
  const elementsByPage = new Map<string, CanvasElement[]>();
  for (const el of payload.elements) {
    const list = elementsByPage.get(el.pageId) ?? [];
    list.push(el);
    elementsByPage.set(el.pageId, list);
  }

  // Stage 2: Apply MuPDF Wasm content-stream redactions (removes original text / XObject images)
  const redactedBytes = applyMupdfStreamRemovals(
    mupdf,
    assembledBytes,
    payload.pages,
    elementsByPage,
  );

  // Stage 3: Embed fonts, draw replacement/added elements, and apply final userRotation
  const finalDoc = await PDFDocument.load(redactedBytes, { ignoreEncryption: true });
  finalDoc.registerFontkit(fontkit);

  // Auto-hydrate any referenced embedded PDF fonts from sourceDocs if not already in payload.fonts
  const providedFonts: FontAssetPayload[] = [...(payload.fonts ?? [])];
  const referencedEmbeddedIds = new Set<string>();
  for (const el of payload.elements) {
    if (
      (el.kind === 'text-edit' || el.kind === 'text-add') &&
      el.fontFamily.startsWith('embedded:') &&
      !providedFonts.some((f) => f.family === el.fontFamily)
    ) {
      referencedEmbeddedIds.add(el.fontFamily);
    }
  }
  if (referencedEmbeddedIds.size > 0) {
    const neededDocIds = new Set<string>();
    for (const fid of referencedEmbeddedIds) {
      const parts = fid.split(':');
      if (parts.length >= 2) neededDocIds.add(parts[1]);
    }
    for (const src of payload.sourceDocs) {
      if (neededDocIds.has(src.id) && src.bytes) {
        await extractEmbeddedFontsFromPdfBytes(src.id, src.bytes);
      }
    }
    providedFonts.push(...getExtractedFontAssetPayloads([...referencedEmbeddedIds]));
  }

  const resolveCategoryAsset = (
    family: FontFamilyOption,
    fallback?: BuiltinFontFamilyOption,
  ): FontAssetPayload | undefined => {
    const eff = fallback ?? (isBuiltinFontFamily(family) ? family : undefined);
    const categoryKey = `category:${getFontCategory(family, eff)}`;
    return (
      (eff ? providedFonts.find((f) => f.family === eff) : undefined) ??
      providedFonts.find((f) => f.family === categoryKey) ??
      providedFonts.find((f) => f.family === 'category:sans')
    );
  };

  const resolveFontPayload = (
    family: FontFamilyOption,
    fallback?: BuiltinFontFamilyOption,
  ): FontAssetPayload | undefined => {
    if (providedFonts.length === 0) return undefined;
    return (
      providedFonts.find((f) => f.family === family) ??
      resolveCategoryAsset(family, fallback)
    );
  };

  const resolveFallbackPayload = (
    family: FontFamilyOption,
    fallback?: BuiltinFontFamilyOption,
  ): FontAssetPayload | undefined => {
    if (providedFonts.length === 0) return undefined;
    const cat = getFontCategory(family, fallback);
    const fbKey =
      cat === 'cambria' || cat === 'serif'
        ? 'fallback:serif'
        : cat === 'mono'
          ? 'fallback:mono'
          : cat === 'script'
            ? 'fallback:script'
            : 'fallback:sans';
    return (
      providedFonts.find((f) => f.family === fbKey) ??
      providedFonts.find((f) => f.family === 'fallback:sans')
    );
  };

  const fontCache = new Map<string, EmbeddedFontEntry>();
  const embedVariantFromPayload = async (
    cacheKey: string,
    asset: FontAssetPayload | undefined,
    bold: boolean,
    italic: boolean,
  ): Promise<EmbeddedFontEntry | null> => {
    const existing = fontCache.get(cacheKey);
    if (existing) return existing;
    if (!asset) return null;
    const customBytes =
      (bold && italic && asset.boldItalic) ||
      (bold && asset.bold) ||
      (italic && asset.italic) ||
      asset.regular ||
      asset.bold ||
      asset.italic ||
      asset.boldItalic;
    if (!customBytes) return null;

    let embedded: PDFFont;
    try {
      embedded = await finalDoc.embedFont(customBytes, { subset: true });
    } catch {
      try {
        embedded = await finalDoc.embedFont(customBytes, { subset: false });
      } catch {
        return null;
      }
    }
    const entry: EmbeddedFontEntry = {
      font: embedded,
      supportedCodePoints: new Set(embedded.getCharacterSet()),
    };
    fontCache.set(cacheKey, entry);
    return entry;
  };

  const getFontPair = async (
    family: FontFamilyOption,
    bold: boolean,
    italic: boolean,
    fallback?: BuiltinFontFamilyOption,
  ): Promise<FontPairEntry> => {
    const suffix = `${bold ? 'B' : 'N'}_${italic ? 'I' : 'N'}`;
    const primaryAsset = resolveFontPayload(family, fallback);
    let primary = await embedVariantFromPayload(
      `pri:${primaryAsset?.family ?? family}_${suffix}`,
      primaryAsset,
      bold,
      italic,
    );
    if (!primary) {
      const catAsset = resolveCategoryAsset(family, fallback);
      if (catAsset && catAsset !== primaryAsset) {
        primary = await embedVariantFromPayload(
          `pri:${catAsset.family}_${suffix}`,
          catAsset,
          bold,
          italic,
        );
      }
    }
    if (!primary) {
      const key = `std:${family}_${suffix}`;
      const cached = fontCache.get(key);
      if (!cached) {
        throw new Error('STD_FALLBACK_ASYNC');
      }
      primary = cached;
    }

    const fallbackAsset = resolveFallbackPayload(family, fallback);
    const fbEntry = fallbackAsset
      ? await embedVariantFromPayload(
          `fb:${fallbackAsset.family}_${suffix}`,
          fallbackAsset,
          bold,
          italic,
        )
      : null;

    return { primary, fallback: fbEntry };
  };

  const getFontPairSafe = async (
    family: FontFamilyOption,
    bold: boolean,
    italic: boolean,
    fallback?: BuiltinFontFamilyOption,
  ): Promise<FontPairEntry> => {
    try {
      return await getFontPair(family, bold, italic, fallback);
    } catch {
      const key = `std:${fallback ?? family}_${bold ? 'B' : 'N'}_${italic ? 'I' : 'N'}`;
      let stdEntry = fontCache.get(key);
      if (!stdEntry) {
        const std = getStandardPdfFont(family, bold, italic, fallback);
        const embedded = await finalDoc.embedFont(std);
        stdEntry = { font: embedded, supportedCodePoints: null };
        fontCache.set(key, stdEntry);
      }
      return { primary: stdEntry, fallback: null };
    }
  };

  const extractContentRefs = (page: PDFPage): PDFRef[] => {
    const raw = page.node.get(PDFName.of('Contents'));
    if (raw instanceof PDFRef) return [raw];
    if (raw instanceof PDFArray) {
      const refs: PDFRef[] = [];
      for (let idx = 0; idx < raw.size(); idx++) {
        const item = raw.get(idx);
        if (item instanceof PDFRef) refs.push(item);
      }
      return refs;
    }
    return [];
  };

  const imageCache = new Map<Uint8Array, Awaited<ReturnType<PDFDocument['embedPng']>>>();
  const embedImageBytes = async (bytes: Uint8Array, mimeType: 'image/png' | 'image/jpeg') => {
    const cached = imageCache.get(bytes);
    if (cached) return cached;
    const embedded =
      mimeType === 'image/jpeg'
        ? await finalDoc.embedJpg(bytes)
        : await finalDoc.embedPng(bytes);
    imageCache.set(bytes, embedded);
    return embedded;
  };

  const finalPages = finalDoc.getPages();

  for (let i = 0; i < payload.pages.length; i++) {
    const pageMeta = payload.pages[i];
    const pdfPage = finalPages[i];
    const pageEls = [...(elementsByPage.get(pageMeta.id) ?? [])].sort(
      (a, b) => getElementLayerTier(a) - getElementLayerTier(b) || a.zIndex - b.zIndex,
    );

    const behindEls = pageEls.filter(
      (el) =>
        ((el.kind === 'image' || el.kind === 'image-replacement') &&
          el.behindContent === true &&
          !(el.kind === 'image-replacement' && el.deleted)) ||
        (el.kind === 'shape-replacement' && el.behindContent === true && !el.deleted) ||
        ((el.kind === 'shape' || el.kind === 'path') && el.behindContent === true),
    );
    const behindIds = new Set(behindEls.map((el) => el.id));
    const frontEls = pageEls.filter((el) => !behindIds.has(el.id));

    // Prepend behindContent background/watermark layers before original page streams
    if (behindEls.length > 0) {
      const origRefs = extractContentRefs(pdfPage);
      pdfPage.node.set(PDFName.of('Contents'), finalDoc.context.obj([]));

      for (const el of behindEls) {
        if (el.kind === 'image' || el.kind === 'image-replacement') {
          const img = await embedImageBytes(el.bytes, el.mimeType);
          drawImageElementOnPage(pdfPage, pageMeta, img, el);
        } else if (el.kind === 'shape-replacement') {
          drawRectShapeOnPage(
            pdfPage,
            pageMeta,
            { x: el.x, y: el.y, width: el.width, height: el.height },
            el.rotation,
            {
              fillColor: el.fillColor,
              strokeColor: el.strokeColor,
              strokeWidth: el.strokeWidth,
              opacity: el.opacity,
            },
          );
        } else if (el.kind === 'shape' || el.kind === 'path') {
          drawVectorElementOnPage(pdfPage, pageMeta, el);
        }
      }

      const bgRefs = extractContentRefs(pdfPage);
      const qRef = finalDoc.context.register(finalDoc.context.flateStream('q\n'));
      const QRef = finalDoc.context.register(finalDoc.context.flateStream('Q\n'));
      pdfPage.node.set(
        PDFName.of('Contents'),
        finalDoc.context.obj([...bgRefs, qRef, ...origRefs, QRef]),
      );
      // Reset cached PDFPage stream pointer so foreground elements start a clean trailing stream
      const internalPage = pdfPage as unknown as {
        contentStream?: unknown;
        contentStreamRef?: unknown;
      };
      internalPage.contentStream = undefined;
      internalPage.contentStreamRef = undefined;
    }

    for (const el of frontEls) {
      switch (el.kind) {
        case 'text-edit':
        case 'text-add': {
          if (el.kind === 'text-edit' && el.deleted) break;
          const fallbackFam =
            el.fallbackFontFamily ??
            (el.originalFontName ? parsePdfFontMetadata(el.originalFontName).fontFamily : undefined);
          await drawTextElementOnPage(pdfPage, pageMeta, el, (b, it) =>
            getFontPairSafe(el.fontFamily, b, it, fallbackFam),
          );
          break;
        }
        case 'image':
        case 'image-replacement': {
          if (el.kind === 'image-replacement' && el.deleted) break;
          const img = await embedImageBytes(el.bytes, el.mimeType);
          drawImageElementOnPage(pdfPage, pageMeta, img, el);
          break;
        }
        case 'signature': {
          const sig: SignatureElement = el;
          if (
            !sig.realisticInk &&
            sig.svgPaths &&
            sig.svgPaths.length > 0 &&
            sig.viewBoxWidth &&
            sig.viewBoxHeight
          ) {
            const sx = sig.width / sig.viewBoxWidth;
            const sy = sig.height / sig.viewBoxHeight;
            for (const pathObj of sig.svgPaths) {
              drawSvgBoxOnPage(
                pdfPage,
                pageMeta,
                { x: sig.x, y: sig.y, width: sig.width, height: sig.height },
                sig.rotation,
                pathObj.d,
                sx,
                sy,
                pathObj.color,
                pathObj.strokeWidth * Math.min(sx, sy),
                (pathObj.opacity ?? 1) * sig.opacity,
              );
            }
          } else {
            const img = await embedImageBytes(sig.pngBytes, 'image/png');
            const placement = computePdfLibDrawPlacement(
              { x: sig.x, y: sig.y, width: sig.width, height: sig.height },
              sig.rotation,
              pageMeta,
            );
            drawPlacedImage(pdfPage, img, placement, sig.opacity);
          }
          break;
        }
        case 'stroke': {
          const stroke: StrokeElement = el;
          const d = pointsToSmoothSvgPath(stroke.points, stroke.width, stroke.height);
          drawSvgBoxOnPage(
            pdfPage,
            pageMeta,
            { x: stroke.x, y: stroke.y, width: stroke.width, height: stroke.height },
            stroke.rotation,
            d,
            1,
            1,
            stroke.strokeColor,
            stroke.strokeWidth,
            stroke.opacity,
          );
          break;
        }
        case 'shape-replacement': {
          const shp: ShapeReplacementElement = el;
          if (shp.deleted) break;
          drawRectShapeOnPage(
            pdfPage,
            pageMeta,
            { x: shp.x, y: shp.y, width: shp.width, height: shp.height },
            shp.rotation,
            {
              fillColor: shp.fillColor,
              strokeColor: shp.strokeColor,
              strokeWidth: shp.strokeWidth,
              opacity: shp.opacity,
            },
          );
          break;
        }
        case 'shape':
        case 'path': {
          drawVectorElementOnPage(pdfPage, pageMeta, el);
          break;
        }
        case 'highlight': {
          const h: HighlightElement = el;
          if (h.shape === 'redact') {
            // Already burned in via MuPDF Pass 3
            break;
          }
          drawRectShapeOnPage(
            pdfPage,
            pageMeta,
            { x: h.x, y: h.y, width: h.width, height: h.height },
            h.rotation,
            {
              fillColor: h.fillColor,
              strokeColor: h.strokeColor,
              strokeWidth: h.strokeWidth,
              opacity: h.opacity,
              isHighlight: h.shape === 'highlight',
            },
          );
          break;
        }
      }
    }

    // Stamp dynamic page number when enabled
    if (payload.pageNumbering?.enabled) {
      const rot = normalizeRotation(pageMeta.userRotation);
      const effW = rot === 90 || rot === 270 ? pageMeta.baseHeight : pageMeta.baseWidth;
      const effH = rot === 90 || rot === 270 ? pageMeta.baseWidth : pageMeta.baseHeight;
      const pgLayout = computePageNumberLayout(
        effW,
        effH,
        i,
        payload.pages.length,
        payload.pageNumbering,
      );
      if (pgLayout) {
        const pair = await getFontPairSafe(payload.pageNumbering.fontFamily, false, false);
        const fs = payload.pageNumbering.fontSize;
        const labelW = measureWithFontPair(pgLayout.text, pair, fs);
        const startDispX =
          pgLayout.align === 'center'
            ? pgLayout.x + Math.max(0, (pgLayout.width - labelW) / 2)
            : pgLayout.align === 'right'
              ? pgLayout.x + Math.max(0, pgLayout.width - labelW)
              : pgLayout.x;
        const baselineDispY = pgLayout.y + fs * 0.85;

        const basePt = mapDisplayRotatedPointToBaseVisual(
          startDispX,
          baselineDispY,
          pageMeta.baseWidth,
          pageMeta.baseHeight,
          pageMeta.userRotation,
        );
        const rightPt = mapDisplayRotatedPointToBaseVisual(
          startDispX + 1,
          baselineDispY,
          pageMeta.baseWidth,
          pageMeta.baseHeight,
          pageMeta.userRotation,
        );
        const pdfPt = pointBaseVisualToPdfUserSpace(
          basePt.x,
          basePt.y,
          pageMeta.cropBox,
          pageMeta.intrinsicRotation,
        );
        const pdfRight = pointBaseVisualToPdfUserSpace(
          rightPt.x,
          rightPt.y,
          pageMeta.cropBox,
          pageMeta.intrinsicRotation,
        );
        const angleCCW =
          (Math.atan2(pdfRight.y - pdfPt.y, pdfRight.x - pdfPt.x) * 180) / Math.PI;
        const textColor = pdfRgb(payload.pageNumbering.color);
        let cxCursor = 0;

        for (const seg of splitTextByGlyphSupport(pgLayout.text, pair)) {
          if (!seg.text) continue;
          const segDispX = startDispX + cxCursor;
          const segBase = mapDisplayRotatedPointToBaseVisual(
            segDispX,
            baselineDispY,
            pageMeta.baseWidth,
            pageMeta.baseHeight,
            pageMeta.userRotation,
          );
          const segPdf = pointBaseVisualToPdfUserSpace(
            segBase.x,
            segBase.y,
            pageMeta.cropBox,
            pageMeta.intrinsicRotation,
          );
          pdfPage.drawText(seg.text, {
            x: segPdf.x,
            y: segPdf.y,
            size: fs,
            font: seg.entry.font,
            color: textColor,
            opacity: payload.pageNumbering.opacity,
            rotate: degrees(angleCCW),
          });
          try {
            cxCursor += seg.entry.font.widthOfTextAtSize(seg.text, fs);
          } catch {
            cxCursor += seg.text.length * fs * 0.5;
          }
        }
      }
    }

    // Apply user rotation on top of intrinsic rotation
    if (pageMeta.userRotation !== 0) {
      const targetAngle = ((pageMeta.intrinsicRotation + pageMeta.userRotation) % 360) as RotationAngle;
      pdfPage.setRotation(degrees(targetAngle));
    }
  }

  const savedBytes = await finalDoc.save({ useObjectStreams: true });

  // Stage 4: Optional MuPDF Wasm garbage collection & stream compression
  if (payload.optimizeWithMupdf !== false) {
    const optDoc = mupdf.Document.openDocument(savedBytes, 'application/pdf');
    try {
      const optPdf = optDoc.asPDF();
      if (optPdf) {
        const optBuf = optPdf.saveToBuffer('garbage=3,compress');
        try {
          const raw = optBuf.asUint8Array();
          const out = new Uint8Array(raw.byteLength);
          out.set(raw);
          return out;
        } finally {
          optBuf.destroy();
        }
      }
    } finally {
      optDoc.destroy();
    }
  }

  return savedBytes;
}

/**
 * Compiles one or more split/extract jobs and bundles multi-file outputs into a ZIP archive.
 */
export async function splitPdfToZip(
  mupdf: MuPdfModule,
  payload: SplitPdfZipPayload,
): Promise<Uint8Array> {
  const zip = new JSZip();

  for (const job of payload.jobs) {
    const pageIds = new Set(job.pages.map((p) => p.id));
    const jobElements = payload.elements.filter((el) => pageIds.has(el.pageId));
    const pdfBytes = await compilePdfDocument(mupdf, {
      sourceDocs: payload.sourceDocs,
      pages: job.pages,
      elements: jobElements,
      fonts: payload.fonts,
      pageNumbering: payload.pageNumbering,
      optimizeWithMupdf: true,
    });
    zip.file(job.filename, pdfBytes);
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
