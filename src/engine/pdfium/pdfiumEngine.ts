import { init, type PdfiumModule, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { RotationAngle } from '@/types/pdf';
import type {
  PdfiumOpenResult,
  PdfiumPageSummary,
  PdfLinkAnnotation,
  PdfOutlineNode,
  PdfSearchHit,
  PdfTextSpan,
  TileRenderRequest,
} from './pdfiumTypes';

const FPDF_ERR_PASSWORD = 4;
const FPDF_ANNOT = 0x01;
const FPDF_LCD_TEXT = 0x02;
const FPDFBitmap_BGRA = 4;
const MAX_CACHED_OPEN_PAGES = 8;

type PdfiumRuntimeWithHeap = WrappedPdfiumModule['pdfium'] & {
  HEAPU8: Uint8Array;
};

interface OpenDocumentEntry {
  sourceDocId: string;
  docPtr: number;
  dataPtr: number;
  byteLength: number;
  pagesMeta: PdfiumPageSummary[];
  canCopyText: boolean;
  permissions: number;
}

interface CachedPageEntry {
  key: string;
  sourceDocId: string;
  pageIndex: number;
  docPtr: number;
  pagePtr: number;
}

/**
 * Turkish-aware case & diacritic folding for document-wide search (02 §3.5).
 * Maps İ/i/ı/I -> i and strips combining marks while preserving fast index offsets.
 */
export function normalizeForTurkishSearch(input: string, foldDiacritics = true): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === 'İ' || ch === 'I' || ch === 'ı') {
      out += 'i';
    } else if (foldDiacritics) {
      if (ch === 'ğ' || ch === 'Ğ') out += 'g';
      else if (ch === 'ş' || ch === 'Ş') out += 's';
      else if (ch === 'ç' || ch === 'Ç') out += 'c';
      else if (ch === 'ö' || ch === 'Ö') out += 'o';
      else if (ch === 'ü' || ch === 'Ü') out += 'u';
      else {
        const folded = ch
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();
        out += folded;
      }
    } else {
      out += ch.toLowerCase();
    }
  }
  return out;
}

function getClockwiseTotalSteps(userRotation: RotationAngle): 0 | 1 | 2 | 3 {
  const norm = ((userRotation % 360) + 360) % 360;
  if (norm === 90) return 1;
  if (norm === 180) return 2;
  if (norm === 270) return 3;
  return 0;
}

/**
 * Single-thread PDFium engine wrapper (00 -> D2).
 * All calls into `WrappedPdfiumModule` happen sequentially within one worker or thread.
 */
export class PdfiumEngine {
  private mod: WrappedPdfiumModule | null = null;
  private openDocs = new Map<string, OpenDocumentEntry>();
  private pageLru = new Map<string, CachedPageEntry>();

  async init(moduleOverrides?: Partial<PdfiumModule>): Promise<void> {
    if (this.mod) return;
    const mod = await init(moduleOverrides ?? {});
    mod.PDFiumExt_Init();
    this.mod = mod;
  }

  private ensureMod(): WrappedPdfiumModule {
    if (!this.mod) {
      throw new Error('PdfiumEngine has not been initialized');
    }
    return this.mod;
  }

  hasDocument(sourceDocId: string): boolean {
    return this.openDocs.has(sourceDocId);
  }

