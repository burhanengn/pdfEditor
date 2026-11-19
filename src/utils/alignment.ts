import { getRotatedBoundingBox } from '@/engine/coordinates';
import type { CanvasElement } from '@/types/elements';

export type AlignAction =
  | 'left'
  | 'center-h'
  | 'right'
  | 'top'
  | 'center-v'
  | 'bottom'
  | 'distribute-h'
  | 'distribute-v';

/**
 * Computes new top-left `(x, y)` coordinates for multi-selected elements so their
 * outer (rotation-aware) bounding boxes align or distribute evenly along either axis.
 */
export function computeAlignedPositions(
  elements: CanvasElement[],
  action: AlignAction,
): Record<string, { x: number; y: number }> {
  if (elements.length < 2) return {};

  const boxes = elements.map((el) => ({
    el,
    bbox: getRotatedBoundingBox({ x: el.x, y: el.y, width: el.width, height: el.height }, el.rotation ?? 0),
  }));

  const updates: Record<string, { x: number; y: number }> = {};

  if (action === 'distribute-h' || action === 'distribute-v') {
    if (boxes.length < 3) return {};
    if (action === 'distribute-h') {
      const sorted = [...boxes].sort((a, b) => a.bbox.x - b.bbox.x);
      const minX = sorted[0].bbox.x;
      const last = sorted[sorted.length - 1];
      const maxX = last.bbox.x + last.bbox.width;
      const totalWidths = sorted.reduce((sum, item) => sum + item.bbox.width, 0);
      const gap = (maxX - minX - totalWidths) / (sorted.length - 1);
      let cursor = minX;
      for (const item of sorted) {
        const dx = cursor - item.bbox.x;
        updates[item.el.id] = { x: item.el.x + dx, y: item.el.y };
        cursor += item.bbox.width + gap;
      }
    } else {
      const sorted = [...boxes].sort((a, b) => a.bbox.y - b.bbox.y);
      const minY = sorted[0].bbox.y;
      const last = sorted[sorted.length - 1];
      const maxY = last.bbox.y + last.bbox.height;
      const totalHeights = sorted.reduce((sum, item) => sum + item.bbox.height, 0);
      const gap = (maxY - minY - totalHeights) / (sorted.length - 1);
      let cursor = minY;
      for (const item of sorted) {
        const dy = cursor - item.bbox.y;
        updates[item.el.id] = { x: item.el.x, y: item.el.y + dy };
        cursor += item.bbox.height + gap;
      }
    }
    return updates;
  }

  const groupMinX = Math.min(...boxes.map((b) => b.bbox.x));
  const groupMaxX = Math.max(...boxes.map((b) => b.bbox.x + b.bbox.width));
  const groupCenterX = (groupMinX + groupMaxX) / 2;

  const groupMinY = Math.min(...boxes.map((b) => b.bbox.y));
  const groupMaxY = Math.max(...boxes.map((b) => b.bbox.y + b.bbox.height));
  const groupCenterY = (groupMinY + groupMaxY) / 2;

  for (const { el, bbox } of boxes) {
    let dx = 0;
    let dy = 0;
    switch (action) {
      case 'left':
        dx = groupMinX - bbox.x;
        break;
      case 'center-h':
        dx = groupCenterX - (bbox.x + bbox.width / 2);
        break;
      case 'right':
        dx = groupMaxX - (bbox.x + bbox.width);
        break;
      case 'top':
        dy = groupMinY - bbox.y;
        break;
      case 'center-v':
        dy = groupCenterY - (bbox.y + bbox.height / 2);
        break;
      case 'bottom':
        dy = groupMaxY - (bbox.y + bbox.height);
        break;
    }
    updates[el.id] = { x: el.x + dx, y: el.y + dy };
  }

  return updates;
}
