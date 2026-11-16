import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSharedPdfium, type PdfiumRuntimeModule } from '../pdfiumLoader';
import { rgbaToPngBytes } from '@/utils/pngCodec';
import { patchTtfFontForTest } from '../../../../e2e/helpers/pdfiumTestHelper';

export { getSharedPdfium, patchTtfFontForTest };

function savePdfiumDoc(mod: PdfiumRuntimeModule, docPtr: number): Uint8Array {
  const writer = mod.PDFiumExt_OpenFileWriter();
  if (!writer) throw new Error('Failed to open PDFium file writer in test helper.');
  try {
    if (!mod.PDFiumExt_SaveAsCopy(docPtr, writer)) {
      throw new Error('PDFiumext_SaveAsCopy failed in test helper.');
    }
    const size = mod.PDFiumExt_GetFileWriterSize(writer);
    if (size <= 0) return new Uint8Array(0);
    const outPtr = mod.pdfium.wasmExports.malloc(size);
    try {
      mod.PDFiumExt_GetFileWriterData(writer, outPtr, size);
      const bytes = new Uint8Array(size);
      bytes.set(mod.pdfium.HEAPU8.subarray(outPtr, outPtr + size));
      return bytes;
    } finally {
      mod.pdfium.wasmExports.free(outPtr);
    }
  } finally {
    mod.PDFiumExt_CloseFileWriter(writer);
  }
}

export async function withPdfiumDocument<T>(
  pdfBytes: Uint8Array,
  password: string,
  fn: (mod: PdfiumRuntimeModule, docPtr: number) => Promise<T> | T,
): Promise<T> {
  const mod = await getSharedPdfium();
  const dataPtr = mod.pdfium.wasmExports.malloc(pdfBytes.byteLength);
  if (!dataPtr) throw new Error('Out of Wasm memory allocating PDF test buffer.');
  mod.pdfium.HEAPU8.set(pdfBytes, dataPtr);
  const docPtr = mod.FPDF_LoadMemDocument(dataPtr, pdfBytes.byteLength, password);
  if (!docPtr) {
    mod.pdfium.wasmExports.free(dataPtr);
    throw new Error(`Failed loading test PDF document (error ${mod.FPDF_GetLastError()}).`);
  }
  try {
    return await fn(mod, docPtr);
  } finally {
    mod.FPDF_CloseDocument(docPtr);
    mod.pdfium.wasmExports.free(dataPtr);
  }
}

export async function getPdfPageCountWithPdfium(
  pdfBytes: Uint8Array,
  password = '',
): Promise<number> {
  return withPdfiumDocument(pdfBytes, password, (mod, docPtr) => mod.FPDF_GetPageCount(docPtr));
}

export async function getPdfPageSizesWithPdfium(
  pdfBytes: Uint8Array,
  password = '',
): Promise<Array<{ width: number; height: number; rotationDeg: number }>> {
  return withPdfiumDocument(pdfBytes, password, (mod, docPtr) => {
    const count = mod.FPDF_GetPageCount(docPtr);
    const pages: Array<{ width: number; height: number; rotationDeg: number }> = [];
    for (let i = 0; i < count; i++) {
      const pagePtr = mod.FPDF_LoadPage(docPtr, i);
      if (!pagePtr) continue;
      try {
        pages.push({
          width: mod.FPDF_GetPageWidthF(pagePtr),
          height: mod.FPDF_GetPageHeightF(pagePtr),
          rotationDeg: (mod.EPDF_GetPageRotationByIndex(docPtr, i) % 4) * 90,
        });
      } finally {
        mod.FPDF_ClosePage(pagePtr);
      }
    }
    return pages;
  });
}

