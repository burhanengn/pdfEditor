import fs from 'node:fs';
import path from 'node:path';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { rgbaToPngBytes } from '../../src/utils/pngCodec';

type PdfiumMod = WrappedPdfiumModule & {
  pdfium: WrappedPdfiumModule['pdfium'] & { HEAPU8: Uint8Array };
};

let cachedPdfium: Promise<PdfiumMod> | null = null;

export async function getE2ePdfium(): Promise<PdfiumMod> {
  if (!cachedPdfium) {
    cachedPdfium = (async () => {
      const wasmPath = path.resolve(
        process.cwd(),
        'node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
      );
      const wasmBinary = fs.readFileSync(wasmPath);
      const mod = await init({ wasmBinary });
      mod.PDFiumExt_Init();
      return mod as PdfiumMod;
    })();
  }
  return cachedPdfium;
}

function lookupGlyphIdInTtfCmap(ttf: Uint8Array, codePoint: number): number {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const numTables = dv.getUint16(4, false);
  let cmapOff = 0;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(ttf[rec], ttf[rec + 1], ttf[rec + 2], ttf[rec + 3]);
    if (tag === 'cmap') {
      cmapOff = dv.getUint32(rec + 8, false);
      break;
    }
  }
  if (!cmapOff) return 0;

  const numSub = dv.getUint16(cmapOff + 2, false);
  let f4Off = 0;
  for (let i = 0; i < numSub; i++) {
    const sr = cmapOff + 4 + i * 8;
    const plat = dv.getUint16(sr, false);
    const enc = dv.getUint16(sr + 2, false);
    const subOff = cmapOff + dv.getUint32(sr + 4, false);
    if (dv.getUint16(subOff, false) === 4 && (plat === 3 || plat === 0)) {
      f4Off = subOff;
      if (plat === 3 && enc === 1) break;
    }
  }
  if (!f4Off) return 0;

  const segCount = dv.getUint16(f4Off + 6, false) / 2;
  const endCodeBase = f4Off + 14;
  const startCodeBase = endCodeBase + segCount * 2 + 2;
  const idDeltaBase = startCodeBase + segCount * 2;
  const idRangeBase = idDeltaBase + segCount * 2;

  for (let i = 0; i < segCount; i++) {
    const endCode = dv.getUint16(endCodeBase + i * 2, false);
    if (codePoint > endCode) continue;
    const startCode = dv.getUint16(startCodeBase + i * 2, false);
    if (codePoint < startCode) return 0;
    const idDelta = dv.getInt16(idDeltaBase + i * 2, false);
    const rangeOff = dv.getUint16(idRangeBase + i * 2, false);
    if (rangeOff === 0) {
      return (codePoint + idDelta) & 0xffff;
    }
    const gidAddr = idRangeBase + i * 2 + rangeOff + (codePoint - startCode) * 2;
    const gid = dv.getUint16(gidAddr, false);
    return gid === 0 ? 0 : (gid + idDelta) & 0xffff;
  }
  return 0;
}

function buildSfntNameTable(family: string, psName: string): Uint8Array {
  const encodeUtf16Be = (s: string) => {
    const out = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      out[i * 2] = (code >> 8) & 0xff;
      out[i * 2 + 1] = code & 0xff;
    }
    return out;
  };
  const lower = psName.toLowerCase();
  const isBold = lower.includes('bold');
  const isItalic = lower.includes('italic') || lower.includes('oblique');
  const subfamily =
    isBold && isItalic ? 'Bold Italic' : isBold ? 'Bold' : isItalic ? 'Italic' : 'Regular';
  const entries: Array<[number, Uint8Array]> = [
    [1, encodeUtf16Be(family)],
    [2, encodeUtf16Be(subfamily)],
    [4, encodeUtf16Be(psName)],
    [6, encodeUtf16Be(psName)],
  ];
  const headerSize = 6 + entries.length * 12;
  const strLen = entries.reduce((sum, e) => sum + e[1].length, 0);
  const out = new Uint8Array(headerSize + strLen);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0, false);
  dv.setUint16(2, entries.length, false);
  dv.setUint16(4, headerSize, false);
  let curStr = 0;
  entries.forEach(([nameId, bytes], idx) => {
    const r = 6 + idx * 12;
    dv.setUint16(r, 3, false);
    dv.setUint16(r + 2, 1, false);
    dv.setUint16(r + 4, 0x0409, false);
    dv.setUint16(r + 6, nameId, false);
    dv.setUint16(r + 8, bytes.length, false);
    dv.setUint16(r + 10, curStr, false);
    out.set(bytes, headerSize + curStr);
    curStr += bytes.length;
  });
  return out;
}