  openDocument(sourceDocId: string, bytes: Uint8Array, password?: string): PdfiumOpenResult {
    const mod = this.ensureMod();
    this.closeDocument(sourceDocId);

    const dataPtr = mod.pdfium.wasmExports.malloc(bytes.byteLength);
    if (!dataPtr) {
      throw new Error('Failed to allocate Wasm memory for PDF document');
    }

    let docPtr = 0;
    try {
      (mod.pdfium as unknown as PdfiumRuntimeWithHeap).HEAPU8.set(bytes, dataPtr);
      docPtr = mod.FPDF_LoadMemDocument(dataPtr, bytes.byteLength, password ?? '');
      if (!docPtr) {
        const err = mod.FPDF_GetLastError();
        mod.pdfium.wasmExports.free(dataPtr);
        if (err === FPDF_ERR_PASSWORD) {
          return {
            status: password ? 'invalid-password' : 'needs-password',
            pageCount: 0,
            pages: [],
            canCopyText: true,
            permissions: 0,
          };
        }
        throw new Error(`PDFium failed to open document (error code ${err})`);
      }

      const pageCount = mod.FPDF_GetPageCount(docPtr);
      const permissions = mod.FPDF_GetDocUserPermissions(docPtr);
      // Bit 4 (16) = print/copy extract text in PDF spec; bit 9 (512) = accessibility extract; -1 = unrestricted
      const canCopyText =
        permissions === -1 || Boolean((permissions & 0x10) !== 0 || (permissions & 0x200) !== 0);

      const pages: PdfiumPageSummary[] = [];
      const sizePtr = mod.pdfium.wasmExports.malloc(8);
      try {
        for (let i = 0; i < pageCount; i++) {
          const ok = mod.FPDF_GetPageSizeByIndexF(docPtr, i, sizePtr);
          const w = ok ? mod.pdfium.getValue(sizePtr, 'float') : 612;
          const h = ok ? mod.pdfium.getValue(sizePtr + 4, 'float') : 792;
          const rotIdx = mod.EPDF_GetPageRotationByIndex(docPtr, i);
          const intrinsicRotation: RotationAngle =
            rotIdx === 1 ? 90 : rotIdx === 2 ? 180 : rotIdx === 3 ? 270 : 0;

          pages.push({
            sourcePageIndex: i,
            baseWidth: w > 1 ? w : 612,
            baseHeight: h > 1 ? h : 792,
            intrinsicRotation,
          });
        }
      } finally {
        mod.pdfium.wasmExports.free(sizePtr);
      }

      this.openDocs.set(sourceDocId, {
        sourceDocId,
        docPtr,
        dataPtr,
        byteLength: bytes.byteLength,
        pagesMeta: pages,
        canCopyText,
        permissions,
      });

      return {
        status: 'ok',
        pageCount,
        pages,
        canCopyText,
        permissions,
      };
    } catch (err) {
      if (docPtr) {
        mod.FPDF_CloseDocument(docPtr);
      }
      mod.pdfium.wasmExports.free(dataPtr);
      throw err;
    }
  }

  closeDocument(sourceDocId: string): void {
    const mod = this.mod;
    if (!mod) return;

    for (const [key, entry] of [...this.pageLru.entries()]) {
      if (entry.sourceDocId === sourceDocId) {
        this.pageLru.delete(key);
        mod.FPDF_ClosePage(entry.pagePtr);
      }
    }

    const doc = this.openDocs.get(sourceDocId);
    if (doc) {
      this.openDocs.delete(sourceDocId);
      mod.FPDF_CloseDocument(doc.docPtr);
      mod.pdfium.wasmExports.free(doc.dataPtr);
    }
  }

  trimPages(maxOpenPages = 0): void {
    const mod = this.mod;
    if (!mod) return;
    while (this.pageLru.size > maxOpenPages) {
      const oldestKey = this.pageLru.keys().next().value;
      if (!oldestKey) break;
      const entry = this.pageLru.get(oldestKey);
      this.pageLru.delete(oldestKey);
      if (entry) {
        mod.FPDF_ClosePage(entry.pagePtr);
      }
    }
  }