export async function extractPdfTextWithPdfium(
  pdfBytes: Uint8Array,
  pageIndex = 0,
  password = '',
): Promise<string> {
  return withPdfiumDocument(pdfBytes, password, (mod, docPtr) => {
    const pagePtr = mod.FPDF_LoadPage(docPtr, pageIndex);
    if (!pagePtr) throw new Error(`Page ${pageIndex} not found in test PDF.`);
    try {
      const textPagePtr = mod.FPDFText_LoadPage(pagePtr);
      if (!textPagePtr) return '';
      try {
        const count = mod.FPDFText_CountChars(textPagePtr);
        let out = '';
        for (let i = 0; i < count; i++) {
          const code = mod.FPDFText_GetUnicode(textPagePtr, i);
          if (code > 0) {
            out += String.fromCodePoint(code);
          }
        }
        return out;
      } finally {
        mod.FPDFText_ClosePage(textPagePtr);
      }
    } finally {
      mod.FPDF_ClosePage(pagePtr);
    }
  });
}

export async function getPdfPageImageBoxesWithPdfium(
  pdfBytes: Uint8Array,
  pageIndex = 0,
  password = '',
): Promise<Array<[number, number, number, number]>> {
  return withPdfiumDocument(pdfBytes, password, (mod, docPtr) => {
    const pagePtr = mod.FPDF_LoadPage(docPtr, pageIndex);
    if (!pagePtr) return [];
    const boxPtr = mod.pdfium.wasmExports.malloc(16);
    const out: Array<[number, number, number, number]> = [];
    try {
      const pageH = mod.FPDF_GetPageHeightF(pagePtr) || 792;
      const count = mod.FPDFPage_CountObjects(pagePtr);
      for (let i = 0; i < count; i++) {
        const obj = mod.FPDFPage_GetObject(pagePtr, i);
        if (!obj || mod.FPDFPageObj_GetType(obj) !== 3) continue;
        if (mod.FPDFPageObj_GetBounds(obj, boxPtr, boxPtr + 4, boxPtr + 8, boxPtr + 12)) {
          const l = mod.pdfium.getValue(boxPtr, 'float');
          const b = mod.pdfium.getValue(boxPtr + 4, 'float');
          const r = mod.pdfium.getValue(boxPtr + 8, 'float');
          const t = mod.pdfium.getValue(boxPtr + 12, 'float');
          out.push([Math.min(l, r), pageH - Math.max(b, t), Math.max(l, r), pageH - Math.min(b, t)]);
        }
      }
      return out;
    } finally {
      mod.pdfium.wasmExports.free(boxPtr);
      mod.FPDF_ClosePage(pagePtr);
    }
  });
}

export async function extractPdfCharsWithPdfium(
  pdfBytes: Uint8Array,
  pageIndex = 0,
  password = '',
): Promise<Array<{ ch: string; originY: number; x0: number; x1: number; size: number }>> {
  return withPdfiumDocument(pdfBytes, password, (mod, docPtr) => {
    const pagePtr = mod.FPDF_LoadPage(docPtr, pageIndex);
    if (!pagePtr) return [];
    const boxPtr = mod.pdfium.wasmExports.malloc(32);
    const out: Array<{ ch: string; originY: number; x0: number; x1: number; size: number }> = [];
    try {
      const pageH = mod.FPDF_GetPageHeightF(pagePtr) || 792;
      const textPtr = mod.FPDFText_LoadPage(pagePtr);
      if (!textPtr) return [];
      try {
        const count = mod.FPDFText_CountChars(textPtr);
        for (let i = 0; i < count; i++) {
          const code = mod.FPDFText_GetUnicode(textPtr, i);
          if (!code) continue;
          const ch = String.fromCodePoint(code);
          if (!mod.FPDFText_GetCharBox(textPtr, i, boxPtr, boxPtr + 8, boxPtr + 16, boxPtr + 24)) {
            continue;
          }
          const l = mod.pdfium.getValue(boxPtr, 'double');
          const r = mod.pdfium.getValue(boxPtr + 8, 'double');
          const b = mod.pdfium.getValue(boxPtr + 16, 'double');
          const size = mod.FPDFText_GetFontSize(textPtr, i);
          out.push({
            ch,
            originY: pageH - b,
            x0: Math.min(l, r),
            x1: Math.max(l, r),
            size,
          });
        }
      } finally {
        mod.FPDFText_ClosePage(textPtr);
      }
      return out;
    } finally {
      mod.pdfium.wasmExports.free(boxPtr);
      mod.FPDF_ClosePage(pagePtr);
    }
  });
}

