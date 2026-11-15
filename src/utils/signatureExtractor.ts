export type SignatureExtractionMode = 'smart' | 'white' | 'none';

export interface SignatureExtractParams {
  /** Extraction strategy: 'smart' (shadow & paper adaptive), 'white' (simple white strip), 'none' */
  mode?: SignatureExtractionMode;
  /** 0..1 capture sensitivity (default 0.55; higher captures lighter pencil/ballpoint strokes) */
  sensitivity?: number;
  /** 'original' keeps natural pen color (de-matted); hex string recolors strokes cleanly */
  inkTintColor?: string | 'original';
  /** Trim empty transparent border with small safe padding (default true) */
  autoCrop?: boolean;
}

export interface ExtractedSignatureRgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) || 0,
      parseInt(clean[1] + clean[1], 16) || 0,
      parseInt(clean[2] + clean[2], 16) || 0,
    ];
  }
  const full = clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [15, 23, 42];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Separable 2D sliding-window morphological extrema ('max' = dilate, 'min' = erode) in O(W*H).
 * Closing (dilate -> erode) eliminates pen strokes while accurately tracking local paper shadows.
 */
function slidingWindowExtrema(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  mode: 'max' | 'min',
): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(width * height);
  const out = new Uint8ClampedArray(width * height);
  const qIdx = new Int32Array(Math.max(width, height));
  const shouldPop = mode === 'max'
    ? (tailVal: number, val: number) => tailVal <= val
    : (tailVal: number, val: number) => tailVal >= val;

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    let head = 0;
    let tail = 0;
    const primeEnd = Math.min(width - 1, radius - 1);
    for (let x = 0; x <= primeEnd; x++) {
      const val = src[rowOff + x];
      while (tail > head && shouldPop(src[rowOff + qIdx[tail - 1]], val)) tail--;
      qIdx[tail++] = x;
    }
    for (let x = 0; x < width; x++) {
      const addX = x + radius;
      if (addX < width) {
        const val = src[rowOff + addX];
        while (tail > head && shouldPop(src[rowOff + qIdx[tail - 1]], val)) tail--;
        qIdx[tail++] = addX;
      }
      if (qIdx[head] < x - radius) head++;
      tmp[rowOff + x] = src[rowOff + qIdx[head]];
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    let head = 0;
    let tail = 0;
    const primeEnd = Math.min(height - 1, radius - 1);
    for (let y = 0; y <= primeEnd; y++) {
      const val = tmp[y * width + x];
      while (tail > head && shouldPop(tmp[qIdx[tail - 1] * width + x], val)) tail--;
      qIdx[tail++] = y;
    }
    for (let y = 0; y < height; y++) {
      const addY = y + radius;
      if (addY < height) {
        const val = tmp[addY * width + x];
        while (tail > head && shouldPop(tmp[qIdx[tail - 1] * width + x], val)) tail--;
        qIdx[tail++] = addY;
      }
      if (qIdx[head] < y - radius) head++;
      out[y * width + x] = tmp[qIdx[head] * width + x];
    }
  }

  return out;
}

function estimatePaperChannel(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  dilRadius: number,
): Uint8ClampedArray {
  const dilated = slidingWindowExtrema(src, width, height, dilRadius, 'max');
  const erodeRadius = Math.max(3, Math.round(dilRadius * 0.8));
  const closed = slidingWindowExtrema(dilated, width, height, erodeRadius, 'min');
  const smoothRadius = Math.max(2, Math.round(dilRadius * 0.25));
  return boxBlurChannel(closed, width, height, smoothRadius);
}

/**
 * Separable sliding-sum box blur in O(W*H) to turn dilated background blocks
 * into a smooth continuous local paper-illumination surface.
 */
