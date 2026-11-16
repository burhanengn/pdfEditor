import fontkit from '@pdf-lib/fontkit';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';
import {
  normalizeFontMatchKey,
  parsePdfFontMetadata,
  type FontStyleVariant,
} from './fonts';
import {
  extractedFontRegistry,
  registerExtractedPdfFontsInBrowser,
  populateExtractedFontRegistry,
  getExtractedFontAssetPayloads,
  clearExtractedFontsForDoc,
} from './extractedFontRegistry';
import type { ExtractedPdfFont, FontVariantAvailability } from '@/types/pdf';

export {
  registerExtractedPdfFontsInBrowser,
  populateExtractedFontRegistry,
  getExtractedFontAssetPayloads,
  clearExtractedFontsForDoc,
};

function hasValidSfntHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];
  // 0x00010000 (TrueType), 'OTTO' (CFF OpenType), 'true' (Apple TTF), 'ttcf' (collection)
  const tag = String.fromCharCode(b0, b1, b2, b3);
  return (
    (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) ||
    tag === 'OTTO' ||
    tag === 'true' ||
    tag === 'typ1' ||
    tag === 'ttcf'
  );
}

function decodePdfNameText(val: unknown): string {
  if (!val) return '';
  if (val instanceof PDFName) {
    return val.decodeText().replace(/^\//, '');
  }
  return String(val).replace(/^\//, '');
}

function extractStreamBytes(raw: unknown): Uint8Array | null {
  if (!raw) return null;
  if (raw instanceof PDFRawStream) {
    return decodePDFRawStream(raw).decode();
  }
  if (raw instanceof PDFStream) {
    return raw.getContents();
  }
  return null;
}

function safeCssIdent(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function readU16BE(b: Uint8Array, off: number): number {
  return ((b[off] << 8) | b[off + 1]) >>> 0;
}

function readI16BE(b: Uint8Array, off: number): number {
  const v = ((b[off] << 8) | b[off + 1]) & 0xffff;
  return v >= 0x8000 ? v - 0x10000 : v;
}

function readU32BE(b: Uint8Array, off: number): number {
  return (((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0);
}

function writeU16BE(b: Uint8Array, off: number, val: number): void {
  b[off] = (val >>> 8) & 0xff;
  b[off + 1] = val & 0xff;
}

function writeI16BE(b: Uint8Array, off: number, val: number): void {
  writeU16BE(b, off, val & 0xffff);
}

function writeU32BE(b: Uint8Array, off: number, val: number): void {
  b[off] = (val >>> 24) & 0xff;
  b[off + 1] = (val >>> 16) & 0xff;
  b[off + 2] = (val >>> 8) & 0xff;
  b[off + 3] = val & 0xff;
}

function calcSfntChecksum(data: Uint8Array): number {
  let sum = 0;
  const len = data.byteLength;
  for (let i = 0; i < len; i += 4) {
    const b0 = data[i] ?? 0;
    const b1 = i + 1 < len ? data[i + 1] : 0;
    const b2 = i + 2 < len ? data[i + 2] : 0;
    const b3 = i + 3 < len ? data[i + 3] : 0;
    sum = (sum + (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0)) >>> 0;
  }
  return sum;
}

function decodeCMapUtf16Hex(hex: string): number | null {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length === 0 || clean.length % 2 !== 0) return null;
  if (clean.length <= 4) {
    const cp = parseInt(clean, 16);
    if (!Number.isFinite(cp) || cp <= 0 || cp >= 0xffff || cp === 0xfffd) return null;
    return cp;
  }
  if (clean.length === 8) {
    const hi = parseInt(clean.slice(0, 4), 16);
    const lo = parseInt(clean.slice(4, 8), 16);
    if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) {
      const cp = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
      if (cp <= 0xffff) return cp;
    }
  }
  return null;
}

function parseToUnicodeCMap(bytes: Uint8Array): Map<number, number> {
  const cidToCp = new Map<number, number>();
  let text = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    text += String.fromCharCode(bytes[i]);
  }

  // Match beginbfchar ... endbfchar sections
  const bfCharRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let m: RegExpExecArray | null;
  while ((m = bfCharRe.exec(text)) !== null) {
    const body = m[1];
    const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let pm: RegExpExecArray | null;
    while ((pm = pairRe.exec(body)) !== null) {
      const cid = parseInt(pm[1], 16);
      const cp = decodeCMapUtf16Hex(pm[2]);
      if (Number.isFinite(cid) && cp !== null) {
        cidToCp.set(cid, cp);
      }
    }
  }

  // Match beginbfrange ... endbfrange sections
  const bfRangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfRangeRe.exec(text)) !== null) {
    const body = m[1];
    const entryRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:\[([\s\S]*?)\]|<([0-9a-fA-F]+)>)/g;
    let rm: RegExpExecArray | null;
    while ((rm = entryRe.exec(body)) !== null) {
      const start = parseInt(rm[1], 16);
      const end = parseInt(rm[2], 16);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 65536) {
        continue;
      }
      if (rm[3] !== undefined) {
        const hexes = [...rm[3].matchAll(/<([0-9a-fA-F]+)>/g)];
        for (let idx = 0; idx < hexes.length && start + idx <= end; idx++) {
          const cp = decodeCMapUtf16Hex(hexes[idx][1]);
          if (cp !== null) {
            cidToCp.set(start + idx, cp);
          }
        }
      } else if (rm[4] !== undefined) {
        const baseCp = decodeCMapUtf16Hex(rm[4]);
        if (baseCp !== null) {
          for (let cid = start; cid <= end; cid++) {
            const cp = baseCp + (cid - start);
            if (cp > 0 && cp < 0xffff) {
              cidToCp.set(cid, cp);
            }
          }
        }
      }
    }
  }

  return cidToCp;
}