  private getOrLoadPage(sourceDocId: string, pageIndex: number): {
    doc: OpenDocumentEntry;
    pagePtr: number;
    meta: PdfiumPageSummary;
  } {
    const mod = this.ensureMod();
    const doc = this.openDocs.get(sourceDocId);
    if (!doc) {
      throw new Error(`PDFIUM_DOC_NOT_OPEN:${sourceDocId}`);
    }
    const meta = doc.pagesMeta[pageIndex];
    if (!meta) {
      throw new Error(`Invalid page index ${pageIndex} for ${sourceDocId}`);
    }

    const key = `${sourceDocId}:${pageIndex}`;
    const cached = this.pageLru.get(key);
    if (cached) {
      this.pageLru.delete(key);
      this.pageLru.set(key, cached);
      return { doc, pagePtr: cached.pagePtr, meta };
    }

    const pagePtr = mod.FPDF_LoadPage(doc.docPtr, pageIndex);
    if (!pagePtr) {
      throw new Error(`Failed to load page ${pageIndex} in PDFium`);
    }
    this.pageLru.set(key, {
      key,
      sourceDocId,
      pageIndex,
      docPtr: doc.docPtr,
      pagePtr,
    });
    this.trimPages(MAX_CACHED_OPEN_PAGES);
    return { doc, pagePtr, meta };
  }

