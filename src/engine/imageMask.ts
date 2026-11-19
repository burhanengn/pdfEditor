import type {
  CanvasElement,
  ClipMaskSourceSnapshot,
  ImageAddElement,
  ImageClipMask,
  ImageReplacementElement,
  NormalizedCropRect,
  NormalizedPoint,
  RotateCopyPivot,
  ShapeReplacementElement,
  VectorPathElement,
  VectorShapeElement,
} from '@/types/elements';
import type { Point, RectBox } from '@/types/pdf';
import { pathPointsToSvgPath, shapeToSvgPath } from './vectorShapes';

export interface SvgPathCommand {
  cmd: 'M' | 'L' | 'Q' | 'C' | 'Z';
  nums: number[];
}

export type ImageMaskTargetElement = ImageAddElement | ImageReplacementElement;
export type VectorMaskCandidateElement =
  | VectorShapeElement
  | VectorPathElement
  | ShapeReplacementElement;

export interface ClippingCandidateMatch {
  mask: VectorMaskCandidateElement;
  image: ImageMaskTargetElement;
  overlapRatio: number;
  isOpenLineCut: boolean;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function normalizeAngle360(deg: number): number {
  const n = deg % 360;
  return n < 0 ? n + 360 : n;
}

export function elementLocalToPage(
  lx: number,
  ly: number,
  box: RectBox,
  rotationDeg: number,
): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const relX = lx - box.width / 2;
  const relY = ly - box.height / 2;
  if (Math.abs(rotationDeg % 360) < 1e-4) {
    return { x: cx + relX, y: cy + relY };
  }
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: cx + relX * cos - relY * sin,
    y: cy + relX * sin + relY * cos,
  };
}

export function pageToElementLocal(
  px: number,
  py: number,
  box: RectBox,
  rotationDeg: number,
): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = px - cx;
  const dy = py - cy;
  if (Math.abs(rotationDeg % 360) < 1e-4) {
    return { x: dx + box.width / 2, y: dy + box.height / 2 };
  }
  const rad = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: dx * cos - dy * sin + box.width / 2,
    y: dx * sin + dy * cos + box.height / 2,
  };
}

export function getElementPivotOnPage(
  el: Pick<CanvasElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  pivot: RotateCopyPivot,
): Point {
  switch (pivot) {
    case 'top-center':
      return elementLocalToPage(el.width / 2, 0, el, el.rotation);
    case 'bottom-center':
      return elementLocalToPage(el.width / 2, el.height, el, el.rotation);
    case 'left-center':
      return elementLocalToPage(0, el.height / 2, el, el.rotation);
    case 'right-center':
      return elementLocalToPage(el.width, el.height / 2, el, el.rotation);
    case 'center':
    default:
      return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
  }
}

export function rotateRectAroundPivot(
  rect: RectBox,
  rotationDeg: number,
  deltaDeg: number,
  pivotPt: Point,
): { x: number; y: number; rotation: number } {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = cx - pivotPt.x;
  const dy = cy - pivotPt.y;
  const nextCx = pivotPt.x + dx * cos - dy * sin;
  const nextCy = pivotPt.y + dx * sin + dy * cos;
  return {
    x: nextCx - rect.width / 2,
    y: nextCy - rect.height / 2,
    rotation: normalizeAngle360(rotationDeg + deltaDeg),
  };
}

export function parseSvgPathCommands(d: string): SvgPathCommand[] {
  const cmds: SvgPathCommand[] = [];
  const tokenRe = /([MLQCZ])\s*([^MLQCZ]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(d)) !== null) {
    const rawCmd = match[1].toUpperCase() as SvgPathCommand['cmd'];
    const rawArgs = match[2].trim();
    const nums = rawArgs
      ? rawArgs
          .split(/[\s,]+/)
          .map(Number)
          .filter((n) => !Number.isNaN(n))
      : [];
    cmds.push({ cmd: rawCmd, nums });
  }
  return cmds;
}

export function serializeSvgPathCommands(cmds: SvgPathCommand[], decimals = 4): string {
  return cmds
    .map((c) => {
      if (c.cmd === 'Z') return 'Z';
      return `${c.cmd} ${c.nums.map((n) => Number(n.toFixed(decimals))).join(' ')}`;
    })
    .join(' ');
}