function boxBlurChannel(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return src;
  const tmp = new Float32Array(width * height);
  const out = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y++) {
    const off = y * width;
    let sum = 0;
    let count = 0;
    const initEnd = Math.min(width - 1, radius);
    for (let x = 0; x <= initEnd; x++) {
      sum += src[off + x];
      count++;
    }
    for (let x = 0; x < width; x++) {
      tmp[off + x] = sum / count;
      const removeX = x - radius;
      const addX = x + radius + 1;
      if (removeX >= 0) {
        sum -= src[off + removeX];
        count--;
      }
      if (addX < width) {
        sum += src[off + addX];
        count++;
      }
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    const initEnd = Math.min(height - 1, radius);
    for (let y = 0; y <= initEnd; y++) {
      sum += tmp[y * width + x];
      count++;
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = clampByte(sum / count);
      const removeY = y - radius;
      const addY = y + radius + 1;
      if (removeY >= 0) {
        sum -= tmp[removeY * width + x];
        count--;
      }
      if (addY < height) {
        sum += tmp[addY * width + x];
        count++;
      }
    }
  }

  return out;
}

function estimateAdaptiveNoiseFloorAndSplit(strengths: Float32Array, count: number): {
  noiseFloor: number;
  otsuSplit: number;
} {
  const bins = 256;
  const hist = new Int32Array(bins);
  let valid = 0;
  for (let i = 0; i < count; i++) {
    const s = strengths[i];
    if (s < 0) continue;
    const b = Math.max(0, Math.min(bins - 1, Math.round(s * 255)));
    hist[b]++;
    valid++;
  }
  if (valid === 0) return { noiseFloor: 0.08, otsuSplit: 0.25 };

  // Find background noise upper quantile (78th percentile & 90th percentile of pixels;
  // typically >=82% of a signature photo is blank/shaded paper)
  const p75Target = Math.floor(valid * 0.78);
  const p88Target = Math.floor(valid * 0.88);
  let cum = 0;
  let p78 = 0.06;
  let p88 = 0.12;
  for (let b = 0; b < bins; b++) {
    cum += hist[b];
    if (cum >= p75Target) {
      p78 = b / 255;
      break;
    }
  }
  cum = 0;
  for (let b = 0; b < bins; b++) {
    cum += hist[b];
    if (cum >= p88Target) {
      p88 = b / 255;
      break;
    }
  }

  // Otsu threshold maximizing between-class variance across the 256 ink-strength bins
  let totalWeight = 0;
  let totalMean = 0;
  for (let b = 0; b < bins; b++) {
    totalWeight += hist[b];
    totalMean += b * hist[b];
  }
  let wB = 0;
  let sumB = 0;
  let maxVar = -1;
  let bestFirst = 64;
  let bestLast = 64;
  for (let b = 0; b < bins; b++) {
    wB += hist[b];
    if (wB === 0) continue;
    const wF = totalWeight - wB;
    if (wF === 0) break;
    sumB += b * hist[b];
    const mB = sumB / wB;
    const mF = (totalMean - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar + 1e-6) {
      maxVar = between;
      bestFirst = b;
      bestLast = b;
    } else if (between >= maxVar - 1e-6) {
      bestLast = b;
    }
  }
  const bestBin = (bestFirst + bestLast) * 0.5;

  const noiseFloor = Math.max(0.05, Math.min(0.28, p78 + (p88 - p78) * 0.55));
  const otsuSplit = Math.max(noiseFloor + 0.06, Math.min(0.62, bestBin / 255));
  return { noiseFloor, otsuSplit };
}

/**
 * Trims empty transparent borders while keeping safe balanced padding.
 */