export async function renderPdfPageRgbaWithPdfium(
  pdfBytes: Uint8Array,
  pageIndex = 0,
  scale = 1,
  password = '',
): Promise<{ width: number; height: number; data: Uint8Array }> {
  return withPdfiumDocument(pdfBytes, password, (mod, docPtr) => {
    const pagePtr = mod.FPDF_LoadPage(docPtr, pageIndex);
    if (!pagePtr) throw new Error(`Page ${pageIndex} not found in test PDF.`);
    try {
      const w = Math.max(1, Math.round(mod.FPDF_GetPageWidthF(pagePtr) * scale));
      const h = Math.max(1, Math.round(mod.FPDF_GetPageHeightF(pagePtr) * scale));
      const bmpPtr = mod.FPDFBitmap_Create(w, h, 0);
      if (!bmpPtr) throw new Error('FPDFBitmap_Create failed.');
      try {
        mod.FPDFBitmap_FillRect(bmpPtr, 0, 0, w, h, 0xffffffff);
        mod.FPDF_RenderPageBitmap(bmpPtr, pagePtr, 0, 0, w, h, 0, 0x10);
        const stride = mod.FPDFBitmap_GetStride(bmpPtr);
        const bufPtr = mod.FPDFBitmap_GetBuffer(bmpPtr);
        const heap = mod.pdfium.HEAPU8;
        const rgba = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) {
          const srcRow = bufPtr + y * stride;
          const dstRow = y * w * 4;
          for (let x = 0; x < w; x++) {
            const s = srcRow + x * 4;
            const d = dstRow + x * 4;
            // Flag 0x10 (FPDF_REVERSE_BYTE_ORDER) outputs native RGBA byte order
            rgba[d] = heap[s];
            rgba[d + 1] = heap[s + 1];
            rgba[d + 2] = heap[s + 2];
            rgba[d + 3] = heap[s + 3];
          }
        }
        return { width: w, height: h, data: rgba };
      } finally {
        mod.FPDFBitmap_Destroy(bmpPtr);
      }
    } finally {
      mod.FPDF_ClosePage(pagePtr);
    }
  });
}

export interface TestPdfPageSpec {
  width?: number;
  height?: number;
  rotation?: 0 | 90 | 180 | 270;
  texts?: Array<{
    text: string;
    x: number;
    yPdf?: number;
    yVisual?: number;
    fontSize?: number;
    color?: [number, number, number];
    ttfFontBytes?: Uint8Array;
    fontKey?: string;
  }>;
  images?: Array<{
    pngBytes: Uint8Array;
    x: number;
    yPdf: number;
    width: number;
    height: number;
  }>;
  rects?: Array<{
    x: number;
    yPdf: number;
    width: number;
    height: number;
    fill?: [number, number, number];
    stroke?: [number, number, number];
    strokeWidth?: number;
  }>;
  lines?: Array<{
    x1: number;
    y1Pdf: number;
    x2: number;
    y2Pdf: number;
    stroke?: [number, number, number];
    strokeWidth?: number;
  }>;
}