function buildSfntSubsetCmap(ttf: Uint8Array, subsetChars: string): Uint8Array {
  const codeSet = new Set<number>();
  for (const ch of subsetChars) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp < 0xffff) codeSet.add(cp);
  }
  const codes = [...codeSet].sort((a, b) => a - b);
  const segs: Array<{ code: number; gid: number }> = [];
  for (const code of codes) {
    const gid = lookupGlyphIdInTtfCmap(ttf, code);
    if (gid > 0) segs.push({ code, gid });
  }
  segs.push({ code: 0xffff, gid: 1 });

  const segCount = segs.length;
  const f4Len = 16 + segCount * 8;
  const out = new Uint8Array(12 + f4Len);
  const dv = new DataView(out.buffer);

  dv.setUint16(0, 0, false);
  dv.setUint16(2, 1, false);
  dv.setUint16(4, 3, false);
  dv.setUint16(6, 1, false);
  dv.setUint32(8, 12, false);

  const f4 = 12;
  let maxPow2 = 1;
  let entrySel = 0;
  while (maxPow2 * 2 <= segCount) {
    maxPow2 *= 2;
    entrySel += 1;
  }
  const searchRange = maxPow2 * 2;
  dv.setUint16(f4, 4, false);
  dv.setUint16(f4 + 2, f4Len, false);
  dv.setUint16(f4 + 4, 0, false);
  dv.setUint16(f4 + 6, segCount * 2, false);
  dv.setUint16(f4 + 8, searchRange, false);
  dv.setUint16(f4 + 10, entrySel, false);
  dv.setUint16(f4 + 12, segCount * 2 - searchRange, false);

  const endBase = f4 + 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;

  for (let i = 0; i < segCount; i++) {
    const s = segs[i];
    dv.setUint16(endBase + i * 2, s.code, false);
    dv.setUint16(startBase + i * 2, s.code, false);
    const delta = s.code === 0xffff ? 1 : (s.gid - s.code) & 0xffff;
    dv.setUint16(deltaBase + i * 2, delta, false);
  }
  return out;
}

/**
 * Rewrites `name` and optionally subsets `cmap` tables of a TrueType font buffer so PDFium
 * embeds a custom PostScript font name or partial-glyph subset cleanly in fixtures.
 */
