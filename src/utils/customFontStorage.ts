import {
  buildUnicodeRangeFromCodePoints,
  registerDynamicFontFace,
  unregisterDynamicFontFamily,
} from '@/engine/fontFaces';
import {
  normalizeFontMatchKey,
  parsePdfFontMetadata,
  type FontStyleVariant,
} from '@/engine/fonts';
import type { BuiltinFontFamilyOption, UserCustomFont } from '@/types/pdf';
import type { FontAssetPayload } from '@/types/worker';

const DB_NAME = 'aetherpdf_custom_fonts_db_v1';
const STORE_NAME = 'fonts';

interface StoredFontRecord {
  meta: UserCustomFont;
  variants: Partial<Record<FontStyleVariant, Uint8Array>>;
}

const userFontRegistry = new Map<string, StoredFontRecord>();

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function writeUint32BE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function writeUint16BE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 8) & 0xff;
  out[offset + 1] = value & 0xff;
}

async function inflateZlib(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('WOFF decompression requires TTF or OTF format in this environment.');
  }
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('deflate'));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Unwraps WOFF1 into a standard SFNT (TTF/OTF) byte array so pdf-lib and fontkit can
 * embed WOFF uploads into exported PDFs identically to TTF/OTF uploads.
 */
export async function normalizeUploadedFontBytes(rawBytes: Uint8Array): Promise<Uint8Array> {
  if (rawBytes.byteLength < 12) {
    throw new Error('Font file is empty or truncated.');
  }
  const tag = String.fromCharCode(rawBytes[0], rawBytes[1], rawBytes[2], rawBytes[3]);
  if (tag === 'wOF2') {
    throw new Error('WOFF2 format is not supported for PDF embedding yet. Please upload a .ttf, .otf, or .woff file.');
  }
  if (tag !== 'wOFF') {
    return rawBytes;
  }

  if (rawBytes.byteLength < 44) {
    throw new Error('Corrupt WOFF header.');
  }
  const flavor = readUint32BE(rawBytes, 4);
  const numTables = (rawBytes[12] << 8) | rawBytes[13];
  if (numTables === 0 || rawBytes.byteLength < 44 + numTables * 20) {
    throw new Error('Corrupt WOFF table directory.');
  }

  interface TableEntry {
    tagBytes: Uint8Array;
    checksum: number;
    data: Uint8Array;
  }
  const tables: TableEntry[] = [];
  for (let i = 0; i < numTables; i++) {
    const dirOff = 44 + i * 20;
    const tagBytes = rawBytes.slice(dirOff, dirOff + 4);
    const offset = readUint32BE(rawBytes, dirOff + 4);
    const compLength = readUint32BE(rawBytes, dirOff + 8);
    const origLength = readUint32BE(rawBytes, dirOff + 12);
    const origChecksum = readUint32BE(rawBytes, dirOff + 16);
    const slice = rawBytes.subarray(offset, offset + compLength);
    const data = compLength < origLength ? await inflateZlib(slice) : new Uint8Array(slice);
    tables.push({ tagBytes, checksum: origChecksum, data });
  }

  const headerSize = 12 + numTables * 16;
  let totalSize = headerSize;
  for (const t of tables) {
    totalSize += Math.ceil(t.data.byteLength / 4) * 4;
  }

  const sfnt = new Uint8Array(totalSize);
  writeUint32BE(sfnt, 0, flavor);
  writeUint16BE(sfnt, 4, numTables);
  const maxPow2 = 1 << Math.floor(Math.log2(numTables));
  writeUint16BE(sfnt, 6, maxPow2 * 16);
  writeUint16BE(sfnt, 8, Math.floor(Math.log2(maxPow2)));
  writeUint16BE(sfnt, 10, numTables * 16 - maxPow2 * 16);

  let dataCursor = headerSize;
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const recOff = 12 + i * 16;
    sfnt.set(t.tagBytes, recOff);
    writeUint32BE(sfnt, recOff + 4, t.checksum);
    writeUint32BE(sfnt, recOff + 8, dataCursor);
    writeUint32BE(sfnt, recOff + 12, t.data.byteLength);
    sfnt.set(t.data, dataCursor);
    dataCursor += Math.ceil(t.data.byteLength / 4) * 4;
  }

  return sfnt;
}

function openFontDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'meta.id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function persistRecordToDb(record: StoredFontRecord): Promise<void> {
  const db = await openFontDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

async function deleteRecordFromDb(id: string): Promise<void> {
  const db = await openFontDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

async function registerUserFontRecordInBrowser(record: StoredFontRecord): Promise<void> {
  const unicodeRange =
    record.meta.supportedCodePoints.length > 0 && record.meta.supportedCodePoints.length < 1800
      ? buildUnicodeRangeFromCodePoints(record.meta.supportedCodePoints)
      : undefined;
  const entries: Array<[FontStyleVariant, Uint8Array | undefined]> = [
    ['regular', record.variants.regular],
    ['bold', record.variants.bold],
    ['italic', record.variants.italic],
    ['boldItalic', record.variants.boldItalic],
  ];
  for (const [variant, bytes] of entries) {
    if (bytes) {
      await registerDynamicFontFace(record.meta.cssFamily, bytes, variant, unicodeRange);
    }
  }
}

export async function loadUserCustomFonts(): Promise<UserCustomFont[]> {
  const db = await openFontDb();
  if (!db) {
    return [...userFontRegistry.values()].map((r) => r.meta);
  }
  const records = await new Promise<StoredFontRecord[]>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        db.close();
        resolve(Array.isArray(req.result) ? (req.result as StoredFontRecord[]) : []);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });

  for (const rec of records) {
    userFontRegistry.set(rec.meta.id, rec);
    await registerUserFontRecordInBrowser(rec);
  }
  return [...userFontRegistry.values()].map((r) => r.meta);
}