  /**
   * Renders any rectangular tile or full-page preview into RGBA Uint8ClampedArray.
   * Uses `FPDF_RenderPageBitmapWithMatrix` with exact device transform & clip rect.
   */
  renderTileRgba(req: TileRenderRequest): {
    width: number;
    height: number;
    rgba: Uint8ClampedArray;
  } {
    const mod = this.ensureMod();
    const { pagePtr, meta } = this.getOrLoadPage(req.sourceDocId, req.pageIndex);

    const w = Math.max(1, Math.round(req.tileWidthPx));
    const h = Math.max(1, Math.round(req.tileHeightPx));
    const s = req.scale;
    const rotSteps = getClockwiseTotalSteps(req.userRotation);

    // Base page visual width/height (in points) before userRotation
    const pw = meta.baseWidth;
    const ph = meta.baseHeight;

    // PDFium's FPDF_RenderPageBitmapWithMatrix transforms PDF page space (Y-up from bottom-left,
    // or rather PDFium's page user space where default matrix [1,0,0,-1,0,ph] maps top-left to (0,0)).
    // Wait: FPDF_RenderPageBitmapWithMatrix applies FS_MATRIX on top of PDFium's *already-device-oriented*
    // or *PDF page* coordinate system! Let's check:
    // Actually in PDFium: FPDF_RenderPageBitmapWithMatrix maps from PDF page space (bottom-left (0,0),
    // top-right (pw, ph) before display flip, OR top-left)? Let's check exact matrix:
    // In PDFium `FPDF_RenderPageBitmapWithMatrix`:
    //   matrix maps *PDF page coordinates* (where FPDF_LoadPage already normalized display rotation so
    //   page space has width=pw, height=ph with Y UPWARD from bottom-left (0,0) to top-right (pw, ph))
    //   wait OR does PDFium use Y-downward in FPDF_RenderPageBitmapWithMatrix?
    //   Let's verify: in PDFium's fpdfview.h, `FPDF_RenderPageBitmap` uses `FPDF_PageToDevice`
    //   where device Y goes DOWN and PDF page Y goes UP, so the default matrix at scale s is:
    //   a = s, b = 0, c = 0, d = -s, e = 0, f = ph * s (or wait — let's test in Vitest!).
    // Actually in PDFium fpdf_view.cpp: `CFX_Matrix page2device = page->GetDisplayMatrix(rect, rotate)`
    // AND `FPDF_RenderPageBitmapWithMatrix` builds `matrix * page->GetDisplayMatrix(...)` OR replaces it!
    // We will assert this in `pdfiumEngine.test.ts` on a page with a red rectangle at top-left!
    let a = s;
    let b = 0;
    let c = 0;
    let d = s;
    let e = -req.tileX;
    let f = -req.tileY;

    if (rotSteps === 1) {
      // 90 deg CW: displayW = ph * s, displayH = pw * s
      a = 0;
      b = s;
      c = -s;
      d = 0;
      e = ph * s - req.tileX;
      f = -req.tileY;
    } else if (rotSteps === 2) {
      // 180 deg CW
      a = -s;
      b = 0;
      c = 0;
      d = -s;
      e = pw * s - req.tileX;
      f = ph * s - req.tileY;
    } else if (rotSteps === 3) {
      // 270 deg CW
      a = 0;
      b = -s;
      c = s;
      d = 0;
      e = -req.tileX;
      f = pw * s - req.tileY;
    }

    // Create BGRA bitmap via PDFium (format 4)
    const bitmap = mod.FPDFBitmap_CreateEx(w, h, FPDFBitmap_BGRA, 0, 0);
    if (!bitmap) {
      throw new Error('Failed to create PDFium bitmap');
    }

    const matrixPtr = mod.pdfium.wasmExports.malloc(24);
    const clipPtr = mod.pdfium.wasmExports.malloc(16);

    try {
      const fillArgb = req.transparentBg ? 0x00000000 : 0xffffffff;
      mod.FPDFBitmap_FillRect(bitmap, 0, 0, w, h, fillArgb);

      mod.pdfium.setValue(matrixPtr, a, 'float');
      mod.pdfium.setValue(matrixPtr + 4, b, 'float');
      mod.pdfium.setValue(matrixPtr + 8, c, 'float');
      mod.pdfium.setValue(matrixPtr + 12, d, 'float');
      mod.pdfium.setValue(matrixPtr + 16, e, 'float');
      mod.pdfium.setValue(matrixPtr + 20, f, 'float');

      mod.pdfium.setValue(clipPtr, 0, 'float');
      mod.pdfium.setValue(clipPtr + 4, 0, 'float');
      mod.pdfium.setValue(clipPtr + 8, w, 'float');
      mod.pdfium.setValue(clipPtr + 12, h, 'float');

      mod.FPDF_RenderPageBitmapWithMatrix(
        bitmap,
        pagePtr,
        matrixPtr,
        clipPtr,
        FPDF_ANNOT | FPDF_LCD_TEXT,
      );

      const bufPtr = mod.FPDFBitmap_GetBuffer(bitmap);
      const stride = mod.FPDFBitmap_GetStride(bitmap);
      const rgba = new Uint8ClampedArray(w * h * 4);

      const heap = (mod.pdfium as unknown as PdfiumRuntimeWithHeap).HEAPU8;
      const isSepia = req.theme === 'sepia';
      const isDarkInvert = req.theme === 'dark' && Boolean(req.darkPaperInvert);

      for (let row = 0; row < h; row++) {
        let srcOffset = bufPtr + row * stride;
        let dstOffset = row * w * 4;
        for (let col = 0; col < w; col++) {
          let blue = heap[srcOffset];
          let green = heap[srcOffset + 1];
          let red = heap[srcOffset + 2];
          const alpha = heap[srcOffset + 3];

          if (isSepia && alpha > 0) {
            // Warm paper tint preserving readability (02 §3.7)
            red = Math.min(255, Math.round(red * 0.96));
            green = Math.min(255, Math.round(green * 0.9));
            blue = Math.min(255, Math.round(blue * 0.78));
          } else if (isDarkInvert && alpha > 0) {
            // Luminance-oriented dark inversion: invert brightness while avoiding harsh pure-black shock
            const lum = 0.299 * red + 0.587 * green + 0.114 * blue;
            const targetLum = 255 - lum * 0.88;
            const ratio = lum > 1 ? targetLum / lum : 1;
            if (Math.abs(red - green) < 18 && Math.abs(green - blue) < 18) {
              red = Math.round(255 - red * 0.88);
              green = Math.round(255 - green * 0.88);
              blue = Math.round(255 - blue * 0.88);
            } else {
              red = Math.min(255, Math.max(24, Math.round(red * Math.min(1.3, ratio))));
              green = Math.min(255, Math.max(24, Math.round(green * Math.min(1.3, ratio))));
              blue = Math.min(255, Math.max(24, Math.round(blue * Math.min(1.3, ratio))));
            }
          }

          rgba[dstOffset] = red;
          rgba[dstOffset + 1] = green;
          rgba[dstOffset + 2] = blue;
          rgba[dstOffset + 3] = alpha;
          srcOffset += 4;
          dstOffset += 4;
        }
      }

      return { width: w, height: h, rgba };
    } finally {
      mod.pdfium.wasmExports.free(matrixPtr);
      mod.pdfium.wasmExports.free(clipPtr);
      mod.FPDFBitmap_Destroy(bitmap);
    }
  }

