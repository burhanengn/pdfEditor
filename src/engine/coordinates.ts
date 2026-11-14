import type { PageMeta, RectBox, RotationAngle } from '@/types/pdf';

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
