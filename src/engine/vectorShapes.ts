import type { NormalizedPoint, VectorShapeType, VectorStrokeDash } from '@/types/elements';
import type { Point, RectBox } from '@/types/pdf';

export type ShapePreset = VectorShapeType;
export type StrokeDashStyle = VectorStrokeDash;
export type PathToolMode = 'line' | 'pen';

const KAPPA = 0.5522847498;
const MIN_PATH_BOX_DIM = 12;

/**
 * Generates an SVG path string (`d` attribute) inside a `[0..width] x [0..height]` local coordinate box
 * using only `M`, `L`, `C`, `Q`, and `Z` commands so browser SVG `<path>` and `pdf-lib drawSvgPath` match 1:1.
 */
export function shapeToSvgPath(
  shapeType: ShapePreset,
  width: number,
  height: number,
  borderRadius = 0,
): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);

  switch (shapeType) {
    case 'rect': {
      const r = Math.max(0, Math.min(borderRadius, w / 2, h / 2));
      if (r <= 0.1) {
        return `M 0 0 L ${w.toFixed(2)} 0 L ${w.toFixed(2)} ${h.toFixed(2)} L 0 ${h.toFixed(2)} Z`;
      }
      const k = r * KAPPA;
      return [
        `M ${r.toFixed(2)} 0`,
        `L ${(w - r).toFixed(2)} 0`,
        `C ${(w - r + k).toFixed(2)} 0 ${w.toFixed(2)} ${(r - k).toFixed(2)} ${w.toFixed(2)} ${r.toFixed(2)}`,
        `L ${w.toFixed(2)} ${(h - r).toFixed(2)}`,
        `C ${w.toFixed(2)} ${(h - r + k).toFixed(2)} ${(w - r + k).toFixed(2)} ${h.toFixed(2)} ${(w - r).toFixed(2)} ${h.toFixed(2)}`,
        `L ${r.toFixed(2)} ${h.toFixed(2)}`,
        `C ${(r - k).toFixed(2)} ${h.toFixed(2)} 0 ${(h - r + k).toFixed(2)} 0 ${(h - r).toFixed(2)}`,
        `L 0 ${r.toFixed(2)}`,
        `C 0 ${(r - k).toFixed(2)} ${(r - k).toFixed(2)} 0 ${r.toFixed(2)} 0`,
        'Z',
      ].join(' ');
    }

    case 'ellipse': {
      const rx = w / 2;
      const ry = h / 2;
      const kx = rx * KAPPA;
      const ky = ry * KAPPA;
      return [
        `M ${rx.toFixed(2)} 0`,
        `C ${(rx + kx).toFixed(2)} 0 ${w.toFixed(2)} ${(ry - ky).toFixed(2)} ${w.toFixed(2)} ${ry.toFixed(2)}`,
        `C ${w.toFixed(2)} ${(ry + ky).toFixed(2)} ${(rx + kx).toFixed(2)} ${h.toFixed(2)} ${rx.toFixed(2)} ${h.toFixed(2)}`,
        `C ${(rx - kx).toFixed(2)} ${h.toFixed(2)} 0 ${(ry + ky).toFixed(2)} 0 ${ry.toFixed(2)}`,
        `C 0 ${(ry - ky).toFixed(2)} ${(rx - kx).toFixed(2)} 0 ${rx.toFixed(2)} 0`,
        'Z',
      ].join(' ');
    }

    case 'triangle': {
      return `M ${(w / 2).toFixed(2)} 0 L ${w.toFixed(2)} ${h.toFixed(2)} L 0 ${h.toFixed(2)} Z`;
    }

    case 'diamond': {
      return `M ${(w / 2).toFixed(2)} 0 L ${w.toFixed(2)} ${(h / 2).toFixed(2)} L ${(w / 2).toFixed(2)} ${h.toFixed(2)} L 0 ${(h / 2).toFixed(2)} Z`;
    }

    case 'arrow': {
      const shaftTop = (h * 0.3).toFixed(2);
      const shaftBot = (h * 0.7).toFixed(2);
      const neckX = (w * 0.62).toFixed(2);
      const midY = (h * 0.5).toFixed(2);
      return [
        `M 0 ${shaftTop}`,
        `L ${neckX} ${shaftTop}`,
        `L ${neckX} 0`,
        `L ${w.toFixed(2)} ${midY}`,
        `L ${neckX} ${h.toFixed(2)}`,
        `L ${neckX} ${shaftBot}`,
        `L 0 ${shaftBot}`,
        'Z',
      ].join(' ');
    }
  }
}

