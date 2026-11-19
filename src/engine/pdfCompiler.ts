import JSZip from 'jszip';
import {
  isUnmodifiedTextEdit,
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
  PageNumberingConfig,
  RectBox,
  RotationAngle,
  TextScriptMode,
} from '@/types/pdf';
import type { FontAssetPayload } from '@/types/worker';
import {
  getRotatedBoundingBox,
  normalizeRotation,
  pointBaseVisualToPdfUserSpace,
  rectBaseVisualToPdfUserSpace,
} from './coordinates';
import {
  filterTextForPdfFont,
  getFontCategory,
  getStandardPdfFont,
  isBuiltinFontFamily,
  type FontCategory,
  type StandardPdfFontName,
} from './fonts';
import {
  elementLocalToPage,
  flipSvgPath,
  parseSvgPathCommands,
  scaleSvgPath as scaleSvgPathCommands,
  type SvgPathCommand,
} from './imageMask';
import { computePageNumberLayout } from './pageNumbers';
import { getSharedPdfium, type PdfiumRuntimeModule } from './pdfium/pdfiumLoader';
import { buildWrappedRichLines, ensureRunsFromElement } from './richText';
import { ensureRustCoreReady, type GpWasmModule } from './rustCoreBridge';
import {
  pathPointsToSvgPath,
  pointsToSmoothSvgPath,
  shapeToSvgPath,
  strokeDashToArray,
} from './vectorShapes';

export interface PdfPageInspectInfo {
  sourcePageIndex: number;
  baseWidth: number;
  baseHeight: number;
  intrinsicRotation: RotationAngle;
  mediaBox: [number, number, number, number];
  cropBox: [number, number, number, number];
}

export interface PdfInspectResult {
  status: 'ok' | 'needs-password' | 'invalid-password';
  decryptedBytes?: Uint8Array;
  wasEncrypted: boolean;
  pageCount: number;
  pages: PdfPageInspectInfo[];
}

export interface CompilePdfPayload {
  sourceDocs: Array<{ id: string; bytes: Uint8Array }>;
  pages: PageMeta[];
  elements: CanvasElement[];
  fonts?: FontAssetPayload[];
  pageNumbering?: PageNumberingConfig | null;
  optimizeWithMupdf?: boolean;
}

export interface SplitPdfZipJob {
  id: string;
  filename: string;
  pages: PageMeta[];
}

export interface SplitPdfZipPayload {
  sourceDocs: Array<{ id: string; bytes: Uint8Array }>;
  elements: CanvasElement[];
  jobs: SplitPdfZipJob[];
  fonts?: FontAssetPayload[];
  pageNumbering?: PageNumberingConfig | null;
}

const FPDF_ERR_PASSWORD = 4;
const FPDF_FONT_TRUETYPE = 2;
const FPDF_FILLMODE_WINDING = 2;

function parseHexColorBytes(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
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

  return lines;
}

function savePdfiumDocToBytes(mod: PdfiumRuntimeModule, docPtr: number): Uint8Array {
  const writer = mod.PDFiumExt_OpenFileWriter();
  if (!writer) {
    throw new Error('Failed to open PDFium file writer.');
  }
  try {
    const ok = mod.PDFiumExt_SaveAsCopy(docPtr, writer);
    if (!ok) {
      throw new Error('PDFium failed to serialize compiled PDF.');
    }
    const size = mod.PDFiumExt_GetFileWriterSize(writer);
    if (size <= 0) {
      return new Uint8Array(0);
    }
    const outPtr = mod.pdfium.wasmExports.malloc(size);
    if (!outPtr) {
      throw new Error('Out of Wasm memory while copying compiled PDF.');
    }
    try {
      mod.PDFiumExt_GetFileWriterData(writer, outPtr, size);
      const out = new Uint8Array(size);
      out.set(mod.pdfium.HEAPU8.subarray(outPtr, outPtr + size));
      return out;
    } finally {
      mod.pdfium.wasmExports.free(outPtr);
    }
  } finally {
    mod.PDFiumExt_CloseFileWriter(writer);
  }
}

function loadPdfiumMemDoc(
  mod: PdfiumRuntimeModule,
  bytes: Uint8Array,
  password = '',
): { docPtr: number; freeData: () => void } {
  const ptr = mod.pdfium.wasmExports.malloc(bytes.byteLength);
  if (!ptr) {
    throw new Error('Out of Wasm memory allocating PDF buffer.');
  }
  mod.pdfium.HEAPU8.set(bytes, ptr);
  const docPtr = mod.FPDF_LoadMemDocument(ptr, bytes.byteLength, password);
  if (!docPtr) {
    mod.pdfium.wasmExports.free(ptr);
    return { docPtr: 0, freeData: () => undefined };
  }
  return {
    docPtr,
    freeData: () => mod.pdfium.wasmExports.free(ptr),
  };
}

/**
 * Inspects a PDF buffer using PDFium Wasm and returns decrypted bytes (when password-protected),
 * page dimensions, crop/media boxes, and intrinsic page rotations.
 */
export async function inspectPdfDocument(
  bytes: Uint8Array,
  password?: string,
): Promise<PdfInspectResult> {
  const mod = await getSharedPdfium();
  const dataPtr = mod.pdfium.wasmExports.malloc(bytes.byteLength);
  if (!dataPtr) {
    throw new Error('Out of Wasm memory allocating PDF buffer.');
  }
  mod.pdfium.HEAPU8.set(bytes, dataPtr);

  let docPtr = mod.FPDF_LoadMemDocument(dataPtr, bytes.byteLength, password ?? '');
  if (!docPtr) {
    const errCode = mod.FPDF_GetLastError();
    mod.pdfium.wasmExports.free(dataPtr);
    if (errCode === FPDF_ERR_PASSWORD) {
      return {
        status: password ? 'invalid-password' : 'needs-password',
        wasEncrypted: true,
        pageCount: 0,
        pages: [],
      };
    }
    throw new Error(`Unable to open PDF document (PDFium error ${errCode}).`);
  }

  try {
    const wasEncrypted = mod.EPDF_IsEncrypted(docPtr);
    let decryptedBytes: Uint8Array | undefined;
    if (wasEncrypted) {
      mod.EPDF_RemoveEncryption(docPtr);
      decryptedBytes = savePdfiumDocToBytes(mod, docPtr);
    }

    const pageCount = mod.FPDF_GetPageCount(docPtr);
    const pages: PdfPageInspectInfo[] = [];
    const boxPtr = mod.pdfium.wasmExports.malloc(16);
    if (!boxPtr) {
      throw new Error('Out of Wasm memory allocating page box buffer.');
    }

    try {
      for (let i = 0; i < pageCount; i++) {
        const pagePtr = mod.FPDF_LoadPage(docPtr, i);
        if (!pagePtr) {
          throw new Error(`Failed loading page ${i + 1} during inspection.`);
        }
        try {
          const rotIdx = mod.EPDF_GetPageRotationByIndex(docPtr, i);
          const intrinsicRotation = normalizeRotation(rotIdx * 90);

          const hasMedia = mod.FPDFPage_GetMediaBox(
            pagePtr,
            boxPtr,
            boxPtr + 4,
            boxPtr + 8,
            boxPtr + 12,
          );
          const rawW = mod.FPDF_GetPageWidthF(pagePtr) || 595;
          const rawH = mod.FPDF_GetPageHeightF(pagePtr) || 842;

          let mediaBox: [number, number, number, number];
          if (hasMedia) {
            const l = mod.pdfium.getValue(boxPtr, 'float');
            const b = mod.pdfium.getValue(boxPtr + 4, 'float');
            const r = mod.pdfium.getValue(boxPtr + 8, 'float');
            const t = mod.pdfium.getValue(boxPtr + 12, 'float');
            mediaBox = [l, b, r, t];
          } else {
            mediaBox = [0, 0, rawW, rawH];
          }

          const hasCrop = mod.FPDFPage_GetCropBox(
            pagePtr,
            boxPtr,
            boxPtr + 4,
            boxPtr + 8,
            boxPtr + 12,
          );
          let cropBox: [number, number, number, number] = [...mediaBox];
          if (hasCrop) {
            const l = mod.pdfium.getValue(boxPtr, 'float');
            const b = mod.pdfium.getValue(boxPtr + 4, 'float');
            const r = mod.pdfium.getValue(boxPtr + 8, 'float');
            const t = mod.pdfium.getValue(boxPtr + 12, 'float');
            if (Math.abs(r - l) > 1 && Math.abs(t - b) > 1) {
              cropBox = [l, b, r, t];
            }
          }

          const cw = Math.abs(cropBox[2] - cropBox[0]);
          const ch = Math.abs(cropBox[3] - cropBox[1]);
          const swapped = intrinsicRotation === 90 || intrinsicRotation === 270;
          const baseWidth = swapped ? ch : cw;
          const baseHeight = swapped ? cw : ch;

          pages.push({
            sourcePageIndex: i,
            baseWidth,
            baseHeight,
            intrinsicRotation,
            mediaBox,
            cropBox,
          });
        } finally {
          mod.FPDF_ClosePage(pagePtr);
        }
      }
    } finally {
      mod.pdfium.wasmExports.free(boxPtr);
    }

    return {
      status: 'ok',
      decryptedBytes,
      wasEncrypted,
      pageCount,
      pages,
    };
  } finally {
    mod.FPDF_CloseDocument(docPtr);
    mod.pdfium.wasmExports.free(dataPtr);
  }
}