export async function buildTestPdfWithPdfium(
  pages: TestPdfPageSpec[],
  options?: {
    userPassword?: string;
    ownerPassword?: string;
    customFonts?: Record<string, Uint8Array>;
  },
): Promise<Uint8Array> {
  const mod = await getSharedPdfium();
  const docPtr = mod.FPDF_CreateNewDocument();
  if (!docPtr) throw new Error('FPDF_CreateNewDocument failed.');

  const stdFontPtr = mod.FPDFText_LoadStandardFont(docPtr, 'Helvetica');
  const loadedTtfFonts = new Map<string, number>();
  const matrixPtr = mod.pdfium.wasmExports.malloc(24);
  if (!matrixPtr) {
    if (stdFontPtr) mod.FPDFFont_Close(stdFontPtr);
    mod.FPDF_CloseDocument(docPtr);
    throw new Error('Out of memory allocating test matrix.');
  }

  const getOrLoadFont = (bytes?: Uint8Array, fontKey?: string): number => {
    const resolvedBytes = (fontKey && options?.customFonts?.[fontKey]) || bytes;
    if (!resolvedBytes) return stdFontPtr;
    const cacheKey = fontKey ?? `len:${resolvedBytes.byteLength}:${resolvedBytes[0]}:${resolvedBytes[resolvedBytes.byteLength - 1]}`;
    const existing = loadedTtfFonts.get(cacheKey);
    if (existing) return existing;
    const fPtr = mod.pdfium.wasmExports.malloc(resolvedBytes.byteLength);
    mod.pdfium.HEAPU8.set(resolvedBytes, fPtr);
    const loaded = mod.FPDFText_LoadFont(docPtr, fPtr, resolvedBytes.byteLength, 2, true);
    mod.pdfium.wasmExports.free(fPtr);
    if (loaded) {
      loadedTtfFonts.set(cacheKey, loaded);
      return loaded;
    }
    return stdFontPtr;
  };

  try {
    for (let pi = 0; pi < pages.length; pi++) {
      const spec = pages[pi];
      const w = spec.width ?? 595;
      const h = spec.height ?? 842;
      const pagePtr = mod.FPDFPage_New(docPtr, pi, w, h);
      if (!pagePtr) throw new Error(`FPDFPage_New failed at index ${pi}`);

      try {
        for (const r of spec.rects ?? []) {
          const path = mod.FPDFPageObj_CreateNewPath(r.x, r.yPdf);
          mod.FPDFPath_LineTo(path, r.x + r.width, r.yPdf);
          mod.FPDFPath_LineTo(path, r.x + r.width, r.yPdf + r.height);
          mod.FPDFPath_LineTo(path, r.x, r.yPdf + r.height);
          mod.FPDFPath_Close(path);
          mod.FPDFPath_SetDrawMode(path, r.fill ? 2 : 0, Boolean(r.stroke));
          if (r.fill) mod.FPDFPageObj_SetFillColor(path, r.fill[0], r.fill[1], r.fill[2], 255);
          if (r.stroke) {
            mod.FPDFPageObj_SetStrokeColor(path, r.stroke[0], r.stroke[1], r.stroke[2], 255);
            mod.FPDFPageObj_SetStrokeWidth(path, r.strokeWidth ?? 1);
          }
          mod.FPDFPage_InsertObject(pagePtr, path);
        }

        for (const ln of spec.lines ?? []) {
          const path = mod.FPDFPageObj_CreateNewPath(ln.x1, ln.y1Pdf);
          mod.FPDFPath_LineTo(path, ln.x2, ln.y2Pdf);
          mod.FPDFPath_SetDrawMode(path, 0, true);
          const sc = ln.stroke ?? [0, 0, 0];
          mod.FPDFPageObj_SetStrokeColor(path, sc[0], sc[1], sc[2], 255);
          mod.FPDFPageObj_SetStrokeWidth(path, ln.strokeWidth ?? 1);
          mod.FPDFPage_InsertObject(pagePtr, path);
        }

        for (const im of spec.images ?? []) {
          const imgObj = mod.FPDFPageObj_NewImageObj(docPtr);
          const ptr = mod.pdfium.wasmExports.malloc(im.pngBytes.byteLength);
          mod.pdfium.HEAPU8.set(im.pngBytes, ptr);
          mod.EPDFImageObj_SetPng(0, 0, imgObj, ptr, im.pngBytes.byteLength);
          mod.pdfium.wasmExports.free(ptr);
          mod.FPDFImageObj_SetMatrix(imgObj, im.width, 0, 0, im.height, im.x, im.yPdf);
          mod.FPDFPage_InsertObject(pagePtr, imgObj);
        }

        for (const t of spec.texts ?? []) {
          const fontPtr = getOrLoadFont(t.ttfFontBytes, t.fontKey);
          const fontSize = t.fontSize ?? 12;
          const objPtr = mod.FPDFPageObj_CreateTextObj(docPtr, fontPtr, fontSize);
          const byteLen = (t.text.length + 1) * 2;
          const tPtr = mod.pdfium.wasmExports.malloc(byteLen);
          mod.pdfium.stringToUTF16(t.text, tPtr, byteLen);
          mod.FPDFText_SetText(objPtr, tPtr);
          mod.pdfium.wasmExports.free(tPtr);

          const rgb = t.color ?? [0, 0, 0];
          mod.FPDFPageObj_SetFillColor(objPtr, rgb[0], rgb[1], rgb[2], 255);

          const pdfY = t.yPdf ?? (t.yVisual !== undefined ? h - t.yVisual - fontSize : h - 72);
          mod.pdfium.setValue(matrixPtr, 1, 'float');
          mod.pdfium.setValue(matrixPtr + 4, 0, 'float');
          mod.pdfium.setValue(matrixPtr + 8, 0, 'float');
          mod.pdfium.setValue(matrixPtr + 12, 1, 'float');
          mod.pdfium.setValue(matrixPtr + 16, t.x, 'float');
          mod.pdfium.setValue(matrixPtr + 20, pdfY, 'float');
          mod.FPDFPageObj_SetMatrix(objPtr, matrixPtr);
          mod.FPDFPage_InsertObject(pagePtr, objPtr);
        }

        if (spec.rotation) {
          mod.FPDFPage_SetRotation(pagePtr, Math.round(spec.rotation / 90) % 4);
        }
        mod.FPDFPage_GenerateContent(pagePtr);
      } finally {
        mod.FPDF_ClosePage(pagePtr);
      }
    }

    if (options?.userPassword || options?.ownerPassword) {
      mod.EPDF_SetEncryption(
        docPtr,
        options.userPassword ?? '',
        options.ownerPassword ?? options.userPassword ?? '',
        -1,
      );
    }

    return savePdfiumDoc(mod, docPtr);
  } finally {
    mod.pdfium.wasmExports.free(matrixPtr);
    for (const fp of loadedTtfFonts.values()) mod.FPDFFont_Close(fp);
    if (stdFontPtr) mod.FPDFFont_Close(stdFontPtr);
    mod.FPDF_CloseDocument(docPtr);
  }
}

