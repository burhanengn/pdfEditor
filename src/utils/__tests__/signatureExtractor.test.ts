import { describe, expect, it } from 'vitest';
import {
  autoCropTransparentRgba,
  extractSignatureFromRgba,
} from '../signatureExtractor';

function drawThickSegment(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  ink: [number, number, number],
  darkenInShadow = false,
) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const px = Math.round(cx + dx);
        const py = Math.round(cy + dy);
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        const o = (py * width + px) * 4;
        if (darkenInShadow) {
          // Attenuate stroke slightly proportional to local paper illumination (like real ink photo)
          const factor = rgba[o] / 255;
          rgba[o] = Math.round(ink[0] * factor);
          rgba[o + 1] = Math.round(ink[1] * factor);
          rgba[o + 2] = Math.round(ink[2] * factor);
        } else {
          rgba[o] = ink[0];
          rgba[o + 1] = ink[1];
          rgba[o + 2] = ink[2];
        }
        rgba[o + 3] = 255;
      }
    }
  }
}

describe('extractSignatureFromRgba', () => {
  it('removes heavily shadowed & warm-tinted paper while preserving ink across both light and dark halves', () => {
    const width = 260;
    const height = 140;
    const src = new Uint8ClampedArray(width * height * 4);

    // Left half bright cream paper (~244 lum), transitioning to deep hand shadow (~112 lum) on right half
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = Math.max(0, Math.min(1, (x - 85) / 60));
        const illum = 1 - t * 0.54; // 1.0 -> 0.46
        const idx = (y * width + x) * 4;
        src[idx] = Math.round(248 * illum);
        src[idx + 1] = Math.round(238 * illum);
        src[idx + 2] = Math.round(218 * illum);
        src[idx + 3] = 255;
      }
    }

    // Draw signature crossing from bright region (x=30) all the way into deep shadow (x=220)
    drawThickSegment(src, width, height, 30, 85, 115, 45, 2, [28, 32, 42], true);
    drawThickSegment(src, width, height, 115, 45, 225, 82, 2, [28, 32, 42], true);

    // Simple white threshold fails completely on the shadow side
    const whiteOnly = extractSignatureFromRgba(src, width, height, {
      mode: 'white',
      autoCrop: false,
    });
    const whiteShadowBgAlpha = whiteOnly.data[(15 * width + 220) * 4 + 3];
    expect(whiteShadowBgAlpha).toBeGreaterThan(200);

    // Smart extractor cleans BOTH bright and deeply shadowed paper while capturing all strokes
    const smart = extractSignatureFromRgba(src, width, height, {
      mode: 'smart',
      sensitivity: 0.55,
      autoCrop: false,
    });

    // Empty corners/paper across bright, transition, and shadow halves must be transparent
    for (const [bx, by] of [
      [15, 15],
      [115, 120],
      [230, 20],
      [230, 125],
    ]) {
      expect(smart.data[(by * width + bx) * 4 + 3]).toBe(0);
    }

    // Ink strokes in bright half (x=65, y=68) and deep shadow half (x=190, y=70) stay crisp & opaque
    const brightStrokeIdx = (68 * width + 65) * 4;
    const shadowStrokeIdx = (70 * width + 190) * 4;
    expect(smart.data[brightStrokeIdx + 3]).toBeGreaterThan(190);
    expect(smart.data[shadowStrokeIdx + 3]).toBeGreaterThan(190);
  });

  it('preserves colored blue ballpoint ink on yellow-ish paper and removes 1px paper noise speckles', () => {
    const width = 200;
    const height = 110;
    const src = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        src[idx] = 242;
        src[idx + 1] = 230;
        src[idx + 2] = 198;
        src[idx + 3] = 255;
      }
    }

    // Isolated 1px paper dust / JPEG compression dots far from strokes
    const dustCoords = [
      [12, 14],
      [182, 18],
      [25, 92],
      [175, 95],
    ];
    for (const [dx, dy] of dustCoords) {
      const idx = (dy * width + dx) * 4;
      src[idx] = 155;
      src[idx + 1] = 148;
      src[idx + 2] = 130;
    }

    // Blue pen signature
    drawThickSegment(src, width, height, 40, 62, 158, 48, 2, [26, 66, 198], false);

    const extracted = extractSignatureFromRgba(src, width, height, {
      mode: 'smart',
      sensitivity: 0.6,
      inkTintColor: 'original',
      autoCrop: false,
    });

    // Despeckler eliminates isolated 1px dots
    for (const [dx, dy] of dustCoords) {
      expect(extracted.data[(dy * width + dx) * 4 + 3]).toBe(0);
    }

    // Blue pen center stays visibly blue & well above alpha 190
    const inkIdx = (55 * width + 100) * 4;
    expect(extracted.data[inkIdx + 3]).toBeGreaterThan(190);
    expect(extracted.data[inkIdx + 2]).toBeGreaterThan(extracted.data[inkIdx] + 80);
  });

  it('recolors extracted signature when inkTintColor is set and crops borders automatically', () => {
    const width = 240;
    const height = 160;
    const src = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      src[o] = 245;
      src[o + 1] = 244;
      src[o + 2] = 240;
      src[o + 3] = 255;
    }

    // Small signature in center (~60x26 area)
    drawThickSegment(src, width, height, 95, 72, 145, 88, 2, [35, 35, 35], false);

    const cropped = extractSignatureFromRgba(src, width, height, {
      mode: 'smart',
      inkTintColor: '#1e3a8a',
      autoCrop: true,
    });

    expect(cropped.width).toBeLessThan(110);
    expect(cropped.height).toBeLessThan(70);

    // Find at least one opaque pixel and confirm exact archival blue RGB (30, 58, 138)
    let foundOpaque = false;
    for (let i = 0; i < cropped.width * cropped.height; i++) {
      const o = i * 4;
      if (cropped.data[o + 3] > 180) {
        foundOpaque = true;
        expect(cropped.data[o]).toBe(30);
        expect(cropped.data[o + 1]).toBe(58);
        expect(cropped.data[o + 2]).toBe(138);
      }
    }
    expect(foundOpaque).toBe(true);
  });

  it('preserves already-transparent PNG cutouts cleanly and crops padding', () => {
    const width = 180;
    const height = 100;
    const src = new Uint8ClampedArray(width * height * 4); // already alpha = 0

    drawThickSegment(src, width, height, 55, 50, 125, 50, 2, [15, 23, 42], false);

    const out = extractSignatureFromRgba(src, width, height, {
      mode: 'smart',
      inkTintColor: '#7f1d1d',
      autoCrop: true,
    });

    expect(out.width).toBeLessThan(120);
    expect(out.height).toBeLessThan(55);

    const midIdx = (Math.floor(out.height / 2) * out.width + Math.floor(out.width / 2)) * 4;
    expect(out.data[midIdx + 3]).toBe(255);
    expect(out.data[midIdx]).toBe(127);
    expect(out.data[midIdx + 1]).toBe(29);
    expect(out.data[midIdx + 2]).toBe(29);
  });

  it('handles sharp desk-lamp step shadows across blank paper without false shadow halo edges', () => {
    const width = 240;
    const height = 140;
    const src = new Uint8ClampedArray(width * height * 4);

    // Sharp shadow step from bright (242,239,232) to deep shadow (115,112,108) across 4px at x=120
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = Math.max(0, Math.min(1, (x - 118) / 4));
        const idx = (y * width + x) * 4;
        src[idx] = Math.round(242 * (1 - t) + 115 * t);
        src[idx + 1] = Math.round(239 * (1 - t) + 112 * t);
        src[idx + 2] = Math.round(232 * (1 - t) + 108 * t);
        src[idx + 3] = 255;
      }
    }

    drawThickSegment(src, width, height, 40, 75, 195, 65, 2, [20, 22, 26], true);

    const extracted = extractSignatureFromRgba(src, width, height, {
      mode: 'smart',
      sensitivity: 0.55,
      autoCrop: false,
    });

    // Empty pixels right near and along the sharp shadow transition (y=15 and y=125) must remain 0 alpha
    for (let x = 10; x < width - 10; x += 6) {
      expect(extracted.data[(15 * width + x) * 4 + 3]).toBe(0);
      expect(extracted.data[(125 * width + x) * 4 + 3]).toBe(0);
    }

    // Ink strokes on both sides of the sharp shadow cliff stay intact
    expect(extracted.data[(73 * width + 65) * 4 + 3]).toBeGreaterThan(190);
    expect(extracted.data[(67 * width + 170) * 4 + 3]).toBeGreaterThan(190);
  });

  it('autoCropTransparentRgba leaves blank transparent buffers unchanged', () => {
    const empty = new Uint8ClampedArray(40 * 30 * 4);
    const res = autoCropTransparentRgba(empty, 40, 30);
    expect(res.width).toBe(40);
    expect(res.height).toBe(30);
  });
});