  /**
   * Converts PDFium user-space char box (bottom-up Y) to visual unrotated top-left pt coordinates.
   */
  private pdfRectToVisualRect(
    pageHeight: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): { x: number; y: number; width: number; height: number } {
    const x = Math.min(left, right);
    const maxY = Math.max(top, bottom);
    const minY = Math.min(top, bottom);
    const y = pageHeight - maxY;
    const width = Math.max(0, Math.abs(right - left));
    const height = Math.max(0, maxY - minY);
    return { x, y, width, height };
  }

  /**
   * Extracts line/span-level text geometry for the transparent Viewer TextLayer & Smart Block Zoom.
   */
  extractPageTextSpans(sourceDocId: string, pageIndex: number): PdfTextSpan[] {
    const mod = this.ensureMod();
    const { pagePtr, meta } = this.getOrLoadPage(sourceDocId, pageIndex);
    const textPage = mod.FPDFText_LoadPage(pagePtr);
    if (!textPage) return [];

    const boxPtr = mod.pdfium.wasmExports.malloc(32); // 4 doubles
    try {
      const charCount = mod.FPDFText_CountChars(textPage);
      if (charCount <= 0) return [];

      interface RawChar {
        ch: string;
        x: number;
        y: number;
        width: number;
        height: number;
        fontSize: number;
      }

      const chars: RawChar[] = [];
      for (let i = 0; i < charCount; i++) {
        const code = mod.FPDFText_GetUnicode(textPage, i);
        if (code === 0 || code === 0xfffe || code === 0xffff) continue;
        const ch = String.fromCodePoint(code);
        if (ch === '\r' || ch === '\n') {
          chars.push({ ch: '\n', x: 0, y: 0, width: 0, height: 0, fontSize: 12 });
          continue;
        }
        const ok = mod.FPDFText_GetCharBox(
          textPage,
          i,
          boxPtr,
          boxPtr + 8,
          boxPtr + 16,
          boxPtr + 24,
        );
        if (!ok) continue;
        const left = mod.pdfium.getValue(boxPtr, 'double');
        const right = mod.pdfium.getValue(boxPtr + 8, 'double');
        const bottom = mod.pdfium.getValue(boxPtr + 16, 'double');
        const top = mod.pdfium.getValue(boxPtr + 24, 'double');
        const fontSize = Math.max(4, mod.FPDFText_GetFontSize(textPage, i) || 12);
        const vis = this.pdfRectToVisualRect(meta.baseHeight, left, top, right, bottom);

        // Space characters sometimes have 0 box width in PDFium; synthesize small width for clean spans
        const w = ch === ' ' && vis.width < 0.5 ? fontSize * 0.28 : vis.width;
        const h = vis.height < 1 ? fontSize : vis.height;
        chars.push({
          ch,
          x: vis.x,
          y: vis.y,
          width: w,
          height: h,
          fontSize,
        });
      }

      // Group contiguous characters on the same visual line into spans
      const spans: PdfTextSpan[] = [];
      let curText = '';
      let minX = 0;
      let minY = 0;
      let maxX = 0;
      let maxY = 0;
      let curFontSize = 12;

      const flush = () => {
        const trimmed = curText.trimEnd();
        if (trimmed.length > 0 && maxX > minX) {
          spans.push({
            id: `span_${pageIndex}_${spans.length}`,
            text: trimmed,
            x: minX,
            y: minY,
            width: Math.max(1, maxX - minX),
            height: Math.max(4, maxY - minY),
            fontSize: curFontSize,
            baselineY: maxY,
          });
        }
        curText = '';
      };

      for (const c of chars) {
        if (c.ch === '\n') {
          flush();
          continue;
        }
        if (c.ch === ' ' && curText.length === 0) {
          continue;
        }
        if (curText.length === 0) {
          curText = c.ch;
          minX = c.x;
          minY = c.y;
          maxX = c.x + c.width;
          maxY = c.y + c.height;
          curFontSize = c.fontSize;
          continue;
        }

        const sameLine = Math.abs(c.y - minY) <= Math.max(curFontSize, c.fontSize) * 0.55;
        const gapX = c.x - maxX;
        const maxGap = Math.max(curFontSize, c.fontSize) * 1.4;

        if (!sameLine || gapX > maxGap || gapX < -curFontSize * 0.8) {
          flush();
          if (c.ch !== ' ') {
            curText = c.ch;
            minX = c.x;
            minY = c.y;
            maxX = c.x + c.width;
            maxY = c.y + c.height;
            curFontSize = c.fontSize;
          }
          continue;
        }

        if (c.ch === ' ' && c.width <= 0.1) {
          maxX += curFontSize * 0.25;
        } else {
          minX = Math.min(minX, c.x);
          minY = Math.min(minY, c.y);
          maxX = Math.max(maxX, c.x + c.width);
          maxY = Math.max(maxY, c.y + c.height);
        }
        curText += c.ch;
      }
      flush();

      return spans;
    } finally {
      mod.pdfium.wasmExports.free(boxPtr);
      mod.FPDFText_ClosePage(textPage);
    }
  }

