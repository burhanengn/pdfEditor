import {
  getElementLayerTier,
  type CanvasElement,
} from '@/types/elements';
import type {
  DetectedImageObject,
  DetectedTextBlock,
  DetectedVectorShape,
  PageMeta,
  RectBox,
  RotationAngle,
} from '@/types/pdf';

export interface Point2D {
  x: number;
  y: number;
}

export function normalizeRotation(deg: number): RotationAngle {
  const norm = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  if (norm === 90 || norm === 180 || norm === 270) return norm;
  return 0;
}

export function getDisplayDimensions(
  baseWidth: number,
  baseHeight: number,
  userRotation: RotationAngle,
  zoom = 1,
): { width: number; height: number } {
  const swapped = userRotation === 90 || userRotation === 270;
  return {
    width: (swapped ? baseHeight : baseWidth) * zoom,
    height: (swapped ? baseWidth : baseHeight) * zoom,
  };
}

/**
 * Converts a point in canonical base visual space (top-left origin, userRotation=0, points)
 * into rotated display space (top-left origin, points * zoom).
 */
export function pointBaseToDisplay(
  vx: number,
  vy: number,
  baseWidth: number,
  baseHeight: number,
  userRotation: RotationAngle,
  zoom = 1,
): Point2D {
  let rx = vx;
  let ry = vy;
  switch (userRotation) {
    case 90:
      rx = baseHeight - vy;
      ry = vx;
      break;
    case 180:
      rx = baseWidth - vx;
      ry = baseHeight - vy;
      break;
    case 270:
      rx = vy;
      ry = baseWidth - vx;
      break;
    default:
      break;
  }
  return { x: rx * zoom, y: ry * zoom };
}

/**
 * Converts a point in rotated display space (top-left origin, CSS px)
 * back into canonical base visual space (top-left origin, userRotation=0, points).
 */
export function pointDisplayToBase(
  dx: number,
  dy: number,
  baseWidth: number,
  baseHeight: number,
  userRotation: RotationAngle,
  zoom = 1,
): Point2D {
  const px = dx / zoom;
  const py = dy / zoom;
  switch (userRotation) {
    case 90:
      return { x: py, y: baseHeight - px };
    case 180:
      return { x: baseWidth - px, y: baseHeight - py };
    case 270:
      return { x: baseWidth - py, y: px };
    default:
      return { x: px, y: py };
  }
}

/**
 * Converts a delta vector (dx, dy) in screen/display space into base visual space points.
 */
export function deltaDisplayToBase(
  dx: number,
  dy: number,
  userRotation: RotationAngle,
  zoom = 1,
): Point2D {
  const sx = dx / zoom;
  const sy = dy / zoom;
  switch (userRotation) {
    case 90:
      return { x: sy, y: -sx };
    case 180:
      return { x: -sx, y: -sy };
    case 270:
      return { x: -sy, y: sx };
    default:
      return { x: sx, y: sy };
  }
}

/**
 * Projects a base-space element rectangle into CSS display center + unrotated dimensions + angle.
 */
export function rectBaseToDisplayFrame(
  rect: RectBox,
  elementRotation: number,
  baseWidth: number,
  baseHeight: number,
  userRotation: RotationAngle,
  zoom: number,
): {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation: number;
  left: number;
  top: number;
} {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dispCenter = pointBaseToDisplay(cx, cy, baseWidth, baseHeight, userRotation, zoom);
  const w = rect.width * zoom;
  const h = rect.height * zoom;
  return {
    centerX: dispCenter.x,
    centerY: dispCenter.y,
    width: w,
    height: h,
    rotation: elementRotation + userRotation,
    left: dispCenter.x - w / 2,
    top: dispCenter.y - h / 2,
  };
}

/**
 * Converts an axis-aligned rect in base visual space into rotated axis-aligned display rect
 * (used for axis-aligned canvas masks when elementRotation is 0).
 */