export function transformSvgPath(
  d: string,
  mapPt: (x: number, y: number) => Point,
  decimals = 4,
): string {
  if (!d) return '';
  const cmds = parseSvgPathCommands(d);
  const out: SvgPathCommand[] = cmds.map((c) => {
    if (c.cmd === 'Z') return { cmd: 'Z', nums: [] };
    const mapped: number[] = [];
    for (let i = 0; i + 1 < c.nums.length; i += 2) {
      const pt = mapPt(c.nums[i], c.nums[i + 1]);
      mapped.push(pt.x, pt.y);
    }
    return { cmd: c.cmd, nums: mapped };
  });
  return serializeSvgPathCommands(out, decimals);
}

export function flipSvgPath(
  d: string,
  width: number,
  height: number,
  flipX?: boolean,
  flipY?: boolean,
  decimals = 4,
): string {
  if (!flipX && !flipY) return d;
  return transformSvgPath(
    d,
    (x, y) => ({
      x: flipX ? width - x : x,
      y: flipY ? height - y : y,
    }),
    decimals,
  );
}

export function scaleSvgPath(d: string, sx: number, sy: number, decimals = 2): string {
  if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) return d;
  return transformSvgPath(d, (x, y) => ({ x: x * sx, y: y * sy }), decimals);
}

export function getImageClipMaskSvgPath(
  clipMask: ImageClipMask | undefined,
  width: number,
  height: number,
): string {
  if (!clipMask?.unitSvgPath) return '';
  return scaleSvgPath(clipMask.unitSvgPath, Math.max(1, width), Math.max(1, height), 3);
}

/**
 * Computes axis-aligned bounds of any SVG `M/L/Q/C/Z` path by sampling curves.
 */
function flattenSvgPathToPolygon(d: string, curveSteps = 18): Point[] {
  const cmds = parseSvgPathCommands(d);
  const pts: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };

  for (const c of cmds) {
    if (c.cmd === 'M' && c.nums.length >= 2) {
      cur = { x: c.nums[0], y: c.nums[1] };
      start = cur;
      pts.push(cur);
      for (let i = 2; i + 1 < c.nums.length; i += 2) {
        cur = { x: c.nums[i], y: c.nums[i + 1] };
        pts.push(cur);
      }
    } else if (c.cmd === 'L') {
      for (let i = 0; i + 1 < c.nums.length; i += 2) {
        cur = { x: c.nums[i], y: c.nums[i + 1] };
        pts.push(cur);
      }
    } else if (c.cmd === 'Q') {
      for (let i = 0; i + 3 < c.nums.length; i += 4) {
        const cx = c.nums[i];
        const cy = c.nums[i + 1];
        const ex = c.nums[i + 2];
        const ey = c.nums[i + 3];
        const p0 = cur;
        for (let s = 1; s <= curveSteps; s++) {
          const t = s / curveSteps;
          const u = 1 - t;
          pts.push({
            x: u * u * p0.x + 2 * u * t * cx + t * t * ex,
            y: u * u * p0.y + 2 * u * t * cy + t * t * ey,
          });
        }
        cur = { x: ex, y: ey };
      }
    } else if (c.cmd === 'C') {
      for (let i = 0; i + 5 < c.nums.length; i += 6) {
        const c1x = c.nums[i];
        const c1y = c.nums[i + 1];
        const c2x = c.nums[i + 2];
        const c2y = c.nums[i + 3];
        const ex = c.nums[i + 4];
        const ey = c.nums[i + 5];
        const p0 = cur;
        for (let s = 1; s <= curveSteps; s++) {
          const t = s / curveSteps;
          const u = 1 - t;
          pts.push({
            x:
              u * u * u * p0.x +
              3 * u * u * t * c1x +
              3 * u * t * t * c2x +
              t * t * t * ex,
            y:
              u * u * u * p0.y +
              3 * u * u * t * c1y +
              3 * u * t * t * c2y +
              t * t * t * ey,
          });
        }
        cur = { x: ex, y: ey };
      }
    } else if (c.cmd === 'Z') {
      cur = start;
    }
  }
  return pts;
}