function stripLeftoverObjectsWithPdfiumWasm(
  mod: PdfiumRuntimeModule,
  pdfBytes: Uint8Array,
  imageTargets: RedactionEntry[],
  textTargets: RedactionEntry[],
): Uint8Array {
  if (imageTargets.length === 0 && textTargets.length === 0) {
    return pdfBytes;
  }

  const imgByPage = new Map<number, RedactionEntry[]>();
  for (const r of imageTargets) {
    if (r.width <= 0 || r.height <= 0) continue;
    const list = imgByPage.get(r.pageIndex) ?? [];
    list.push(r);
    imgByPage.set(r.pageIndex, list);
  }
  const txtByPage = new Map<number, RedactionEntry[]>();
  for (const r of textTargets) {
    if (r.width <= 0 || r.height <= 0) continue;
    const list = txtByPage.get(r.pageIndex) ?? [];
    list.push(r);
    txtByPage.set(r.pageIndex, list);
  }
  const pageIndices = new Set<number>([...imgByPage.keys(), ...txtByPage.keys()]);
  if (pageIndices.size === 0) return pdfBytes;

  const { docPtr, freeData } = loadPdfiumMemDoc(mod, pdfBytes);
  if (!docPtr) return pdfBytes;

  const FPDF_OBJ_TEXT = 1;
  const FPDF_OBJ_IMAGE = 3;
  const FPDF_OBJ_FORM = 5;

  const boundsPtr = mod.pdfium.wasmExports.malloc(16);
  const matrixPtr = mod.pdfium.wasmExports.malloc(24);
  const charBoxPtr = mod.pdfium.wasmExports.malloc(32);
  if (!boundsPtr || !matrixPtr || !charBoxPtr) {
    if (boundsPtr) mod.pdfium.wasmExports.free(boundsPtr);
    if (matrixPtr) mod.pdfium.wasmExports.free(matrixPtr);
    if (charBoxPtr) mod.pdfium.wasmExports.free(charBoxPtr);
    mod.FPDF_CloseDocument(docPtr);
    freeData();
    return pdfBytes;
  }

  type PdfMat = [number, number, number, number, number, number];
  const mulMat = (parent: PdfMat, local: PdfMat): PdfMat => [
    local[0] * parent[0] + local[1] * parent[2],
    local[0] * parent[1] + local[1] * parent[3],
    local[2] * parent[0] + local[3] * parent[2],
    local[2] * parent[1] + local[3] * parent[3],
    local[4] * parent[0] + local[5] * parent[2] + parent[4],
    local[4] * parent[1] + local[5] * parent[3] + parent[5],
  ];
  const transformBounds = (
    l: number,
    b: number,
    r: number,
    t: number,
    m: PdfMat | null,
  ): [number, number, number, number] => {
    if (!m) {
      return [Math.min(l, r), Math.min(b, t), Math.max(l, r), Math.max(b, t)];
    }
    const pts = [
      [l, b],
      [r, b],
      [l, t],
      [r, t],
    ].map(([px, py]) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]]);
    return [
      Math.min(...pts.map((p) => p[0])),
      Math.min(...pts.map((p) => p[1])),
      Math.max(...pts.map((p) => p[0])),
      Math.max(...pts.map((p) => p[1])),
    ];
  };

  let anyRemoved = false;
  try {
    const pageCount = mod.FPDF_GetPageCount(docPtr);
    for (const pageIdx of pageIndices) {
      if (pageIdx < 0 || pageIdx >= pageCount) continue;
      const pagePtr = mod.FPDF_LoadPage(docPtr, pageIdx);
      if (!pagePtr) continue;
      let removedOnPage = false;

      try {
        const pageH = mod.FPDF_GetPageHeightF(pagePtr) || 842;
        const imgTargets = (imgByPage.get(pageIdx) ?? []).map((r) => ({
          l: r.x,
          b: pageH - (r.y + r.height),
          r: r.x + r.width,
          t: pageH - r.y,
        }));
        const txtTargets = (txtByPage.get(pageIdx) ?? []).map((r) => ({
          l: r.x,
          b: pageH - (r.y + r.height),
          r: r.x + r.width,
          t: pageH - r.y,
        }));

        const shortCharBoxes: Array<[number, number, number, number]> = [];
        if (txtTargets.length > 0) {
          const tp = mod.FPDFText_LoadPage(pagePtr);
          if (tp) {
            try {
              const cc = mod.FPDFText_CountChars(tp);
              for (let ci = 0; ci < cc; ci++) {
                const uc = mod.FPDFText_GetUnicode(tp, ci);
                if (!uc || uc <= 0x20) continue;
                if (
                  mod.FPDFText_GetCharBox(
                    tp,
                    ci,
                    charBoxPtr,
                    charBoxPtr + 8,
                    charBoxPtr + 16,
                    charBoxPtr + 24,
                  )
                ) {
                  const cl = mod.pdfium.getValue(charBoxPtr, 'double');
                  const cr = mod.pdfium.getValue(charBoxPtr + 8, 'double');
                  const cb = mod.pdfium.getValue(charBoxPtr + 16, 'double');
                  const ct = mod.pdfium.getValue(charBoxPtr + 24, 'double');
                  shortCharBoxes.push([
                    Math.min(cl, cr),
                    Math.min(cb, ct),
                    Math.max(cl, cr),
                    Math.max(cb, ct),
                  ]);
                }
              }
            } finally {
              mod.FPDFText_ClosePage(tp);
            }
          }
        }

        const countNonSpaceChars = (ol: number, ob: number, or: number, ot: number): number => {
          let n = 0;
          for (const [cl, cb, cr, ct] of shortCharBoxes) {
            if (cr > ol - 0.5 && cl < or + 0.5 && ct > ob - 0.5 && cb < ot + 0.5) {
              n++;
              if (n > 4) break;
            }
          }
          return n;
        };

        const walkAndStrip = (containerPtr: number, isForm: boolean, parentMat: PdfMat | null) => {
          const count = isForm
            ? mod.FPDFFormObj_CountObjects(containerPtr)
            : mod.FPDFPage_CountObjects(containerPtr);
          for (let i = count - 1; i >= 0; i--) {
            const objPtr = isForm
              ? mod.FPDFFormObj_GetObject(containerPtr, i)
              : mod.FPDFPage_GetObject(containerPtr, i);
            if (!objPtr) continue;
            const objType = mod.FPDFPageObj_GetType(objPtr);

            if (objType === FPDF_OBJ_FORM) {
              let nextMat = parentMat;
              if (mod.FPDFPageObj_GetMatrix(objPtr, matrixPtr)) {
                const local: PdfMat = [
                  mod.pdfium.getValue(matrixPtr, 'float'),
                  mod.pdfium.getValue(matrixPtr + 4, 'float'),
                  mod.pdfium.getValue(matrixPtr + 8, 'float'),
                  mod.pdfium.getValue(matrixPtr + 12, 'float'),
                  mod.pdfium.getValue(matrixPtr + 16, 'float'),
                  mod.pdfium.getValue(matrixPtr + 20, 'float'),
                ];
                nextMat = parentMat ? mulMat(parentMat, local) : local;
              }
              walkAndStrip(objPtr, true, nextMat);
              continue;
            }

            if (
              !mod.FPDFPageObj_GetBounds(
                objPtr,
                boundsPtr,
                boundsPtr + 4,
                boundsPtr + 8,
                boundsPtr + 12,
              )
            ) {
              continue;
            }
            const [ol, ob, or, ot] = transformBounds(
              mod.pdfium.getValue(boundsPtr, 'float'),
              mod.pdfium.getValue(boundsPtr + 4, 'float'),
              mod.pdfium.getValue(boundsPtr + 8, 'float'),
              mod.pdfium.getValue(boundsPtr + 12, 'float'),
              parentMat,
            );

            let shouldRemove = false;
            if (objType === FPDF_OBJ_IMAGE && imgTargets.length > 0) {
              for (const t of imgTargets) {
                const tolX = Math.max(3.5, 0.08 * Math.max(Math.abs(or - ol), Math.abs(t.r - t.l)));
                const tolY = Math.max(3.5, 0.08 * Math.max(Math.abs(ot - ob), Math.abs(t.t - t.b)));
                const edgeMatch =
                  Math.abs(ol - t.l) <= tolX &&
                  Math.abs(or - t.r) <= tolX &&
                  Math.abs(ob - t.b) <= tolY &&
                  Math.abs(ot - t.t) <= tolY;
                const contained =
                  ol >= t.l - 2.5 && or <= t.r + 2.5 && ob >= t.b - 2.5 && ot <= t.t + 2.5;
                if (edgeMatch || contained) {
                  shouldRemove = true;
                  break;
                }
              }
            } else if (objType === FPDF_OBJ_TEXT && txtTargets.length > 0) {
              for (const t of txtTargets) {
                const contained =
                  ol >= t.l - 2.5 && or <= t.r + 2.5 && ob >= t.b - 2.5 && ot <= t.t + 2.5;
                if (contained) {
                  shouldRemove = true;
                  break;
                }
                const vertOverlap = Math.min(ot, t.t) - Math.max(ob, t.b);
                const tgtH = Math.max(4, Math.abs(t.t - t.b));
                if (
                  vertOverlap >= tgtH * 0.3 &&
                  ol >= t.l - 2.5 &&
                  ol <= t.r + 14 &&
                  or <= t.r + 16 &&
                  or - ol <= 24 &&
                  countNonSpaceChars(ol, ob, or, ot) <= 4
                ) {
                  shouldRemove = true;
                  break;
                }
              }
            }

            if (shouldRemove) {
              const ok = isForm
                ? mod.FPDFFormObj_RemoveObject(containerPtr, objPtr)
                : mod.FPDFPage_RemoveObject(pagePtr, objPtr);
              if (ok) {
                mod.FPDFPageObj_Destroy(objPtr);
                removedOnPage = true;
              }
            }
          }
        };

        walkAndStrip(pagePtr, false, null);
        if (removedOnPage) {
          mod.FPDFPage_GenerateContent(pagePtr);
          anyRemoved = true;
        }
      } finally {
        mod.FPDF_ClosePage(pagePtr);
      }
    }

    if (!anyRemoved) return pdfBytes;
    return savePdfiumDocToBytes(mod, docPtr);
  } finally {
    mod.pdfium.wasmExports.free(boundsPtr);
    mod.pdfium.wasmExports.free(matrixPtr);
    mod.pdfium.wasmExports.free(charBoxPtr);
    mod.FPDF_CloseDocument(docPtr);
    freeData();
  }
}

/**
 * Produces a clean 1-page preview PDF with edited text / deleted or moved image XObject /
 * deleted vector shape stream operators removed via Rust `gp-wasm`, preserving tables/lines.
 */