function buildCmapFormat4Table(unicodeToGid: Map<number, number>): Uint8Array {
  const entries = [...unicodeToGid.entries()]
    .filter(([cp, gid]) => cp > 0 && cp < 0xffff && gid > 0 && gid <= 0xffff)
    .sort((a, b) => a[0] - b[0]);

  interface Seg {
    start: number;
    end: number;
    idDelta: number;
  }
  const segments: Seg[] = [];
  for (const [cp, gid] of entries) {
    const idDelta = (gid - cp) & 0xffff;
    const prev = segments[segments.length - 1];
    if (prev && cp === prev.end + 1 && idDelta === prev.idDelta) {
      prev.end = cp;
    } else {
      segments.push({ start: cp, end: cp, idDelta });
    }
  }
  segments.push({ start: 0xffff, end: 0xffff, idDelta: 1 });

  const segCount = segments.length;
  const segCountX2 = segCount * 2;
  const maxPow = Math.floor(Math.log2(segCount));
  const searchRange = 2 * (1 << maxPow);
  const entrySelector = maxPow;
  const rangeShift = segCountX2 - searchRange;

  const subtableLen = 16 + segCount * 8;
  const cmapHeaderLen = 12; // version(2)+numTables(2)+platformID(2)+encodingID(2)+offset(4)
  const out = new Uint8Array(cmapHeaderLen + subtableLen);

  // cmap directory header
  writeU16BE(out, 0, 0); // version
  writeU16BE(out, 2, 1); // numTables
  writeU16BE(out, 4, 3); // Windows
  writeU16BE(out, 6, 1); // Unicode BMP
  writeU32BE(out, 8, cmapHeaderLen);

  // Format 4 subtable
  let p = cmapHeaderLen;
  writeU16BE(out, p, 4); // format
  writeU16BE(out, p + 2, subtableLen);
  writeU16BE(out, p + 4, 0); // language
  writeU16BE(out, p + 6, segCountX2);
  writeU16BE(out, p + 8, searchRange);
  writeU16BE(out, p + 10, entrySelector);
  writeU16BE(out, p + 12, rangeShift);
  p += 14;

  for (let i = 0; i < segCount; i++) {
    writeU16BE(out, p + i * 2, segments[i].end);
  }
  p += segCount * 2;
  writeU16BE(out, p, 0); // reservedPad
  p += 2;
  for (let i = 0; i < segCount; i++) {
    writeU16BE(out, p + i * 2, segments[i].start);
  }
  p += segCount * 2;
  for (let i = 0; i < segCount; i++) {
    writeU16BE(out, p + i * 2, segments[i].idDelta);
  }
  // idRangeOffset bytes already zeroed
  return out;
}

