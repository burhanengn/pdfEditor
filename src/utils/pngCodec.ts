const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  const MOD = 65521;
  for (let i = 0; i < bytes.length; i++) {
    s1 = (s1 + bytes[i]) % MOD;
    s2 = (s2 + s1) % MOD;
  }
  return ((s2 << 16) | s1) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return out;
}

/**
 * Encodes raw RGBA8888 pixel bytes into a valid PNG byte buffer cleanly without requiring
 * DOM Canvas or `OffscreenCanvas` (works identically in Web Workers and Node/Vitest).
 */
export function rgbaToPngBytes(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const stride = w * 4 + 1;
  const rawScanlines = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    rawScanlines[y * stride] = 0; // filter None
    const srcOff = y * w * 4;
    const rowLen = Math.min(w * 4, Math.max(0, rgba.length - srcOff));
    if (rowLen > 0) {
      rawScanlines.set(rgba.subarray(srcOff, srcOff + rowLen), y * stride + 1);
    }
  }

  // Wrap raw scanlines in valid zlib stored-deflate blocks (max 65535 bytes/block)
  const MAX_BLK = 65535;
  const blockCount = Math.max(1, Math.ceil(rawScanlines.length / MAX_BLK));
  const zlibLen = 2 + rawScanlines.length + blockCount * 5 + 4;
  const zlib = new Uint8Array(zlibLen);
  let pos = 0;
  zlib[pos++] = 0x78;
  zlib[pos++] = 0x01;
  for (let offset = 0; offset < rawScanlines.length || offset === 0; offset += MAX_BLK) {
    const chunkLen = Math.min(MAX_BLK, rawScanlines.length - offset);
    const isFinal = offset + chunkLen >= rawScanlines.length ? 1 : 0;
    zlib[pos++] = isFinal;
    zlib[pos++] = chunkLen & 0xff;
    zlib[pos++] = (chunkLen >>> 8) & 0xff;
    const nlen = (~chunkLen) & 0xffff;
    zlib[pos++] = nlen & 0xff;
    zlib[pos++] = (nlen >>> 8) & 0xff;
    if (chunkLen > 0) {
      zlib.set(rawScanlines.subarray(offset, offset + chunkLen), pos);
      pos += chunkLen;
    }
    if (offset + chunkLen >= rawScanlines.length) break;
  }
  const adler = adler32(rawScanlines);
  new DataView(zlib.buffer).setUint32(pos, adler, false);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, w, false);
  ihdrView.setUint32(4, h, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', zlib);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const totalLen = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(totalLen);
  let p = 0;
  out.set(sig, p);
  p += sig.length;
  out.set(ihdrChunk, p);
  p += ihdrChunk.length;
  out.set(idatChunk, p);
  p += idatChunk.length;
  out.set(iendChunk, p);
  return out;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function rgbaToPngDataUrl(rgba: Uint8Array, width: number, height: number): string {
  const png = rgbaToPngBytes(rgba, width, height);
  return `data:image/png;base64,${uint8ToBase64(png)}`;
}