function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentIntersect(a: Point, b: Point, c: Point, d: Point): Point | null {
  const rX = b.x - a.x;
  const rY = b.y - a.y;
  const sX = d.x - c.x;
  const sY = d.y - c.y;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * sY - (c.y - a.y) * sX) / denom;
  const u = ((c.x - a.x) * rY - (c.y - a.y) * rX) / denom;
  if (t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) {
    return { x: a.x + clamp(t, 0, 1) * rX, y: a.y + clamp(t, 0, 1) * rY };
  }
  return null;
}

/**
 * Intersects a closed polygon/SVG path normalized to unit box with `[0..1] x [0..1]`
 * and returns the tight visible crop rectangle inside `[0..1] x [0..1]`.
 */
function computeVisibleUnitClipBbox(closedSvgPath: string): RectBox {
  const poly = flattenSvgPathToPolygon(closedSvgPath, 18);
  if (poly.length === 0) return { x: 0, y: 0, width: 1, height: 1 };

  const visiblePts: Point[] = [];
  for (const p of poly) {
    if (p.x >= -1e-5 && p.x <= 1 + 1e-5 && p.y >= -1e-5 && p.y <= 1 + 1e-5) {
      visiblePts.push({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) });
    }
  }

  const unitCorners: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  for (const corner of unitCorners) {
    if (pointInPolygon(corner, poly)) {
      visiblePts.push(corner);
    }
  }

  const unitEdges: Array<[Point, Point]> = [
    [unitCorners[0], unitCorners[1]],
    [unitCorners[1], unitCorners[2]],
    [unitCorners[2], unitCorners[3]],
    [unitCorners[3], unitCorners[0]],
  ];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (const [e0, e1] of unitEdges) {
      const hit = segmentIntersect(a, b, e0, e1);
      if (hit) {
        visiblePts.push({ x: clamp(hit.x, 0, 1), y: clamp(hit.y, 0, 1) });
      }
    }
  }

  if (visiblePts.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of visiblePts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const w = Math.max(0.02, maxX - minX);
  const h = Math.max(0.02, maxY - minY);
  const x = clamp(minX, 0, 1 - w);
  const y = clamp(minY, 0, 1 - h);
  return { x, y, width: w, height: h };
}

/**
 * Projects a point onto a huge outer square perimeter `[-L..1+L] x [-L..1+L]`
 * clockwise along 4 edges (`t` in `[0..4)`: 0=top, 1=right, 2=bottom, 3=left).
 */
const OUTER_MIN = -6;
const OUTER_MAX = 7;
const OUTER_SPAN = OUTER_MAX - OUTER_MIN;

function rayToOuterPerimeter(origin: Point, dir: Point): { pt: Point; param: number } {
  let dx = dir.x;
  let dy = dir.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    dx = -1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }

  let bestT = Infinity;
  let bestSide = 0;

  if (dy < -1e-6) {
    const t = (OUTER_MIN - origin.y) / dy;
    if (t > 0 && t < bestT) {
      bestT = t;
      bestSide = 0;
    }
  }
  if (dx > 1e-6) {
    const t = (OUTER_MAX - origin.x) / dx;
    if (t > 0 && t < bestT) {
      bestT = t;
      bestSide = 1;
    }
  }
  if (dy > 1e-6) {
    const t = (OUTER_MAX - origin.y) / dy;
    if (t > 0 && t < bestT) {
      bestT = t;
      bestSide = 2;
    }
  }
  if (dx < -1e-6) {
    const t = (OUTER_MIN - origin.x) / dx;
    if (t > 0 && t < bestT) {
      bestT = t;
      bestSide = 3;
    }
  }

  const hit: Point = {
    x: clamp(origin.x + dx * bestT, OUTER_MIN, OUTER_MAX),
    y: clamp(origin.y + dy * bestT, OUTER_MIN, OUTER_MAX),
  };

  let param = 0;
  if (bestSide === 0) param = (hit.x - OUTER_MIN) / OUTER_SPAN;
  else if (bestSide === 1) param = 1 + (hit.y - OUTER_MIN) / OUTER_SPAN;
  else if (bestSide === 2) param = 2 + (OUTER_MAX - hit.x) / OUTER_SPAN;
  else param = 3 + (OUTER_MAX - hit.y) / OUTER_SPAN;

  return { pt: hit, param };
}