function buildMinimalOs2Table(params: {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  yMin: number;
  yMax: number;
  isBold: boolean;
  isItalic: boolean;
  firstCp: number;
  lastCp: number;
}): Uint8Array {
  const out = new Uint8Array(96);
  const upem = Math.max(16, params.unitsPerEm);
  const typoAsc = params.ascent > 0 ? params.ascent : Math.round(upem * 0.8);
  const typoDesc = params.descent < 0 ? params.descent : -Math.round(upem * 0.2);
  const winAsc = Math.max(typoAsc, params.yMax > 0 ? params.yMax : typoAsc);
  const winDesc = Math.max(-typoDesc, params.yMin < 0 ? -params.yMin : -typoDesc);

  writeU16BE(out, 0, 4); // version 4
  writeI16BE(out, 2, Math.round(upem * 0.5)); // xAvgCharWidth
  writeU16BE(out, 4, params.isBold ? 700 : 400); // usWeightClass
  writeU16BE(out, 6, 5); // usWidthClass (Medium)
  writeU16BE(out, 8, 0); // fsType (Installable)
  writeI16BE(out, 10, Math.round(upem * 0.65)); // ySubscriptXSize
  writeI16BE(out, 12, Math.round(upem * 0.7)); // ySubscriptYSize
  writeI16BE(out, 14, 0);
  writeI16BE(out, 16, Math.round(upem * 0.14)); // ySubscriptYOffset
  writeI16BE(out, 18, Math.round(upem * 0.65)); // ySuperscriptXSize
  writeI16BE(out, 20, Math.round(upem * 0.7)); // ySuperscriptYSize
  writeI16BE(out, 22, 0);
  writeI16BE(out, 24, Math.round(upem * 0.45)); // ySuperscriptYOffset
  writeI16BE(out, 26, Math.max(1, Math.round(upem * 0.05))); // yStrikeoutSize
  writeI16BE(out, 28, Math.round(upem * 0.26)); // yStrikeoutPosition
  writeU32BE(out, 42, 1); // ulUnicodeRange1 Basic Latin
  out[58] = 80; // P
  out[59] = 68; // D
  out[60] = 70; // F
  out[61] = 69; // E
  const fsSelection =
    (params.isItalic ? 1 : 0) |
    (params.isBold ? 32 : 0) |
    (!params.isBold && !params.isItalic ? 64 : 0);
  writeU16BE(out, 62, fsSelection);
  writeU16BE(out, 64, Math.min(0xffff, Math.max(0, params.firstCp)));
  writeU16BE(out, 66, Math.min(0xffff, Math.max(params.firstCp, params.lastCp)));
  writeI16BE(out, 68, typoAsc);
  writeI16BE(out, 70, typoDesc);
  writeI16BE(out, 72, Math.max(0, params.lineGap));
  writeU16BE(out, 74, winAsc);
  writeU16BE(out, 76, winDesc);
  writeU32BE(out, 78, 1); // ulCodePageRange1 Latin1
  writeI16BE(out, 86, Math.round(upem * 0.5)); // sxHeight
  writeI16BE(out, 88, Math.round(upem * 0.7)); // sCapHeight
  writeU16BE(out, 90, 0); // usDefaultChar
  writeU16BE(out, 92, 0x20); // usBreakChar
  writeU16BE(out, 94, 0); // usMaxContext
  return out;
}

function buildMinimalPostTable(unitsPerEm: number, isItalic: boolean, isMono: boolean): Uint8Array {
  const out = new Uint8Array(32);
  writeU32BE(out, 0, 0x00030000); // format 3.0
  writeU32BE(out, 4, isItalic ? (((-12) & 0xffff) << 16) >>> 0 : 0);
  writeI16BE(out, 8, -Math.round(unitsPerEm * 0.1));
  writeI16BE(out, 10, Math.max(1, Math.round(unitsPerEm * 0.05)));
  writeU32BE(out, 12, isMono ? 1 : 0);
  return out;
}

function encodeUtf16Be(str: string): Uint8Array {
  const out = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    writeU16BE(out, i * 2, str.charCodeAt(i));
  }
  return out;
}