/**
 * Parses and installs user-uploaded TTF/OTF/WOFF font files into browser CSS fonts,
 * IndexedDB storage, and worker export registry. Merges style variants cleanly by family name.
 */
export async function importUserCustomFontFiles(
  inputs: Array<File | { name: string; bytes: Uint8Array }>,
): Promise<{ allFonts: UserCustomFont[]; affectedIds: string[] }> {
  const affectedIds: string[] = [];

  for (const input of inputs) {
    const fileName = input.name;
    const rawBytes =
      input instanceof File ? new Uint8Array(await input.arrayBuffer()) : input.bytes;
    const sfntBytes = await normalizeUploadedFontBytes(rawBytes);

    const { ensureRustCoreReady } = await import('@/engine/rustCoreBridge');
    const wasm = await ensureRustCoreReady();
    let fkFont: {
      familyName: string;
      subfamilyName: string;
      fullName: string;
      postscriptName: string;
      supportedCodePoints: number[];
    };
    try {
      fkFont = wasm.inspect_ttf_font(sfntBytes);
    } catch {
      throw new Error(`Could not parse font "${fileName}". Ensure it is a valid TTF, OTF, or WOFF file.`);
    }

    const familyCandidate =
      fkFont.familyName?.trim() ||
      normalizeFontMatchKey(fileName).cleanName;
    const fullCandidate = fkFont.postscriptName?.trim() || fkFont.fullName?.trim() || fileName;
    const famNorm = normalizeFontMatchKey(familyCandidate);
    const fullNorm = normalizeFontMatchKey(fullCandidate);
    const fileNorm = normalizeFontMatchKey(fileName);

    const sub = (fkFont.subfamilyName ?? '').toLowerCase();
    const bold =
      fullNorm.bold ||
      fileNorm.bold ||
      sub.includes('bold') ||
      sub.includes('black') ||
      sub.includes('heavy') ||
      sub.includes('semibold') ||
      sub.includes('demi');
    const italic =
      fullNorm.italic ||
      fileNorm.italic ||
      sub.includes('italic') ||
      sub.includes('oblique');
    const variant: FontStyleVariant =
      bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';

    const baseKey = famNorm.baseKey || fullNorm.baseKey || fileNorm.baseKey;
    const id = `user:${baseKey}`;
    const cssFamily = `user_custom_${baseKey.replace(/[^a-z0-9]/g, '_')}`;
    const parsedMeta = parsePdfFontMetadata(fullCandidate);

    const cpSet = new Set<number>(
      Array.isArray(fkFont.supportedCodePoints)
        ? fkFont.supportedCodePoints.filter((cp) => cp > 0 && cp <= 0x10ffff)
        : [],
    );

    const existing = userFontRegistry.get(id);
    if (existing) {
      for (const cp of existing.meta.supportedCodePoints) {
        cpSet.add(cp);
      }
    }

    const nextVariants: Partial<Record<FontStyleVariant, Uint8Array>> = {
      ...(existing?.variants ?? {}),
      [variant]: sfntBytes,
    };
    const nextFileNames: Partial<Record<FontStyleVariant, string>> = {
      ...(existing?.meta.fileNames ?? {}),
      [variant]: fileName,
    };

    const nextMeta: UserCustomFont = {
      id,
      name: familyCandidate || existing?.meta.name || fileNorm.cleanName,
      baseKey,
      cssFamily,
      fallbackFamily: (parsedMeta.fontFamily as BuiltinFontFamilyOption) || 'Helvetica',
      variants: {
        regular: Boolean(nextVariants.regular),
        bold: Boolean(nextVariants.bold),
        italic: Boolean(nextVariants.italic),
        boldItalic: Boolean(nextVariants.boldItalic),
      },
      supportedCodePoints: [...cpSet].sort((a, b) => a - b),
      fileNames: nextFileNames,
      addedAt: existing?.meta.addedAt ?? Date.now(),
    };

    const record: StoredFontRecord = { meta: nextMeta, variants: nextVariants };
    userFontRegistry.set(id, record);
    await registerUserFontRecordInBrowser(record);
    await persistRecordToDb(record);
    if (!affectedIds.includes(id)) {
      affectedIds.push(id);
    }
  }

  return {
    allFonts: [...userFontRegistry.values()].map((r) => r.meta),
    affectedIds,
  };
}

export async function deleteUserCustomFont(id: string): Promise<UserCustomFont[]> {
  const existing = userFontRegistry.get(id);
  if (existing) {
    unregisterDynamicFontFamily(existing.meta.cssFamily);
    userFontRegistry.delete(id);
    await deleteRecordFromDb(id);
  }
  return [...userFontRegistry.values()].map((r) => r.meta);
}

export function getUserFontAssetPayloads(fontIds?: string[]): FontAssetPayload[] {
  const out: FontAssetPayload[] = [];
  for (const [id, rec] of userFontRegistry.entries()) {
    if (fontIds && !fontIds.includes(id)) continue;
    out.push({
      family: id,
      regular: rec.variants.regular,
      bold: rec.variants.bold,
      italic: rec.variants.italic,
      boldItalic: rec.variants.boldItalic,
    });
  }
  return out;
}

export function clearUserCustomFontMemory(): void {
  for (const rec of userFontRegistry.values()) {
    unregisterDynamicFontFamily(rec.meta.cssFamily);
  }
  userFontRegistry.clear();
}