function walkOuterPerimeterCorners(fromParam: number, toParam: number, side: 'a' | 'b'): Point[] {
  const outerCorners: Array<{ param: number; pt: Point }> = [
    { param: 0, pt: { x: OUTER_MIN, y: OUTER_MIN } },
    { param: 1, pt: { x: OUTER_MAX, y: OUTER_MIN } },
    { param: 2, pt: { x: OUTER_MAX, y: OUTER_MAX } },
    { param: 3, pt: { x: OUTER_MIN, y: OUTER_MAX } },
  ];

  const pts: Point[] = [];
  if (side === 'a') {
    // Clockwise perimeter sweep: ascending param mod 4
    let cur = fromParam;
    const target = toParam >= fromParam ? toParam : toParam + 4;
    for (let k = 0; k < 8; k++) {
      const nextCornerIdx = Math.floor(cur) + 1;
      if (nextCornerIdx >= target - 1e-6) break;
      const c = outerCorners[((nextCornerIdx % 4) + 4) % 4];
      pts.push(c.pt);
      cur = nextCornerIdx;
    }
  } else {
    // Counter-clockwise perimeter sweep: descending param mod 4
    let cur = fromParam;
    const target = toParam <= fromParam ? toParam : toParam - 4;
    for (let k = 0; k < 8; k++) {
      let nextCornerIdx = Math.ceil(cur) - 1;
      if (nextCornerIdx <= cur - 1 - 1e-6) nextCornerIdx = Math.ceil(cur - 1e-6) - 1;
      if (nextCornerIdx <= target + 1e-6) break;
      const c = outerCorners[((nextCornerIdx % 4) + 4) % 4];
      pts.push(c.pt);
      cur = nextCornerIdx;
    }
  }
  return pts;
}

/**
 * Slices a unit `[0..1] x [0..1]` box cleanly along an open straight/curved cut path
 * and returns the closed SVG path in `[0..1]` image coords + tight visible bounding box.
 */
function buildOpenCutClipRegion(
  openNormPts: NormalizedPoint[],
  smooth: boolean,
  side: 'a' | 'b',
): { fullClosedUnitPath: string; relCrop: RectBox } {
  const openD = pathPointsToSvgPath(openNormPts, 1, 1, false, smooth);
  const first = openNormPts[0];
  const second = openNormPts[1] ?? first;
  const last = openNormPts[openNormPts.length - 1];
  const prevLast = openNormPts[openNormPts.length - 2] ?? last;

  const startHit = rayToOuterPerimeter(first, {
    x: first.x - second.x,
    y: first.y - second.y,
  });
  const endHit = rayToOuterPerimeter(last, {
    x: last.x - prevLast.x,
    y: last.y - prevLast.y,
  });

  const perimeterCorners = walkOuterPerimeterCorners(endHit.param, startHit.param, side);
  const closingSegs = [
    `L ${endHit.pt.x.toFixed(4)} ${endHit.pt.y.toFixed(4)}`,
    ...perimeterCorners.map((c) => `L ${c.x.toFixed(4)} ${c.y.toFixed(4)}`),
    `L ${startHit.pt.x.toFixed(4)} ${startHit.pt.y.toFixed(4)}`,
    `L ${first.x.toFixed(4)} ${first.y.toFixed(4)}`,
    'Z',
  ];

  // Re-anchor openD so its stroke seamlessly continues around the perimeter loop
  const fullClosedUnitPath = `${openD} ${closingSegs.join(' ')}`;
  const relCrop = computeVisibleUnitClipBbox(fullClosedUnitPath);
  return { fullClosedUnitPath, relCrop };
}

/**
 * Applies a normalized `[0..1] x [0..1]` sub-crop rectangle (inside current element's screen box)
 * onto an image element, updating element bounds accurately under any rotation or flip.
 */