function buildMinimalNameTable(
  familyName: string,
  postscriptName: string,
  isBold: boolean,
  isItalic: boolean,
): Uint8Array {
  const subfamily =
    isBold && isItalic
      ? 'Bold Italic'
      : isBold
        ? 'Bold'
        : isItalic
          ? 'Italic'
          : 'Regular';
  const cleanFamily = familyName.trim() || 'EmbeddedPDF';
  const cleanPs =
    postscriptName.replace(/[^A-Za-z0-9-]/g, '').slice(0, 62) || 'EmbeddedPDFFont';
  const fullName = `${cleanFamily} ${subfamily}`;

  const records: Array<[number, Uint8Array]> = [
    [1, encodeUtf16Be(cleanFamily)],
    [2, encodeUtf16Be(subfamily)],
    [3, encodeUtf16Be(`PDFSubset:${cleanPs}`)],
    [4, encodeUtf16Be(fullName)],
    [5, encodeUtf16Be('Version 1.0')],
    [6, encodeUtf16Be(cleanPs)],
  ];

  const count = records.length;
  const storageOffset = 6 + count * 12;
  let totalStrLen = 0;
  for (const [, buf] of records) totalStrLen += buf.byteLength;

  const out = new Uint8Array(storageOffset + totalStrLen);
  writeU16BE(out, 0, 0); // format
  writeU16BE(out, 2, count);
  writeU16BE(out, 4, storageOffset);

  let strOffset = 0;
  for (let i = 0; i < count; i++) {
    const [nameId, buf] = records[i];
    const recOff = 6 + i * 12;
    writeU16BE(out, recOff, 3); // Windows
    writeU16BE(out, recOff + 2, 1); // Unicode BMP
    writeU16BE(out, recOff + 4, 0x0409); // en-US
    writeU16BE(out, recOff + 6, nameId);
    writeU16BE(out, recOff + 8, buf.byteLength);
    writeU16BE(out, recOff + 10, strOffset);
    out.set(buf, storageOffset + strOffset);
    strOffset += buf.byteLength;
  }
  return out;
}

/**
 * Reconstructs missing `cmap` (from PDF `/ToUnicode` + `/CIDToGIDMap`), `OS/2`, `name`,
 * and `post` tables in subsetted PDF TrueType streams (e.g., pdf-lib / Chrome / Word
 * `TTFSubset` streams that strip `cmap`) so Chromium `@font-face` and `pdf-lib`
 * can actively render and embed extracted custom PDF fonts.
 */
