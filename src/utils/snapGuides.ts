import type { RectBox, SnapGuide } from '@/types/pdf';

const SNAP_THRESHOLD = 5;
const PAGE_MARGIN = 36; // 0.5 inch margin guide

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

export function computeSnapPosition(
  movingRect: RectBox,
  pageWidth: number,
  pageHeight: number,
  siblings: RectBox[],
  enabled: boolean,
): SnapResult {
  if (!enabled) {
    return { x: movingRect.x, y: movingRect.y, guides: [] };
  }

  const xTargets: Array<{ value: number; start: number; end: number }> = [
    { value: PAGE_MARGIN, start: 0, end: pageHeight },
    { value: pageWidth / 2, start: 0, end: pageHeight },
    { value: pageWidth - PAGE_MARGIN, start: 0, end: pageHeight },
  ];

  const yTargets: Array<{ value: number; start: number; end: number }> = [
    { value: PAGE_MARGIN, start: 0, end: pageWidth },
    { value: pageHeight / 2, start: 0, end: pageWidth },
    { value: pageHeight - PAGE_MARGIN, start: 0, end: pageWidth },
  ];

  for (const sib of siblings) {
    const minY = Math.min(movingRect.y, sib.y) - 12;
    const maxY = Math.max(movingRect.y + movingRect.height, sib.y + sib.height) + 12;
    xTargets.push(
      { value: sib.x, start: minY, end: maxY },
      { value: sib.x + sib.width / 2, start: minY, end: maxY },
      { value: sib.x + sib.width, start: minY, end: maxY },
    );

    const minX = Math.min(movingRect.x, sib.x) - 12;
    const maxX = Math.max(movingRect.x + movingRect.width, sib.x + sib.width) + 12;
    yTargets.push(
      { value: sib.y, start: minX, end: maxX },
      { value: sib.y + sib.height / 2, start: minX, end: maxX },
      { value: sib.y + sib.height, start: minX, end: maxX },
    );
  }

  let bestDx = 0;
  let bestXDist = SNAP_THRESHOLD + 1;
  let bestXGuide: SnapGuide | null = null;

  const movingXEdges = [
    movingRect.x,
    movingRect.x + movingRect.width / 2,
    movingRect.x + movingRect.width,
  ];
  for (const edge of movingXEdges) {
    for (const target of xTargets) {
      const dist = Math.abs(target.value - edge);
      if (dist < bestXDist) {
        bestXDist = dist;
        bestDx = target.value - edge;
        bestXGuide = {
          orientation: 'vertical',
          position: target.value,
          start: target.start,
          end: target.end,
        };
      }
    }
  }

  let bestDy = 0;
  let bestYDist = SNAP_THRESHOLD + 1;
  let bestYGuide: SnapGuide | null = null;

  const movingYEdges = [
    movingRect.y,
    movingRect.y + movingRect.height / 2,
    movingRect.y + movingRect.height,
  ];
  for (const edge of movingYEdges) {
    for (const target of yTargets) {
      const dist = Math.abs(target.value - edge);
      if (dist < bestYDist) {
        bestYDist = dist;
        bestDy = target.value - edge;
        bestYGuide = {
          orientation: 'horizontal',
          position: target.value,
          start: target.start,
          end: target.end,
        };
      }
    }
  }

  const guides: SnapGuide[] = [];
  if (bestXGuide && bestXDist <= SNAP_THRESHOLD) guides.push(bestXGuide);
  if (bestYGuide && bestYDist <= SNAP_THRESHOLD) guides.push(bestYGuide);

  return {
    x: movingRect.x + (bestXDist <= SNAP_THRESHOLD ? bestDx : 0),
    y: movingRect.y + (bestYDist <= SNAP_THRESHOLD ? bestDy : 0),
    guides,
  };
}