export function applyCropSubRectToElement(
  el: ImageMaskTargetElement,
  relCrop: RectBox,
  nextClipMask?: ImageClipMask | null,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  cropRect: NormalizedCropRect;
  clipMask?: ImageClipMask;
} {
  const rx0 = clamp(relCrop.x, 0, 0.98);
  const ry0 = clamp(relCrop.y, 0, 0.98);
  const rw = clamp(relCrop.width, 0.02, 1 - rx0);
  const rh = clamp(relCrop.height, 0.02, 1 - ry0);
  const rx1 = rx0 + rw;
  const ry1 = ry0 + rh;

  const oldCx = el.x + el.width / 2;
  const oldCy = el.y + el.height / 2;
  const localDx = ((rx0 + rx1) / 2 - 0.5) * el.width;
  const localDy = ((ry0 + ry1) / 2 - 0.5) * el.height;

  const rad = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const newCx = oldCx + (localDx * cos - localDy * sin);
  const newCy = oldCy + (localDx * sin + localDy * cos);

  const newW = rw * el.width;
  const newH = rh * el.height;
  const newX = newCx - newW / 2;
  const newY = newCy - newH / 2;

  const oldCrop = el.cropRect ?? { x: 0, y: 0, width: 1, height: 1 };
  const effX0 = el.flipX ? 1 - rx1 : rx0;
  const effX1 = el.flipX ? 1 - rx0 : rx1;
  const effY0 = el.flipY ? 1 - ry1 : ry0;
  const effY1 = el.flipY ? 1 - ry0 : ry1;

  const nextCrop: NormalizedCropRect = {
    x: oldCrop.x + effX0 * oldCrop.width,
    y: oldCrop.y + effY0 * oldCrop.height,
    width: (effX1 - effX0) * oldCrop.width,
    height: (effY1 - effY0) * oldCrop.height,
  };

  let resolvedClipMask: ImageClipMask | undefined;
  if (nextClipMask !== null) {
    if (nextClipMask) {
      resolvedClipMask = nextClipMask;
    } else if (el.clipMask?.unitSvgPath) {
      const gx0 = el.flipX ? 1 - rx1 : rx0;
      const gx1 = el.flipX ? 1 - rx0 : rx1;
      const gy0 = el.flipY ? 1 - ry1 : ry0;
      const gy1 = el.flipY ? 1 - ry0 : ry1;
      const gw = Math.max(0.02, gx1 - gx0);
      const gh = Math.max(0.02, gy1 - gy0);
      resolvedClipMask = {
        ...el.clipMask,
        unitSvgPath: transformSvgPath(
          el.clipMask.unitSvgPath,
          (u, v) => ({ x: (u - gx0) / gw, y: (v - gy0) / gh }),
          5,
        ),
      };
    }
  }

  return {
    x: newX,
    y: newY,
    width: newW,
    height: newH,
    cropRect: nextCrop,
    clipMask: resolvedClipMask,
  };
}

/**
 * Restores an image element's uncropped bounding box cleanly from `cropRect` while
 * preserving the cropped image's current alignment on the page.
 */
export function resetImageCropGeometry(el: ImageMaskTargetElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const crop = el.cropRect;
  if (!crop || (Math.abs(crop.width - 1) < 1e-4 && Math.abs(crop.height - 1) < 1e-4 && Math.abs(crop.x) < 1e-4 && Math.abs(crop.y) < 1e-4)) {
    return { x: el.x, y: el.y, width: el.width, height: el.height };
  }

  const origW = el.width / Math.max(0.02, crop.width);
  const origH = el.height / Math.max(0.02, crop.height);

  const scrCropCenterX = el.flipX
    ? 1 - (crop.x + crop.width / 2)
    : crop.x + crop.width / 2;
  const scrCropCenterY = el.flipY
    ? 1 - (crop.y + crop.height / 2)
    : crop.y + crop.height / 2;

  const localDeltaX = (scrCropCenterX - 0.5) * origW;
  const localDeltaY = (scrCropCenterY - 0.5) * origH;
  const rad = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const curCx = el.x + el.width / 2;
  const curCy = el.y + el.height / 2;
  const origCx = curCx - (localDeltaX * cos - localDeltaY * sin);
  const origCy = curCy - (localDeltaX * sin + localDeltaY * cos);

  return {
    x: origCx - origW / 2,
    y: origCy - origH / 2,
    width: origW,
    height: origH,
  };
}