export async function prepareCleanPreviewPagePdf(
  srcPdfBytes: Uint8Array,
  sourcePageIndex: number,
  textRects: RectBox[],
  imageRects: RectBox[],
  shapeRects: RectBox[] = [],
): Promise<Uint8Array> {
  const wasm = await ensureRustCoreReady();
  const out = wasm.prepare_clean_page_preview_bytes(
    srcPdfBytes,
    sourcePageIndex,
    textRects,
    imageRects,
    shapeRects,
  );
  let bytes = out instanceof Uint8Array ? out : new Uint8Array(out);
  if (imageRects.length > 0 || textRects.length > 0) {
    try {
      const mod = await getSharedPdfium();
      const imgP0: RedactionEntry[] = imageRects.map((r) => ({ pageIndex: 0, ...r }));
      const txtP0: RedactionEntry[] = textRects.map((r) => ({ pageIndex: 0, ...r }));
      bytes = stripLeftoverObjectsWithPdfiumWasm(mod, bytes, imgP0, txtP0);
    } catch {
      // Fall back to lopdf output if PDFium isn't ready yet.
    }
  }
  return bytes;
}

interface RedactionEntry {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Mandatory D3 post-redaction PDFium `FPDFText_*` check:
 * Ensures zero non-whitespace characters remain inside explicit black redaction rectangles.
 */
function verifyRedactionsWithPdfium(
  mod: PdfiumRuntimeModule,
  redactedBytes: Uint8Array,
  blackRedactRects: RedactionEntry[],
  pageMetas: PageMeta[],
): number {
  if (blackRedactRects.length === 0) return 0;

  const { docPtr, freeData } = loadPdfiumMemDoc(mod, redactedBytes);
  if (!docPtr) {
    throw new Error('PDFium failed to open redacted PDF for D3 text verification.');
  }

  const charBoxPtr = mod.pdfium.wasmExports.malloc(32); // 4 doubles (8 bytes each)
  if (!charBoxPtr) {
    mod.FPDF_CloseDocument(docPtr);
    freeData();
    return 0;
  }

  let leakedChars = 0;
  try {
    const byPage = new Map<number, RedactionEntry[]>();
    for (const r of blackRedactRects) {
      if (r.width <= 0 || r.height <= 0) continue;
      const list = byPage.get(r.pageIndex) ?? [];
      list.push(r);
      byPage.set(r.pageIndex, list);
    }

    for (const [pageIdx, rects] of byPage.entries()) {
      const pageMeta = pageMetas[pageIdx];
      const pagePtr = mod.FPDF_LoadPage(docPtr, pageIdx);
      if (!pagePtr) continue;
      try {
        const textPagePtr = mod.FPDFText_LoadPage(pagePtr);
        if (!textPagePtr) continue;
        try {
          const pdfTargets: Array<[number, number, number, number]> = rects.map((r) => {
            if (pageMeta) {
              return rectBaseVisualToPdfUserSpace(r, pageMeta.cropBox, pageMeta.intrinsicRotation);
            }
            const pageH = mod.FPDF_GetPageHeightF(pagePtr) || 842;
            const y0 = pageH - (r.y + r.height);
            return [r.x, y0, r.x + r.width, y0 + r.height];
          });
          const charCount = mod.FPDFText_CountChars(textPagePtr);
          for (let ci = 0; ci < charCount; ci++) {
            const chCode = mod.FPDFText_GetUnicode(textPagePtr, ci);
            if (!chCode) continue;
            const chStr = String.fromCodePoint(chCode);
            if (/\s/.test(chStr) || chCode < 32) continue;
            const ok = mod.FPDFText_GetCharBox(
              textPagePtr,
              ci,
              charBoxPtr,
              charBoxPtr + 8,
              charBoxPtr + 16,
              charBoxPtr + 24,
            );
            if (!ok) continue;
            const l = mod.pdfium.getValue(charBoxPtr, 'double');
            const r = mod.pdfium.getValue(charBoxPtr + 8, 'double');
            const b = mod.pdfium.getValue(charBoxPtr + 16, 'double');
            const t = mod.pdfium.getValue(charBoxPtr + 24, 'double');
            const cw = Math.abs(r - l);
            const ch = Math.abs(t - b);
            if (cw <= 0.05 && ch <= 0.05) continue;

            const cLeft = Math.min(l, r);
            const cRight = Math.max(l, r);
            const cBot = Math.min(b, t);
            const cTop = Math.max(b, t);

            for (const target of pdfTargets) {
              const tLeft = Math.min(target[0], target[2]);
              const tRight = Math.max(target[0], target[2]);
              const tBot = Math.min(target[1], target[3]);
              const tTop = Math.max(target[1], target[3]);
              const eps = 0.25;
              if (
                tRight > cLeft + eps &&
                tLeft < cRight - eps &&
                tTop > cBot + eps &&
                tBot < cTop - eps
              ) {
                leakedChars++;
                break;
              }
            }
          }
        } finally {
          mod.FPDFText_ClosePage(textPagePtr);
        }
      } finally {
        mod.FPDF_ClosePage(pagePtr);
      }
    }
  } finally {
    mod.pdfium.wasmExports.free(charBoxPtr);
    mod.FPDF_CloseDocument(docPtr);
    freeData();
  }

  return leakedChars;
}

interface PdfiumLoadedFont {
  fontPtr: number;
  supportedCodePoints: Set<number> | null;
  glyphWidthCache: Map<string, number>;
}

interface PdfiumFontPair {
  primary: PdfiumLoadedFont;
  fallback: PdfiumLoadedFont | null;
}

function measureFontWidth(
  mod: PdfiumRuntimeModule,
  entry: PdfiumLoadedFont,
  text: string,
  fontSize: number,
): number {
  if (!text) return 0;
  const ptr = mod.pdfium.wasmExports.malloc(4);
  if (!ptr) {
    return text.length * fontSize * 0.5;
  }
  let total = 0;
  try {
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      const cacheKey = `${fontSize}:${cp}`;
      const cached = entry.glyphWidthCache.get(cacheKey);
      if (cached !== undefined) {
        total += cached;
      } else {
        const ok = mod.FPDFFont_GetGlyphWidth(entry.fontPtr, cp, fontSize, ptr);
        const measured = ok ? Number(mod.pdfium.getValue(ptr, 'float') || 0) : 0;
        let nextW: number;
        if (ch === ' ') {
          nextW =
            measured >= fontSize * 0.14 && measured <= fontSize * 0.75
              ? measured
              : fontSize * 0.28;
        } else {
          nextW = measured > 0 ? measured : fontSize * 0.52;
        }
        entry.glyphWidthCache.set(cacheKey, nextW);
        total += nextW;
      }
    }
  } finally {
    mod.pdfium.wasmExports.free(ptr);
  }
  return total;
}

function splitTextByGlyphSupport(
  text: string,
  pair: PdfiumFontPair,
): Array<{ entry: PdfiumLoadedFont; text: string }> {
  const supported = pair.primary.supportedCodePoints;
  if (!supported || !pair.fallback) {
    return [
      {
        entry: pair.primary,
        text: filterTextForPdfFont(text, supported),
      },
    ];
  }

  const segments: Array<{ entry: PdfiumLoadedFont; text: string }> = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const usePrimary =
      cp === undefined || (ch === ' ' ? supported.has(0x20) : supported.has(cp));
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
  mod: PdfiumRuntimeModule,
  text: string,
  pair: PdfiumFontPair,
  fontSize: number,
): number {
  let width = 0;
  for (const seg of splitTextByGlyphSupport(text, pair)) {
    if (!seg.text) continue;
    width += measureFontWidth(mod, seg.entry, seg.text, fontSize);
  }
  return width;
}

function writeFsMatrix(
  mod: PdfiumRuntimeModule,
  ptr: number,
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
): void {
  mod.pdfium.setValue(ptr, a, 'float');
  mod.pdfium.setValue(ptr + 4, b, 'float');
  mod.pdfium.setValue(ptr + 8, c, 'float');
  mod.pdfium.setValue(ptr + 12, d, 'float');
  mod.pdfium.setValue(ptr + 16, e, 'float');
  mod.pdfium.setValue(ptr + 20, f, 'float');
}

function insertPageObjectOrdered(
  mod: PdfiumRuntimeModule,
  pagePtr: number,
  objPtr: number,
  behindIndex: { next: number } | null,
): void {
  if (behindIndex !== null) {
    const ok = mod.FPDFPage_InsertObjectAtIndex(pagePtr, objPtr, behindIndex.next);
    if (ok) {
      behindIndex.next += 1;
      return;
    }
  }
  mod.FPDFPage_InsertObject(pagePtr, objPtr);
}

function emitTextRunAtVisualPoint(
  mod: PdfiumRuntimeModule,
  docPtr: number,
  pagePtr: number,
  pageMeta: PageMeta,
  fontPtr: number,
  fontSize: number,
  text: string,
  visX: number,
  visY: number,
  rotationDegCW: number,
  hScale: number,
  colorHex: string,
  opacity: number,
  scratchMatrixPtr: number,
  behindIndex: { next: number } | null,
): void {
  if (!text) return;
  const objPtr = mod.FPDFPageObj_CreateTextObj(docPtr, fontPtr, fontSize);
  if (!objPtr) return;

  const bufBytes = (text.length + 1) * 2;
  const textBuf = mod.pdfium.wasmExports.malloc(bufBytes);
  if (!textBuf) {
    mod.FPDFPageObj_Destroy(objPtr);
    return;
  }
  mod.pdfium.stringToUTF16(text, textBuf, bufBytes);
  const okText = mod.FPDFText_SetText(objPtr, textBuf);
  mod.pdfium.wasmExports.free(textBuf);
  if (!okText) {
    mod.FPDFPageObj_Destroy(objPtr);
    return;
  }

  const { r, g, b } = parseHexColorBytes(colorHex);
  const alpha = Math.max(0, Math.min(255, Math.round(opacity * 255)));
  mod.FPDFPageObj_SetFillColor(objPtr, r, g, b, alpha);

  // Map visual baseline and glyph-up vectors through affine BaseVisual -> PdfUserSpace Jacobian
  const radCW = (rotationDegCW * Math.PI) / 180;
  const cos = Math.cos(radCW);
  const sin = Math.sin(radCW);

  const pdfPt = pointBaseVisualToPdfUserSpace(
    visX,
    visY,
    pageMeta.cropBox,
    pageMeta.intrinsicRotation,
  );
  const oPdf = pointBaseVisualToPdfUserSpace(0, 0, pageMeta.cropBox, pageMeta.intrinsicRotation);
  const xAxisPdf = pointBaseVisualToPdfUserSpace(
    1,
    0,
    pageMeta.cropBox,
    pageMeta.intrinsicRotation,
  );
  const yAxisPdf = pointBaseVisualToPdfUserSpace(
    0,
    1,
    pageMeta.cropBox,
    pageMeta.intrinsicRotation,
  );

  const jxx = xAxisPdf.x - oPdf.x;
  const jxy = xAxisPdf.y - oPdf.y;
  const jyx = yAxisPdf.x - oPdf.x;
  const jyy = yAxisPdf.y - oPdf.y;

  // In visual coords: text baseline unit vector is (cos, sin), glyph up vector is (sin, -cos)
  const a = (cos * jxx + sin * jyx) * hScale;
  const pb = (cos * jxy + sin * jyy) * hScale;
  const c = sin * jxx - cos * jyx;
  const d = sin * jxy - cos * jyy;

  writeFsMatrix(mod, scratchMatrixPtr, a, pb, c, d, pdfPt.x, pdfPt.y);
  mod.FPDFPageObj_SetMatrix(objPtr, scratchMatrixPtr);

  insertPageObjectOrdered(mod, pagePtr, objPtr, behindIndex);
}

