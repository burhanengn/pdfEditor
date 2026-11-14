import type { SignatureVectorPath } from '@/types/elements';

export interface InkTimedPoint {
  x: number;
  y: number;
  t?: number;
  pressure?: number;
}

export interface RealisticInkStroke {
  points: InkTimedPoint[];
  color?: string;
}

export const ARCHIVAL_INK_PRESETS = [
  { id: 'blue-black', label: 'Archival Blue-Black', color: '#0f2b5b' },
  { id: 'midnight', label: 'Deep Fountain Ink', color: '#1a1a2e' },
  { id: 'carbon', label: 'Classic Carbon Black', color: '#111827' },
  { id: 'notary-red', label: 'Notary Crimson', color: '#7f1d1d' },
] as const;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return [
      Number.parseInt(clean[0] + clean[0], 16) || 0,
      Number.parseInt(clean[1] + clean[1], 16) || 0,
      Number.parseInt(clean[2] + clean[2], 16) || 0,
    ];
  }
  return [
    Number.parseInt(clean.slice(0, 2), 16) || 0,
    Number.parseInt(clean.slice(2, 4), 16) || 0,
    Number.parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

function rgbToRgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/**
 * Deterministic fast hash in [-1, 1] so capillary feathering never flickers between redraws.
 */
function deterministicJitter(seedA: number, seedB: number): number {
  const raw = Math.sin(seedA * 12.9898 + seedB * 78.233) * 43758.5453;
  return (raw - Math.floor(raw)) * 2 - 1;
}

function getInkTonalColors(baseColor: string): {
  core: [number, number, number];
  halo: [number, number, number];
} {
  const baseRgb = hexToRgb(baseColor);
  const core: [number, number, number] = [
    Math.max(0, Math.round(baseRgb[0] * 0.86)),
    Math.max(0, Math.round(baseRgb[1] * 0.88)),
    Math.max(0, Math.round(baseRgb[2] * 0.96)),
  ];
  const halo: [number, number, number] = [
    Math.min(255, Math.round(baseRgb[0] + 18)),
    Math.min(255, Math.round(baseRgb[1] + 24)),
    Math.min(255, Math.round(baseRgb[2] + 42)),
  ];
  return { core, halo };
}

interface ComputedSegmentSample {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w0: number;
  w1: number;
  jitterX: number;
  jitterY: number;
}

function computeStrokeSegments(
  points: InkTimedPoint[],
  baseWidth: number,
  strokeSeed: number,
): ComputedSegmentSample[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    return [
      {
        x0: points[0].x,
        y0: points[0].y,
        x1: points[0].x + 0.15,
        y1: points[0].y + 0.15,
        w0: baseWidth * 1.15,
        w1: baseWidth * 1.15,
        jitterX: 0,
        jitterY: 0,
      },
    ];
  }

  const widths: number[] = new Array(points.length).fill(baseWidth);
  const totalPts = points.length;
  let smoothedW = baseWidth * 1.12;

  for (let i = 0; i < totalPts; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
    const dt =
      i === 0
        ? 16
        : Math.max(2, (p.t ?? i * 14) - (prev.t ?? (i - 1) * 14));
    const velocity = dist / dt; // px per ms

    // Velocity-sensitive fountain pen width: slower dwell -> thicker wet deposit, fast flick -> sharp taper
    const velocityFactor = 1.32 - Math.min(0.76, Math.pow(velocity, 0.72) * 0.34);

    // Fountain pen nib angle anisotropy (~35 deg): downstrokes slightly richer than sideways hairlines
    const angle = i > 0 ? Math.atan2(p.y - prev.y, p.x - prev.x) : 0.6;
    const nibAngleFactor = 0.88 + 0.24 * Math.abs(Math.sin(angle - 0.45));

    // Entry/exit taper on pen contact & liftoff
    const progress = totalPts > 1 ? i / (totalPts - 1) : 0.5;
    const endTaper =
      progress > 0.88 ? 1 - ((progress - 0.88) / 0.12) * 0.42 : 1;

    const pressure = typeof p.pressure === 'number' && p.pressure > 0 ? 0.65 + p.pressure * 0.7 : 1;
    const targetW = Math.max(
      0.45,
      baseWidth * velocityFactor * nibAngleFactor * endTaper * pressure,
    );
    smoothedW = smoothedW * 0.62 + targetW * 0.38;
    widths[i] = smoothedW;
  }

  const out: ComputedSegmentSample[] = [];
  for (let i = 1; i < totalPts; i++) {
    const jx = deterministicJitter(strokeSeed + i, 1) * Math.min(0.42, baseWidth * 0.12);
    const jy = deterministicJitter(strokeSeed + i, 2) * Math.min(0.42, baseWidth * 0.12);
    out.push({
      x0: points[i - 1].x,
      y0: points[i - 1].y,
      x1: points[i].x,
      y1: points[i].y,
      w0: widths[i - 1],
      w1: widths[i],
      jitterX: jx,
      jitterY: jy,
    });
  }
  return out;
}