export function patchTtfFontForTest(
  ttfBytes: Uint8Array,
  options: { postscriptName?: string; subsetChars?: string },
): Uint8Array {
  const dv = new DataView(ttfBytes.buffer, ttfBytes.byteOffset, ttfBytes.byteLength);
  const sfntVer = dv.getUint32(0, false);
  const numTables = dv.getUint16(4, false);

  const tables: Array<{ tag: string; data: Uint8Array }> = [];
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(
      ttfBytes[rec],
      ttfBytes[rec + 1],
      ttfBytes[rec + 2],
      ttfBytes[rec + 3],
    );
    const off = dv.getUint32(rec + 8, false);
    const len = dv.getUint32(rec + 12, false);
    let data: Uint8Array = ttfBytes.slice(off, off + len);
    if (tag === 'name' && options.postscriptName) {
      const fam = options.postscriptName.replace(/-(Bold|Italic|Regular).*$/i, '');
      data = buildSfntNameTable(fam, options.postscriptName);
    } else if (tag === 'cmap' && options.subsetChars) {
      data = buildSfntSubsetCmap(ttfBytes, options.subsetChars);
    }
    tables.push({ tag, data });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const dirSize = 12 + tables.length * 16;
  const totalBody = tables.reduce((s, t) => s + ((t.data.length + 3) & ~3), 0);
  const out = new Uint8Array(dirSize + totalBody);
  const outDv = new DataView(out.buffer);

  let maxPow2 = 1;
  let entrySel = 0;
  while (maxPow2 * 2 <= tables.length) {
    maxPow2 *= 2;
    entrySel += 1;
  }
  outDv.setUint32(0, sfntVer, false);
  outDv.setUint16(4, tables.length, false);
  outDv.setUint16(6, maxPow2 * 16, false);
  outDv.setUint16(8, entrySel, false);
  outDv.setUint16(10, tables.length * 16 - maxPow2 * 16, false);

  const calcChecksum = (bytes: Uint8Array) => {
    let sum = 0;
    const paddedLen = (bytes.length + 3) & ~3;
    for (let i = 0; i < paddedLen; i += 4) {
      const val =
        ((bytes[i] ?? 0) << 24) |
        ((bytes[i + 1] ?? 0) << 16) |
        ((bytes[i + 2] ?? 0) << 8) |
        (bytes[i + 3] ?? 0);
      sum = (sum + (val >>> 0)) >>> 0;
    }
    return sum;
  };

  let curOff = dirSize;
  tables.forEach((t, idx) => {
    const rec = 12 + idx * 16;
    for (let j = 0; j < 4; j++) out[rec + j] = t.tag.charCodeAt(j);
    out.set(t.data, curOff);
    outDv.setUint32(rec + 4, calcChecksum(t.data), false);
    outDv.setUint32(rec + 8, curOff, false);
    outDv.setUint32(rec + 12, t.data.length, false);
    curOff += (t.data.length + 3) & ~3;
  });
  return out;
}