function buildSvgClipCommandsInPdfSpace(
  svgPath: string,
  mapLocalToPdf: (lx: number, ly: number) => { x: number; y: number },
): Array<
  | { op: 'move-to'; x: number; y: number }
  | { op: 'line-to'; x: number; y: number }
  | { op: 'curve-to'; cx1: number; cy1: number; cx2: number; cy2: number; x: number; y: number }
  | { op: 'close' }
> {
  const cmds = parseSvgPathCommands(svgPath);
  const out: Array<
    | { op: 'move-to'; x: number; y: number }
    | { op: 'line-to'; x: number; y: number }
    | { op: 'curve-to'; cx1: number; cy1: number; cx2: number; cy2: number; x: number; y: number }
    | { op: 'close' }
  > = [];

  let curPdf = { x: 0, y: 0 };
  let startPdf = { x: 0, y: 0 };

  for (const c of cmds) {
    if (c.cmd === 'M' && c.nums.length >= 2) {
      curPdf = mapLocalToPdf(c.nums[0], c.nums[1]);
      startPdf = curPdf;
      out.push({ op: 'move-to', x: curPdf.x, y: curPdf.y });
      for (let i = 2; i + 1 < c.nums.length; i += 2) {
        curPdf = mapLocalToPdf(c.nums[i], c.nums[i + 1]);
        out.push({ op: 'line-to', x: curPdf.x, y: curPdf.y });
      }
    } else if (c.cmd === 'L') {
      for (let i = 0; i + 1 < c.nums.length; i += 2) {
        curPdf = mapLocalToPdf(c.nums[i], c.nums[i + 1]);
        out.push({ op: 'line-to', x: curPdf.x, y: curPdf.y });
      }
    } else if (c.cmd === 'Q') {
      for (let i = 0; i + 3 < c.nums.length; i += 4) {
        const pCp = mapLocalToPdf(c.nums[i], c.nums[i + 1]);
        const pEnd = mapLocalToPdf(c.nums[i + 2], c.nums[i + 3]);
        out.push({
          op: 'curve-to',
          cx1: curPdf.x + (2 / 3) * (pCp.x - curPdf.x),
          cy1: curPdf.y + (2 / 3) * (pCp.y - curPdf.y),
          cx2: pEnd.x + (2 / 3) * (pCp.x - pEnd.x),
          cy2: pEnd.y + (2 / 3) * (pCp.y - pEnd.y),
          x: pEnd.x,
          y: pEnd.y,
        });
        curPdf = pEnd;
      }
    } else if (c.cmd === 'C') {
      for (let i = 0; i + 5 < c.nums.length; i += 6) {
        const pC1 = mapLocalToPdf(c.nums[i], c.nums[i + 1]);
        const pC2 = mapLocalToPdf(c.nums[i + 2], c.nums[i + 3]);
        const pEnd = mapLocalToPdf(c.nums[i + 4], c.nums[i + 5]);
        out.push({
          op: 'curve-to',
          cx1: pC1.x,
          cy1: pC1.y,
          cx2: pC2.x,
          cy2: pC2.y,
          x: pEnd.x,
          y: pEnd.y,
        });
        curPdf = pEnd;
      }
    } else if (c.cmd === 'Z') {
      out.push({ op: 'close' });
      curPdf = startPdf;
    }
  }

  return out;
}

function drawSvgCommandsAsPdfiumPath(
  mod: PdfiumRuntimeModule,
  pagePtr: number,
  cmds: SvgPathCommand[],
  mapLocalToPdf: (lx: number, ly: number) => { x: number; y: number },
  style: {
    fillColor?: string;
    fillAlpha?: number;
    strokeColor?: string;
    strokeWidth?: number;
    strokeAlpha?: number;
    dashArray?: number[];
  },
  behindIndex: { next: number } | null,
): void {
  const fillHex = style.fillColor;
  const strokeHex = style.strokeColor;
  const strokeWidth = style.strokeWidth ?? 0;
  const hasFill = Boolean(fillHex && fillHex !== 'transparent');
  const hasStroke = Boolean(strokeHex && strokeHex !== 'transparent' && strokeWidth > 0);
  if (!hasFill && !hasStroke) return;

  let pathObj = 0;
  let curPdf = { x: 0, y: 0 };
  let startPdf = { x: 0, y: 0 };

  for (const c of cmds) {
    if (c.cmd === 'M' && c.nums.length >= 2) {
      curPdf = mapLocalToPdf(c.nums[0], c.nums[1]);
      startPdf = curPdf;
      if (!pathObj) {
        pathObj = mod.FPDFPageObj_CreateNewPath(curPdf.x, curPdf.y);
      } else {
        mod.FPDFPath_MoveTo(pathObj, curPdf.x, curPdf.y);
      }
      for (let i = 2; i + 1 < c.nums.length; i += 2) {
        if (!pathObj) break;
        curPdf = mapLocalToPdf(c.nums[i], c.nums[i + 1]);
        mod.FPDFPath_LineTo(pathObj, curPdf.x, curPdf.y);
      }
    } else if (c.cmd === 'L' && pathObj) {
      for (let i = 0; i + 1 < c.nums.length; i += 2) {
        curPdf = mapLocalToPdf(c.nums[i], c.nums[i + 1]);
        mod.FPDFPath_LineTo(pathObj, curPdf.x, curPdf.y);
      }
    } else if (c.cmd === 'Q' && pathObj) {
      for (let i = 0; i + 3 < c.nums.length; i += 4) {
        const pCp = mapLocalToPdf(c.nums[i], c.nums[i + 1]);
        const pEnd = mapLocalToPdf(c.nums[i + 2], c.nums[i + 3]);
        mod.FPDFPath_BezierTo(
          pathObj,
          curPdf.x + (2 / 3) * (pCp.x - curPdf.x),
          curPdf.y + (2 / 3) * (pCp.y - curPdf.y),
          pEnd.x + (2 / 3) * (pCp.x - pEnd.x),
          pEnd.y + (2 / 3) * (pCp.y - pEnd.y),
          pEnd.x,
          pEnd.y,
        );
        curPdf = pEnd;
      }
    } else if (c.cmd === 'C' && pathObj) {
      for (let i = 0; i + 5 < c.nums.length; i += 6) {
        const pC1 = mapLocalToPdf(c.nums[i], c.nums[i + 1]);
        const pC2 = mapLocalToPdf(c.nums[i + 2], c.nums[i + 3]);
        const pEnd = mapLocalToPdf(c.nums[i + 4], c.nums[i + 5]);
        mod.FPDFPath_BezierTo(pathObj, pC1.x, pC1.y, pC2.x, pC2.y, pEnd.x, pEnd.y);
        curPdf = pEnd;
      }
    } else if (c.cmd === 'Z' && pathObj) {
      mod.FPDFPath_Close(pathObj);
      curPdf = startPdf;
    }
  }

  if (!pathObj) return;

  mod.FPDFPath_SetDrawMode(pathObj, hasFill ? FPDF_FILLMODE_WINDING : 0, hasStroke);
  if (hasFill && fillHex) {
    const rgb = parseHexColorBytes(fillHex);
    const alpha = Math.max(0, Math.min(255, Math.round((style.fillAlpha ?? 1) * 255)));
    mod.FPDFPageObj_SetFillColor(pathObj, rgb.r, rgb.g, rgb.b, alpha);
  }
  if (hasStroke && strokeHex) {
    const rgb = parseHexColorBytes(strokeHex);
    const alpha = Math.max(0, Math.min(255, Math.round((style.strokeAlpha ?? 1) * 255)));
    mod.FPDFPageObj_SetStrokeColor(pathObj, rgb.r, rgb.g, rgb.b, alpha);
    mod.FPDFPageObj_SetStrokeWidth(pathObj, strokeWidth);
    mod.FPDFPageObj_SetLineCap(pathObj, 1); // Round cap
    if (style.dashArray && style.dashArray.length > 0) {
      const dashPtr = mod.pdfium.wasmExports.malloc(style.dashArray.length * 4);
      if (dashPtr) {
        for (let di = 0; di < style.dashArray.length; di++) {
          mod.pdfium.setValue(dashPtr + di * 4, style.dashArray[di], 'float');
        }
        mod.FPDFPageObj_SetDashArray(pathObj, dashPtr, style.dashArray.length, 0);
        mod.pdfium.wasmExports.free(dashPtr);
      }
    }
  }

  insertPageObjectOrdered(mod, pagePtr, pathObj, behindIndex);
}