/**
 * Renders wet fountain-pen ink onto a 2D canvas with velocity-sensitive stroke width,
 * start/end ink pooling, micro-jitter feathering, and archival blue-black ink tonal layering.
 */
export function renderRealisticInkToCanvas(
  ctx: CanvasRenderingContext2D,
  strokes: RealisticInkStroke[],
  baseWidth: number,
  defaultColor: string,
): void {
  for (let sIdx = 0; sIdx < strokes.length; sIdx++) {
    const stroke = strokes[sIdx];
    const pts = stroke.points;
    if (pts.length === 0) continue;

    const strokeColor = stroke.color || defaultColor;
    const { core, halo } = getInkTonalColors(strokeColor);
    const segs = computeStrokeSegments(pts, baseWidth, sIdx * 97 + 13);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. Subtle outer capillary feathering halo (simulates ink soaking into paper fibers)
    ctx.strokeStyle = rgbToRgba(halo, 0.18);
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      ctx.lineWidth = ((seg.w0 + seg.w1) * 0.5) * 1.38;
      ctx.beginPath();
      ctx.moveTo(seg.x0 + seg.jitterX, seg.y0 + seg.jitterY);
      ctx.lineTo(seg.x1 + seg.jitterX, seg.y1 + seg.jitterY);
      ctx.stroke();
    }

    // 2. Main variable-width body pass (interpolated quad-ribbon per segment for smooth taper)
    ctx.fillStyle = rgbToRgba(core, 0.92);
    ctx.strokeStyle = rgbToRgba(core, 0.88);
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const steps = Math.max(1, Math.min(6, Math.ceil(Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0) / 3)));
      for (let st = 0; st < steps; st++) {
        const t0 = st / steps;
        const t1 = (st + 1) / steps;
        const ax = seg.x0 + (seg.x1 - seg.x0) * t0;
        const ay = seg.y0 + (seg.y1 - seg.y0) * t0;
        const bx = seg.x0 + (seg.x1 - seg.x0) * t1;
        const by = seg.y0 + (seg.y1 - seg.y0) * t1;
        const w = seg.w0 + (seg.w1 - seg.w0) * ((t0 + t1) * 0.5);

        ctx.lineWidth = Math.max(0.55, w);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    // 3. Saturated wet-ink core spline
    ctx.strokeStyle = rgbToRgba(core, 0.96);
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      ctx.lineWidth = Math.max(0.45, ((seg.w0 + seg.w1) * 0.5) * 0.62);
      ctx.beginPath();
      ctx.moveTo(seg.x0, seg.y0);
      ctx.lineTo(seg.x1, seg.y1);
      ctx.stroke();
    }

    // 4. Start & end nib pooling deposits (slightly larger dark ink bead where nib lands/lifts)
    const first = pts[0];
    const last = pts[pts.length - 1];
    const startRadius = Math.max(0.8, (segs[0]?.w0 ?? baseWidth) * 0.64);
    const endRadius = Math.max(0.7, (segs[segs.length - 1]?.w1 ?? baseWidth) * 0.56);

    ctx.fillStyle = rgbToRgba(halo, 0.24);
    ctx.beginPath();
    ctx.arc(first.x, first.y, startRadius * 1.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgbToRgba(core, 0.96);
    ctx.beginPath();
    ctx.arc(first.x, first.y, startRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgbToRgba(core, 0.92);
    ctx.beginPath();
    ctx.arc(last.x, last.y, endRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

/**
 * Generates high-DPI transparent PNG bytes/dataUrl for a realistic ink drawn signature.
 */
export function generateRealisticInkPng(
  strokes: RealisticInkStroke[],
  baseWidth: number,
  defaultColor: string,
  logicalWidth: number,
  logicalHeight: number,
  dpr = 2,
): { dataUrl: string; width: number; height: number } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(logicalWidth * dpr));
  canvas.height = Math.max(1, Math.round(logicalHeight * dpr));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, logicalWidth, logicalHeight);
  renderRealisticInkToCanvas(ctx, strokes, baseWidth, defaultColor);
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: logicalWidth,
    height: logicalHeight,
  };
}

