import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type {
  DetectedImageObject,
  DetectedTextBlock,
  DetectedVectorShape,
  PageExtractionResult,
  RectBox,
  RotationAngle,
} from '@/types/pdf';
import type { HorizontalRule, VectorGeometry, VerticalRule } from '@/types/worker';
import { blobRegistry } from '@/utils/blobRegistry';
import { createId } from '@/utils/id';
import { computeCappedCanvasDpr, decomposeImageCtm, MAX_PDF_CANVAS_PIXELS } from './coordinates';
export { computeCappedCanvasDpr, MAX_PDF_CANVAS_PIXELS };
import { inferFontFromPdfName } from './fonts';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface RawTextRun {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  baselineY: number;
  rawFontName: string;
  color: string;
}

class PdfJsService {
  private readonly docCache = new Map<string, Promise<PDFDocumentProxy>>();

  async getDocumentProxy(sourceDocId: string, bytes: Uint8Array): Promise<PDFDocumentProxy> {
    const existing = this.docCache.get(sourceDocId);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      // Always pass a sliced copy so PDF.js worker transfer never detaches store bytes
      const copy = bytes.slice();
      const task = pdfjsLib.getDocument({
        data: copy,
        verbosity: pdfjsLib.VerbosityLevel.ERRORS,
      });
      return task.promise;
    })();

    this.docCache.set(sourceDocId, promise);
    try {
      return await promise;
    } catch (err) {
      this.docCache.delete(sourceDocId);
      throw err;
    }
  }

  async releaseDocument(sourceDocId: string): Promise<void> {
    const existing = this.docCache.get(sourceDocId);
    if (!existing) return;
    this.docCache.delete(sourceDocId);
    try {
      const doc = await existing;
      await doc.destroy();
    } catch {
      // Ignore cleanup errors
    }
  }

  async releaseAllDocuments(): Promise<void> {
    const entries = [...this.docCache.entries()];
    this.docCache.clear();
    await Promise.all(
      entries.map(async ([, promise]) => {
        try {
          const doc = await promise;
          await doc.destroy();
        } catch {
          // Ignore
        }
      }),
    );
  }

  renderPageToCanvas(params: {
    sourceDocId: string;
    bytes: Uint8Array;
    sourcePageIndex: number;
    canvas: HTMLCanvasElement;
    zoom: number;
    userRotation: RotationAngle;
    dpr?: number;
    background?: string;
  }): { promise: Promise<void>; cancel: () => void } {
    let cancelled = false;
    let activeRenderTask: RenderTask | null = null;

    const promise = (async () => {
      const doc = await this.getDocumentProxy(params.sourceDocId, params.bytes);
      if (cancelled) return;
      const page = await doc.getPage(params.sourcePageIndex + 1);
      if (cancelled) return;

      const dpr = params.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      const totalRotation = ((page.rotate + params.userRotation) % 360 + 360) % 360;
      const cssViewport = page.getViewport({ scale: params.zoom, rotation: totalRotation });
      const safeDpr = computeCappedCanvasDpr(cssViewport.width, cssViewport.height, dpr);
      const pixelViewport = page.getViewport({
        scale: params.zoom * safeDpr,
        rotation: totalRotation,
      });

      const { canvas } = params;
      const targetWidth = Math.max(1, Math.round(pixelViewport.width));
      const targetHeight = Math.max(1, Math.round(pixelViewport.height));
      const cssWidthPx = Math.max(1, Math.round(cssViewport.width));
      const cssHeightPx = Math.max(1, Math.round(cssViewport.height));

      // Always acquire alpha:true on visible canvas and render via an alpha:true offscreen buffer
      // so switching to transparent paper ('rgba(0, 0, 0, 0)') never renders solid black or flickers.
      const dstCtx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
      const offscreen =
        typeof document !== 'undefined' ? document.createElement('canvas') : null;
      const offCtx = offscreen
        ? offscreen.getContext('2d', { alpha: true, willReadFrequently: true })
        : null;

      if (offscreen && offCtx && dstCtx) {
        offscreen.width = targetWidth;
        offscreen.height = targetHeight;

        activeRenderTask = page.render({
          canvasContext: offCtx,
          canvas: offscreen,
          viewport: pixelViewport,
          ...(params.background ? { background: params.background } : {}),
        });

        try {
          await activeRenderTask.promise;
        } catch (err) {
          if (err instanceof pdfjsLib.RenderingCancelledException || cancelled) {
            return;
          }
          throw err;
        }
        if (cancelled) return;

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
          canvas.width = targetWidth;
          canvas.height = targetHeight;
        }
        canvas.style.width = `${cssWidthPx}px`;
        canvas.style.height = `${cssHeightPx}px`;
        dstCtx.clearRect(0, 0, targetWidth, targetHeight);
        dstCtx.drawImage(offscreen, 0, 0);
        return;
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = `${cssWidthPx}px`;
      canvas.style.height = `${cssHeightPx}px`;

      activeRenderTask = page.render({
        ...(dstCtx ? { canvasContext: dstCtx } : {}),
        canvas,
        viewport: pixelViewport,
        ...(params.background ? { background: params.background } : {}),
      });

      try {
        await activeRenderTask.promise;
      } catch (err) {
        if (err instanceof pdfjsLib.RenderingCancelledException || cancelled) {
          return;
        }
        throw err;
      }
    })();

    return {
      promise,
      cancel: () => {
        cancelled = true;
        if (activeRenderTask) {
          try {
            activeRenderTask.cancel();
          } catch {
            // Ignore already finished
          }
        }
      },
    };
  }

  /**
   * Extracts embedded raster XObject images and horizontal/vertical table rules & cell boxes
   * from PDF.js operator list for pairing with MuPDF text extraction.
   */
  async extractPageImagesAndRules(
    sourceDocId: string,
    bytes: Uint8Array,
    sourcePageIndex: number,
    pageId: string,
  ): Promise<{ images: DetectedImageObject[] } & VectorGeometry> {
    const doc = await this.getDocumentProxy(sourceDocId, bytes);
    const page = await doc.getPage(sourcePageIndex + 1);
    const baseViewport = page.getViewport({ scale: 1 });
    const opList = await page.getOperatorList();
    return extractImagesAndRulesFromOperatorList(page, opList, baseViewport.transform, pageId);
  }

  /**
   * Extracts clustered editable text blocks (with matched font/size/color)
   * and embedded raster XObject images (with PDF bounds, rotation, and PNG bytes)
   * in canonical base visual coordinates (userRotation = 0).
   */
  async extractPageContent(
    sourceDocId: string,
    bytes: Uint8Array,
    sourcePageIndex: number,
    pageId: string,
  ): Promise<PageExtractionResult> {
    const doc = await this.getDocumentProxy(sourceDocId, bytes);
    const page = await doc.getPage(sourcePageIndex + 1);
    const baseViewport = page.getViewport({ scale: 1 });

    const [textContent, opList] = await Promise.all([
      page.getTextContent({ includeMarkedContent: false }),
      page.getOperatorList(),
    ]);

    const textColors = extractTextOpColors(opList);
    const fontNameLookup = (fontId: string): string => {
      try {
        if (page.commonObjs.has(fontId)) {
          const obj = page.commonObjs.get(fontId) as { name?: string } | undefined;
          if (obj?.name) return obj.name;
        }
      } catch {
        // Ignore unavailable font obj
      }
      return '';
    };
    const textBlocks = clusterTextContent(
      textContent,
      baseViewport.transform,
      pageId,
      textColors,
      fontNameLookup,
    );
    const { images, shapes, horizontalRules, verticalRules, cellRects } =
      await extractImagesAndRulesFromOperatorList(
        page,
        opList,
        baseViewport.transform,
        pageId,
      );

    return { textBlocks, images, shapes, horizontalRules, verticalRules, cellRects };
  }
}