export async function measureTtfTextWidthWithPdfium(
  ttfBytes: Uint8Array,
  text: string,
  fontSize: number,
): Promise<number> {
  const mod = await getSharedPdfium();
  const docPtr = mod.FPDF_CreateNewDocument();
  const ptr = mod.pdfium.wasmExports.malloc(ttfBytes.byteLength);
  mod.pdfium.HEAPU8.set(ttfBytes, ptr);
  const fPtr = mod.FPDFText_LoadFont(docPtr, ptr, ttfBytes.byteLength, 2, true);
  mod.pdfium.wasmExports.free(ptr);
  const wPtr = mod.pdfium.wasmExports.malloc(4);
  try {
    let sum = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      const ok = fPtr ? mod.FPDFFont_GetGlyphWidth(fPtr, cp, fontSize, wPtr) : false;
      sum += ok ? Number(mod.pdfium.getValue(wPtr, 'float') || 0) : fontSize * 0.5;
    }
    return sum;
  } finally {
    mod.pdfium.wasmExports.free(wPtr);
    if (fPtr) mod.FPDFFont_Close(fPtr);
    mod.FPDF_CloseDocument(docPtr);
  }
}

export function createSolidPngBytes(
  width: number,
  height: number,
  rgbaTuple: [number, number, number, number],
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = rgbaTuple[0];
    rgba[i + 1] = rgbaTuple[1];
    rgba[i + 2] = rgbaTuple[2];
    rgba[i + 3] = rgbaTuple[3];
  }
  return rgbaToPngBytes(rgba, width, height);
}

export function readDejaVuSansBytes(): Uint8Array {
  return new Uint8Array(
    readFileSync(resolve(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf')),
  );
}