/**
 * Applies subtle organic capillary bleed & ink density variation to rasterized
 * typed or uploaded signatures when "Orijinal Görünümlü" mode is enabled.
 */
export function applyOrganicInkFilterToDataUrl(
  sourceDataUrl: string,
  inkTintColor: string,
  width: number,
  height: number,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sourceDataUrl);
        return;
      }

      // Layer 1: Soft capillary feathering halo under crisp signature
      ctx.save();
      ctx.filter = 'blur(0.65px)';
      ctx.globalAlpha = 0.28;
      ctx.drawImage(img, 0, 0, width, height);
      ctx.restore();

      // Layer 2: Crisp core shifted by sub-pixel organic jitter
      ctx.save();
      ctx.globalAlpha = 0.94;
      ctx.drawImage(img, 0, 0, width, height);
      ctx.restore();

      // Subtle paper fiber texture modulation on alpha channel
      try {
        const imgData = ctx.getImageData(0, 0, width, height);
        const d = imgData.data;
        const [tr, tg, tb] = hexToRgb(inkTintColor);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const alpha = d[idx + 3];
            if (alpha > 8) {
              const fiber = deterministicJitter(x * 0.7, y * 0.7);
              const density = 0.92 + fiber * 0.08;
              d[idx] = Math.round(d[idx] * 0.85 + tr * 0.15);
              d[idx + 1] = Math.round(d[idx + 1] * 0.85 + tg * 0.15);
              d[idx + 2] = Math.round(d[idx + 2] * 0.85 + tb * 0.15);
              d[idx + 3] = Math.max(0, Math.min(255, Math.round(alpha * density)));
            }
          }
        }
        ctx.putImageData(imgData, 0, 0);
      } catch {
        // Ignore security/readback fallback
      }

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(sourceDataUrl);
    img.src = sourceDataUrl;
  });
}

/**
 * Generates vector SVG paths (outer bleed halo + variable-width tapered stroke segments)
 * for lightweight vector inspection & vault thumbnails alongside high-DPI PNG data.
 */
export function buildRealisticInkVectorPaths(
  strokes: RealisticInkStroke[],
  baseWidth: number,
  defaultColor: string,
): SignatureVectorPath[] {
  const paths: SignatureVectorPath[] = [];
  for (let sIdx = 0; sIdx < strokes.length; sIdx++) {
    const stroke = strokes[sIdx];
    const pts = stroke.points;
    if (pts.length === 0) continue;
    const color = stroke.color || defaultColor;
    const segs = computeStrokeSegments(pts, baseWidth, sIdx * 97 + 13);

    // Full path feather halo
    const fullD =
      pts.length === 1
        ? `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)} l 0.1 0.1`
        : `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}`;
    paths.push({
      d: fullD,
      strokeWidth: Number((baseWidth * 1.32).toFixed(2)),
      color,
      opacity: 0.16,
    });

    for (const seg of segs) {
      paths.push({
        d: `M ${seg.x0.toFixed(2)} ${seg.y0.toFixed(2)} L ${seg.x1.toFixed(2)} ${seg.y1.toFixed(2)}`,
        strokeWidth: Number(((seg.w0 + seg.w1) * 0.5).toFixed(2)),
        color,
        opacity: 0.94,
      });
    }
  }
  return paths;
}