export function pointIsSmooth(pt: NormalizedPoint, globalSmooth: boolean): boolean {
  return pt.smooth ?? globalSmooth;
}

/**
 * Generates an SVG path string for a vector polyline/polygon/smooth path in `[0..width] x [0..height]`.
 */
export function pathPointsToSvgPath(
  points: NormalizedPoint[],
  width: number,
  height: number,
  closed: boolean,
  smooth = false,
): string {
  if (points.length === 0) return '';
  const abs = points.map((p) => ({
    x: p.x * Math.max(1, width),
    y: p.y * Math.max(1, height),
  }));

  if (abs.length === 1) {
    return `M ${abs[0].x.toFixed(2)} ${abs[0].y.toFixed(2)} L ${(abs[0].x + 0.5).toFixed(2)} ${(abs[0].y + 0.5).toFixed(2)}`;
  }

  const n = abs.length;
  const hasAnySmooth =
    n >= 3 &&
    (closed
      ? points.some((pt) => pointIsSmooth(pt, smooth))
      : points.slice(1, n - 1).some((pt) => pointIsSmooth(pt, smooth)));

  if (!hasAnySmooth) {
    const segs = [`M ${abs[0].x.toFixed(2)} ${abs[0].y.toFixed(2)}`];
    for (let i = 1; i < n; i++) {
      segs.push(`L ${abs[i].x.toFixed(2)} ${abs[i].y.toFixed(2)}`);
    }
    if (closed) segs.push('Z');
    return segs.join(' ');
  }

  const ptsClose = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;

  if (!closed) {
    let d = `M ${abs[0].x.toFixed(2)} ${abs[0].y.toFixed(2)}`;
    let cursor = abs[0];
    const firstSmooth = pointIsSmooth(points[0], smooth);
    for (let i = 1; i < n - 1; i++) {
      if (pointIsSmooth(points[i], smooth)) {
        const enter =
          i === 1 && firstSmooth
            ? abs[0]
            : { x: (abs[i - 1].x + abs[i].x) / 2, y: (abs[i - 1].y + abs[i].y) / 2 };
        const exit = { x: (abs[i].x + abs[i + 1].x) / 2, y: (abs[i].y + abs[i + 1].y) / 2 };
        if (!ptsClose(cursor, enter)) {
          d += ` L ${enter.x.toFixed(2)} ${enter.y.toFixed(2)}`;
        }
        d += ` Q ${abs[i].x.toFixed(2)} ${abs[i].y.toFixed(2)} ${exit.x.toFixed(2)} ${exit.y.toFixed(2)}`;
        cursor = exit;
      } else {
        if (!ptsClose(cursor, abs[i])) {
          d += ` L ${abs[i].x.toFixed(2)} ${abs[i].y.toFixed(2)}`;
        }
        cursor = abs[i];
      }
    }
    const last = abs[n - 1];
    if (!ptsClose(cursor, last)) {
      d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
    }
    return d;
  }

  const enter: Point[] = [];
  const exit: Point[] = [];
  const smoothFlags: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const prev = abs[(i + n - 1) % n];
    const curr = abs[i];
    const next = abs[(i + 1) % n];
    const sm = pointIsSmooth(points[i], smooth);
    smoothFlags.push(sm);
    if (sm) {
      enter.push({ x: (prev.x + curr.x) / 2, y: (prev.y + curr.y) / 2 });
      exit.push({ x: (curr.x + next.x) / 2, y: (curr.y + next.y) / 2 });
    } else {
      enter.push(curr);
      exit.push(curr);
    }
  }

  let d = `M ${enter[0].x.toFixed(2)} ${enter[0].y.toFixed(2)}`;
  let cursor = enter[0];
  for (let i = 0; i < n; i++) {
    if (smoothFlags[i]) {
      if (!ptsClose(cursor, enter[i])) {
        d += ` L ${enter[i].x.toFixed(2)} ${enter[i].y.toFixed(2)}`;
      }
      d += ` Q ${abs[i].x.toFixed(2)} ${abs[i].y.toFixed(2)} ${exit[i].x.toFixed(2)} ${exit[i].y.toFixed(2)}`;
      cursor = exit[i];
    } else {
      if (!ptsClose(cursor, abs[i])) {
        d += ` L ${abs[i].x.toFixed(2)} ${abs[i].y.toFixed(2)}`;
      }
      cursor = abs[i];
    }
    const nextI = (i + 1) % n;
    if (nextI !== 0 && !ptsClose(cursor, enter[nextI])) {
      d += ` L ${enter[nextI].x.toFixed(2)} ${enter[nextI].y.toFixed(2)}`;
      cursor = enter[nextI];
    }
  }
  if (!ptsClose(cursor, enter[0])) {
    d += ` L ${enter[0].x.toFixed(2)} ${enter[0].y.toFixed(2)}`;
  }
  d += ' Z';
  return d;
}