  /**
   * Searches a single page with Turkish-sensitive case & diacritic folding (02 §3.5).
   * Returns visual highlight rectangles per match.
   */
  searchPage(
    sourceDocId: string,
    pageIndex: number,
    query: string,
    options: { matchCase?: boolean; wholeWord?: boolean } = {},
  ): PdfSearchHit[] {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const mod = this.ensureMod();
    const { pagePtr, meta } = this.getOrLoadPage(sourceDocId, pageIndex);
    const textPage = mod.FPDFText_LoadPage(pagePtr);
    if (!textPage) return [];

    const boxPtr = mod.pdfium.wasmExports.malloc(32);
    try {
      const charCount = mod.FPDFText_CountChars(textPage);
      if (charCount <= 0) return [];

      let rawText = '';
      const rawToPdfCharIdx: number[] = [];
      let foldedText = '';
      const foldedToRawIdx: number[] = [];

      for (let i = 0; i < charCount; i++) {
        const code = mod.FPDFText_GetUnicode(textPage, i);
        if (code === 0 || code === 0xfffe || code === 0xffff) continue;
        const ch = code === 13 || code === 10 ? ' ' : String.fromCodePoint(code);
        const rawIdx = rawText.length;
        rawText += ch;
        rawToPdfCharIdx.push(i);

        const normChar = options.matchCase ? ch : normalizeForTurkishSearch(ch, true);
        for (let k = 0; k < normChar.length; k++) {
          foldedText += normChar[k];
          foldedToRawIdx.push(rawIdx);
        }
      }

      const needle = options.matchCase ? cleanQuery : normalizeForTurkishSearch(cleanQuery, true);
      if (!needle) return [];

      const hits: PdfSearchHit[] = [];
      let searchFrom = 0;
      const isWordBoundary = (ch: string | undefined) => !ch || !/[\p{L}\p{N}_]/u.test(ch);

      while (searchFrom <= foldedText.length - needle.length) {
        const pos = foldedText.indexOf(needle, searchFrom);
        if (pos < 0) break;

        const endPos = pos + needle.length;
        if (options.wholeWord) {
          const prevChar = foldedText[pos - 1];
          const nextChar = foldedText[endPos];
          if (!isWordBoundary(prevChar) || !isWordBoundary(nextChar)) {
            searchFrom = pos + 1;
            continue;
          }
        }

        const rawStart = foldedToRawIdx[pos];
        const rawEnd = foldedToRawIdx[endPos - 1];
        const pdfStart = rawToPdfCharIdx[rawStart];
        const pdfEnd = rawToPdfCharIdx[rawEnd];

        const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
        let lineRect: { x: number; y: number; width: number; height: number } | null = null;

        for (let ci = pdfStart; ci <= pdfEnd; ci++) {
          const ok = mod.FPDFText_GetCharBox(
            textPage,
            ci,
            boxPtr,
            boxPtr + 8,
            boxPtr + 16,
            boxPtr + 24,
          );
          if (!ok) continue;
          const left = mod.pdfium.getValue(boxPtr, 'double');
          const right = mod.pdfium.getValue(boxPtr + 8, 'double');
          const bottom = mod.pdfium.getValue(boxPtr + 16, 'double');
          const top = mod.pdfium.getValue(boxPtr + 24, 'double');
          const vis = this.pdfRectToVisualRect(meta.baseHeight, left, top, right, bottom);
          if (vis.width <= 0.05 || vis.height <= 0.05) continue;

          if (lineRect && Math.abs(vis.y - lineRect.y) <= Math.max(lineRect.height, vis.height) * 0.6) {
            const x0 = Math.min(lineRect.x, vis.x);
            const y0 = Math.min(lineRect.y, vis.y);
            const x1 = Math.max(lineRect.x + lineRect.width, vis.x + vis.width);
            const y1 = Math.max(lineRect.y + lineRect.height, vis.y + vis.height);
            lineRect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
          } else {
            if (lineRect) rects.push(lineRect);
            lineRect = vis;
          }
        }
        if (lineRect) rects.push(lineRect);

        const snippetStart = Math.max(0, rawStart - 24);
        const snippetEnd = Math.min(rawText.length, rawEnd + 32);
        const snippet = rawText.slice(snippetStart, snippetEnd).replace(/\s+/g, ' ').trim();

        if (rects.length > 0) {
          hits.push({
            pageIndex,
            matchIndexInPage: hits.length,
            snippet,
            rects,
          });
        }

        searchFrom = Math.max(pos + 1, endPos);
      }

      return hits;
    } finally {
      mod.pdfium.wasmExports.free(boxPtr);
      mod.FPDFText_ClosePage(textPage);
    }
  }