function createMaskSourceSnapshot(
  maskEl: VectorMaskCandidateElement,
  imageEl: ImageMaskTargetElement,
): ClipMaskSourceSnapshot {
  const imageOrigin = { x: imageEl.x, y: imageEl.y };
  if (maskEl.kind === 'shape') {
    return {
      kind: 'shape',
      x: maskEl.x,
      y: maskEl.y,
      width: maskEl.width,
      height: maskEl.height,
      rotation: maskEl.rotation,
      opacity: maskEl.opacity,
      behindContent: maskEl.behindContent,
      shapeType: maskEl.shapeType,
      borderRadius: maskEl.borderRadius,
      fillColor: maskEl.fillColor,
      strokeColor: maskEl.strokeColor,
      strokeWidth: maskEl.strokeWidth,
      strokeDash: maskEl.strokeDash,
      flipX: maskEl.flipX,
      flipY: maskEl.flipY,
      imageOrigin,
    };
  }
  if (maskEl.kind === 'shape-replacement') {
    return {
      kind: 'shape-replacement',
      x: maskEl.x,
      y: maskEl.y,
      width: maskEl.width,
      height: maskEl.height,
      rotation: maskEl.rotation,
      opacity: maskEl.opacity,
      behindContent: maskEl.behindContent,
      fillColor: maskEl.fillColor,
      strokeColor: maskEl.strokeColor,
      strokeWidth: maskEl.strokeWidth,
      originalShapeId: maskEl.originalShapeId,
      originalRect: { ...maskEl.originalRect },
      originalStrokeWidth: maskEl.originalStrokeWidth,
      imageOrigin,
    };
  }
  return {
    kind: 'path',
    x: maskEl.x,
    y: maskEl.y,
    width: maskEl.width,
    height: maskEl.height,
    rotation: maskEl.rotation,
    opacity: maskEl.opacity,
    behindContent: maskEl.behindContent,
    fillColor: maskEl.fillColor,
    strokeColor: maskEl.strokeColor,
    strokeWidth: maskEl.strokeWidth,
    strokeDash: maskEl.strokeDash,
    points: maskEl.points.map((p) => ({ ...p })),
    closed: maskEl.closed,
    smooth: maskEl.smooth,
    imageOrigin,
  };
}

/**
 * Generates an Adobe Illustrator-style clipping mask patching an image element
 * using any overlapping vector shape, rounded rect, closed pen path, or open straight/curved line.
 */