export function autoCropTransparentRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 14,
): ExtractedSignatureRgba {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      if (rgba[(rowOff + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { data: new Uint8ClampedArray(rgba), width, height };
  }

  const spanW = maxX - minX + 1;
  const spanH = maxY - minY + 1;
  const pad = Math.max(8, Math.min(24, Math.round(Math.max(spanW, spanH) * 0.04)));

  const cropX = Math.max(0, minX - pad);
  const cropY = Math.max(0, minY - pad);
  const cropEndX = Math.min(width - 1, maxX + pad);
  const cropEndY = Math.min(height - 1, maxY + pad);

  const outW = cropEndX - cropX + 1;
  const outH = cropEndY - cropY + 1;
  const out = new Uint8ClampedArray(outW * outH * 4);

  for (let y = 0; y < outH; y++) {
    const srcStart = ((cropY + y) * width + cropX) * 4;
    const dstStart = y * outW * 4;
    out.set(rgba.subarray(srcStart, srcStart + outW * 4), dstStart);
  }

  return { data: out, width: outW, height: outH };
}

/**
 * High-precision client-side signature extractor tuned for camera photos on paper,
 * uneven shadow gradients, colored ink (blue/black pen), and noisy compressed inputs.
 */
export function extractSignatureFromRgba(
  srcRgba: Uint8ClampedArray,
  width: number,
  height: number,
  params: SignatureExtractParams = {},
): ExtractedSignatureRgba {
  const mode = params.mode ?? 'smart';
  const sensitivity = Math.max(0.05, Math.min(0.98, params.sensitivity ?? 0.55));
  const inkTint = params.inkTintColor ?? 'original';
  const autoCrop = params.autoCrop ?? true;

  const total = width * height;
  const out = new Uint8ClampedArray(srcRgba);

  if (mode === 'none') {
    return { data: out, width, height };
  }

  if (mode === 'white') {
    for (let i = 0; i < out.length; i += 4) {
      const lum = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2];
      if (lum > 225) {
        out[i + 3] = 0;
      } else if (lum > 185) {
        out[i + 3] = Math.round(((225 - lum) / 40) * out[i + 3]);
      }
    }
    return autoCrop ? autoCropTransparentRgba(out, width, height) : { data: out, width, height };
  }

  // Split channels; treat pre-transparent pixels as white paper during background surface fit
  // so existing transparency never drags nearby opaque boundaries dark.
  const srcR = new Uint8ClampedArray(total);
  const srcG = new Uint8ClampedArray(total);
  const srcB = new Uint8ClampedArray(total);
  let transparentCount = 0;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (out[o + 3] < 40) {
      transparentCount++;
      srcR[i] = 255;
      srcG[i] = 255;
      srcB[i] = 255;
    } else {
      srcR[i] = out[o];
      srcG[i] = out[o + 1];
      srcB[i] = out[o + 2];
    }
  }

  const mostlyTransparentPng = transparentCount / Math.max(1, total) > 0.2;
  const [tintR, tintG, tintB] =
    inkTint !== 'original' ? parseHexRgb(inkTint) : [0, 0, 0];

  // If uploaded PNG is already a transparent cutout, preserve crisp existing cutout
  // and optionally re-ink & auto-crop cleanly without distorting alpha.
  if (mostlyTransparentPng) {
    if (inkTint !== 'original') {
      for (let i = 0; i < total; i++) {
        const o = i * 4;
        if (out[o + 3] > 0) {
          out[o] = tintR;
          out[o + 1] = tintG;
          out[o + 2] = tintB;
        }
      }
    }
    return autoCrop ? autoCropTransparentRgba(out, width, height) : { data: out, width, height };
  }

  // 1. Morphological closing + smoothing for local paper illumination (tracks shadows & paper tint)
  const dilRadius = Math.max(10, Math.min(40, Math.round(Math.max(width, height) * 0.042)));

  const paperR = estimatePaperChannel(srcR, width, height, dilRadius);
  const paperG = estimatePaperChannel(srcG, width, height, dilRadius);
  const paperB = estimatePaperChannel(srcB, width, height, dilRadius);

  // 2. Per-pixel reflectance absorption + channel contrast relative to local paper surface
  const strengths = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const r = srcR[i];
    const g = srcG[i];
    const b = srcB[i];
    const pr = Math.max(36, paperR[i]);
    const pg = Math.max(36, paperG[i]);
    const pb = Math.max(36, paperB[i]);

    const paperLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    const lumDrop = Math.max(0, paperLum - lum) / Math.max(36, paperLum);
    // Max-channel drop keeps saturated blue/red pen ink sharp even when luminance is moderate
    const dr = Math.max(0, pr - r) / pr;
    const dg = Math.max(0, pg - g) / pg;
    const db = Math.max(0, pb - b) / pb;
    const maxChanDrop = Math.max(dr, dg, db);

    const combined = 0.52 * lumDrop + 0.48 * maxChanDrop;
    strengths[i] = out[i * 4 + 3] < 40 ? -1 : combined;
  }

  // 3. Adaptive cutoff calibration combining paper grain floor, Otsu split, and user sensitivity
  const { noiseFloor, otsuSplit } = estimateAdaptiveNoiseFloorAndSplit(strengths, total);

  // Higher sensitivity shifts threshold down closer to noiseFloor; lower sensitivity demands stronger ink
  const sensBias = (0.55 - sensitivity) * 0.22;
  const baseCutoff = Math.max(
    noiseFloor + 0.015,
    Math.min(0.45, noiseFloor * 0.45 + otsuSplit * 0.55 + sensBias),
  );
  const lowCut = Math.max(0.04, baseCutoff * (0.85 - sensitivity * 0.25));
  const highCut = Math.max(lowCut + 0.1, Math.min(0.72, lowCut + 0.16 + (1 - sensitivity) * 0.18));
  const span = highCut - lowCut;

  const rawAlpha = new Uint8ClampedArray(total);
  const normT = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const s = strengths[i];
    if (s <= lowCut) {
      rawAlpha[i] = 0;
      continue;
    }
    const t = s >= highCut ? 1 : (s - lowCut) / span;
    // Smooth S-curve preserves delicate hairlines & anti-aliased borders
    const smoothT = t * t * (3 - 2 * t);
    const boostT = Math.min(1, Math.pow(smoothT, 0.82));
    normT[i] = boostT;
    rawAlpha[i] = clampByte(boostT * out[i * 4 + 3]);
  }

  // 4. Despeckle 1px isolated paper grain / JPEG artifacts (needs >= 1 neighbor in 3x3)
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOff + x;
      const a = rawAlpha[idx];
      if (a === 0) {
        out[idx * 4 + 3] = 0;
        continue;
      }

      let support = 0;
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(height - 1, y + 1);
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      for (let ny = y0; ny <= y1; ny++) {
        const nRow = ny * width;
        for (let nx = x0; nx <= x1; nx++) {
          if (nx === x && ny === y) continue;
          if (rawAlpha[nRow + nx] >= 28) {
            support++;
            if (support >= 2) break;
          }
        }
        if (support >= 2) break;
      }

      if (support === 0 || (support === 1 && a < 90)) {
        out[idx * 4 + 3] = 0;
        continue;
      }

      const o = idx * 4;
      out[o + 3] = a;

      if (inkTint !== 'original') {
        out[o] = tintR;
        out[o + 1] = tintG;
        out[o + 2] = tintB;
      } else {
        // Color un-premultiply against local paper color so semi-transparent borders
        // never carry ugly beige/gray paper fringes onto crisp PDF pages!
        const alphaFrac = Math.max(0.22, normT[idx]);
        const pr = paperR[idx];
        const pg = paperG[idx];
        const pb = paperB[idx];
        const inv = 1 - alphaFrac;
        out[o] = clampByte((srcR[idx] - inv * pr) / alphaFrac);
        out[o + 1] = clampByte((srcG[idx] - inv * pg) / alphaFrac);
        out[o + 2] = clampByte((srcB[idx] - inv * pb) / alphaFrac);
      }
    }
  }

  return autoCrop ? autoCropTransparentRgba(out, width, height) : { data: out, width, height };
}