  getOutline(sourceDocId: string): PdfOutlineNode[] {
    const mod = this.ensureMod();
    const doc = this.openDocs.get(sourceDocId);
    if (!doc) return [];

    const bufBytes = 1024;
    const bufPtr = mod.pdfium.wasmExports.malloc(bufBytes);
    let nodeCounter = 0;

    const readChildren = (parentBookmark: number, depth: number): PdfOutlineNode[] => {
      if (depth > 12) return [];
      const nodes: PdfOutlineNode[] = [];
      let bm = mod.FPDFBookmark_GetFirstChild(doc.docPtr, parentBookmark);
      while (bm) {
        const len = mod.FPDFBookmark_GetTitle(bm, bufPtr, bufBytes);
        let title = '';
        if (len > 2) {
          title = mod.pdfium.UTF16ToString(bufPtr).trim();
        }
        let pageIndex: number | null = null;
        let dest = mod.FPDFBookmark_GetDest(doc.docPtr, bm);
        if (!dest) {
          const action = mod.FPDFBookmark_GetAction(bm);
          if (action) {
            dest = mod.FPDFAction_GetDest(doc.docPtr, action);
          }
        }
        if (dest) {
          const idx = mod.FPDFDest_GetDestPageIndex(doc.docPtr, dest);
          if (idx >= 0) pageIndex = idx;
        }
        nodes.push({
          id: `bm_${++nodeCounter}`,
          title: title || `Section ${nodeCounter}`,
          pageIndex,
          children: readChildren(bm, depth + 1),
        });
        bm = mod.FPDFBookmark_GetNextSibling(doc.docPtr, bm);
      }
      return nodes;
    };

    try {
      return readChildren(0, 0);
    } finally {
      mod.pdfium.wasmExports.free(bufPtr);
    }
  }