function drawRectOnPdfiumPage(
  mod: PdfiumRuntimeModule,
  pagePtr: number,
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
  behindIndex: { next: number } | null,
): void {
  const cmds: SvgPathCommand[] = [
    { cmd: 'M', nums: [0, 0] },
    { cmd: 'L', nums: [box.width, 0, box.width, box.height, 0, box.height] },
    { cmd: 'Z', nums: [] },
  ];
  const mapLocal = (lx: number, ly: number) => {
    const vis = elementLocalToPage(lx, ly, box, rotation);
    return pointBaseVisualToPdfUserSpace(
      vis.x,
      vis.y,
      pageMeta.cropBox,
      pageMeta.intrinsicRotation,
    );
  };

  drawSvgCommandsAsPdfiumPath(
    mod,
    pagePtr,
    cmds,
    mapLocal,
    {
      fillColor:
        style.isHighlight || (style.fillColor && style.fillColor !== 'transparent')
          ? style.fillColor ?? '#fef08a'
          : undefined,
      fillAlpha: style.isHighlight ? Math.min(0.45, style.opacity) : style.opacity,
      strokeColor: style.strokeColor,
      strokeWidth: style.strokeWidth ?? 0,
      strokeAlpha: style.opacity,
    },
    behindIndex,
  );
}