function repairSubsetTrueTypeSfnt(
  fontBytes: Uint8Array,
  params: {
    unicodeToGid: Map<number, number>;
    cleanName: string;
    isBold: boolean;
    isItalic: boolean;
    isMono: boolean;
  },
): Uint8Array | null {
  if (fontBytes.byteLength < 12) return null;
  const tag0 = String.fromCharCode(fontBytes[0], fontBytes[1], fontBytes[2], fontBytes[3]);
  if (tag0 === 'ttcf' || tag0 === 'typ1') return null;

  const numTables = readU16BE(fontBytes, 4);
  if (numTables === 0 || 12 + numTables * 16 > fontBytes.byteLength) return null;

  const sfntVersion = readU32BE(fontBytes, 0);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tTag = String.fromCharCode(
      fontBytes[off],
      fontBytes[off + 1],
      fontBytes[off + 2],
      fontBytes[off + 3],
    );
    const tOffset = readU32BE(fontBytes, off + 8);
    const tLen = readU32BE(fontBytes, off + 12);
    if (tOffset + tLen > fontBytes.byteLength) return null;
    tables.set(tTag, fontBytes.slice(tOffset, tOffset + tLen));
  }

  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const maxp = tables.get('maxp');
  if (!head || head.byteLength < 54 || !hhea || hhea.byteLength < 36 || !maxp || maxp.byteLength < 6) {
    return null;
  }

  const unitsPerEm = readU16BE(head, 18);
  const yMin = readI16BE(head, 38);
  const yMax = readI16BE(head, 42);
  const ascent = readI16BE(hhea, 4);
  const descent = readI16BE(hhea, 6);
  const lineGap = readI16BE(hhea, 8);
  const numGlyphs = readU16BE(maxp, 4);

  const validMap = new Map<number, number>();
  for (const [cp, gid] of params.unicodeToGid.entries()) {
    if (cp > 0 && cp < 0xffff && gid > 0 && gid < numGlyphs) {
      validMap.set(cp, gid);
    }
  }
  if (validMap.size === 0) return null;

  if (!tables.has('cmap')) {
    tables.set('cmap', buildCmapFormat4Table(validMap));
  }
  const cps = [...validMap.keys()].sort((a, b) => a - b);
  if (!tables.has('OS/2')) {
    tables.set(
      'OS/2',
      buildMinimalOs2Table({
        unitsPerEm,
        ascent,
        descent,
        lineGap,
        yMin,
        yMax,
        isBold: params.isBold,
        isItalic: params.isItalic,
        firstCp: cps[0] ?? 0x20,
        lastCp: cps[cps.length - 1] ?? 0x7e,
      }),
    );
  }
  if (!tables.has('post')) {
    tables.set('post', buildMinimalPostTable(unitsPerEm, params.isItalic, params.isMono));
  }
  if (!tables.has('name')) {
    const familyBase =
      params.cleanName.replace(/[-_](regular|bold|italic|oblique|bolditalic|boldoblique)$/i, '').trim() ||
      params.cleanName;
    tables.set(
      'name',
      buildMinimalNameTable(familyBase, params.cleanName, params.isBold, params.isItalic),
    );
  }

  // Zero out checkSumAdjustment in head before final assembly
  const headCopy = head.slice();
  writeU32BE(headCopy, 8, 0);
  tables.set('head', headCopy);

  const sortedTags = [...tables.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const newNumTables = sortedTags.length;
  const headerSize = 12 + newNumTables * 16;

  let dataSize = 0;
  for (const t of sortedTags) {
    const len = tables.get(t)!.byteLength;
    dataSize += (len + 3) & ~3;
  }

  const out = new Uint8Array(headerSize + dataSize);
  const maxPow = Math.floor(Math.log2(newNumTables));
  const searchRange = 16 * (1 << maxPow);
  const entrySelector = maxPow;
  const rangeShift = newNumTables * 16 - searchRange;

  writeU32BE(out, 0, sfntVersion);
  writeU16BE(out, 4, newNumTables);
  writeU16BE(out, 6, searchRange);
  writeU16BE(out, 8, entrySelector);
  writeU16BE(out, 10, rangeShift);

  let cursor = headerSize;
  let headOutOffset = -1;
  for (let i = 0; i < sortedTags.length; i++) {
    const tagStr = sortedTags[i];
    const tData = tables.get(tagStr)!;
    const recOff = 12 + i * 16;
    out[recOff] = tagStr.charCodeAt(0);
    out[recOff + 1] = tagStr.charCodeAt(1);
    out[recOff + 2] = tagStr.charCodeAt(2);
    out[recOff + 3] = tagStr.charCodeAt(3);
    writeU32BE(out, recOff + 4, calcSfntChecksum(tData));
    writeU32BE(out, recOff + 8, cursor);
    writeU32BE(out, recOff + 12, tData.byteLength);
    out.set(tData, cursor);
    if (tagStr === 'head') headOutOffset = cursor;
    cursor += (tData.byteLength + 3) & ~3;
  }

  if (headOutOffset >= 0) {
    const totalSum = calcSfntChecksum(out);
    const checkAdj = (0xb1b0afba - totalSum) >>> 0;
    writeU32BE(out, headOutOffset + 8, checkAdj);
  }

  return out;
}

/**
 * Parses usable embedded TrueType / OpenType streams (`/FontFile2` and OpenType `/FontFile3`)
 * directly from a PDF byte buffer so original custom fonts can be rendered in the browser
 * editor and reused during export.
 */
