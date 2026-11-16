import type { PageMeta } from '@/types/pdf';
import { getDisplayDimensions, VIEWPORT_PAGE_GAP, type ViewportSurfaceMetrics } from './coordinates';

export interface PageOffsetIndex {
  count: number;
  rowTops: Float64Array;
  rowHeights: Float64Array;
  rowLefts: Float64Array;
  pageWidths: Float64Array;
  pageHeights: Float64Array;
  totalHeight: number;
}

/**
 * O(N) precomputation + O(log N) binary search page layout index (01 §6.3).
 * Replaces per-frame Array.reduce() during virtualized scroll & pinch anchor tracking.
 */
export function buildPageOffsetIndex(
  pages: PageMeta[],
  zoom: number,
  metrics: ViewportSurfaceMetrics,
): PageOffsetIndex {
  const count = pages.length;
  const rowTops = new Float64Array(count);
  const rowHeights = new Float64Array(count);
  const rowLefts = new Float64Array(count);
  const pageWidths = new Float64Array(count);
  const pageHeights = new Float64Array(count);

  let y = metrics.viewportMarginY;
  for (let i = 0; i < count; i++) {
    const p = pages[i];
    const dims = getDisplayDimensions(p.baseWidth, p.baseHeight, p.userRotation, zoom);
    const rowH = dims.height + VIEWPORT_PAGE_GAP;
    rowTops[i] = y;
    rowHeights[i] = rowH;
    pageWidths[i] = dims.width;
    pageHeights[i] = dims.height;
    rowLefts[i] = Math.max(metrics.viewportMarginX, (metrics.surfaceWidth - dims.width) / 2);
    y += rowH;
  }

  return {
    count,
    rowTops,
    rowHeights,
    rowLefts,
    pageWidths,
    pageHeights,
    totalHeight: y + metrics.viewportMarginY,
  };
}

/**
 * Binary-search page lookup for any surface Y coordinate in O(log N).
 */
export function findPageIndexAtSurfaceY(index: PageOffsetIndex, surfaceY: number): number {
  const { count, rowTops, rowHeights } = index;
  if (count === 0) return -1;
  if (surfaceY <= rowTops[0]) return 0;
  const last = count - 1;
  if (surfaceY >= rowTops[last] + rowHeights[last]) return last;

  let lo = 0;
  let hi = last;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const top = rowTops[mid];
    const bot = top + rowHeights[mid];
    if (surfaceY < top) {
      hi = mid - 1;
    } else if (surfaceY >= bot) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }
  return Math.max(0, Math.min(last, lo));
}