function normalizeCssColorToHex(color: unknown): string {
  if (typeof color !== 'string') return '#000000';
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return (
      '#' +
      trimmed
        .slice(1)
        .split('')
        .map((c) => c + c)
        .join('')
        .toLowerCase()
    );
  }
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]).toString(16).padStart(2, '0');
    const g = Number(rgbMatch[2]).toString(16).padStart(2, '0');
    const b = Number(rgbMatch[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return '#000000';
}

function rgbChannelArrayToHex(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') {
    return normalizeCssColorToHex(first);
  }
  if (
    typeof first === 'number' &&
    typeof args[1] === 'number' &&
    typeof args[2] === 'number'
  ) {
    const scale = first <= 1 && args[1] <= 1 && args[2] <= 1 ? 255 : 1;
    const toHex = (n: number) =>
      Math.round(Math.max(0, Math.min(255, n * scale)))
        .toString(16)
        .padStart(2, '0');
    return `#${toHex(first)}${toHex(args[1])}${toHex(args[2])}`;
  }
  return '#000000';
}

function grayValueToHex(gray: number): string {
  const v = Math.round(Math.max(0, Math.min(1, gray)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${v}${v}${v}`;
}

function cmykArrayToHex(args: unknown[]): string {
  if (
    typeof args[0] === 'number' &&
    typeof args[1] === 'number' &&
    typeof args[2] === 'number' &&
    typeof args[3] === 'number'
  ) {
    const [c, m, y, k] = args as number[];
    const toHex = (v: number) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${toHex((1 - c) * (1 - k))}${toHex((1 - m) * (1 - k))}${toHex((1 - y) * (1 - k))}`;
  }
  return '#000000';
}

function isAxisAlignedRectDrawData(
  drawData: unknown,
  ctm: number[],
  bbox: ArrayLike<number> | null | undefined,
): boolean {
  const [a, b, c, d] = ctm;
  const isOrtho =
    (Math.abs(b) < 1e-3 && Math.abs(c) < 1e-3) ||
    (Math.abs(a) < 1e-3 && Math.abs(d) < 1e-3);
  if (!isOrtho || !bbox || bbox.length < 4) return false;

  const opsSeq = Array.isArray(drawData) ? (drawData[0] as ArrayLike<number> | undefined) : undefined;
  if (!opsSeq || typeof opsSeq.length !== 'number' || opsSeq.length === 0) return false;

  // pdf-lib / standard rectangle paths consist purely of moveTo(0), lineTo(1), closePath(4)
  // with vertices landing on the bbox corners, or OPS.rectangle.
  const [bx0, by0, bx1, by1] = [bbox[0], bbox[1], bbox[2], bbox[3]];
  const eps = 0.75;
  let idx = 0;
  let cornerVisits = 0;
  while (idx < opsSeq.length) {
    const cmd = opsSeq[idx++];
    if (cmd === 0 || cmd === 1) {
      if (idx + 1 >= opsSeq.length) return false;
      const vx = opsSeq[idx++];
      const vy = opsSeq[idx++];
      const onX = Math.abs(vx - bx0) <= eps || Math.abs(vx - bx1) <= eps;
      const onY = Math.abs(vy - by0) <= eps || Math.abs(vy - by1) <= eps;
      if (!onX || !onY) return false;
      cornerVisits++;
    } else if (cmd === 4) {
      // closePath
    } else {
      return false;
    }
  }
  return cornerVisits >= 4 && cornerVisits <= 5;
}

/**
 * Walks PDF.js operator list to collect the active fill color at each showText operator.
 */
function extractTextOpColors(opList: { fnArray: number[]; argsArray: unknown[] }): string[] {
  const OPS = pdfjsLib.OPS;
  const colorStack: string[] = [];
  let currentColor = '#000000';
  const showColors: string[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[];

    if (fn === OPS.save) {
      colorStack.push(currentColor);
    } else if (fn === OPS.restore) {
      currentColor = colorStack.pop() ?? '#000000';
    } else if (fn === OPS.setFillRGBColor && args && args.length > 0) {
      currentColor = normalizeCssColorToHex(args[0]);
    } else if (fn === OPS.setFillGray && args && typeof args[0] === 'number') {
      const v = Math.round(Math.max(0, Math.min(1, args[0])) * 255)
        .toString(16)
        .padStart(2, '0');
      currentColor = `#${v}${v}${v}`;
    } else if (
      fn === OPS.showText ||
      fn === OPS.showSpacedText ||
      fn === OPS.nextLineShowText ||
      fn === OPS.nextLineSetSpacingShowText
    ) {
      showColors.push(currentColor);
    }
  }

  return showColors;
}

function clusterTextContent(
  textContent: Awaited<ReturnType<PDFPageProxy['getTextContent']>>,
  viewportTransform: number[],
  pageId: string,
  opColors: string[],
  fontNameLookup: (fontId: string) => string = () => '',
): DetectedTextBlock[] {
  const runs: RawTextRun[] = [];
  let colorCursor = 0;

  for (const item of textContent.items) {
    if (!('str' in item)) continue;
    const str = item.str;
    if (!str || (str.trim().length === 0 && item.width <= 0)) {
      if (item.hasEOL) colorCursor++;
      continue;
    }

    const tx = pdfjsLib.Util.transform(viewportTransform, item.transform);
    const fontSize = Math.max(4, Math.hypot(tx[2], tx[3]) || item.height || 12);
    const baselineY = tx[5];
    const style = textContent.styles[item.fontName];
    const loadedFontName = fontNameLookup(item.fontName);
    const rawFontName = [loadedFontName, item.fontName, style?.fontFamily].filter(Boolean).join(' ');
    const width = Math.max(item.width, str.length * fontSize * 0.35);
    const height = Math.max(item.height || 0, fontSize * 1.18);
    const color = opColors[Math.min(colorCursor, Math.max(0, opColors.length - 1))] ?? '#000000';

    if (item.hasEOL || str.trim().length > 0) {
      colorCursor++;
    }

    runs.push({
      str,
      x: tx[4],
      y: baselineY - fontSize * 0.85,
      width,
      height,
      fontSize,
      baselineY,
      rawFontName,
      color,
    });
  }

  if (runs.length === 0) return [];

  // Sort runs top-to-bottom, then left-to-right
  runs.sort((a, b) => {
    const dy = a.baselineY - b.baselineY;
    if (Math.abs(dy) > Math.min(a.fontSize, b.fontSize) * 0.35) return dy;
    return a.x - b.x;
  });

  // Step 1: Merge horizontally adjacent runs on the same baseline into lines
  interface LineRun {
    text: string;
    x: number;
    y: number;
    right: number;
    bottom: number;
    fontSize: number;
    baselineY: number;
    rawFontName: string;
    color: string;
  }

  const lines: LineRun[] = [];
  for (const run of runs) {
    const prev = lines[lines.length - 1];
    const sameBaseline =
      prev && Math.abs(prev.baselineY - run.baselineY) <= Math.max(prev.fontSize, run.fontSize) * 0.35;
    const closeHoriz = prev && run.x - prev.right <= Math.max(prev.fontSize, run.fontSize) * 1.4;
    const sameStyle =
      prev &&
      Math.abs(prev.fontSize - run.fontSize) <= 1.5 &&
      prev.color === run.color;

    if (prev && sameBaseline && closeHoriz && sameStyle) {
      const gap = run.x - prev.right;
      const spacer = gap > run.fontSize * 0.18 && !prev.text.endsWith(' ') && !run.str.startsWith(' ') ? ' ' : '';
      prev.text += spacer + run.str;
      prev.right = Math.max(prev.right, run.x + run.width);
      prev.y = Math.min(prev.y, run.y);
      prev.bottom = Math.max(prev.bottom, run.y + run.height);
    } else {
      lines.push({
        text: run.str,
        x: run.x,
        y: run.y,
        right: run.x + run.width,
        bottom: run.y + run.height,
        fontSize: run.fontSize,
        baselineY: run.baselineY,
        rawFontName: run.rawFontName,
        color: run.color,
      });
    }
  }

  // Step 2: Cluster vertically adjacent matching lines into paragraph blocks
  const blocks: DetectedTextBlock[] = [];
  let currentGroup: LineRun[] = [];

  const flushGroup = () => {
    if (currentGroup.length === 0) return;
    const first = currentGroup[0];
    const minX = Math.min(...currentGroup.map((l) => l.x));
    const minY = Math.min(...currentGroup.map((l) => l.y));
    const maxR = Math.max(...currentGroup.map((l) => l.right));
    const maxB = Math.max(...currentGroup.map((l) => l.bottom));
    const { fontFamily, bold, italic } = inferFontFromPdfName(first.rawFontName);

    let lineHeight = 1.2;
    if (currentGroup.length > 1) {
      const diffs: number[] = [];
      for (let i = 1; i < currentGroup.length; i++) {
        diffs.push(currentGroup[i].baselineY - currentGroup[i - 1].baselineY);
      }
      const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      lineHeight = Math.max(1.0, Math.min(2.0, Number((avgDiff / first.fontSize).toFixed(2))));
    }

    const joined = currentGroup.map((l) => l.text.trimEnd()).join('\n').trim();
    if (joined.length > 0) {
      blocks.push({
        id: createId('txtblk'),
        pageId,
        text: joined,
        x: minX,
        y: minY,
        width: Math.max(8, maxR - minX),
        height: Math.max(first.fontSize * 1.15, maxB - minY),
        fontSize: Number(first.fontSize.toFixed(3)),
        fontFamily,
        rawFontName: first.rawFontName,
        bold,
        italic,
        color: first.color,
        lineHeight,
        baselineOffset: first.baselineY - minY,
      });
    }
    currentGroup = [];
  };

  for (const line of lines) {
    if (currentGroup.length === 0) {
      currentGroup.push(line);
      continue;
    }
    const prev = currentGroup[currentGroup.length - 1];
    const verticalGap = line.baselineY - prev.baselineY;
    const prevFont = inferFontFromPdfName(prev.rawFontName);
    const curFont = inferFontFromPdfName(line.rawFontName);
    const prevMacro = prevFont.fontFamily === 'Courier' || prevFont.fontFamily === 'JetBrainsMono' ? 'mono' : 'prop';
    const curMacro = curFont.fontFamily === 'Courier' || curFont.fontFamily === 'JetBrainsMono' ? 'mono' : 'prop';
    const compatibleFont =
      Math.abs(line.fontSize - prev.fontSize) <= Math.max(1.4, line.fontSize * 0.14) &&
      line.color === prev.color &&
      prevMacro === curMacro;
    const colLeft = Math.min(...currentGroup.map((l) => l.x));
    const alignedLeft =
      Math.abs(line.x - colLeft) <= line.fontSize * 1.8 ||
      Math.abs(line.x - prev.x) <= line.fontSize * 1.8 ||
      (currentGroup.length === 1 && prev.x > line.x && prev.x - line.x <= line.fontSize * 4.5) ||
      (currentGroup.length === 1 && line.x > prev.x && line.x - prev.x <= line.fontSize * 4.5);

    if (compatibleFont && alignedLeft && verticalGap > 0 && verticalGap <= line.fontSize * 2.15) {
      currentGroup.push(line);
    } else {
      flushGroup();
      currentGroup.push(line);
    }
  }
  flushGroup();

  return blocks;
}

function resolvePdfObject(
  page: PDFPageProxy,
  objId: string,
  timeoutMs = 1500,
): Promise<unknown> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: unknown) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      if (page.objs.has(objId)) {
        clearTimeout(timer);
        finish(page.objs.get(objId));
        return;
      }
      page.objs.get(objId, (data: unknown) => {
        clearTimeout(timer);
        finish(data);
      });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