export async function extractEmbeddedFontsFromPdfBytes(
  sourceDocId: string,
  pdfBytes: Uint8Array,
): Promise<ExtractedPdfFont[]> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch {
    return [];
  }

  const ctx = pdfDoc.context;
  const seenFontRef = new Set<string>();
  const grouped = new Map<
    string,
    {
      cleanName: string;
      displayName: string;
      baseKey: string;
      isSerif?: boolean;
      isMono?: boolean;
      variants: Partial<Record<FontStyleVariant, Uint8Array>>;
      codePoints: Set<number>;
    }
  >();

  const inspectFontDict = (
    fontDict: PDFDict,
    inheritedBaseFont?: string,
    inheritedToUnicode?: PDFObject,
  ) => {
    const rawBaseFont = decodePdfNameText(ctx.lookup(fontDict.get(PDFName.of('BaseFont')))) || inheritedBaseFont || '';
    const toUnicodeRef = fontDict.get(PDFName.of('ToUnicode')) ?? inheritedToUnicode;

    // Composite Type0 fonts store FontDescriptor on DescendantFonts[0] and ToUnicode on Type0
    const subtype = decodePdfNameText(ctx.lookup(fontDict.get(PDFName.of('Subtype'))));
    if (subtype === 'Type0') {
      const descendants = ctx.lookupMaybe(fontDict.get(PDFName.of('DescendantFonts')), PDFArray);
      if (descendants) {
        for (let i = 0; i < descendants.size(); i++) {
          const descDict = descendants.lookupMaybe(i, PDFDict);
          if (descDict) {
            inspectFontDict(descDict, rawBaseFont, toUnicodeRef);
          }
        }
      }
      return;
    }

    const descriptor = fontDict.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    if (!descriptor) return;

    const descFontName = decodePdfNameText(ctx.lookup(descriptor.get(PDFName.of('FontName'))));
    const effectiveFontName = rawBaseFont || descFontName;
    if (!effectiveFontName) return;

    const flagsVal = ctx.lookup(descriptor.get(PDFName.of('Flags')));
    const flagsNum = flagsVal instanceof PDFNumber ? flagsVal.asNumber() : 0;
    const isFixedPitch = Boolean(flagsNum & 1);
    const isSerif = Boolean(flagsNum & 2);
    const isItalicFlag = Boolean(flagsNum & 64);

    // Prefer FontFile2 (TrueType/OTF) or OpenType FontFile3
    const ff2Ref = descriptor.get(PDFName.of('FontFile2'));
    const ff3Ref = descriptor.get(PDFName.of('FontFile3'));
    const chosenRef = ff2Ref ?? ff3Ref;
    const chosenTag = chosenRef instanceof PDFRef ? chosenRef.toString() : null;
    if (chosenTag && seenFontRef.has(chosenTag)) return;

    const rawFontStream = ctx.lookup(chosenRef);
    const rawFontBytes = extractStreamBytes(rawFontStream);
    if (!rawFontBytes || !hasValidSfntHeader(rawFontBytes)) return;

    const norm = normalizeFontMatchKey(effectiveFontName);

    let usableFontBytes = rawFontBytes;
    let fkFont: ReturnType<typeof fontkit.create> | null = null;
    let charSet: number[] = [];
    let subfamily = '';
    let headItalic = false;
    let postFixed = false;

    try {
      fkFont = fontkit.create(usableFontBytes);
      charSet = Array.isArray(fkFont.characterSet)
        ? fkFont.characterSet.filter((cp) => cp > 0 && cp <= 0x10ffff)
        : [];
      subfamily = fkFont.subfamilyName ?? '';
      headItalic = Boolean(fkFont.head?.macStyle?.italic);
      postFixed = Boolean(fkFont.post?.isFixedPitch);
    } catch {
      charSet = [];
    }

    const initialBold = norm.bold || /bold|black|heavy|semibold|demi/i.test(subfamily);
    const initialItalic = norm.italic || isItalicFlag || headItalic || /italic|oblique/i.test(subfamily);

    // Many real-world PDF generators (pdf-lib subset, Chrome/Skia, Word) strip the SFNT `cmap`,
    // `name`, `OS/2`, and `post` tables from Type0 subsetted /FontFile2 streams. Reconstruct them
    // from the PDF font's `/ToUnicode` CMap + `/CIDToGIDMap` when absent.
    if (charSet.length === 0 && toUnicodeRef) {
      const toUnicodeStream = ctx.lookup(toUnicodeRef);
      const toUnicodeBytes = extractStreamBytes(toUnicodeStream);
      if (toUnicodeBytes) {
        const cidToCp = parseToUnicodeCMap(toUnicodeBytes);
        if (cidToCp.size > 0) {
          let cidToGidBytes: Uint8Array | null = null;
          const ctgVal = ctx.lookup(fontDict.get(PDFName.of('CIDToGIDMap')));
          if (!(ctgVal instanceof PDFName)) {
            cidToGidBytes = extractStreamBytes(ctgVal);
          }
          const unicodeToGid = new Map<number, number>();
          for (const [cid, cp] of cidToCp.entries()) {
            let gid = cid;
            if (cidToGidBytes && cid * 2 + 1 < cidToGidBytes.byteLength) {
              gid = (cidToGidBytes[cid * 2] << 8) | cidToGidBytes[cid * 2 + 1];
            }
            if (gid > 0 && !unicodeToGid.has(cp)) {
              unicodeToGid.set(cp, gid);
            }
          }
          const repaired = repairSubsetTrueTypeSfnt(rawFontBytes, {
            unicodeToGid,
            cleanName: norm.cleanName,
            isBold: initialBold,
            isItalic: initialItalic,
            isMono: isFixedPitch || postFixed,
          });
          if (repaired) {
            try {
              const repairedFk = fontkit.create(repaired);
              const repairedChars = Array.isArray(repairedFk.characterSet)
                ? repairedFk.characterSet.filter((cp) => cp > 0 && cp <= 0x10ffff)
                : [];
              if (repairedChars.length > 0) {
                usableFontBytes = repaired;
                fkFont = repairedFk;
                charSet = repairedChars;
                subfamily = repairedFk.subfamilyName ?? subfamily;
                headItalic = Boolean(repairedFk.head?.macStyle?.italic) || headItalic;
                postFixed = Boolean(repairedFk.post?.isFixedPitch) || postFixed;
              }
            } catch {
              charSet = [];
            }
          }
        }
      }
    }

    if (charSet.length === 0) {
      return;
    }

    if (chosenTag) {
      seenFontRef.add(chosenTag);
    }

    const variantBold = norm.bold || /bold|black|heavy|semibold|demi/i.test(subfamily);
    const variantItalic =
      norm.italic ||
      isItalicFlag ||
      headItalic ||
      /italic|oblique/i.test(subfamily);
    const variant: FontStyleVariant =
      variantBold && variantItalic
        ? 'boldItalic'
        : variantBold
          ? 'bold'
          : variantItalic
            ? 'italic'
            : 'regular';

    const existing = grouped.get(norm.baseKey) ?? {
      cleanName: norm.cleanName,
      displayName:
        norm.cleanName.replace(/[-_](regular|bold|italic|oblique|bolditalic|boldoblique)$/i, '').trim() ||
        norm.cleanName,
      baseKey: norm.baseKey,
      isSerif: isSerif || /serif/i.test(effectiveFontName),
      isMono: isFixedPitch || postFixed,
      variants: {},
      codePoints: new Set<number>(),
    };

    // Keep the richer subset if another copy exists for the same variant
    const prevBytes = existing.variants[variant];
    if (!prevBytes || usableFontBytes.byteLength >= prevBytes.byteLength) {
      existing.variants[variant] = usableFontBytes;
    }
    for (const cp of charSet) {
      existing.codePoints.add(cp);
    }
    grouped.set(norm.baseKey, existing);
  };

  const candidateFontDicts: PDFDict[] = [];
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      const type = decodePdfNameText(ctx.lookup(obj.get(PDFName.of('Type'))));
      if (type === 'Font' || obj.has(PDFName.of('FontDescriptor')) || obj.has(PDFName.of('DescendantFonts'))) {
        candidateFontDicts.push(obj);
      }
    }
  }

  // Visit composite Type0 dictionaries first so their `/ToUnicode` stream attaches to DescendantFonts
  for (const dict of candidateFontDicts) {
    const subtype = decodePdfNameText(ctx.lookup(dict.get(PDFName.of('Subtype'))));
    if (subtype === 'Type0') {
      inspectFontDict(dict);
    }
  }
  for (const dict of candidateFontDicts) {
    const subtype = decodePdfNameText(ctx.lookup(dict.get(PDFName.of('Subtype'))));
    if (subtype !== 'Type0' && subtype !== 'CIDFontType2' && subtype !== 'CIDFontType0') {
      inspectFontDict(dict);
    }
  }

  const results: ExtractedPdfFont[] = [];
  for (const entry of grouped.values()) {
    const id = `embedded:${sourceDocId}:${entry.baseKey}`;
    const cssFamily = `pdf_embedded_${safeCssIdent(sourceDocId)}_${safeCssIdent(entry.baseKey)}`;
    const fallbackMeta = parsePdfFontMetadata(entry.cleanName, {
      isSerif: entry.isSerif,
      isMono: entry.isMono,
    });
    const supportedCodePoints = [...entry.codePoints].sort((a, b) => a - b);
    const variantsAvail: FontVariantAvailability = {
      regular: Boolean(entry.variants.regular),
      bold: Boolean(entry.variants.bold),
      italic: Boolean(entry.variants.italic),
      boldItalic: Boolean(entry.variants.boldItalic),
    };

    const meta: ExtractedPdfFont = {
      id,
      sourceDocId,
      cleanName: entry.cleanName,
      displayName: entry.displayName,
      baseKey: entry.baseKey,
      cssFamily,
      fallbackFamily: fallbackMeta.fontFamily,
      variants: variantsAvail,
      supportedCodePoints,
      unicodeUsable: supportedCodePoints.length > 0,
    };

    extractedFontRegistry.set(id, { meta, variants: entry.variants });
    results.push(meta);
  }

  return results;
}