/**
 * Converts a dashed style enum into shared SVG / PDF stroke dash lengths in points.
 */
export function strokeDashToArray(
  dash: StrokeDashStyle | undefined,
  strokeWidth: number,
): number[] | undefined {
  const sw = Math.max(1, strokeWidth);
  if (dash === 'dashed') {
    return [Number(Math.max(4, sw * 3).toFixed(2)), Number(Math.max(3, sw * 2).toFixed(2))];
  }
  if (dash === 'dotted') {
    return [Number(sw.toFixed(2)), Number(Math.max(2.5, sw * 2).toFixed(2))];
  }
  return undefined;
}

/**
 * Converts absolute base-page coordinates into a padded bounding box (`>= 12pt` on each axis
 * so straight horizontal/vertical lines remain easy to select & rotate) + normalized `[0..1]` points.
 */
export type PathPoint = Point & { smooth?: boolean };

export function normalizeAbsolutePoints(absPoints: PathPoint[]): {
  rect: RectBox;
  points: NormalizedPoint[];
} {
  if (absPoints.length === 0) {
    return {
      rect: { x: 0, y: 0, width: MIN_PATH_BOX_DIM, height: MIN_PATH_BOX_DIM },
      points: [],
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of absPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const rawW = maxX - minX;
  const rawH = maxY - minY;
  const width = Math.max(MIN_PATH_BOX_DIM, rawW);
  const height = Math.max(MIN_PATH_BOX_DIM, rawH);
  const x = rawW < MIN_PATH_BOX_DIM ? (minX + maxX) / 2 - width / 2 : minX;
  const y = rawH < MIN_PATH_BOX_DIM ? (minY + maxY) / 2 - height / 2 : minY;

  const points: NormalizedPoint[] = absPoints.map((p) => ({
    x: (p.x - x) / width,
    y: (p.y - y) / height,
    ...(p.smooth !== undefined ? { smooth: p.smooth } : {}),
  }));

  return {
    rect: { x, y, width, height },
    points,
  };
}

/**
 * Resolves a vector path's normalized vertices into absolute base-page `(x, y)` coordinates,
 * accurately respecting any element `rotation` applied via the selection box.
 */
export function denormalizePathPoints(el: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  points: NormalizedPoint[];
}): PathPoint[] {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const rad = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hasRot = Math.abs(el.rotation % 360) > 1e-4;

  return el.points.map((p) => {
    const rawX = el.x + p.x * el.width;
    const rawY = el.y + p.y * el.height;
    const extra = p.smooth !== undefined ? { smooth: p.smooth } : {};
    if (!hasRot) return { x: rawX, y: rawY, ...extra };
    const dx = rawX - cx;
    const dy = rawY - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
      ...extra,
    };
  });
}

function dedupeAdjacentPoints(points: PathPoint[], threshold = 1.25): PathPoint[] {
  if (points.length <= 1) return points;
  const out: PathPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) >= threshold) {
      out.push(cur);
    } else if (cur.smooth !== undefined && prev.smooth === undefined) {
      out[out.length - 1] = { ...prev, smooth: cur.smooth };
    }
  }
  return out;
}

/**
 * Merges two polyline / line paths by connecting their closest pair of endpoints
 * (reversing either chain automatically so orientation flows cleanly head-to-tail).
 */
export function mergeTwoPointChains(chainA: PathPoint[], chainB: PathPoint[]): PathPoint[] {
  if (chainA.length === 0) return [...chainB];
  if (chainB.length === 0) return [...chainA];

  const aStart = chainA[0];
  const aEnd = chainA[chainA.length - 1];
  const bStart = chainB[0];
  const bEnd = chainB[chainB.length - 1];

  const candidates = [
    { dist: Math.hypot(aEnd.x - bStart.x, aEnd.y - bStart.y), revA: false, revB: false },
    { dist: Math.hypot(aEnd.x - bEnd.x, aEnd.y - bEnd.y), revA: false, revB: true },
    { dist: Math.hypot(aStart.x - bStart.x, aStart.y - bStart.y), revA: true, revB: false },
    { dist: Math.hypot(bEnd.x - aStart.x, bEnd.y - aStart.y), revA: false, revB: false, bFirst: true },
  ];

  candidates.sort((m, n) => m.dist - n.dist);
  const best = candidates[0];

  const partA = best.revA ? [...chainA].reverse() : [...chainA];
  const partB = best.revB ? [...chainB].reverse() : [...chainB];
  const combined = best.bFirst ? [...partB, ...partA] : [...partA, ...partB];
  return dedupeAdjacentPoints(combined, 1.5);
}