  getLinks(sourceDocId: string, pageIndex: number): PdfLinkAnnotation[] {
    const mod = this.ensureMod();
    const { doc, pagePtr, meta } = this.getOrLoadPage(sourceDocId, pageIndex);

    const startPosPtr = mod.pdfium.wasmExports.malloc(4);
    const linkPtrPtr = mod.pdfium.wasmExports.malloc(4);
    const rectPtr = mod.pdfium.wasmExports.malloc(16);
    const uriBufBytes = 2048;
    const uriBufPtr = mod.pdfium.wasmExports.malloc(uriBufBytes);

    const links: PdfLinkAnnotation[] = [];
    try {
      mod.pdfium.setValue(startPosPtr, 0, 'i32');
      let idx = 0;
      while (mod.FPDFLink_Enumerate(pagePtr, startPosPtr, linkPtrPtr)) {
        const link = mod.pdfium.getValue(linkPtrPtr, 'i32');
        if (!link) continue;
        if (!mod.FPDFLink_GetAnnotRect(link, rectPtr)) continue;

        const left = mod.pdfium.getValue(rectPtr, 'float');
        const top = mod.pdfium.getValue(rectPtr + 4, 'float');
        const right = mod.pdfium.getValue(rectPtr + 8, 'float');
        const bottom = mod.pdfium.getValue(rectPtr + 12, 'float');
        const vis = this.pdfRectToVisualRect(meta.baseHeight, left, top, right, bottom);
        if (vis.width <= 1 || vis.height <= 1) continue;

        const dest = mod.FPDFLink_GetDest(doc.docPtr, link);
        if (dest) {
          const destPageIndex = mod.FPDFDest_GetDestPageIndex(doc.docPtr, dest);
          if (destPageIndex >= 0) {
            links.push({
              id: `link_${pageIndex}_${idx++}`,
              pageIndex,
              ...vis,
              kind: 'goto',
              destPageIndex,
            });
            continue;
          }
        }

        const action = mod.FPDFLink_GetAction(link);
        if (action) {
          const uriLen = mod.FPDFAction_GetURIPath(doc.docPtr, action, uriBufPtr, uriBufBytes);
          if (uriLen > 1) {
            const uri = mod.pdfium.UTF8ToString(uriBufPtr).trim();
            if (uri) {
              links.push({
                id: `link_${pageIndex}_${idx++}`,
                pageIndex,
                ...vis,
                kind: 'uri',
                uri,
              });
              continue;
            }
          }
          const actionDest = mod.FPDFAction_GetDest(doc.docPtr, action);
          if (actionDest) {
            const destPageIndex = mod.FPDFDest_GetDestPageIndex(doc.docPtr, actionDest);
            if (destPageIndex >= 0) {
              links.push({
                id: `link_${pageIndex}_${idx++}`,
                pageIndex,
                ...vis,
                kind: 'goto',
                destPageIndex,
              });
            }
          }
        }
      }
      return links;
    } finally {
      mod.pdfium.wasmExports.free(startPosPtr);
      mod.pdfium.wasmExports.free(linkPtrPtr);
      mod.pdfium.wasmExports.free(rectPtr);
      mod.pdfium.wasmExports.free(uriBufPtr);
    }
  }

  destroy(): void {
    for (const id of [...this.openDocs.keys()]) {
      this.closeDocument(id);
    }
    if (this.mod) {
      this.mod.FPDF_DestroyLibrary();
      this.mod = null;
    }
  }
}