export function axisAlignedRectBaseToDisplay(
  rect: RectBox,
  baseWidth: number,
  baseHeight: number,
  userRotation: RotationAngle,
  zoom: number,
): RectBox {
  const p1 = pointBaseToDisplay(rect.x, rect.y, baseWidth, baseHeight, userRotation, zoom);
  const p2 = pointBaseToDisplay(
    rect.x + rect.width,
    rect.y + rect.height,
    baseWidth,
    baseHeight,
    userRotation,
    zoom,
  );
  const minX = Math.min(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxX = Math.max(p1.x, p2.x);
  const maxY = Math.max(p1.y, p2.y);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Maps a point in canonical base visual space (top-left origin, intrinsicRotation already applied)
 * into raw unrotated PDF page user space (bottom-left origin, CropBox-relative).
 */
export function pointBaseVisualToPdfUserSpace(
  vx: number,
  vy: number,
  cropBox: [number, number, number, number],
  intrinsicRotation: RotationAngle,
): Point2D {
  const [cx0, cy0, cx1, cy1] = cropBox;
  switch (intrinsicRotation) {
    case 90:
      return { x: cx0 + vy, y: cy0 + vx };
    case 180:
      return { x: cx1 - vx, y: cy0 + vy };
    case 270:
      return { x: cx1 - vy, y: cy1 - vx };
    default:
      return { x: cx0 + vx, y: cy1 - vy };
  }
}

/**
 * Converts a rectangle in canonical base visual space into PDF bottom-left Rect [x0, y0, x1, y1]
 * in raw unrotated PDF page user space.
 */
export function rectBaseVisualToPdfUserSpace(
  rect: RectBox,
  cropBox: [number, number, number, number],
  intrinsicRotation: RotationAngle,
): [number, number, number, number] {
  const p1 = pointBaseVisualToPdfUserSpace(rect.x, rect.y, cropBox, intrinsicRotation);
  const p2 = pointBaseVisualToPdfUserSpace(
    rect.x + rect.width,
    rect.y + rect.height,
    cropBox,
    intrinsicRotation,
  );
  return [
    Math.min(p1.x, p2.x),
    Math.min(p1.y, p2.y),
    Math.max(p1.x, p2.x),
    Math.max(p1.y, p2.y),
  ];
}

/**
 * Converts a rectangle in canonical base visual space into MuPDF's top-left page bounds space
 * (relative to page bounds [bx0, by0, bx1, by1] at intrinsicRotation, with top-left origin).
 */
export function rectBaseVisualToMupdfRect(
  rect: RectBox,
  mupdfPageBounds: [number, number, number, number],
): [number, number, number, number] {
  const [bx0, by0] = mupdfPageBounds;
  return [
    bx0 + rect.x,
    by0 + rect.y,
    bx0 + rect.x + rect.width,
    by0 + rect.y + rect.height,
  ];
}

/**
 * Computes rotated axis-aligned bounding box corners of an element rotated around its center.
 */
export function getRotatedBoundingBox(
  rect: RectBox,
  rotationDeg: number,
): RectBox {
  if (Math.abs(rotationDeg % 360) < 1e-6) {
    return { ...rect };
  }
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const w = rect.width * cos + rect.height * sin;
  const h = rect.width * sin + rect.height * cos;
  return {
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
  };
}

/**
 * Computes PDF draw placement parameters (bottom-left origin of unrotated box + pdf-lib CCW degrees)
 * for drawing a visual rectangle (with center-based clockwise rotation) onto a PDF page in raw user space.
 */
export function computePdfLibDrawPlacement(
  rect: RectBox,
  visualRotationDeg: number,
  page: Pick<PageMeta, 'cropBox' | 'intrinsicRotation'>,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotateDegCCW: number;
} {
  // Visual center in base visual space
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  // In visual space, the box is rotated clockwise by `visualRotationDeg` around (cx, cy).
  // Relative to the visual top-left corner of the unrotated box, the PDF bottom-left anchor
  // in visual space is (rect.x, rect.y + rect.height) for intrinsicRotation=0!
  // More generally, we compute the vector from visual center (cx, cy) to the rotated box's
  // local origin corner in PDF user space.
  const radCW = (visualRotationDeg * Math.PI) / 180;
  const cos = Math.cos(radCW);
  const sin = Math.sin(radCW);

  // Local bottom-left corner of the visual box relative to its center in visual coords: (-w/2, +h/2)
  const localOriginX = -rect.width / 2;
  const localOriginY = rect.height / 2;

  // Rotate that local vector clockwise in visual space (y-down):
  // x' = x*cos - y*sin, y' = x*sin + y*cos
  const rotOriginVx = cx + (localOriginX * cos - localOriginY * sin);
  const rotOriginVy = cy + (localOriginX * sin + localOriginY * cos);

  const pdfCenter = pointBaseVisualToPdfUserSpace(cx, cy, page.cropBox, page.intrinsicRotation);
  const pdfBL = pointBaseVisualToPdfUserSpace(
    rotOriginVx,
    rotOriginVy,
    page.cropBox,
    page.intrinsicRotation,
  );

  // Wait: for intrinsicRotation != 0, pdf-lib's page.drawImage / drawText rotates around (x, y)
  // in raw PDF user space! Let's determine the exact corner of the visual box that corresponds
  // to pdf-lib's local (+x = right, +y = up) origin in raw PDF user space:
  // Visual +X unit vector in raw PDF user space:
  const vxRight = pointBaseVisualToPdfUserSpace(cx + 1, cy, page.cropBox, page.intrinsicRotation);
  const dirX = vxRight.x - pdfCenter.x;
  const dirY = vxRight.y - pdfCenter.y;
  // Angle of visual +X axis in raw PDF CCW coordinates:
  const basePdfAngleCCW = (Math.atan2(dirY, dirX) * 180) / Math.PI;
  // Visual clockwise rotation corresponds to negative CCW angle in PDF space:
  const totalPdfAngleCCW = basePdfAngleCCW - visualRotationDeg;

  // For intrinsicRotation=0: basePdfAngleCCW=0, visual origin is bottom-left (rotOriginVx, rotOriginVy),
  // which equals pdfBL! Let's verify for intrinsicRotation=90/180/270:
  // If we rotate around the local (0,0) of pdf-lib draw call (which corresponds to visual (-w/2, +h/2)):
  // Wait: in pdf-lib, drawImage/drawRectangle with rotate: degrees(theta) draws a box spanning
  // [0..width] along angle `theta` and [0..height] along angle `theta + 90` (CCW)!
  // Let's check angle `theta + 90` in visual space!
  // For intrinsicRotation=0: +X_pdf = +X_vis, +Y_pdf = -Y_vis. So at theta=0, [0..h] goes -Y_vis (UP from bottom-left!).
  // For intrinsicRotation=90: pointBaseVisualToPdfUserSpace(cx+1, cy) gives (cx0+cy, cy0+vx+1) => dir=(0, +1) => basePdfAngleCCW = +90!
  // Along angle 90+90=180 (-X_pdf), wait: in visual space for intrinsic=90, -Y_vis maps to (vx, vy-1) => (cx0+vy-1, cy0+vx) => (-1, 0) which IS 180 deg!
  // That means for ALL intrinsic rotations, visual (-w/2, +h/2) ALWAYS maps to pdf-lib's (x, y) origin!!
  // Wait let's double check intrinsic=180 and 270:
  // 180: +X_vis -> (-1, 0) = 180 deg. 180+90 = 270 deg = (0, -1). And -Y_vis -> (cx1-vx, cy0+vy-1) = (0, -1)! EXACT!
  // 270: +X_vis -> (0, -1) = 270 deg (-90). -90+90 = 0 deg = (+1, 0). And -Y_vis -> (cx1-(vy-1), cy1-vx) = (+1, 0)! EXACT!

  return {
    x: pdfBL.x,
    y: pdfBL.y,
    width: rect.width,
    height: rect.height,
    rotateDegCCW: totalPdfAngleCCW,
  };
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_BASE_ANGLE: Record<ResizeHandle, number> = {
  n: 0,
  ne: 45,
  e: 90,
  se: 135,
  s: 180,
  sw: 225,
  w: 270,
  nw: 315,
};

const COMPASS_RESIZE_CURSORS = [
  'n-resize',
  'ne-resize',
  'e-resize',
  'se-resize',
  's-resize',
  'sw-resize',
  'w-resize',
  'nw-resize',
] as const;

/**
 * Computes the screen-space directional CSS cursor for a resize handle on a rotated box,
 * snapping (`baseAngle + totalRotationDeg`) to the nearest 45° compass cursor.
 */
export function computeRotatedResizeCursor(
  handle: ResizeHandle,
  totalRotationDeg: number,
): string {
  const base = HANDLE_BASE_ANGLE[handle];
  const angle = (((base + totalRotationDeg) % 360) + 360) % 360;
  const idx = Math.floor((angle + 22.5) / 45) % 8;
  return COMPASS_RESIZE_CURSORS[idx];
}

export interface RotatedResizeParams {
  startRect: RectBox;
  handle: ResizeHandle;
  dxPx: number;
  dyPx: number;
  frameRotationDeg: number;
  userRotation: RotationAngle;
  zoom: number;
  aspectLocked: boolean;
  shiftKey?: boolean;
  minSize?: number;
}

/**
 * Computes the updated base-space RectBox during handle resize by projecting display-space
 * pointer deltas through the inverse 2D rotation matrix R(-theta) into the object's local
 * coordinate frame, keeping the opposite corner/edge pinned regardless of rotation angle.
 */
export function computeRotatedResizeRect(params: RotatedResizeParams): RectBox {
  const {
    startRect,
    handle,
    dxPx,
    dyPx,
    frameRotationDeg,
    userRotation,
    zoom,
    aspectLocked,
    shiftKey = false,
    minSize = 12,
  } = params;

  const startCx = startRect.x + startRect.width / 2;
  const startCy = startRect.y + startRect.height / 2;
  const isCorner = handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw';
  const aspectRatio = startRect.width / Math.max(1, startRect.height);

  // R(-theta) transform from screen display deltas to object local box axes
  const dispAngleRad = (frameRotationDeg * Math.PI) / 180;
  const cos = Math.cos(dispAngleRad);
  const sin = Math.sin(dispAngleRad);
  const localDx = (dxPx * cos + dyPx * sin) / zoom;
  const localDy = (-dxPx * sin + dyPx * cos) / zoom;

  const dirX = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const dirY = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;

  let dw = dirX * localDx;
  let dh = dirY * localDy;

  const preserveAspect = isCorner && (aspectLocked || shiftKey);
  if (preserveAspect) {
    if (Math.abs(dw) / aspectRatio >= Math.abs(dh)) {
      dh = dw / aspectRatio;
    } else {
      dw = dh * aspectRatio;
    }
  }

  let nextW = Math.max(minSize, startRect.width + dw);
  let nextH = Math.max(minSize, startRect.height + dh);
  if (preserveAspect) {
    if (nextW / aspectRatio < minSize) {
      nextH = minSize;
      nextW = nextH * aspectRatio;
    } else {
      nextH = nextW / aspectRatio;
    }
  }

  const actualDw = nextW - startRect.width;
  const actualDh = nextH - startRect.height;

  // Rotate local half-delta back into display space via R(+theta), then into base space
  const localCenterShiftX = (dirX * actualDw) / 2;
  const localCenterShiftY = (dirY * actualDh) / 2;
  const dispCenterShiftPxX = (localCenterShiftX * cos - localCenterShiftY * sin) * zoom;
  const dispCenterShiftPxY = (localCenterShiftX * sin + localCenterShiftY * cos) * zoom;

  const baseCenterShift = deltaDisplayToBase(
    dispCenterShiftPxX,
    dispCenterShiftPxY,
    userRotation,
    zoom,
  );

  const nextCx = startCx + baseCenterShift.x;
  const nextCy = startCy + baseCenterShift.y;

  return {
    x: nextCx - nextW / 2,
    y: nextCy - nextH / 2,
    width: nextW,
    height: nextH,
  };
}

/**
 * Tests whether a base-space point falls inside a rotated rectangle.
 */
export function pointInRotatedRect(
  px: number,
  py: number,
  rect: RectBox,
  rotationDeg = 0,
  tolerance = 1.5,
): boolean {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = px - cx;
  const dy = py - cy;
  const rad = (-rotationDeg * Math.PI) / 180;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return (
    Math.abs(lx) <= rect.width / 2 + tolerance &&
    Math.abs(ly) <= rect.height / 2 + tolerance
  );
}

/**
 * Decomposes a PDF.js viewport-transformed image CTM [a, b, c, d, e, f] into base visual
 * box geometry, clockwise rotation in degrees, and flipX/flipY mirror flags.
 */
export function decomposeImageCtm(ctm: number[]): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
} {
  const [a, b, c, d, e, f] = ctm;
  // Screen pixel +X axis vector: T(1,1) - T(0,1) = (a, b)
  // Screen pixel +Y axis vector (top->bottom): T(0,0) - T(0,1) = (-c, -d)
  const exX = a;
  const exY = b;
  const eyX = -c;
  const eyY = -d;

  const width = Math.max(2, Math.hypot(exX, exY));
  const height = Math.max(2, Math.hypot(eyX, eyY));
  const cx = e + 0.5 * (a + c);
  const cy = f + 0.5 * (b + d);
  const x = cx - width / 2;
  const y = cy - height / 2;

  const det = exX * eyY - exY * eyX;
  const normAngle = (deg: number) => {
    const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
    return Math.abs(wrapped) < 0.05 ? 0 : Math.round(wrapped * 10) / 10;
  };

  if (det >= 0) {
    const rot = normAngle((Math.atan2(exY, exX) * 180) / Math.PI);
    return { x, y, width, height, rotation: rot, flipX: false, flipY: false };
  }

  // Negative determinant indicates odd reflection (flipX or flipY).
  // Choose whichever reflection yields the smallest |rotation| angle for intuitive editing.
  const rotFlipY = normAngle((Math.atan2(exY, exX) * 180) / Math.PI);
  const rotFlipX = normAngle((Math.atan2(-exY, -exX) * 180) / Math.PI);

  if (Math.abs(rotFlipX) < Math.abs(rotFlipY)) {
    return { x, y, width, height, rotation: rotFlipX, flipX: true, flipY: false };
  }
  return { x, y, width, height, rotation: rotFlipY, flipX: false, flipY: true };
}

export const VIEWPORT_MIN_ZOOM = 0.25;
export const VIEWPORT_MAX_ZOOM = 5.0;
export const VIEWPORT_PAGE_GAP = 44;

export interface ViewportPageGeom {
  baseWidth: number;
  baseHeight: number;
  userRotation: RotationAngle;
}

export interface ViewportSurfaceMetrics {
  maxPageScaledWidth: number;
  viewportMarginX: number;
  viewportMarginY: number;
  surfaceWidth: number;
}

export function computeViewportSurfaceMetrics(
  pages: ViewportPageGeom[],
  containerWidth: number,
  containerHeight: number,
  zoom: number,
  isMobile: boolean,
): ViewportSurfaceMetrics {
  let maxPageScaledWidth = 0;
  for (const p of pages) {
    const dims = getDisplayDimensions(p.baseWidth, p.baseHeight, p.userRotation, zoom);
    if (dims.width > maxPageScaledWidth) {
      maxPageScaledWidth = dims.width;
    }
  }
  const safeW = Math.max(1, containerWidth);
  const safeH = Math.max(1, containerHeight);
  const isZoomedHorizontally = maxPageScaledWidth + 32 > safeW || zoom > 1.05;
  const viewportMarginX = isZoomedHorizontally
    ? Math.max(48, Math.round(safeW * 0.35))
    : Math.max(16, Math.floor((safeW - maxPageScaledWidth) / 2));
  const viewportMarginY = Math.max(64, Math.round(safeH * 0.35), isMobile ? 140 : 64);
  const surfaceWidth = Math.max(
    safeW,
    Math.ceil(maxPageScaledWidth + viewportMarginX * 2),
  );
  return { maxPageScaledWidth, viewportMarginX, viewportMarginY, surfaceWidth };
}

export function getPageOffsetInSurface(
  pages: ViewportPageGeom[],
  pageIndex: number,
  zoom: number,
  metrics: ViewportSurfaceMetrics,
  pageGap = VIEWPORT_PAGE_GAP,
): { left: number; top: number; rowTop: number; width: number; height: number } {
  const clampedIdx = Math.max(0, Math.min(pages.length - 1, pageIndex));
  let yVirt = 0;
  for (let i = 0; i < clampedIdx; i++) {
    const p = pages[i];
    const dims = getDisplayDimensions(p.baseWidth, p.baseHeight, p.userRotation, zoom);
    yVirt += dims.height + pageGap;
  }
  const target = pages[clampedIdx];
  const targetDims = target
    ? getDisplayDimensions(target.baseWidth, target.baseHeight, target.userRotation, zoom)
    : { width: 0, height: 0 };
  const left = Math.max(
    metrics.viewportMarginX,
    Math.round((metrics.surfaceWidth - targetDims.width) / 2),
  );
  const rowTop = metrics.viewportMarginY + yVirt;
  const top = rowTop + pageGap / 2;
  return { left, top, rowTop, width: targetDims.width, height: targetDims.height };
}

export function findAnchorPageIndex(
  pages: ViewportPageGeom[],
  scrollTop: number,
  relY: number,
  zoom: number,
  metrics: ViewportSurfaceMetrics,
  fallbackIndex = 0,
  pageGap = VIEWPORT_PAGE_GAP,
): number {
  if (pages.length === 0) return 0;
  const contentY = scrollTop + relY;
  let yVirt = 0;
  let bestIdx = Math.max(0, Math.min(pages.length - 1, fallbackIndex));
  let bestDist = Infinity;

  for (let i = 0; i < pages.length; i++) {
    const dims = getDisplayDimensions(pages[i].baseWidth, pages[i].baseHeight, pages[i].userRotation, zoom);
    const top = metrics.viewportMarginY + yVirt + pageGap / 2;
    const bottom = top + dims.height;
    if (contentY >= top - pageGap / 2 && contentY <= bottom + pageGap / 2) {
      return i;
    }
    const dist = contentY < top ? top - contentY : contentY - bottom;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
    yVirt += dims.height + pageGap;
  }
  return bestIdx;
}

export interface SmartHitOptions {
  point: Point2D; // Page-local base PDF coordinates (points)
  zoom: number;
  isCoarsePointer: boolean;
  selectBackgroundMode: boolean;
  altKey?: boolean;
  elements: CanvasElement[];
  detectedTextBlocks: DetectedTextBlock[];
  detectedImages: DetectedImageObject[];
  detectedShapes?: DetectedVectorShape[];
  replacedBlockIds: Set<string>;
  replacedImageIds: Set<string>;
  replacedShapeIds?: Set<string>;
}

export type SmartHitResult =
  | { tier: 2; kind: 'element'; element: CanvasElement }
  | { tier: 3; kind: 'detected-text'; block: DetectedTextBlock }
  | { tier: 4; kind: 'detected-image'; image: DetectedImageObject }
  | { tier: 4; kind: 'detected-shape'; shape: DetectedVectorShape }
  | { tier: 5; kind: 'background-element'; element: CanvasElement }
  | { tier: 5; kind: 'background-detected-image'; image: DetectedImageObject }
  | { tier: 5; kind: 'background-detected-shape'; shape: DetectedVectorShape }
  | null;

function distToBoxCenterSq(point: Point2D, box: RectBox): number {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  return dx * dx + dy * dy;
}

function isTextElementKind(el: CanvasElement): boolean {
  return el.kind === 'text-edit' || el.kind === 'text-add';
}

function isElementDeleted(el: CanvasElement): boolean {
  return (
    (el.kind === 'text-edit' ||
      el.kind === 'image-replacement' ||
      el.kind === 'shape-replacement') &&
    Boolean(el.deleted)
  );
}

/**
 * Multi-tier priority hit-testing with coarse-pointer text expansion and
 * background isolation guard so clicks over full-page scans/background graphics
 * select foreground text reliably unless explicitly targeting background layers.
 */
export function resolveSmartHitAtPoint(opts: SmartHitOptions): SmartHitResult {
  const safeZoom = Math.max(0.25, opts.zoom);
  const textPadPt = (opts.isCoarsePointer ? 6 : 2) / safeZoom;
  const bgGuardPt = (opts.isCoarsePointer ? 8 : 4) / safeZoom;
  const fgNonTextPadPt = 2 / safeZoom;

  const findForegroundElementHit = (padOverride?: number): CanvasElement | null => {
    const fgMatches: Array<{ el: CanvasElement; tier: number; insideExact: boolean; distSq: number }> = [];
    for (const el of opts.elements) {
      if (isElementDeleted(el) || el.locked || el.isBackgroundLayer) continue;
      const isText = isTextElementKind(el);
      const pad = padOverride !== undefined ? padOverride : isText ? textPadPt : fgNonTextPadPt;
      if (!pointInRotatedRect(opts.point.x, opts.point.y, el, el.rotation, pad)) continue;
      fgMatches.push({
        el,
        tier: getElementLayerTier(el),
        insideExact: pointInRotatedRect(opts.point.x, opts.point.y, el, el.rotation, 0),
        distSq: distToBoxCenterSq(opts.point, el),
      });
    }
    if (fgMatches.length === 0) return null;

    // Non-text annotations directly clicked above text (signatures/highlights/strokes at Tier 4)
    // keep z-order priority; multiple text candidates resolve by closest center distance.
    fgMatches.sort((a, b) => {
      if (isTextElementKind(a.el) && isTextElementKind(b.el)) {
        if (a.insideExact !== b.insideExact) return a.insideExact ? -1 : 1;
        return a.distSq - b.distSq || b.el.zIndex - a.el.zIndex;
      }
      return b.tier - a.tier || b.el.zIndex - a.el.zIndex || a.distSq - b.distSq;
    });
    return fgMatches[0].el;
  };

  const findDetectedTextHit = (pad: number): DetectedTextBlock | null => {
    const matches: Array<{ block: DetectedTextBlock; insideExact: boolean; distSq: number }> = [];
    for (const block of opts.detectedTextBlocks) {
      if (opts.replacedBlockIds.has(block.id)) continue;
      if (!pointInRotatedRect(opts.point.x, opts.point.y, block, 0, pad)) continue;
      matches.push({
        block,
        insideExact: pointInRotatedRect(opts.point.x, opts.point.y, block, 0, 0),
        distSq: distToBoxCenterSq(opts.point, block),
      });
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => {
      if (a.insideExact !== b.insideExact) return a.insideExact ? -1 : 1;
      return a.distSq - b.distSq;
    });
    return matches[0].block;
  };

  const detectedShapes = opts.detectedShapes ?? [];
  const replacedShapeIds = opts.replacedShapeIds ?? new Set<string>();

  const findForegroundDetectedImageHit = (): DetectedImageObject | null => {
    const matches: DetectedImageObject[] = [];
    for (const img of opts.detectedImages) {
      if (opts.replacedImageIds.has(img.id) || img.isBackgroundLayer) continue;
      if (pointInRotatedRect(opts.point.x, opts.point.y, img, img.rotation ?? 0, fgNonTextPadPt)) {
        matches.push(img);
      }
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.operatorIndex - a.operatorIndex || a.width * a.height - b.width * b.height);
    return matches[0];
  };

  const findForegroundDetectedShapeHit = (): DetectedVectorShape | null => {
    const matches: DetectedVectorShape[] = [];
    for (const shp of detectedShapes) {
      if (replacedShapeIds.has(shp.id) || shp.isBackgroundLayer) continue;
      if (pointInRotatedRect(opts.point.x, opts.point.y, shp, 0, fgNonTextPadPt)) {
        matches.push(shp);
      }
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.operatorIndex - a.operatorIndex || a.width * a.height - b.width * b.height);
    return matches[0];
  };

  const findBackgroundElementHit = (allowLocked: boolean): CanvasElement | null => {
    const matches: CanvasElement[] = [];
    for (const el of opts.elements) {
      if (isElementDeleted(el) || !el.isBackgroundLayer) continue;
      if (!allowLocked && el.locked) continue;
      if (pointInRotatedRect(opts.point.x, opts.point.y, el, el.rotation, fgNonTextPadPt)) {
        matches.push(el);
      }
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.zIndex - a.zIndex);
    return matches[0];
  };

  const findBackgroundDetectedImageHit = (): DetectedImageObject | null => {
    const matches: DetectedImageObject[] = [];
    for (const img of opts.detectedImages) {
      if (opts.replacedImageIds.has(img.id) || !img.isBackgroundLayer) continue;
      if (pointInRotatedRect(opts.point.x, opts.point.y, img, img.rotation ?? 0, fgNonTextPadPt)) {
        matches.push(img);
      }
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.operatorIndex - a.operatorIndex || a.width * a.height - b.width * b.height);
    return matches[0];
  };

  const findBackgroundDetectedShapeHit = (): DetectedVectorShape | null => {
    const matches: DetectedVectorShape[] = [];
    for (const shp of detectedShapes) {
      if (replacedShapeIds.has(shp.id) || !shp.isBackgroundLayer) continue;
      if (pointInRotatedRect(opts.point.x, opts.point.y, shp, 0, fgNonTextPadPt)) {
        matches.push(shp);
      }
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.operatorIndex - a.operatorIndex || a.width * a.height - b.width * b.height);
    return matches[0];
  };

  const pickHigherBackgroundObject = (
    bgImg: DetectedImageObject | null,
    bgShape: DetectedVectorShape | null,
  ): SmartHitResult => {
    if (bgImg && bgShape) {
      return bgShape.operatorIndex >= bgImg.operatorIndex
        ? { tier: 5, kind: 'background-detected-shape', shape: bgShape }
        : { tier: 5, kind: 'background-detected-image', image: bgImg };
    }
    if (bgShape) return { tier: 5, kind: 'background-detected-shape', shape: bgShape };
    if (bgImg) return { tier: 5, kind: 'background-detected-image', image: bgImg };
    return null;
  };

  // Explicit background-selection mode or Alt+Click: evaluate background layers first
  if (opts.selectBackgroundMode || opts.altKey) {
    const bgEl = findBackgroundElementHit(opts.selectBackgroundMode);
    if (bgEl) return { tier: 5, kind: 'background-element', element: bgEl };
    const bgObjHit = pickHigherBackgroundObject(
      findBackgroundDetectedImageHit(),
      findBackgroundDetectedShapeHit(),
    );
    if (bgObjHit) return bgObjHit;
  }

  // Tier 2: Unlocked foreground elements & promoted text
  const fgEl = findForegroundElementHit();
  if (fgEl) return { tier: 2, kind: 'element', element: fgEl };

  // Tier 3: Unpromoted detected PDF text blocks
  const textBlock = findDetectedTextHit(textPadPt);
  if (textBlock) return { tier: 3, kind: 'detected-text', block: textBlock };

  // Tier 4: Foreground detected images & vector shapes
  const fgImg = findForegroundDetectedImageHit();
  if (fgImg) return { tier: 4, kind: 'detected-image', image: fgImg };
  const fgShape = findForegroundDetectedShapeHit();
  if (fgShape) return { tier: 4, kind: 'detected-shape', shape: fgShape };

  // Tier 5: Guarded background fallback — check proximity guard before ever touching background
  const nearFgEl = findForegroundElementHit(bgGuardPt);
  if (nearFgEl) return { tier: 2, kind: 'element', element: nearFgEl };
  const nearText = findDetectedTextHit(bgGuardPt);
  if (nearText) return { tier: 3, kind: 'detected-text', block: nearText };

  const bgEl = findBackgroundElementHit(false);
  if (bgEl) return { tier: 5, kind: 'background-element', element: bgEl };
  const bgObjHit = pickHigherBackgroundObject(
    findBackgroundDetectedImageHit(),
    findBackgroundDetectedShapeHit(),
  );
  if (bgObjHit) return bgObjHit;

  return null;
}

/**
 * Safely below iOS WebKit's ~16.7M (16,777,216) canvas backing-store limit to prevent blank renders
 * at 300%-500% zoom on high-DPR displays.
 */
export const MAX_PDF_CANVAS_PIXELS = 12_582_912;

export function computeCappedCanvasDpr(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): number {
  const safeCssArea = Math.max(1, cssWidth * cssHeight);
  const rawPixelArea = safeCssArea * dpr * dpr;
  if (rawPixelArea <= MAX_PDF_CANVAS_PIXELS) return dpr;
  return Math.max(1, Math.sqrt(MAX_PDF_CANVAS_PIXELS / safeCssArea));
}