async function pdfImageDataToPng(imgData: {
  width?: number;
  height?: number;
  bitmap?: ImageBitmap;
  data?: Uint8ClampedArray | Uint8Array;
  kind?: number;
}): Promise<{ pngBytes: Uint8Array; pixelWidth: number; pixelHeight: number } | null> {
  if (typeof document === 'undefined') return null;
  const width = imgData.width ?? imgData.bitmap?.width ?? 0;
  const height = imgData.height ?? imgData.bitmap?.height ?? 0;
  if (width <= 0 || height <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if (imgData.bitmap) {
    ctx.drawImage(imgData.bitmap, 0, 0, width, height);
  } else if (imgData.data) {
    const src = imgData.data;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const totalPixels = width * height;
    if (src.length === totalPixels * 4) {
      rgba.set(src);
    } else if (src.length === totalPixels * 3) {
      for (let s = 0, d = 0; s < src.length; s += 3, d += 4) {
        rgba[d] = src[s];
        rgba[d + 1] = src[s + 1];
        rgba[d + 2] = src[s + 2];
        rgba[d + 3] = 255;
      }
    } else if (src.length === totalPixels) {
      for (let s = 0, d = 0; s < src.length; s++, d += 4) {
        rgba[d] = src[s];
        rgba[d + 1] = src[s];
        rgba[d + 2] = src[s];
        rgba[d + 3] = 255;
      }
    } else {
      return null;
    }
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  } else {
    return null;
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  return {
    pngBytes: new Uint8Array(buf),
    pixelWidth: width,
    pixelHeight: height,
  };
}

async function extractImagesAndRulesFromOperatorList(
  page: PDFPageProxy,
  opList: { fnArray: number[]; argsArray: unknown[] },
  viewportTransform: number[],
  pageId: string,
): Promise<{ images: DetectedImageObject[] } & VectorGeometry> {
  const OPS = pdfjsLib.OPS;
  const baseVp = page.getViewport({ scale: 1 });
  const pageWidth = baseVp.width || 612;
  const pageHeight = baseVp.height || 792;
  const ctmStack: number[][] = [];
  const alphaStack: number[] = [];
  const strokeAlphaStack: number[] = [];
  const fillColorStack: string[] = [];
  const strokeColorStack: string[] = [];
  const lineWidthStack: number[] = [];
  let ctm = [...viewportTransform];
  let fillAlpha = 1;
  let strokeAlpha = 1;
  let fillColor = '#000000';
  let strokeColor = '#000000';
  let lineWidth = 1;
  let textMatrix = [1, 0, 0, 1, 0, 0];
  let textLineMatrix = [1, 0, 0, 1, 0, 0];
  let textLeading = 0;
  let currentFontSize = 12;

  const images: DetectedImageObject[] = [];
  const shapes: DetectedVectorShape[] = [];
  const horizontalRules: HorizontalRule[] = [];
  const verticalRules: VerticalRule[] = [];
  const cellRects: RectBox[] = [];
  const fillOnlyRects: RectBox[] = [];
  const drawnRegions: Array<{ opIndex: number; x0: number; y0: number; x1: number; y1: number }> =
    [];

  const recordShapeCandidate = (
    opIndex: number,
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    isFilled: boolean,
    isStroked: boolean,
  ) => {
    if (rw < 24 || rh < 14) return;
    if (rw > pageWidth * 1.02 || rh > pageHeight * 1.02) return;
    const effFill = isFilled && fillAlpha > 0.02 ? fillColor : null;
    const effStroke = isStroked && lineWidth > 0 && strokeAlpha > 0.02 ? strokeColor : null;
    if (!effFill && !effStroke) return;
    // Skip invisible interior white background masks without border
    if (effFill === '#ffffff' && !effStroke) return;
    if (
      rw >= pageWidth * 0.94 &&
      rh >= pageHeight * 0.92 &&
      (!effFill || effFill === '#ffffff')
    ) {
      return;
    }

    const opAlpha = isFilled ? fillAlpha : strokeAlpha;
    const existing = shapes.find(
      (s) =>
        Math.abs(s.x - rx) <= 1.2 &&
        Math.abs(s.y - ry) <= 1.2 &&
        Math.abs(s.width - rw) <= 1.5 &&
        Math.abs(s.height - rh) <= 1.5 &&
        Math.abs(s.operatorIndex - opIndex) <= 6,
    );
    if (existing) {
      if (!existing.fillColor && effFill) existing.fillColor = effFill;
      if (!existing.strokeColor && effStroke) {
        existing.strokeColor = effStroke;
        existing.strokeWidth = Number(lineWidth.toFixed(2));
      }
      return;
    }

    shapes.push({
      id: createId('shape'),
      pageId,
      operatorIndex: opIndex,
      x: rx,
      y: ry,
      width: rw,
      height: rh,
      fillColor: effFill,
      strokeColor: effStroke,
      strokeWidth: effStroke ? Number(lineWidth.toFixed(2)) : 0,
      opacity: Number(Math.max(0.05, Math.min(1, opAlpha)).toFixed(2)),
    });
  };

  const applyTranslateToTm = (tx: number, ty: number) => {
    const [a, b, c, d, e, f] = textLineMatrix;
    textLineMatrix = [a, b, c, d, a * tx + c * ty + e, b * tx + d * ty + f];
    textMatrix = [...textLineMatrix];
  };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[];

    if (fn === OPS.save) {
      ctmStack.push([...ctm]);
      alphaStack.push(fillAlpha);
      strokeAlphaStack.push(strokeAlpha);
      fillColorStack.push(fillColor);
      strokeColorStack.push(strokeColor);
      lineWidthStack.push(lineWidth);
    } else if (fn === OPS.restore) {
      ctm = ctmStack.pop() ?? [...viewportTransform];
      fillAlpha = alphaStack.pop() ?? 1;
      strokeAlpha = strokeAlphaStack.pop() ?? 1;
      fillColor = fillColorStack.pop() ?? '#000000';
      strokeColor = strokeColorStack.pop() ?? '#000000';
      lineWidth = lineWidthStack.pop() ?? 1;
    } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
      ctm = pdfjsLib.Util.transform(ctm, args as number[]);
    } else if (fn === OPS.setFillRGBColor && Array.isArray(args) && args.length > 0) {
      fillColor = rgbChannelArrayToHex(args);
    } else if (fn === OPS.setStrokeRGBColor && Array.isArray(args) && args.length > 0) {
      strokeColor = rgbChannelArrayToHex(args);
    } else if (fn === OPS.setFillGray && Array.isArray(args) && typeof args[0] === 'number') {
      fillColor = grayValueToHex(args[0]);
    } else if (fn === OPS.setStrokeGray && Array.isArray(args) && typeof args[0] === 'number') {
      strokeColor = grayValueToHex(args[0]);
    } else if (fn === OPS.setFillCMYKColor && Array.isArray(args)) {
      fillColor = cmykArrayToHex(args);
    } else if (fn === OPS.setStrokeCMYKColor && Array.isArray(args)) {
      strokeColor = cmykArrayToHex(args);
    } else if (fn === OPS.setLineWidth && Array.isArray(args) && typeof args[0] === 'number') {
      lineWidth = Math.max(0, args[0]);
    } else if (fn === OPS.setGState && Array.isArray(args?.[0])) {
      for (const entry of args[0] as Array<[string, unknown]>) {
        if (entry?.[0] === 'ca' && typeof entry[1] === 'number') {
          fillAlpha = Math.max(0, Math.min(1, entry[1]));
        } else if (entry?.[0] === 'CA' && typeof entry[1] === 'number') {
          strokeAlpha = Math.max(0, Math.min(1, entry[1]));
        }
      }
    } else if (fn === OPS.setFont && Array.isArray(args) && args.length >= 2) {
      const fs = Math.abs(Number(args[1]) || 0);
      if (fs > 0.5) currentFontSize = fs;
    } else if (fn === OPS.beginText) {
      textMatrix = [1, 0, 0, 1, 0, 0];
      textLineMatrix = [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS.setTextMatrix && Array.isArray(args) && args.length >= 6) {
      textMatrix = args.slice(0, 6).map(Number);
      textLineMatrix = [...textMatrix];
    } else if (fn === OPS.setLeading && args?.length) {
      textLeading = Number(args[0]) || 0;
    } else if (fn === OPS.moveText && Array.isArray(args) && args.length >= 2) {
      applyTranslateToTm(Number(args[0]) || 0, Number(args[1]) || 0);
    } else if (fn === OPS.setLeadingMoveText && Array.isArray(args) && args.length >= 2) {
      const ty = Number(args[1]) || 0;
      textLeading = -ty;
      applyTranslateToTm(Number(args[0]) || 0, ty);
    } else if (fn === OPS.nextLine) {
      applyTranslateToTm(0, -textLeading);
    } else if (
      fn === OPS.showText ||
      fn === OPS.showSpacedText ||
      fn === OPS.nextLineShowText ||
      fn === OPS.nextLineSetSpacingShowText
    ) {
      if (fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
        applyTranslateToTm(0, -textLeading);
      }
      const [a, b, c, d, e, f] = ctm;
      const tx = textMatrix[4];
      const ty = textMatrix[5];
      const vx = a * tx + c * ty + e;
      const vy = b * tx + d * ty + f;
      const tmScaleX = Math.hypot(
        a * textMatrix[0] + c * textMatrix[1],
        b * textMatrix[0] + d * textMatrix[1],
      );
      const tmScaleY = Math.hypot(
        a * textMatrix[2] + c * textMatrix[3],
        b * textMatrix[2] + d * textMatrix[3],
      );
      const rawScale = Math.max(tmScaleX, tmScaleY, 1);
      const estFontSize = Math.max(6, rawScale >= 4 ? rawScale : rawScale * currentFontSize);
      let glyphCount = 0;
      let glyphWidthSum = 0;
      const glyphsArg = Array.isArray(args?.[0])
        ? args[0]
        : Array.isArray(args?.[2])
          ? args[2]
          : null;
      if (glyphsArg) {
        for (const item of glyphsArg) {
          if (item && typeof item === 'object') {
            glyphCount += 1;
            if ('width' in item && typeof (item as { width?: number }).width === 'number') {
              glyphWidthSum += Math.max(0, (item as { width: number }).width);
            }
          } else if (typeof item === 'string') {
            glyphCount += item.length;
          }
        }
      }
      const estWidthPt =
        glyphWidthSum > 0
          ? Math.max(18, (glyphWidthSum / 1000) * estFontSize)
          : Math.max(18, glyphCount * estFontSize * 0.55);
      drawnRegions.push({
        opIndex: i,
        x0: vx - 2,
        y0: vy - Math.max(10, estFontSize * 0.9),
        x1: vx + estWidthPt,
        y1: vy + Math.max(6, estFontSize * 0.35),
      });
    } else if (fn === OPS.constructPath && Array.isArray(args) && args.length >= 3) {
      const paintOp = args[0] as number;
      const drawData = args[1] as unknown;
      const bbox = args[2] as ArrayLike<number> | null | undefined;
      const [a, b, c, d, e, f] = ctm;
      const txPt = (px: number, py: number) => ({
        x: a * px + c * py + e,
        y: b * px + d * py + f,
      });

      const isStroked =
        paintOp === OPS.stroke ||
        paintOp === OPS.closeStroke ||
        paintOp === OPS.fillStroke ||
        paintOp === OPS.closeFillStroke ||
        paintOp === OPS.eoFillStroke ||
        paintOp === OPS.closeEOFillStroke;

      const isFilled =
        paintOp === OPS.fill ||
        paintOp === OPS.eoFill ||
        paintOp === OPS.fillStroke ||
        paintOp === OPS.closeFillStroke ||
        paintOp === OPS.eoFillStroke ||
        paintOp === OPS.closeEOFillStroke;

      let parsedSubpaths = false;
      const opsSeq =
        Array.isArray(drawData) && drawData.length > 0 && Array.isArray(drawData[0])
          ? null
          : Array.isArray(drawData) && drawData.length > 0 && typeof (drawData[0] as ArrayLike<number>)?.length === 'number'
            ? (drawData[0] as ArrayLike<number>)
            : null;

      if (opsSeq && opsSeq.length >= 3) {
        let curX = 0;
        let curY = 0;
        let subStartX = 0;
        let subStartY = 0;
        let idx = 0;
        while (idx < opsSeq.length) {
          const op = opsSeq[idx++];
          if (op === OPS.moveTo && idx + 1 < opsSeq.length) {
            curX = opsSeq[idx++];
            curY = opsSeq[idx++];
            subStartX = curX;
            subStartY = curY;
            parsedSubpaths = true;
          } else if (op === OPS.lineTo && idx + 1 < opsSeq.length) {
            const nx = opsSeq[idx++];
            const ny = opsSeq[idx++];
            const p0 = txPt(curX, curY);
            const p1 = txPt(nx, ny);
            const dx = Math.abs(p1.x - p0.x);
            const dy = Math.abs(p1.y - p0.y);
            if (dx >= 12 && dy <= 3.5) {
              horizontalRules.push({
                y: (p0.y + p1.y) / 2,
                x0: Math.min(p0.x, p1.x),
                x1: Math.max(p0.x, p1.x),
              });
            } else if (dy >= 8 && dx <= 3.5) {
              verticalRules.push({
                x: (p0.x + p1.x) / 2,
                y0: Math.min(p0.y, p1.y),
                y1: Math.max(p0.y, p1.y),
              });
            }
            curX = nx;
            curY = ny;
            parsedSubpaths = true;
          } else if (op === OPS.closePath) {
            const p0 = txPt(curX, curY);
            const p1 = txPt(subStartX, subStartY);
            const dx = Math.abs(p1.x - p0.x);
            const dy = Math.abs(p1.y - p0.y);
            if (dx >= 12 && dy <= 3.5) {
              horizontalRules.push({
                y: (p0.y + p1.y) / 2,
                x0: Math.min(p0.x, p1.x),
                x1: Math.max(p0.x, p1.x),
              });
            } else if (dy >= 8 && dx <= 3.5) {
              verticalRules.push({
                x: (p0.x + p1.x) / 2,
                y0: Math.min(p0.y, p1.y),
                y1: Math.max(p0.y, p1.y),
              });
            }
            curX = subStartX;
            curY = subStartY;
          } else if (op === OPS.curveTo && idx + 5 < opsSeq.length) {
            idx += 4;
            curX = opsSeq[idx++];
            curY = opsSeq[idx++];
          } else if ((op === OPS.curveTo2 || op === OPS.curveTo3) && idx + 3 < opsSeq.length) {
            idx += 2;
            curX = opsSeq[idx++];
            curY = opsSeq[idx++];
          } else if (op === OPS.rectangle && idx + 3 < opsSeq.length) {
            const rx = opsSeq[idx++];
            const ry = opsSeq[idx++];
            const rw = opsSeq[idx++];
            const rh = opsSeq[idx++];
            const rPts = [
              txPt(rx, ry),
              txPt(rx + rw, ry),
              txPt(rx, ry + rh),
              txPt(rx + rw, ry + rh),
            ];
            const rMinX = Math.min(...rPts.map((p) => p.x));
            const rMaxX = Math.max(...rPts.map((p) => p.x));
            const rMinY = Math.min(...rPts.map((p) => p.y));
            const rMaxY = Math.max(...rPts.map((p) => p.y));
            const rW = rMaxX - rMinX;
            const rH = rMaxY - rMinY;
            if (rW >= 12 && rH <= 4.5) {
              horizontalRules.push({ y: (rMinY + rMaxY) / 2, x0: rMinX, x1: rMaxX });
            } else if (rH >= 8 && rW <= 4.5) {
              verticalRules.push({ x: (rMinX + rMaxX) / 2, y0: rMinY, y1: rMaxY });
            } else if (rW >= 14 && rH >= 8 && rW < pageWidth * 0.96 && rH < pageHeight * 0.92) {
              if (isStroked) {
                cellRects.push({ x: rMinX, y: rMinY, width: rW, height: rH });
                horizontalRules.push(
                  { y: rMinY, x0: rMinX, x1: rMaxX },
                  { y: rMaxY, x0: rMinX, x1: rMaxX },
                );
                verticalRules.push(
                  { x: rMinX, y0: rMinY, y1: rMaxY },
                  { x: rMaxX, y0: rMinY, y1: rMaxY },
                );
              } else {
                fillOnlyRects.push({ x: rMinX, y: rMinY, width: rW, height: rH });
              }
            }
            recordShapeCandidate(i, rMinX, rMinY, rW, rH, isFilled, isStroked);
            parsedSubpaths = true;
          } else {
            break;
          }
        }
      }

      if (bbox && bbox.length >= 4) {
        const [bx0, by0, bx1, by1] = [bbox[0], bbox[1], bbox[2], bbox[3]];
        const pts = [txPt(bx0, by0), txPt(bx1, by0), txPt(bx0, by1), txPt(bx1, by1)];
        const minX = Math.min(...pts.map((p) => p.x));
        const maxX = Math.max(...pts.map((p) => p.x));
        const minY = Math.min(...pts.map((p) => p.y));
        const maxY = Math.max(...pts.map((p) => p.y));
        const w = maxX - minX;
        const h = maxY - minY;
        if (w > 0.5 || h > 0.5) {
          drawnRegions.push({ opIndex: i, x0: minX, y0: minY, x1: maxX, y1: maxY });
        }
        if (!parsedSubpaths) {
          if (w >= 12 && h <= 4.5) {
            horizontalRules.push({ y: (minY + maxY) / 2, x0: minX, x1: maxX });
          } else if (h >= 8 && w <= 4.5) {
            verticalRules.push({ x: (minX + maxX) / 2, y0: minY, y1: maxY });
          } else if (w >= 14 && h >= 8 && w < pageWidth * 0.96 && h < pageHeight * 0.92) {
            if (isStroked) {
              cellRects.push({ x: minX, y: minY, width: w, height: h });
              horizontalRules.push(
                { y: minY, x0: minX, x1: maxX },
                { y: maxY, x0: minX, x1: maxX },
              );
              verticalRules.push(
                { x: minX, y0: minY, y1: maxY },
                { x: maxX, y0: minY, y1: maxY },
              );
            } else {
              fillOnlyRects.push({ x: minX, y: minY, width: w, height: h });
            }
          }
          if (isAxisAlignedRectDrawData(drawData, ctm, bbox)) {
            recordShapeCandidate(i, minX, minY, w, h, isFilled, isStroked);
          }
        }
      }
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageMaskXObject
    ) {
      const [a, b, c, d, e, f] = ctm;
      // Unit square corners in PDF image space mapped through CTM to visual page space
      const corners = [
        { x: e, y: f },
        { x: a + e, y: b + f },
        { x: c + e, y: d + f },
        { x: a + c + e, y: b + d + f },
      ];
      const minX = Math.min(...corners.map((p) => p.x));
      const maxX = Math.max(...corners.map((p) => p.x));
      const minY = Math.min(...corners.map((p) => p.y));
      const maxY = Math.max(...corners.map((p) => p.y));
      const width = maxX - minX;
      const height = maxY - minY;

      // Ignore tiny 1px spacer masks
      if (width < 4 || height < 4) continue;

      let imgObj: unknown = null;
      let resourceName = `Image_${images.length + 1}`;
      if (fn === OPS.paintInlineImageXObject) {
        imgObj = args?.[0];
      } else if (typeof args?.[0] === 'string') {
        resourceName = args[0];
        imgObj = await resolvePdfObject(page, resourceName);
      }

      if (!imgObj || typeof imgObj !== 'object') continue;
      const converted = await pdfImageDataToPng(
        imgObj as Parameters<typeof pdfImageDataToPng>[0],
      );
      if (!converted) continue;

      const previewUrl = blobRegistry.createUrlFromBytes(
        converted.pngBytes,
        'image/png',
        'cache',
      );
      const imgDecomp = decomposeImageCtm(ctm);

      images.push({
        id: createId('imgobj'),
        pageId,
        resourceName,
        operatorIndex: i,
        x: imgDecomp.x,
        y: imgDecomp.y,
        width: imgDecomp.width,
        height: imgDecomp.height,
        rotation: imgDecomp.rotation,
        flipX: imgDecomp.flipX || undefined,
        flipY: imgDecomp.flipY || undefined,
        pixelWidth: converted.pixelWidth,
        pixelHeight: converted.pixelHeight,
        previewUrl,
        pngBytes: converted.pngBytes,
        opacity: Number(Math.max(0.05, Math.min(1, fillAlpha)).toFixed(2)),
        behindContent: false,
      });
    }
  }

  for (const img of images) {
    const ix0 = img.x + 1;
    const iy0 = img.y + 1;
    const ix1 = img.x + img.width - 1;
    const iy1 = img.y + img.height - 1;
    const hasLaterOverlap = drawnRegions.some(
      (r) =>
        r.opIndex > img.operatorIndex &&
        r.x1 >= ix0 &&
        r.x0 <= ix1 &&
        r.y1 >= iy0 &&
        r.y0 <= iy1,
    );
    const areaRatio = (img.width * img.height) / Math.max(1, pageWidth * pageHeight);
    const isHeaderStrip =
      (img.width >= pageWidth * 0.45 &&
        img.y <= pageHeight * 0.22 &&
        img.height <= pageHeight * 0.25) ||
      (img.width >= pageWidth * 0.85 && img.height >= pageHeight * 0.12);
    const isFullBg = areaRatio >= 0.65;
    if (hasLaterOverlap || isFullBg) {
      img.behindContent = true;
    }
    if (hasLaterOverlap || isHeaderStrip || isFullBg) {
      img.isHeaderOrBackground = true;
    }
    img.isBackgroundLayer = Boolean(img.isHeaderOrBackground || areaRatio >= 0.65);
  }

  // Promote fill-only boxes into cellRects only when side-by-side in the same row band
  // (e.g. borderless shaded multi-column table cells), ignoring full-width highlight/background bands.
  for (let i = 0; i < fillOnlyRects.length; i++) {
    const a = fillOnlyRects[i];
    const hasSideBySidePeer = fillOnlyRects.some((b, j) => {
      if (i === j) return false;
      const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      const minH = Math.min(a.height, b.height);
      const horizDisjoint = b.x >= a.x + a.width - 2 || a.x >= b.x + b.width - 2;
      return yOverlap >= minH * 0.6 && Math.abs(a.height - b.height) <= 4 && horizDisjoint;
    });
    if (hasSideBySidePeer) {
      cellRects.push(a);
    }
  }

  // Classify shapes behind text/content or header banners as editable background layers
  for (const shp of shapes) {
    const shpArea = Math.max(1, shp.width * shp.height);
    const shpX1 = shp.x + shp.width;
    const shpY1 = shp.y + shp.height;
    const hasLaterOverlap = drawnRegions.some((r) => {
      if (r.opIndex <= shp.operatorIndex) return false;
      const ix = Math.min(shpX1, r.x1) - Math.max(shp.x, r.x0);
      const iy = Math.min(shpY1, r.y1) - Math.max(shp.y, r.y0);
      if (ix <= 1 || iy <= 1) return false;
      const rArea = Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0));
      return ix * iy >= Math.min(shpArea, rArea) * 0.15;
    });
    const areaRatio = (shp.width * shp.height) / Math.max(1, pageWidth * pageHeight);
    const isHeaderStrip =
      (shp.width >= pageWidth * 0.45 &&
        shp.y <= pageHeight * 0.22 &&
        shp.height <= pageHeight * 0.25) ||
      (shp.width >= pageWidth * 0.85 && shp.height >= pageHeight * 0.12);
    const isFullBg = areaRatio >= 0.65;
    if (hasLaterOverlap || isFullBg || isHeaderStrip) {
      shp.behindContent = true;
    }
    if (hasLaterOverlap || isHeaderStrip || isFullBg) {
      shp.isHeaderOrBackground = true;
    }
    shp.isBackgroundLayer = Boolean(shp.isHeaderOrBackground || areaRatio >= 0.35);
  }

  return { images, shapes, horizontalRules, verticalRules, cellRects };
}

export const pdfjsService = new PdfJsService();