export function buildClippingMaskFromElement(
  imageEl: ImageMaskTargetElement,
  maskEl: VectorMaskCandidateElement,
  openCutSide: 'a' | 'b' = 'a',
): {
  x: number;
  y: number;
  width: number;
  height: number;
  cropRect: NormalizedCropRect;
  clipMask: ImageClipMask;
} {
  const maskLocalToImgNorm = (mx: number, my: number): Point => {
    const flippedMx =
      maskEl.kind === 'shape' && maskEl.flipX ? maskEl.width - mx : mx;
    const flippedMy =
      maskEl.kind === 'shape' && maskEl.flipY ? maskEl.height - my : my;
    const pagePt = elementLocalToPage(flippedMx, flippedMy, maskEl, maskEl.rotation);
    const imgLocal = pageToElementLocal(pagePt.x, pagePt.y, imageEl, imageEl.rotation);
    return {
      x: imgLocal.x / Math.max(1, imageEl.width),
      y: imgLocal.y / Math.max(1, imageEl.height),
    };
  };

  let rawClosedUnitSvgPath = '';
  let relCrop: RectBox = { x: 0, y: 0, width: 1, height: 1 };
  let openCutPoints: NormalizedPoint[] | undefined;
  let openCutSmooth: boolean | undefined;

  if (maskEl.kind === 'path' && !maskEl.closed) {
    openCutPoints = maskEl.points.map((p) => ({
      ...maskLocalToImgNorm(p.x * maskEl.width, p.y * maskEl.height),
      ...(p.smooth !== undefined ? { smooth: p.smooth } : {}),
    }));
    openCutSmooth = Boolean(maskEl.smooth);
    const built = buildOpenCutClipRegion(openCutPoints, openCutSmooth, openCutSide);
    rawClosedUnitSvgPath = built.fullClosedUnitPath;
    relCrop = built.relCrop;
  } else {
    const rawMaskD =
      maskEl.kind === 'shape'
        ? shapeToSvgPath(maskEl.shapeType, maskEl.width, maskEl.height, maskEl.borderRadius ?? 0)
        : maskEl.kind === 'shape-replacement'
          ? shapeToSvgPath('rect', maskEl.width, maskEl.height, 0)
          : pathPointsToSvgPath(maskEl.points, maskEl.width, maskEl.height, true, maskEl.smooth);

    rawClosedUnitSvgPath = transformSvgPath(rawMaskD, maskLocalToImgNorm, 5);
    relCrop = computeVisibleUnitClipBbox(rawClosedUnitSvgPath);
  }

  // Remap SVG path from `[0..1]` current screen box into `relCrop`'s `[0..1]` local box,
  // then account for image flipX/flipY so <g transform="scale(flipX,flipY)"> matches screen pixels 1:1.
  const screenCroppedSvg = transformSvgPath(
    rawClosedUnitSvgPath,
    (u, v) => ({
      x: (u - relCrop.x) / Math.max(0.02, relCrop.width),
      y: (v - relCrop.y) / Math.max(0.02, relCrop.height),
    }),
    5,
  );
  const unitSvgPath = flipSvgPath(screenCroppedSvg, 1, 1, imageEl.flipX, imageEl.flipY, 5);

  const clipMask: ImageClipMask = {
    unitSvgPath,
    openCutPoints,
    openCutSmooth,
    openCutSide: openCutPoints ? openCutSide : undefined,
    sourceElement: createMaskSourceSnapshot(maskEl, imageEl),
  };

  const cropped = applyCropSubRectToElement(imageEl, relCrop, clipMask);
  return {
    x: cropped.x,
    y: cropped.y,
    width: cropped.width,
    height: cropped.height,
    cropRect: cropped.cropRect,
    clipMask,
  };
}

/**
 * Toggles which half of an open-line/curve clipping cut is kept ('a' <-> 'b').
 */
export function flipOpenCutMaskSide(imageEl: ImageMaskTargetElement): {
  x: number;
  y: number;
  width: number;
  height: number;
  cropRect: NormalizedCropRect;
  clipMask: ImageClipMask;
} | null {
  const mask = imageEl.clipMask;
  if (!mask?.openCutPoints || !mask.sourceElement) return null;

  const origGeom = resetImageCropGeometry(imageEl);
  const uncroppedImage: ImageMaskTargetElement = {
    ...imageEl,
    x: origGeom.x,
    y: origGeom.y,
    width: origGeom.width,
    height: origGeom.height,
    cropRect: undefined,
    clipMask: undefined,
  };

  const snap = mask.sourceElement;
  if (snap.kind !== 'path' || !snap.points) return null;
  const reconstructedMask: VectorPathElement = {
    id: 'tmp_mask',
    pageId: imageEl.pageId,
    kind: 'path',
    x: snap.x,
    y: snap.y,
    width: snap.width,
    height: snap.height,
    rotation: snap.rotation,
    opacity: snap.opacity,
    zIndex: imageEl.zIndex + 1,
    points: snap.points,
    closed: false,
    smooth: snap.smooth,
    fillColor: snap.fillColor,
    strokeColor: snap.strokeColor ?? '#1e3a8a',
    strokeWidth: snap.strokeWidth,
  };

  const nextSide: 'a' | 'b' = mask.openCutSide === 'a' ? 'b' : 'a';
  return buildClippingMaskFromElement(uncroppedImage, reconstructedMask, nextSide);
}

function getRotatedAabb(box: RectBox, rotationDeg: number): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  if (Math.abs(rotationDeg % 360) < 1e-4) {
    return { minX: box.x, maxX: box.x + box.width, minY: box.y, maxY: box.y + box.height };
  }
  const corners = [
    elementLocalToPage(0, 0, box, rotationDeg),
    elementLocalToPage(box.width, 0, box, rotationDeg),
    elementLocalToPage(box.width, box.height, box, rotationDeg),
    elementLocalToPage(0, box.height, box, rotationDeg),
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  return { minX, maxX, minY, maxY };
}