function placePdfiumImage(
  mod: PdfiumRuntimeModule,
  docPtr: number,
  pagePtr: number,
  pageMeta: PageMeta,
  bytes: Uint8Array,
  mimeType: 'image/png' | 'image/jpeg',
  box: RectBox,
  rotationDegCW: number,
  opacity: number,
  flipX?: boolean,
  flipY?: boolean,
  behindIndex: { next: number } | null = null,
  markTag?: string,
): void {
  const imgObj = mod.FPDFPageObj_NewImageObj(docPtr);
  if (!imgObj) return;

  const dataPtr = mod.pdfium.wasmExports.malloc(bytes.byteLength);
  if (!dataPtr) {
    mod.FPDFPageObj_Destroy(imgObj);
    return;
  }
  mod.pdfium.HEAPU8.set(bytes, dataPtr);
  const loaded =
    mimeType === 'image/jpeg'
      ? mod.EPDFImageObj_SetJpeg(0, 0, imgObj, dataPtr, bytes.byteLength)
      : mod.EPDFImageObj_SetPng(0, 0, imgObj, dataPtr, bytes.byteLength);
  mod.pdfium.wasmExports.free(dataPtr);

  if (!loaded) {
    mod.FPDFPageObj_Destroy(imgObj);
    return;
  }

  // Transform [0..1]x[0..1] unit square (where (0,0)=image bottom-left, (1,0)=right, (0,1)=up)
  // via local visual corners -> pointBaseVisualToPdfUserSpace
  const mapUnitCorner = (u: number, v: number) => {
    const effU = flipX ? 1 - u : u;
    const effV = flipY ? v : 1 - v;
    const vis = elementLocalToPage(effU * box.width, effV * box.height, box, rotationDegCW);
    return pointBaseVisualToPdfUserSpace(
      vis.x,
      vis.y,
      pageMeta.cropBox,
      pageMeta.intrinsicRotation,
    );
  };

  const p00 = mapUnitCorner(0, 0);
  const p10 = mapUnitCorner(1, 0);
  const p01 = mapUnitCorner(0, 1);

  mod.FPDFImageObj_SetMatrix(
    imgObj,
    p10.x - p00.x,
    p10.y - p00.y,
    p01.x - p00.x,
    p01.y - p00.y,
    p00.x,
    p00.y,
  );

  if (opacity < 0.999) {
    const alpha = Math.max(0, Math.min(255, Math.round(opacity * 255)));
    mod.FPDFPageObj_SetFillColor(imgObj, 255, 255, 255, alpha);
  }
  if (markTag) {
    mod.FPDFPageObj_AddMark(imgObj, markTag);
  }

  insertPageObjectOrdered(mod, pagePtr, imgObj, behindIndex);
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

async function resolveFallbackFontAssetBytesInNode(
  fileCandidates: string[],
): Promise<Uint8Array | null> {
  if (typeof process === 'undefined' || !process.versions?.node) {
    return null;
  }
  try {
    const [{ default: fs }, { default: path }] = await Promise.all([
      import('node:fs'),
      import('node:path'),
    ]);
    for (const rel of fileCandidates) {
      const full = path.resolve(process.cwd(), rel);
      if (fs.existsSync(full)) {
        return new Uint8Array(fs.readFileSync(full));
      }
    }
  } catch {
    return null;
  }
  return null;
}

const BUILTIN_NODE_FONT_FILES: Record<
  FontCategory,
  { regular: string[]; bold: string[]; italic: string[]; boldItalic: string[] }
> = {
  sans: {
    regular: ['node_modules/@universal-office/font-files/liberationsans-regular.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf'],
    bold: ['node_modules/@universal-office/font-files/liberationsans-bold.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'],
    italic: ['node_modules/@universal-office/font-files/liberationsans-italic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf'],
    boldItalic: ['node_modules/@universal-office/font-files/liberationsans-bolditalic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-BoldOblique.ttf'],
  },
  calibri: {
    regular: ['node_modules/@universal-office/font-files/carlito-regular.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf'],
    bold: ['node_modules/@universal-office/font-files/carlito-bold.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'],
    italic: ['node_modules/@universal-office/font-files/carlito-italic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf'],
    boldItalic: ['node_modules/@universal-office/font-files/carlito-bolditalic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-BoldOblique.ttf'],
  },
  cambria: {
    regular: ['node_modules/@universal-office/font-files/caladea-regular.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif.ttf'],
    bold: ['node_modules/@universal-office/font-files/caladea-bold.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-Bold.ttf'],
    italic: ['node_modules/@universal-office/font-files/caladea-italic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-Italic.ttf'],
    boldItalic: ['node_modules/@universal-office/font-files/caladea-bolditalic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-BoldItalic.ttf'],
  },
  serif: {
    regular: ['node_modules/@universal-office/font-files/liberationserif-regular.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif.ttf'],
    bold: ['node_modules/@universal-office/font-files/liberationserif-bold.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-Bold.ttf'],
    italic: ['node_modules/@universal-office/font-files/liberationserif-italic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-Italic.ttf'],
    boldItalic: ['node_modules/@universal-office/font-files/liberationserif-bolditalic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-BoldItalic.ttf'],
  },
  mono: {
    regular: ['node_modules/@universal-office/font-files/liberationmono-regular.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf'],
    bold: ['node_modules/@universal-office/font-files/liberationmono-bold.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf'],
    italic: ['node_modules/@universal-office/font-files/liberationmono-italic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono-Oblique.ttf'],
    boldItalic: ['node_modules/@universal-office/font-files/liberationmono-bolditalic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono-BoldOblique.ttf'],
  },
  script: {
    regular: ['node_modules/@universal-office/font-files/liberationserif-italic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-Italic.ttf'],
    bold: ['node_modules/@universal-office/font-files/liberationserif-bolditalic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-BoldItalic.ttf'],
    italic: ['node_modules/@universal-office/font-files/liberationserif-italic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-Italic.ttf'],
    boldItalic: ['node_modules/@universal-office/font-files/liberationserif-bolditalic.ttf', 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-BoldItalic.ttf'],
  },
};

function selectPayloadVariant(
  asset: FontAssetPayload,
  bold: boolean,
  italic: boolean,
): Uint8Array | undefined {
  if (bold && italic && asset.boldItalic) return asset.boldItalic;
  if (bold && asset.bold) return asset.bold;
  if (italic && asset.italic) return asset.italic;
  return asset.regular;
}

/**
 * Compiles edited PDFs completely on `@embedpdf/pdfium` + Rust `gp-wasm`:
 * 1) Builds page sequence from source docs + blank pages (intrinsic rotations intact)
 * 2) Applies D3 verified content-stream redactions (`gp_wasm.redact_pdf_bytes` + PDFium `FPDFText_*` assertion)
 * 3) Renders Tier-1 behind-content objects + Tier 2-4 images, shapes, rich Unicode TTF text,
 *    fountain-pen vector ink signatures, page numbers, and vector image clip masks
 * 4) Applies user page rotations cleanly and serializes via `PDFiumExt_SaveAsCopy`.
 */
export async function compilePdfDocument(payload: CompilePdfPayload): Promise<Uint8Array> {
  const [mod, wasm] = await Promise.all([getSharedPdfium(), ensureRustCoreReady()]);
  const sourceByteMap = new Map(payload.sourceDocs.map((d) => [d.id, d.bytes]));

  const elementsByPage = new Map<string, CanvasElement[]>();
  for (const el of payload.elements) {
    const arr = elementsByPage.get(el.pageId) ?? [];
    arr.push(el);
    elementsByPage.set(el.pageId, arr);
  }

  // Step 1: Assemble pages cleanly with PDFium
  const assembledDoc = mod.FPDF_CreateNewDocument();
  if (!assembledDoc) {
    throw new Error('PDFium failed creating output document.');
  }
  const openSourceDocs = new Map<string, { docPtr: number; freeData: () => void }>();

  let assembledBytes: Uint8Array;
  try {
    for (let i = 0; i < payload.pages.length; i++) {
      const pageMeta = payload.pages[i];
      if (pageMeta.sourceDocId === '__blank__') {
        const blankPage = mod.FPDFPage_New(
          assembledDoc,
          i,
          pageMeta.baseWidth,
          pageMeta.baseHeight,
        );
        if (blankPage) {
          mod.FPDFPage_GenerateContent(blankPage);
          mod.FPDF_ClosePage(blankPage);
        }
        continue;
      }

      const srcBytes = sourceByteMap.get(pageMeta.sourceDocId);
      if (!srcBytes) {
        throw new Error(`Missing source PDF bytes for document ID "${pageMeta.sourceDocId}".`);
      }

      let srcEntry = openSourceDocs.get(pageMeta.sourceDocId);
      if (!srcEntry) {
        srcEntry = loadPdfiumMemDoc(mod, srcBytes);
        if (!srcEntry.docPtr) {
          throw new Error(`PDFium failed loading source document "${pageMeta.sourceDocId}".`);
        }
        openSourceDocs.set(pageMeta.sourceDocId, srcEntry);
      }

      const okImport = mod.FPDF_ImportPages(
        assembledDoc,
        srcEntry.docPtr,
        String(pageMeta.sourcePageIndex + 1),
        i,
      );
      if (!okImport) {
        throw new Error(
          `PDFium failed importing page ${pageMeta.sourcePageIndex + 1} from "${pageMeta.sourceDocId}".`,
        );
      }
    }

    assembledBytes = savePdfiumDocToBytes(mod, assembledDoc);
  } finally {
    for (const entry of openSourceDocs.values()) {
      mod.FPDF_CloseDocument(entry.docPtr);
      entry.freeData();
    }
    mod.FPDF_CloseDocument(assembledDoc);
  }

  // Step 2: Apply Rust content-stream stripping (text-only / image-only / shape-only) + mandatory D3 redactions
  const textRemovalRects: RedactionEntry[] = [];
  const imageRemovalRects: RedactionEntry[] = [];
  const shapeRemovalRects: RedactionEntry[] = [];
  const blackRedactRects: RedactionEntry[] = [];

  for (let i = 0; i < payload.pages.length; i++) {
    const pageMeta = payload.pages[i];
    if (pageMeta.sourceDocId === '__blank__') continue;
    const els = elementsByPage.get(pageMeta.id) ?? [];

    for (const el of els) {
      if (el.kind === 'text-edit') {
        if (isUnmodifiedTextEdit(el)) continue;
        const padX = Math.min(0.5, el.originalRect.width * 0.05);
        const padY = Math.min(0.5, el.originalRect.height * 0.05);
        textRemovalRects.push({
          pageIndex: i,
          x: el.originalRect.x + padX,
          y: el.originalRect.y + padY,
          width: Math.max(1, el.originalRect.width - padX * 2),
          height: Math.max(1, el.originalRect.height - padY * 2),
        });
      } else if (el.kind === 'image-replacement') {
        const bbox = getRotatedBoundingBox(el.originalRect, el.originalRotation ?? 0);
        imageRemovalRects.push({
          pageIndex: i,
          x: bbox.x,
          y: bbox.y,
          width: Math.max(1, bbox.width),
          height: Math.max(1, bbox.height),
        });
      } else if (el.kind === 'shape-replacement') {
        shapeRemovalRects.push({
          pageIndex: i,
          x: el.originalRect.x,
          y: el.originalRect.y,
          width: el.originalRect.width,
          height: el.originalRect.height,
        });
      } else if (el.kind === 'highlight' && el.shape === 'redact') {
        blackRedactRects.push({
          pageIndex: i,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
        });
      }
    }
  }

  let redactedBytes = assembledBytes;
  if (
    textRemovalRects.length > 0 ||
    imageRemovalRects.length > 0 ||
    shapeRemovalRects.length > 0
  ) {
    const res = wasm.strip_pdf_elements_bytes(
      redactedBytes,
      textRemovalRects,
      imageRemovalRects,
      shapeRemovalRects,
    );
    redactedBytes = res instanceof Uint8Array ? res : new Uint8Array(res);
    if (imageRemovalRects.length > 0 || textRemovalRects.length > 0) {
      redactedBytes = stripLeftoverObjectsWithPdfiumWasm(
        mod,
        redactedBytes,
        imageRemovalRects,
        textRemovalRects,
      );
    }
  }
  if (blackRedactRects.length > 0) {
    const res = wasm.redact_pdf_bytes(redactedBytes, blackRedactRects, [], true);
    redactedBytes = res instanceof Uint8Array ? res : new Uint8Array(res);
    const leaked = verifyRedactionsWithPdfium(mod, redactedBytes, blackRedactRects, payload.pages);
    if (leaked > 0) {
      throw new Error(
        `Redaction verification failed: ${leaked} non-whitespace character(s) remain inside redacted area(s).`,
      );
    }
  }

  // Step 3: Draw added/edited elements directly on PDFium objects & save
  const { docPtr: finalDoc, freeData: freeFinalData } = loadPdfiumMemDoc(mod, redactedBytes);
  if (!finalDoc) {
    throw new Error('PDFium failed reopening redacted document for element compilation.');
  }

  const scratchMatrixPtr = mod.pdfium.wasmExports.malloc(24);
  if (!scratchMatrixPtr) {
    mod.FPDF_CloseDocument(finalDoc);
    freeFinalData();
    throw new Error('Out of Wasm memory allocating transform matrix.');
  }

  const loadedFonts: PdfiumLoadedFont[] = [];
  const fontCache = new Map<string, PdfiumLoadedFont>();
  const fontAssetMap = new Map<string, FontAssetPayload>(
    (payload.fonts ?? []).map((f) => [f.family, f]),
  );

  const loadTtfFont = (cacheKey: string, bytes: Uint8Array): PdfiumLoadedFont | null => {
    const existing = fontCache.get(cacheKey);
    if (existing) return existing;

    const ptr = mod.pdfium.wasmExports.malloc(bytes.byteLength);
    if (!ptr) return null;
    mod.pdfium.HEAPU8.set(bytes, ptr);
    const fontPtr = mod.FPDFText_LoadFont(finalDoc, ptr, bytes.byteLength, FPDF_FONT_TRUETYPE, true);
    mod.pdfium.wasmExports.free(ptr);
    if (!fontPtr) return null;

    let supportedCodePoints: Set<number> | null = null;
    try {
      const meta = wasm.inspect_ttf_font(bytes) as { supportedCodePoints?: number[] } | null;
      if (meta?.supportedCodePoints?.length) {
        supportedCodePoints = new Set(meta.supportedCodePoints);
      }
    } catch {
      supportedCodePoints = null;
    }

    const entry: PdfiumLoadedFont = {
      fontPtr,
      supportedCodePoints,
      glyphWidthCache: new Map(),
    };
    fontCache.set(cacheKey, entry);
    loadedFonts.push(entry);
    return entry;
  };

  const loadStdFont = (stdName: StandardPdfFontName): PdfiumLoadedFont => {
    const key = `std:${stdName}`;
    const existing = fontCache.get(key);
    if (existing) return existing;
    const fontPtr = mod.FPDFText_LoadStandardFont(finalDoc, stdName);
    if (!fontPtr) {
      throw new Error(`PDFium failed loading Standard14 font "${stdName}".`);
    }
    const entry: PdfiumLoadedFont = {
      fontPtr,
      supportedCodePoints: null,
      glyphWidthCache: new Map(),
    };
    fontCache.set(key, entry);
    loadedFonts.push(entry);
    return entry;
  };

  const resolveBuiltinCategoryAsset = (
    family: FontFamilyOption,
    fallback?: BuiltinFontFamilyOption,
  ): FontAssetPayload | undefined => {
    const cat = getFontCategory(family, fallback);
    if (family === 'DejaVuSans' && fontAssetMap.has('DejaVuSans')) return fontAssetMap.get('DejaVuSans');
    if (family === 'DejaVuSansCondensed' && fontAssetMap.has('DejaVuSansCondensed'))
      return fontAssetMap.get('DejaVuSansCondensed');
    if (family === 'DejaVuSerif' && fontAssetMap.has('DejaVuSerif')) return fontAssetMap.get('DejaVuSerif');
    if (family === 'DejaVuSerifCondensed' && fontAssetMap.has('DejaVuSerifCondensed'))
      return fontAssetMap.get('DejaVuSerifCondensed');
    if (family === 'DejaVuSansMono' && fontAssetMap.has('DejaVuSansMono'))
      return fontAssetMap.get('DejaVuSansMono');
    return fontAssetMap.get(`category:${cat}`) ?? fontAssetMap.get('category:sans');
  };

  const resolveFallbackCategoryAsset = (
    family: FontFamilyOption,
    fallback?: BuiltinFontFamilyOption,
  ): FontAssetPayload | undefined => {
    const cat = getFontCategory(family, fallback);
    if (cat === 'mono') return fontAssetMap.get('fallback:mono') ?? fontAssetMap.get('fallback:sans');
    if (cat === 'serif' || cat === 'cambria' || cat === 'script') {
      return fontAssetMap.get('fallback:serif') ?? fontAssetMap.get('fallback:sans');
    }
    return fontAssetMap.get('fallback:sans');
  };

  const getFontPairSafe = async (
    family: FontFamilyOption,
    bold: boolean,
    italic: boolean,
    fallback?: BuiltinFontFamilyOption,
  ): Promise<PdfiumFontPair> => {
    const suffix = `${bold ? 'B' : 'N'}_${italic ? 'I' : 'N'}`;
    let primary: PdfiumLoadedFont | null = null;

    if (family.startsWith('user:') || family.startsWith('embedded:')) {
      const customAsset = fontAssetMap.get(family);
      if (customAsset) {
        const bytes = selectPayloadVariant(customAsset, bold, italic);
        if (bytes) primary = loadTtfFont(`custom:${family}_${suffix}`, bytes);
      }
    }

    if (!primary && (isBuiltinFontFamily(family) || fallback)) {
      const targetBuiltin = isBuiltinFontFamily(family) ? family : fallback!;
      const catAsset = resolveBuiltinCategoryAsset(targetBuiltin, fallback);
      if (catAsset) {
        const bytes = selectPayloadVariant(catAsset, bold, italic);
        if (bytes) primary = loadTtfFont(`cat:${catAsset.family}_${suffix}`, bytes);
      }
    }

    if (!primary) {
      const cat = getFontCategory(family, fallback);
      const variantKey: 'regular' | 'bold' | 'italic' | 'boldItalic' =
        bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
      const nodeBytes = await resolveFallbackFontAssetBytesInNode(
        BUILTIN_NODE_FONT_FILES[cat][variantKey],
      );
      if (nodeBytes) {
        primary = loadTtfFont(`node:${cat}_${variantKey}`, nodeBytes);
      }
    }

    if (!primary) {
      const stdName = getStandardPdfFont(family, bold, italic, fallback);
      primary = loadStdFont(stdName);
    }

    let fbEntry: PdfiumLoadedFont | null = null;
    const fbAsset = resolveFallbackCategoryAsset(family, fallback);
    if (fbAsset) {
      const fbBytes = selectPayloadVariant(fbAsset, bold, italic);
      if (fbBytes) fbEntry = loadTtfFont(`fb:${fbAsset.family}_${suffix}`, fbBytes);
    } else if (typeof process !== 'undefined' && process.versions?.node) {
      const cat = getFontCategory(family, fallback);
      const fbCat: FontCategory =
        cat === 'mono' ? 'mono' : cat === 'serif' || cat === 'cambria' || cat === 'script' ? 'serif' : 'sans';
      const variantKey: 'regular' | 'bold' | 'italic' | 'boldItalic' =
        bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
      const djFile = BUILTIN_NODE_FONT_FILES[fbCat][variantKey].slice(-1);
      const nodeFbBytes = await resolveFallbackFontAssetBytesInNode(djFile);
      if (nodeFbBytes) {
        fbEntry = loadTtfFont(`nodefb:${fbCat}_${variantKey}`, nodeFbBytes);
      }
    }

    return { primary, fallback: fbEntry };
  };

  const drawTextElementOnPage = async (
    pagePtr: number,
    pageMeta: PageMeta,
    el: TextEditElement | TextAddElement,
    behindIndex: { next: number } | null,
  ) => {
    if ((el.kind === 'text-edit' && el.deleted) || el.text.length === 0) {
      return;
    }

    if (el.kind === 'text-add' && el.backgroundColor) {
      drawRectOnPdfiumPage(
        mod,
        pagePtr,
        pageMeta,
        { x: el.x, y: el.y, width: el.width, height: el.height },
        el.rotation,
        { fillColor: el.backgroundColor, opacity: el.opacity },
        behindIndex,
      );
    }

    const runs = ensureRunsFromElement(el.text, el.runs, el.bold, el.italic);
    const stylePairs = new Map<string, PdfiumFontPair>();
    const styleKey = (b: boolean, i: boolean) => `${b ? 1 : 0}_${i ? 1 : 0}`;
    const ensurePair = async (b: boolean, i: boolean) => {
      const k = styleKey(b, i);
      let p = stylePairs.get(k);
      if (!p) {
        p = await getFontPairSafe(el.fontFamily, b, i, el.fallbackFontFamily);
        stylePairs.set(k, p);
      }
      return p;
    };

    await ensurePair(el.bold, el.italic);
    for (const r of runs) {
      await ensurePair(r.bold ?? el.bold, r.italic ?? el.italic);
    }

    const getPairSync = (b: boolean, i: boolean): PdfiumFontPair =>
      stylePairs.get(styleKey(b, i)) ?? stylePairs.get(styleKey(el.bold, el.italic))!;

    const charSpacing = el.letterSpacing ?? 0;
    const hScale = el.horizontalScale && el.horizontalScale > 0 ? el.horizontalScale : 1;

    const measurePiece = (
      text: string,
      bold: boolean,
      italic: boolean,
      script: TextScriptMode,
    ): number => {
      const scale = script === 'normal' ? 1 : 0.6;
      const baseW = measureWithFontPair(mod, text, getPairSync(bold, italic), el.fontSize * scale);
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

    for (let li = 0; li < wrappedLines.length; li++) {
      const line = wrappedLines[li];
      if (line.pieces.length === 0) continue;

      const scaledLineWidth = line.naturalWidth;
      const fitScale =
        scaledLineWidth > el.width + 0.5 ? Math.max(0.88, el.width / scaledLineWidth) : 1;
      const effectiveHScale = hScale * fitScale;
      const effectiveLineWidth = scaledLineWidth * fitScale;

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
        const pieceSize = piece.script === 'normal' ? el.fontSize : el.fontSize * 0.6;
        const scriptDeltaY =
          piece.script === 'super'
            ? -el.fontSize * 0.3
            : piece.script === 'sub'
              ? el.fontSize * 0.15
              : 0;

        if (piece.isSpace) {
          cursorX +=
            measureWithFontPair(mod, piece.text, piecePair, pieceSize) * effectiveHScale +
            extraPerSpace * piece.text.length;
          continue;
        }

        const glyphSegs = splitTextByGlyphSupport(piece.text, piecePair);
        for (const seg of glyphSegs) {
          if (!seg.text) continue;
          const localOffsetY = li * lineBoxHeight + baselineFromLineTop + scriptDeltaY;

          if (Math.abs(charSpacing) > 0.01 && seg.text.length > 1) {
            for (const ch of seg.text) {
              const relX = -el.width / 2 + cursorX;
              const relY = -el.height / 2 + localOffsetY;
              const visX = cx + (relX * cos - relY * sin);
              const visY = cy + (relX * sin + relY * cos);
              emitTextRunAtVisualPoint(
                mod,
                finalDoc,
                pagePtr,
                pageMeta,
                seg.entry.fontPtr,
                pieceSize,
                ch,
                visX,
                visY,
                el.rotation,
                effectiveHScale,
                el.color,
                el.opacity,
                scratchMatrixPtr,
                behindIndex,
              );
              cursorX +=
                measureFontWidth(mod, seg.entry, ch, pieceSize) * effectiveHScale +
                charSpacing * effectiveHScale;
            }
          } else {
            const relX = -el.width / 2 + cursorX;
            const relY = -el.height / 2 + localOffsetY;
            const visX = cx + (relX * cos - relY * sin);
            const visY = cy + (relX * sin + relY * cos);
            emitTextRunAtVisualPoint(
              mod,
              finalDoc,
              pagePtr,
              pageMeta,
              seg.entry.fontPtr,
              pieceSize,
              seg.text,
              visX,
              visY,
              el.rotation,
              effectiveHScale,
              el.color,
              el.opacity,
              scratchMatrixPtr,
              behindIndex,
            );
            cursorX +=
              measureFontWidth(mod, seg.entry, seg.text, pieceSize) * effectiveHScale +
              seg.text.length * charSpacing * effectiveHScale;
          }
        }
      }
    }
  };

  const drawImageOnPage = (
    pagePtr: number,
    pageIndex: number,
    pageMeta: PageMeta,
    el: ImageAddElement | ImageReplacementElement,
    behindIndex: { next: number } | null,
    clipCounter: { next: number },
    clipPatches: Array<{
      pageIndex: number;
      markName: string;
      evenOdd: boolean;
      commands: Array<
        | { op: 'move-to'; x: number; y: number }
        | { op: 'line-to'; x: number; y: number }
        | { op: 'curve-to'; cx1: number; cy1: number; cx2: number; cy2: number; x: number; y: number }
        | { op: 'close' }
      >;
    }>,
  ) => {
    const hasCropOrMask = Boolean(el.cropRect || el.clipMask?.unitSvgPath);
    if (!hasCropOrMask) {
      placePdfiumImage(
        mod,
        finalDoc,
        pagePtr,
        pageMeta,
        el.bytes,
        el.mimeType,
        { x: el.x, y: el.y, width: el.width, height: el.height },
        el.rotation,
        el.opacity,
        el.flipX,
        el.flipY,
        behindIndex,
      );
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

    // Build crop box & optional vector clip mask as two nested/sequential PDF clipping paths
    const cropMarkTag = `GpClip${clipCounter.next++}`;
    const commands = [];

    if (el.clipMask?.unitSvgPath) {
      const scaled = scaleSvgPathCommands(
        el.clipMask.unitSvgPath,
        Math.max(1, el.width),
        Math.max(1, el.height),
        4,
      );
      const screenD = flipSvgPath(scaled, el.width, el.height, el.flipX, el.flipY, 4);
      const maskCmds = buildSvgClipCommandsInPdfSpace(screenD, mapLocalToPdf);
      if (maskCmds.length > 0) {
        commands.push(...maskCmds);
      }
    }

    if (commands.length === 0) {
      const p0 = mapLocalToPdf(0, 0);
      const p1 = mapLocalToPdf(el.width, 0);
      const p2 = mapLocalToPdf(el.width, el.height);
      const p3 = mapLocalToPdf(0, el.height);
      commands.push(
        { op: 'move-to' as const, x: p0.x, y: p0.y },
        { op: 'line-to' as const, x: p1.x, y: p1.y },
        { op: 'line-to' as const, x: p2.x, y: p2.y },
        { op: 'line-to' as const, x: p3.x, y: p3.y },
        { op: 'close' as const },
      );
    }

    clipPatches.push({
      pageIndex,
      markName: cropMarkTag,
      evenOdd: false,
      commands,
    });

    // Place underlying image aligned so `cropRect` fills `[0..el.width] x [0..el.height]`
    const crop = el.cropRect ?? { x: 0, y: 0, width: 1, height: 1 };
    const lw = el.width / Math.max(0.02, crop.width);
    const lh = el.height / Math.max(0.02, crop.height);
    const lx = -(crop.x / Math.max(0.02, crop.width)) * el.width;
    const ly = -(crop.y / Math.max(0.02, crop.height)) * el.height;
    const effLx = el.flipX ? el.width - (lx + lw) : lx;
    const effLy = el.flipY ? el.height - (ly + lh) : ly;
    const imgCenterVis = elementLocalToPage(effLx + lw / 2, effLy + lh / 2, el, el.rotation);

    placePdfiumImage(
      mod,
      finalDoc,
      pagePtr,
      pageMeta,
      el.bytes,
      el.mimeType,
      {
        x: imgCenterVis.x - lw / 2,
        y: imgCenterVis.y - lh / 2,
        width: lw,
        height: lh,
      },
      el.rotation,
      el.opacity,
      el.flipX,
      el.flipY,
      behindIndex,
      cropMarkTag,
    );
  };

  const clipPatches: Array<{
    pageIndex: number;
    markName: string;
    evenOdd: boolean;
    commands: Array<
      | { op: 'move-to'; x: number; y: number }
      | { op: 'line-to'; x: number; y: number }
      | { op: 'curve-to'; cx1: number; cy1: number; cx2: number; cy2: number; x: number; y: number }
      | { op: 'close' }
    >;
  }> = [];
  const clipCounter = { next: 0 };

  let savedBytes: Uint8Array;
  try {
    for (let i = 0; i < payload.pages.length; i++) {
      const pageMeta = payload.pages[i];
      const pagePtr = mod.FPDF_LoadPage(finalDoc, i);
      if (!pagePtr) {
        throw new Error(`PDFium failed loading page ${i + 1} for drawing.`);
      }

      try {
        const pageEls = [...(elementsByPage.get(pageMeta.id) ?? [])].sort(
          (a, b) => getLayerTierSafe(a) - getLayerTierSafe(b) || a.zIndex - b.zIndex,
        );
        const behindCounter = { next: 0 };
        let modified = false;

        for (const el of pageEls) {
          const isBehind =
            ((el.kind === 'image' || el.kind === 'image-replacement') &&
              el.behindContent === true &&
              !(el.kind === 'image-replacement' && el.deleted)) ||
            (el.kind === 'shape-replacement' && el.behindContent === true && !el.deleted) ||
            ((el.kind === 'shape' || el.kind === 'path') && el.behindContent === true);
          const behindIndex = isBehind ? behindCounter : null;

          switch (el.kind) {
            case 'text-edit': {
              if (el.deleted || isUnmodifiedTextEdit(el) || el.text.length === 0) break;
              await drawTextElementOnPage(pagePtr, pageMeta, el, behindIndex);
              modified = true;
              break;
            }
            case 'text-add': {
              if (el.text.length === 0) break;
              await drawTextElementOnPage(pagePtr, pageMeta, el, behindIndex);
              modified = true;
              break;
            }
            case 'image-replacement': {
              if (!el.deleted) {
                drawImageOnPage(pagePtr, i, pageMeta, el, behindIndex, clipCounter, clipPatches);
                modified = true;
              }
              break;
            }
            case 'image': {
              drawImageOnPage(pagePtr, i, pageMeta, el, behindIndex, clipCounter, clipPatches);
              modified = true;
              break;
            }
            case 'signature': {
              const sig: SignatureElement = el;
              if (sig.svgPaths && sig.svgPaths.length > 0 && sig.viewBoxWidth && sig.viewBoxHeight) {
                const sx = sig.width / Math.max(1, sig.viewBoxWidth);
                const sy = sig.height / Math.max(1, sig.viewBoxHeight);
                const mapLocal = (lx: number, ly: number) => {
                  const vis = elementLocalToPage(lx * sx, ly * sy, sig, sig.rotation);
                  return pointBaseVisualToPdfUserSpace(
                    vis.x,
                    vis.y,
                    pageMeta.cropBox,
                    pageMeta.intrinsicRotation,
                  );
                };
                for (const sp of sig.svgPaths) {
                  const cmds = parseSvgPathCommands(sp.d);
                  const strokeAlpha = (sp.opacity ?? 1) * sig.opacity;
                  drawSvgCommandsAsPdfiumPath(
                    mod,
                    pagePtr,
                    cmds,
                    mapLocal,
                    sp.fill
                      ? { fillColor: sp.color, fillAlpha: strokeAlpha }
                      : {
                          strokeColor: sp.color,
                          strokeWidth: sp.strokeWidth * sx,
                          strokeAlpha,
                        },
                    behindIndex,
                  );
                }
              } else {
                placePdfiumImage(
                  mod,
                  finalDoc,
                  pagePtr,
                  pageMeta,
                  sig.pngBytes,
                  'image/png',
                  { x: sig.x, y: sig.y, width: sig.width, height: sig.height },
                  sig.rotation,
                  sig.opacity,
                  false,
                  false,
                  behindIndex,
                );
              }
              modified = true;
              break;
            }
            case 'stroke': {
              const stroke: StrokeElement = el;
              const d = pointsToSmoothSvgPath(stroke.points, stroke.width, stroke.height);
              const mapLocal = (lx: number, ly: number) => {
                const vis = elementLocalToPage(lx, ly, stroke, stroke.rotation);
                return pointBaseVisualToPdfUserSpace(
                  vis.x,
                  vis.y,
                  pageMeta.cropBox,
                  pageMeta.intrinsicRotation,
                );
              };
              drawSvgCommandsAsPdfiumPath(
                mod,
                pagePtr,
                parseSvgPathCommands(d),
                mapLocal,
                {
                  strokeColor: stroke.strokeColor,
                  strokeWidth: stroke.strokeWidth,
                  strokeAlpha: stroke.opacity,
                },
                behindIndex,
              );
              modified = true;
              break;
            }
            case 'shape-replacement': {
              const shp: ShapeReplacementElement = el;
              if (!shp.deleted) {
                drawRectOnPdfiumPage(
                  mod,
                  pagePtr,
                  pageMeta,
                  { x: shp.x, y: shp.y, width: shp.width, height: shp.height },
                  shp.rotation,
                  {
                    fillColor: shp.fillColor,
                    strokeColor: shp.strokeColor,
                    strokeWidth: shp.strokeWidth,
                    opacity: shp.opacity,
                  },
                  behindIndex,
                );
                modified = true;
              }
              break;
            }
            case 'shape':
            case 'path': {
              const rawSvgPath =
                el.kind === 'shape'
                  ? shapeToSvgPath(el.shapeType, el.width, el.height, el.borderRadius ?? 0)
                  : pathPointsToSvgPath(el.points, el.width, el.height, el.closed, el.smooth);
              const svgPath =
                el.kind === 'shape' && (el.flipX || el.flipY)
                  ? flipSvgPath(rawSvgPath, el.width, el.height, el.flipX, el.flipY, 3)
                  : rawSvgPath;
              const fillColor = el.kind === 'shape' || el.closed ? el.fillColor : 'transparent';
              const mapLocal = (lx: number, ly: number) => {
                const vis = elementLocalToPage(lx, ly, el, el.rotation);
                return pointBaseVisualToPdfUserSpace(
                  vis.x,
                  vis.y,
                  pageMeta.cropBox,
                  pageMeta.intrinsicRotation,
                );
              };
              drawSvgCommandsAsPdfiumPath(
                mod,
                pagePtr,
                parseSvgPathCommands(svgPath),
                mapLocal,
                {
                  fillColor,
                  fillAlpha: el.opacity,
                  strokeColor: el.strokeColor,
                  strokeWidth: el.strokeWidth,
                  strokeAlpha: el.opacity,
                  dashArray: strokeDashToArray(el.strokeDash, el.strokeWidth),
                },
                behindIndex,
              );
              modified = true;
              break;
            }
            case 'highlight': {
              const h: HighlightElement = el;
              if (h.shape === 'redact') {
                // Content stripped and solid black redaction box burned cleanly in Step 2
                break;
              }
              drawRectOnPdfiumPage(
                mod,
                pagePtr,
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
                behindIndex,
              );
              modified = true;
              break;
            }
          }
        }

        // Dynamic page numbering
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
            const safeTxt = filterTextForPdfFont(
              pgLayout.text,
              pair.primary.supportedCodePoints,
            );
            const textW = measureFontWidth(
              mod,
              pair.primary,
              safeTxt,
              payload.pageNumbering.fontSize,
            );
            let localX = 0;
            if (pgLayout.align === 'center') {
              localX = Math.max(0, (pgLayout.width - textW) / 2);
            } else if (pgLayout.align === 'right') {
              localX = Math.max(0, pgLayout.width - textW);
            }
            const dispX = pgLayout.x + localX;
            const dispY = pgLayout.y + payload.pageNumbering.fontSize * 0.92;
            const basePt = mapDisplayRotatedPointToBaseVisual(
              dispX,
              dispY,
              pageMeta.baseWidth,
              pageMeta.baseHeight,
              rot,
            );
            emitTextRunAtVisualPoint(
              mod,
              finalDoc,
              pagePtr,
              pageMeta,
              pair.primary.fontPtr,
              payload.pageNumbering.fontSize,
              safeTxt,
              basePt.x,
              basePt.y,
              -rot,
              1,
              payload.pageNumbering.color,
              payload.pageNumbering.opacity ?? 0.92,
              scratchMatrixPtr,
              null,
            );
            modified = true;
          }
        }

        if (normalizeRotation(pageMeta.userRotation) !== 0) {
          const totalRotDeg = normalizeRotation(
            pageMeta.intrinsicRotation + pageMeta.userRotation,
          );
          mod.FPDFPage_SetRotation(pagePtr, Math.round(totalRotDeg / 90) % 4);
          modified = true;
        }

        if (modified) {
          mod.FPDFPage_GenerateContent(pagePtr);
        }
      } finally {
        mod.FPDF_ClosePage(pagePtr);
      }
    }

    savedBytes = savePdfiumDocToBytes(mod, finalDoc);
  } finally {
    for (const f of loadedFonts) {
      mod.FPDFFont_Close(f.fontPtr);
    }
    mod.pdfium.wasmExports.free(scratchMatrixPtr);
    mod.FPDF_CloseDocument(finalDoc);
    freeFinalData();
  }

  // Step 4: Splice vector clipping paths cleanly for crop/mask images via gp_wasm
  if (clipPatches.length > 0) {
    const clipped = wasm.apply_pdf_clip_masks(savedBytes, clipPatches);
    savedBytes = clipped instanceof Uint8Array ? clipped : new Uint8Array(clipped);
  }

  return savedBytes;
}

function getLayerTierSafe(el: CanvasElement): number {
  if (el.layerOverride) return el.layerOverride;
  if (el.kind === 'image' || el.kind === 'image-replacement' || el.kind === 'shape-replacement') {
    return el.behindContent || el.isBackgroundLayer ? 1 : 2;
  }
  if ((el.kind === 'shape' || el.kind === 'path') && (el.behindContent || el.isBackgroundLayer)) {
    return 1;
  }
  if (el.kind === 'text-edit' || el.kind === 'text-add') {
    return 3;
  }
  return 4;
}

/**
 * Compiles one or more split/extract jobs and bundles multi-file outputs into a ZIP archive.
 */
export async function splitPdfToZip(payload: SplitPdfZipPayload): Promise<Uint8Array> {
  const zip = new JSZip();

  for (const job of payload.jobs) {
    const pageIds = new Set(job.pages.map((p) => p.id));
    const jobElements = payload.elements.filter((el) => pageIds.has(el.pageId));
    const pdfBytes = await compilePdfDocument({
      sourceDocs: payload.sourceDocs,
      pages: job.pages,
      elements: jobElements,
      fonts: payload.fonts,
      pageNumbering: payload.pageNumbering,
    });
    zip.file(job.filename, pdfBytes);
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

// Keep unused type export from gp-wasm referenced cleanly for bundler tree-shaking
export type { GpWasmModule };
