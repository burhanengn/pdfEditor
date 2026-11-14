import { describe, expect, it } from 'vitest';
import {
  computePdfLibDrawPlacement,
  computeRotatedResizeCursor,
  computeRotatedResizeRect,
  decomposeImageCtm,
  deltaDisplayToBase,
  getDisplayDimensions,
  getRotatedBoundingBox,
  pointBaseToDisplay,
  pointBaseVisualToPdfUserSpace,
  pointDisplayToBase,
  pointInRotatedRect,
  rectBaseVisualToPdfUserSpace,
} from '../coordinates';
import type { RotationAngle } from '@/types/pdf';

describe('coordinates engine', () => {
  const baseWidth = 612;
  const baseHeight = 792;
  const rotations: RotationAngle[] = [0, 90, 180, 270];

  it.each(rotations)('round-trips pointBaseToDisplay <-> pointDisplayToBase at %i deg', (rot) => {
    const zoom = 1.75;
    const pts = [
      { x: 0, y: 0 },
      { x: 120.5, y: 340.25 },
      { x: baseWidth, y: baseHeight },
    ];
    for (const pt of pts) {
      const disp = pointBaseToDisplay(pt.x, pt.y, baseWidth, baseHeight, rot, zoom);
      const back = pointDisplayToBase(disp.x, disp.y, baseWidth, baseHeight, rot, zoom);
      expect(back.x).toBeCloseTo(pt.x, 6);
      expect(back.y).toBeCloseTo(pt.y, 6);
    }
  });

  it('swaps display dimensions on 90 and 270 degree rotations', () => {
    expect(getDisplayDimensions(612, 792, 0, 1)).toEqual({ width: 612, height: 792 });
    expect(getDisplayDimensions(612, 792, 90, 1)).toEqual({ width: 792, height: 612 });
    expect(getDisplayDimensions(612, 792, 180, 1)).toEqual({ width: 612, height: 792 });
    expect(getDisplayDimensions(612, 792, 270, 1)).toEqual({ width: 792, height: 612 });
  });

  it.each(rotations)('maps screen delta consistently at %i deg', (rot) => {
    const zoom = 2;
    const originDisp = pointBaseToDisplay(200, 300, baseWidth, baseHeight, rot, zoom);
    const movedDisp = { x: originDisp.x + 40, y: originDisp.y + 20 };
    const originBase = pointDisplayToBase(originDisp.x, originDisp.y, baseWidth, baseHeight, rot, zoom);
    const movedBase = pointDisplayToBase(movedDisp.x, movedDisp.y, baseWidth, baseHeight, rot, zoom);
    const delta = deltaDisplayToBase(40, 20, rot, zoom);
    expect(originBase.x + delta.x).toBeCloseTo(movedBase.x, 6);
    expect(originBase.y + delta.y).toBeCloseTo(movedBase.y, 6);
  });

  it('maps visual coordinates to raw PDF user space with CropBox offset', () => {
    const cropBox: [number, number, number, number] = [10, 20, 622, 812];
    expect(pointBaseVisualToPdfUserSpace(0, 0, cropBox, 0)).toEqual({ x: 10, y: 812 });
    expect(pointBaseVisualToPdfUserSpace(100, 50, cropBox, 0)).toEqual({ x: 110, y: 762 });
    expect(rectBaseVisualToPdfUserSpace({ x: 10, y: 20, width: 100, height: 40 }, cropBox, 0)).toEqual([
      20, 752, 120, 792,
    ]);
  });

  it('computes pdf-lib placement cleanly across intrinsic rotations', () => {
    const cropBox: [number, number, number, number] = [0, 0, 612, 792];
    const p0 = computePdfLibDrawPlacement(
      { x: 50, y: 100, width: 200, height: 60 },
      0,
      { cropBox, intrinsicRotation: 0 },
    );
    expect(p0.x).toBeCloseTo(50, 5);
    expect(p0.y).toBeCloseTo(792 - 160, 5);
    expect(p0.rotateDegCCW).toBeCloseTo(0, 5);

    const p90 = computePdfLibDrawPlacement(
      { x: 50, y: 100, width: 200, height: 60 },
      0,
      { cropBox, intrinsicRotation: 90 },
    );
    expect(p90.rotateDegCCW).toBeCloseTo(90, 5);
  });

  it('computes rotated bounding box accurately', () => {
    const box = getRotatedBoundingBox({ x: 100, y: 100, width: 80, height: 40 }, 90);
    expect(box.width).toBeCloseTo(40, 5);
    expect(box.height).toBeCloseTo(80, 5);
    expect(box.x).toBeCloseTo(120, 5);
    expect(box.y).toBeCloseTo(80, 5);
  });

  it('computes dynamic resize cursors snapped to 45 deg for rotated handles', () => {
    expect(computeRotatedResizeCursor('nw', 0)).toBe('nw-resize');
    expect(computeRotatedResizeCursor('nw', 90)).toBe('ne-resize');
    expect(computeRotatedResizeCursor('e', 90)).toBe('s-resize');
    expect(computeRotatedResizeCursor('s', 180)).toBe('n-resize');
    expect(computeRotatedResizeCursor('n', 45)).toBe('ne-resize');
  });

  it('resizes rotated boxes in local space while anchoring the opposite edge', () => {
    // Box rotated 90 deg CW: dragging screen 'down' (dyPx = 20)
    // extends local 'e' right edge along +localX (+20) while shifting center by +10 down.
    const resized = computeRotatedResizeRect({
      startRect: { x: 100, y: 100, width: 80, height: 40 },
      handle: 'e',
      dxPx: 0,
      dyPx: 20,
      frameRotationDeg: 90,
      userRotation: 0,
      zoom: 1,
      aspectLocked: false,
    });
    expect(resized.width).toBeCloseTo(100, 4);
    expect(resized.height).toBeCloseTo(40, 4);
  });

  it('decomposes PDF.js viewport image CTM negative scales into flipX/flipY', () => {
    // Normal upright image in PDF.js viewport (Y-down): [w, 0, 0, -h, x, bottom]
    const upright = decomposeImageCtm([120, 0, 0, -80, 100, 180]);
    expect(upright.flipX).toBe(false);
    expect(upright.flipY).toBe(false);
    expect(upright.rotation).toBeCloseTo(0, 4);

    // Horizontally mirrored image in PDF.js viewport: a = -120, d = -80
    const fx = decomposeImageCtm([-120, 0, 0, -80, 220, 180]);
    expect(fx.flipX).toBe(true);
    expect(fx.flipY).toBe(false);
    expect(fx.rotation).toBeCloseTo(0, 4);
    expect(fx.width).toBeCloseTo(120, 5);
    expect(fx.height).toBeCloseTo(80, 5);

    // Vertically mirrored image in PDF.js viewport: a = 120, d = +80
    const fy = decomposeImageCtm([120, 0, 0, 80, 100, 100]);
    expect(fy.flipX).toBe(false);
    expect(fy.flipY).toBe(true);
    expect(fy.rotation).toBeCloseTo(0, 4);
    expect(pointInRotatedRect(140, 120, { x: 100, y: 100, width: 80, height: 40 }, 45)).toBe(true);
  });
});