function saveDoc(mod: PdfiumMod, docPtr: number): Uint8Array {
  const writer = mod.PDFiumExt_OpenFileWriter();
  if (!writer) throw new Error('PDFiumExt_OpenFileWriter failed');
  try {
    if (!mod.PDFiumExt_SaveAsCopy(docPtr, writer)) {
      throw new Error('PDFiumExt_SaveAsCopy failed');
    }
    const size = mod.PDFiumExt_GetFileWriterSize(writer);
    if (size <= 0) return new Uint8Array(0);
    const outPtr = mod.pdfium.wasmExports.malloc(size);
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

export async function withE2ePdf<T>(
  pdfBytes: Uint8Array,
  fn: (mod: PdfiumMod, docPtr: number) => Promise<T> | T,
  password = '',
): Promise<T> {
  const mod = await getE2ePdfium();
  const ptr = mod.pdfium.wasmExports.malloc(pdfBytes.byteLength);
  mod.pdfium.HEAPU8.set(pdfBytes, ptr);
  const docPtr = mod.FPDF_LoadMemDocument(ptr, pdfBytes.byteLength, password);
  if (!docPtr) {
    mod.pdfium.wasmExports.free(ptr);
    throw new Error(`Failed loading E2E PDF (err ${mod.FPDF_GetLastError()})`);
  }
  try {
    return await fn(mod, docPtr);
  } finally {
    mod.FPDF_CloseDocument(docPtr);
    mod.pdfium.wasmExports.free(ptr);
  }
}

export async function getE2ePdfInfo(
  pdfBytes: Uint8Array,
): Promise<{ pageCount: number; pages: Array<{ width: number; height: number }> }> {
  return withE2ePdf(pdfBytes, (mod, docPtr) => {
    const pageCount = mod.FPDF_GetPageCount(docPtr);
    const pages: Array<{ width: number; height: number }> = [];
    for (let i = 0; i < pageCount; i++) {
      const p = mod.FPDF_LoadPage(docPtr, i);
      try {
        pages.push({
          width: mod.FPDF_GetPageWidthF(p),
          height: mod.FPDF_GetPageHeightF(p),
        });
      } finally {
        mod.FPDF_ClosePage(p);
      }
    }
    return { pageCount, pages };
  });
}

export async function countE2ePageImages(pdfBytes: Uint8Array, pageIndex = 0): Promise<number> {
  return withE2ePdf(pdfBytes, (mod, docPtr) => {
    const p = mod.FPDF_LoadPage(docPtr, pageIndex);
    if (!p) return 0;
    try {
      const count = mod.FPDFPage_CountObjects(p);
      let imgs = 0;
      for (let i = 0; i < count; i++) {
        const obj = mod.FPDFPage_GetObject(p, i);
        if (obj && mod.FPDFPageObj_GetType(obj) === 3) imgs++;
      }
      return imgs;
    } finally {
      mod.FPDF_ClosePage(p);
    }
  });
}

export async function extractE2ePageText(pdfBytes: Uint8Array, pageIndex = 0): Promise<string> {
  return withE2ePdf(pdfBytes, (mod, docPtr) => {
    const pagePtr = mod.FPDF_LoadPage(docPtr, pageIndex);
    if (!pagePtr) return '';
    try {
      const textPtr = mod.FPDFText_LoadPage(pagePtr);
      if (!textPtr) return '';
      try {
        const count = mod.FPDFText_CountChars(textPtr);
        let text = '';
        for (let i = 0; i < count; i++) {
          const code = mod.FPDFText_GetUnicode(textPtr, i);
          if (code > 0) text += String.fromCodePoint(code);
        }
        return text;
      } finally {
        mod.FPDFText_ClosePage(textPtr);
      }
    } finally {
      mod.FPDF_ClosePage(pagePtr);
    }
  });
}

export async function extractE2ePageCharsWithBoxes(
  pdfBytes: Uint8Array,
  pageIndex = 0,
): Promise<Array<{ c: string; yTop: number; x0: number; x1: number; fontSize: number }>> {
  return withE2ePdf(pdfBytes, (mod, docPtr) => {
    const pagePtr = mod.FPDF_LoadPage(docPtr, pageIndex);
    if (!pagePtr) return [];
    const boxPtr = mod.pdfium.wasmExports.malloc(32);
    const out: Array<{ c: string; yTop: number; x0: number; x1: number; fontSize: number }> = [];
    try {
      const pageH = mod.FPDF_GetPageHeightF(pagePtr) || 842;
      const textPtr = mod.FPDFText_LoadPage(pagePtr);
      if (!textPtr) return [];
      try {
        const count = mod.FPDFText_CountChars(textPtr);
        for (let i = 0; i < count; i++) {
          const code = mod.FPDFText_GetUnicode(textPtr, i);
          if (!code) continue;
          const c = String.fromCodePoint(code);
          if (!c.trim()) continue;
          if (!mod.FPDFText_GetCharBox(textPtr, i, boxPtr, boxPtr + 8, boxPtr + 16, boxPtr + 24)) {
            continue;
          }
          const l = mod.pdfium.getValue(boxPtr, 'double');
          const r = mod.pdfium.getValue(boxPtr + 8, 'double');
          const b = mod.pdfium.getValue(boxPtr + 16, 'double');
          const fontSize = mod.FPDFText_GetFontSize(textPtr, i);
          out.push({
            c,
            yTop: pageH - b,
            x0: Math.min(l, r),
            x1: Math.max(l, r),
            fontSize,
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

export async function renderE2ePageRgba(
  pdfBytes: Uint8Array,
  pageIndex = 0,
  scale = 1,
): Promise<{ width: number; height: number; samples: Uint8Array }> {
  return withE2ePdf(pdfBytes, (mod, docPtr) => {
    const pagePtr = mod.FPDF_LoadPage(docPtr, pageIndex);
    if (!pagePtr) throw new Error(`Missing page ${pageIndex}`);
    try {
      const w = Math.max(1, Math.round(mod.FPDF_GetPageWidthF(pagePtr) * scale));
      const h = Math.max(1, Math.round(mod.FPDF_GetPageHeightF(pagePtr) * scale));
      const bmpPtr = mod.FPDFBitmap_Create(w, h, 0);
      try {
        mod.FPDFBitmap_FillRect(bmpPtr, 0, 0, w, h, 0xffffffff);
        mod.FPDF_RenderPageBitmap(bmpPtr, pagePtr, 0, 0, w, h, 0, 0x10);
        const stride = mod.FPDFBitmap_GetStride(bmpPtr);
        const bufPtr = mod.FPDFBitmap_GetBuffer(bmpPtr);
        const heap = mod.pdfium.HEAPU8;
        const rgba = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) {
          const src = bufPtr + y * stride;
          const dst = y * w * 4;
          for (let x = 0; x < w; x++) {
            const s = src + x * 4;
            const d = dst + x * 4;
            // Flag 0x10 (FPDF_REVERSE_BYTE_ORDER) outputs native RGBA byte order
            rgba[d] = heap[s];
            rgba[d + 1] = heap[s + 1];
            rgba[d + 2] = heap[s + 2];
            rgba[d + 3] = heap[s + 3];
          }
        }
        return { width: w, height: h, samples: rgba };
      } finally {
        mod.FPDFBitmap_Destroy(bmpPtr);
      }
    } finally {
      mod.FPDF_ClosePage(pagePtr);
    }
  });
}

export function createE2ePngBytes(
  width: number,
  height: number,
  fillPixel?: (x: number, y: number) => [number, number, number, number],
  solid?: [number, number, number, number],
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = fillPixel ? fillPixel(x, y) : solid ?? [255, 255, 255, 255];
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = a;
    }
  }
  return rgbaToPngBytes(rgba, width, height);
}

export interface E2ePdfPageSpec {
  width?: number;
  height?: number;
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
  images?: Array<{
    pngBytes: Uint8Array;
    x: number;
    yPdf: number;
    width: number;
    height: number;
  }>;
  texts?: Array<{
    text: string;
    x: number;
    yPdf: number;
    fontSize?: number;
    color?: [number, number, number];
    useDejaVuSans?: boolean;
    fontKey?: string;
  }>;
}

export async function buildE2ePdf(
  pages: E2ePdfPageSpec[],
  options?: {
    userPassword?: string;
    ownerPassword?: string;
    customFonts?: Record<string, Uint8Array>;
  },
): Promise<Uint8Array> {
  const mod = await getE2ePdfium();
  const docPtr = mod.FPDF_CreateNewDocument();
  const stdFont = mod.FPDFText_LoadStandardFont(docPtr, 'Helvetica');
  const fontMap = new Map<string, number>();
  const matrixPtr = mod.pdfium.wasmExports.malloc(24);
  const widthPtr = mod.pdfium.wasmExports.malloc(4);

  const loadTtfKey = (key: string, ttf: Uint8Array): number => {
    const cached = fontMap.get(key);
    if (cached) return cached;
    const ptr = mod.pdfium.wasmExports.malloc(ttf.byteLength);
    mod.pdfium.HEAPU8.set(ttf, ptr);
    const fPtr = mod.FPDFText_LoadFont(docPtr, ptr, ttf.byteLength, 2, true);
    mod.pdfium.wasmExports.free(ptr);
    if (fPtr) fontMap.set(key, fPtr);
    return fPtr || stdFont;
  };

  const getFontPtr = (fontKey?: string, useDejaVuSans?: boolean): number => {
    if (fontKey && options?.customFonts?.[fontKey]) {
      return loadTtfKey(fontKey, options.customFonts[fontKey]);
    }
    if (useDejaVuSans) {
      const ttfPath = path.resolve(
        process.cwd(),
        'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf',
      );
      return loadTtfKey('__dejavu_sans__', fs.readFileSync(ttfPath));
    }
    return stdFont;
  };

  try {
    for (let pi = 0; pi < pages.length; pi++) {
      const spec = pages[pi];
      const w = spec.width ?? 595;
      const h = spec.height ?? 842;
      const pagePtr = mod.FPDFPage_New(docPtr, pi, w, h);

      try {
        for (const r of spec.rects ?? []) {
          const p = mod.FPDFPageObj_CreateNewPath(r.x, r.yPdf);
          mod.FPDFPath_LineTo(p, r.x + r.width, r.yPdf);
          mod.FPDFPath_LineTo(p, r.x + r.width, r.yPdf + r.height);
          mod.FPDFPath_LineTo(p, r.x, r.yPdf + r.height);
          mod.FPDFPath_Close(p);
          mod.FPDFPath_SetDrawMode(p, r.fill ? 2 : 0, Boolean(r.stroke));
          if (r.fill) mod.FPDFPageObj_SetFillColor(p, r.fill[0], r.fill[1], r.fill[2], 255);
          if (r.stroke) {
            mod.FPDFPageObj_SetStrokeColor(p, r.stroke[0], r.stroke[1], r.stroke[2], 255);
            mod.FPDFPageObj_SetStrokeWidth(p, r.strokeWidth ?? 1);
          }
          mod.FPDFPage_InsertObject(pagePtr, p);
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

        for (const ln of spec.lines ?? []) {
          const p = mod.FPDFPageObj_CreateNewPath(ln.x1, ln.y1Pdf);
          mod.FPDFPath_LineTo(p, ln.x2, ln.y2Pdf);
          mod.FPDFPath_SetDrawMode(p, 0, true);
          const sc = ln.stroke ?? [0, 0, 0];
          mod.FPDFPageObj_SetStrokeColor(p, sc[0], sc[1], sc[2], 255);
          mod.FPDFPageObj_SetStrokeWidth(p, ln.strokeWidth ?? 1);
          mod.FPDFPage_InsertObject(pagePtr, p);
        }

        for (const t of spec.texts ?? []) {
          const fontPtr = getFontPtr(t.fontKey, t.useDejaVuSans);
          const size = t.fontSize ?? 12;
          const obj = mod.FPDFPageObj_CreateTextObj(docPtr, fontPtr, size);
          const byteLen = (t.text.length + 1) * 2;
          const ptr = mod.pdfium.wasmExports.malloc(byteLen);
          mod.pdfium.stringToUTF16(t.text, ptr, byteLen);
          mod.FPDFText_SetText(obj, ptr);
          mod.pdfium.wasmExports.free(ptr);
          const rgb = t.color ?? [0, 0, 0];
          mod.FPDFPageObj_SetFillColor(obj, rgb[0], rgb[1], rgb[2], 255);
          mod.pdfium.setValue(matrixPtr, 1, 'float');
          mod.pdfium.setValue(matrixPtr + 4, 0, 'float');
          mod.pdfium.setValue(matrixPtr + 8, 0, 'float');
          mod.pdfium.setValue(matrixPtr + 12, 1, 'float');
          mod.pdfium.setValue(matrixPtr + 16, t.x, 'float');
          mod.pdfium.setValue(matrixPtr + 20, t.yPdf, 'float');
          mod.FPDFPageObj_SetMatrix(obj, matrixPtr);
          mod.FPDFPage_InsertObject(pagePtr, obj);
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

    return saveDoc(mod, docPtr);
  } finally {
    mod.pdfium.wasmExports.free(widthPtr);
    mod.pdfium.wasmExports.free(matrixPtr);
    for (const fp of fontMap.values()) mod.FPDFFont_Close(fp);
    if (stdFont) mod.FPDFFont_Close(stdFont);
    mod.FPDF_CloseDocument(docPtr);
  }
}

export async function measureE2eTtfWidth(
  ttfBytes: Uint8Array,
  text: string,
  fontSize: number,
): Promise<number> {
  const mod = await getE2ePdfium();
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
      const ok = mod.FPDFFont_GetGlyphWidth(fPtr, cp, fontSize, wPtr);
      sum += ok ? Number(mod.pdfium.getValue(wPtr, 'float') || 0) : fontSize * 0.5;
    }
    return sum;
  } finally {
    mod.pdfium.wasmExports.free(wPtr);
    if (fPtr) mod.FPDFFont_Close(fPtr);
    mod.FPDF_CloseDocument(docPtr);
  }
}

let gpWasmInitialized = false;
export async function generateE2eReferencePdf(
  kind: 'form-1p' | 'text-120p' | 'scanned-300p' | 'vector-dense' | 'rtl-cjk',
  options?: { pageCount?: number; vectorSegments?: number },
): Promise<Uint8Array> {
  const gpWasm = await import('../../src/engine/wasm-core/gp_wasm.js');
  if (!gpWasmInitialized) {
    const wasmBytes = fs.readFileSync(
      path.resolve(process.cwd(), 'src/engine/wasm-core/gp_wasm_bg.wasm'),
    );
    gpWasm.initSync({ module: wasmBytes });
    gpWasmInitialized = true;
  }
  const out = gpWasm.create_reference_pdf_bytes(
    kind,
    options?.pageCount ?? null,
    options?.vectorSegments ?? null,
  );
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}