function computeOverlapScore(imageEl: ImageMaskTargetElement, maskEl: VectorMaskCandidateElement): number {
  const a = getRotatedAabb(imageEl, imageEl.rotation);
  const b = getRotatedAabb(maskEl, maskEl.rotation);

  const ix0 = Math.max(a.minX, b.minX);
  const iy0 = Math.max(a.minY, b.minY);
  const ix1 = Math.min(a.maxX, b.maxX);
  const iy1 = Math.min(a.maxY, b.maxY);

  // Also test center proximity / segment crossing for very thin open lines
  if (maskEl.kind === 'path' && !maskEl.closed && maskEl.points.length >= 2) {
    const linePts = maskEl.points.map((p) => {
      const pt = elementLocalToPage(p.x * maskEl.width, p.y * maskEl.height, maskEl, maskEl.rotation);
      return pageToElementLocal(pt.x, pt.y, imageEl, imageEl.rotation);
    });
    for (let i = 0; i < linePts.length - 1; i++) {
      const p0 = linePts[i];
      const p1 = linePts[i + 1];
      // Check sample points along segment inside image box
      for (let s = 0; s <= 12; s++) {
        const t = s / 12;
        const sx = p0.x + (p1.x - p0.x) * t;
        const sy = p0.y + (p1.y - p0.y) * t;
        if (sx >= -4 && sx <= imageEl.width + 4 && sy >= -4 && sy <= imageEl.height + 4) {
          return 0.75;
        }
      }
    }
  }

  if (ix1 <= ix0 || iy1 <= iy0) return 0;
  const interArea = (ix1 - ix0) * (iy1 - iy0);
  const minArea = Math.max(1, Math.min((a.maxX - a.minX) * (a.maxY - a.minY), (b.maxX - b.minX) * (b.maxY - b.minY)));
  return interArea / minArea;
}

export function isImageMaskTarget(el: CanvasElement): el is ImageMaskTargetElement {
  return (el.kind === 'image' || el.kind === 'image-replacement') && !(el.kind === 'image-replacement' && el.deleted);
}

export function isVectorMaskCandidate(el: CanvasElement): el is VectorMaskCandidateElement {
  return (
    el.kind === 'shape' ||
    el.kind === 'path' ||
    (el.kind === 'shape-replacement' && !el.deleted)
  );
}

/**
 * Finds all shapes/paths on the same page overlapping a given image element, sorted best match first.
 */
export function findOverlappingMasksForImage(
  imageEl: ImageMaskTargetElement,
  pageElements: CanvasElement[],
): ClippingCandidateMatch[] {
  const out: ClippingCandidateMatch[] = [];
  for (const el of pageElements) {
    if (el.id === imageEl.id || el.pageId !== imageEl.pageId) continue;
    if (!isVectorMaskCandidate(el)) continue;
    const score = computeOverlapScore(imageEl, el);
    if (score > 0.05) {
      out.push({
        mask: el,
        image: imageEl,
        overlapRatio: score,
        isOpenLineCut: el.kind === 'path' && !el.closed,
      });
    }
  }
  return out.sort((m, n) => n.overlapRatio - m.overlapRatio || n.mask.zIndex - m.mask.zIndex);
}

/**
 * Finds all image elements on the same page underneath or overlapping a given shape/path.
 */
export function findOverlappingImagesForMask(
  maskEl: VectorMaskCandidateElement,
  pageElements: CanvasElement[],
): ClippingCandidateMatch[] {
  const out: ClippingCandidateMatch[] = [];
  for (const el of pageElements) {
    if (el.id === maskEl.id || el.pageId !== maskEl.pageId) continue;
    if (!isImageMaskTarget(el)) continue;
    const score = computeOverlapScore(el, maskEl);
    if (score > 0.05) {
      out.push({
        mask: maskEl,
        image: el,
        overlapRatio: score,
        isOpenLineCut: maskEl.kind === 'path' && !maskEl.closed,
      });
    }
  }
  return out.sort((m, n) => n.overlapRatio - m.overlapRatio || n.image.zIndex - m.image.zIndex);
}