/**
 * Joins 2 or more open/closed point chains sequentially, always chaining the next
 * closest path onto the growing merged polyline so order of selection doesn't matter.
 */
export function mergeMultiplePointChains(chains: PathPoint[][]): PathPoint[] {
  const nonEmpty = chains.filter((c) => c.length > 0);
  if (nonEmpty.length === 0) return [];
  let acc = [...nonEmpty[0]];
  const remaining = nonEmpty.slice(1);

  while (remaining.length > 0) {
    const accStart = acc[0];
    const accEnd = acc[acc.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const cs = c[0];
      const ce = c[c.length - 1];
      const d = Math.min(
        Math.hypot(accEnd.x - cs.x, accEnd.y - cs.y),
        Math.hypot(accEnd.x - ce.x, accEnd.y - ce.y),
        Math.hypot(accStart.x - cs.x, accStart.y - cs.y),
        Math.hypot(accStart.x - ce.x, accStart.y - ce.y),
      );
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const [nextChain] = remaining.splice(bestIdx, 1);
    acc = mergeTwoPointChains(acc, nextChain);
  }

  return acc;
}

export interface OpenPathSnapHit {
  elementId: string;
  endpoint: 'start' | 'end';
  point: Point;
  distance: number;
}

/**
 * Finds the nearest start or end anchor of any unclosed `path` element on the page
 * within `snapRadiusPt` for magnetic line/path snapping and live endpoint joining.
 */
export function findNearestOpenPathEndpoint(
  cursorPt: Point,
  candidates: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    points: NormalizedPoint[];
    closed: boolean;
  }>,
  snapRadiusPt: number,
  excludeIds?: Set<string>,
): OpenPathSnapHit | null {
  let best: OpenPathSnapHit | null = null;

  for (const el of candidates) {
    if (el.closed || el.points.length < 2) continue;
    if (excludeIds && excludeIds.has(el.id)) continue;

    const abs = denormalizePathPoints(el);
    const startPt = abs[0];
    const endPt = abs[abs.length - 1];

    const dStart = Math.hypot(cursorPt.x - startPt.x, cursorPt.y - startPt.y);
    if (dStart <= snapRadiusPt && (!best || dStart < best.distance)) {
      best = { elementId: el.id, endpoint: 'start', point: startPt, distance: dStart };
    }

    const dEnd = Math.hypot(cursorPt.x - endPt.x, cursorPt.y - endPt.y);
    if (dEnd <= snapRadiusPt && (!best || dEnd < best.distance)) {
      best = { elementId: el.id, endpoint: 'end', point: endPt, distance: dEnd };
    }
  }

  return best;
}

/**
 * Locks a line segment end point to 0°, 45°, or 90° multiples when Shift is held.
 */
export function constrainSegmentAngle45(origin: Point, target: Point): Point {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-3) return target;
  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snappedAngle = Math.round(angle / step) * step;
  return {
    x: origin.x + Math.cos(snappedAngle) * dist,
    y: origin.y + Math.sin(snappedAngle) * dist,
  };
}

export function pointsToSmoothSvgPath(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): string {
  if (points.length === 0) return '';
  const abs = points.map((p) => ({
    x: p.x * width,
    y: p.y * height,
  }));
  if (abs.length === 1) {
    return `M ${abs[0].x.toFixed(2)} ${abs[0].y.toFixed(2)} L ${(abs[0].x + 0.1).toFixed(2)} ${(abs[0].y + 0.1).toFixed(2)}`;
  }
  if (abs.length === 2) {
    return `M ${abs[0].x.toFixed(2)} ${abs[0].y.toFixed(2)} L ${abs[1].x.toFixed(2)} ${abs[1].y.toFixed(2)}`;
  }
  let d = `M ${abs[0].x.toFixed(2)} ${abs[0].y.toFixed(2)}`;
  for (let i = 1; i < abs.length - 1; i++) {
    const midX = (abs[i].x + abs[i + 1].x) / 2;
    const midY = (abs[i].y + abs[i + 1].y) / 2;
    d += ` Q ${abs[i].x.toFixed(2)} ${abs[i].y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
  }
  const last = abs[abs.length - 1];
  d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return d;
}
