import { describe, expect, it } from 'vitest';
import {
  constrainSegmentAngle45,
  denormalizePathPoints,
  findNearestOpenPathEndpoint,
  mergeMultiplePointChains,
  mergeTwoPointChains,
  normalizeAbsolutePoints,
  pathPointsToSvgPath,
  shapeToSvgPath,
  strokeDashToArray,
} from '@/engine/vectorShapes';

describe('vectorShapes geometry & path joining engine', () => {
  it('generates sharp and cubic-bezier rounded rectangle SVG paths clamped to box bounds', () => {
    const sharp = shapeToSvgPath('rect', 100, 60, 0);
    expect(sharp).toBe('M 0 0 L 100.00 0 L 100.00 60.00 L 0 60.00 Z');

    const rounded = shapeToSvgPath('rect', 100, 60, 16);
    expect(rounded).toContain('M 16.00 0');
    expect(rounded).toContain('C ');
    expect(rounded.endsWith('Z')).toBe(true);

    // Radius exceeding half height clamps safely to 30
    const overClamped = shapeToSvgPath('rect', 100, 60, 80);
    expect(overClamped).toContain('M 30.00 0');

    const circle = shapeToSvgPath('ellipse', 80, 80);
    expect(circle).toContain('M 40.00 0');
    expect(circle).toContain('C ');
    expect(circle.endsWith('Z')).toBe(true);

    expect(shapeToSvgPath('triangle', 100, 50)).toContain('M 50.00 0');
    expect(shapeToSvgPath('diamond', 100, 50)).toContain('M 50.00 0');
    expect(shapeToSvgPath('arrow', 100, 50)).toContain('L 100.00 25.00');
  });

  it('normalizes flat lines with safe grab height and preserves rotated vertices on denormalize', () => {
    const { rect, points } = normalizeAbsolutePoints([
      { x: 100, y: 200 },
      { x: 300, y: 200 },
    ]);
    expect(rect.width).toBe(200);
    expect(rect.height).toBeGreaterThanOrEqual(12);

    const restored = denormalizePathPoints({ ...rect, rotation: 0, points });
    expect(restored[0].x).toBeCloseTo(100, 2);
    expect(restored[0].y).toBeCloseTo(200, 2);
    expect(restored[1].x).toBeCloseTo(300, 2);
    expect(restored[1].y).toBeCloseTo(200, 2);

    // 90 deg rotation around center (200, 200) -> vertical segment (200, 100) .. (200, 300)
    const rotated = denormalizePathPoints({ ...rect, rotation: 90, points });
    expect(rotated[0].x).toBeCloseTo(200, 2);
    expect(rotated[0].y).toBeCloseTo(100, 2);
    expect(rotated[1].x).toBeCloseTo(200, 2);
    expect(rotated[1].y).toBeCloseTo(300, 2);
  });

  it('joins multiple polyline chains by closest endpoint pairs regardless of direction', () => {
    // Seg 1: (0,0) -> (100,0)
    // Seg 2 drawn reversed: (100,100) -> (100,0)
    const joined = mergeTwoPointChains(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [
        { x: 100, y: 100 },
        { x: 100, y: 0 },
      ],
    );
    expect(joined).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);

    const chain3 = mergeMultiplePointChains([
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    ]);
    expect(chain3).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
  });

  it('finds open path snap endpoints and ignores closed polygons', () => {
    const open = normalizeAbsolutePoints([
      { x: 50, y: 50 },
      { x: 150, y: 50 },
    ]);
    const closed = normalizeAbsolutePoints([
      { x: 60, y: 60 },
      { x: 160, y: 60 },
      { x: 110, y: 140 },
    ]);

    const hit = findNearestOpenPathEndpoint(
      { x: 154, y: 53 },
      [
        { id: 'closed_poly', ...closed.rect, rotation: 0, points: closed.points, closed: true },
        { id: 'open_line', ...open.rect, rotation: 0, points: open.points, closed: false },
      ],
      10,
    );
    expect(hit).not.toBeNull();
    expect(hit!.elementId).toBe('open_line');
    expect(hit!.endpoint).toBe('end');
    expect(hit!.point.x).toBeCloseTo(150, 1);
  });

  it('constrains angles to 45 deg steps and generates smooth/dash SVG helpers', () => {
    const snapped45 = constrainSegmentAngle45({ x: 10, y: 10 }, { x: 110, y: 104 });
    const expectedDist = Math.hypot(100, 94);
    expect(snapped45.x).toBeCloseTo(10 + expectedDist * Math.SQRT1_2, 1);
    expect(snapped45.y).toBeCloseTo(10 + expectedDist * Math.SQRT1_2, 1);

    const smoothPath = pathPointsToSvgPath(
      [
        { x: 0, y: 0 },
        { x: 0.5, y: 1 },
        { x: 1, y: 0 },
      ],
      100,
      100,
      false,
      true,
    );
    expect(smoothPath).toContain('Q ');

    const mixedOpen = pathPointsToSvgPath(
      [
        { x: 0, y: 0 },
        { x: 0.3, y: 1, smooth: false },
        { x: 0.7, y: 1, smooth: true },
        { x: 1, y: 0 },
      ],
      100,
      100,
      false,
      false,
    );
    expect(mixedOpen).toContain('L 30.00 100.00 L 50.00 100.00 Q 70.00 100.00 85.00 50.00 L 100.00 0.00');

    expect(strokeDashToArray('solid', 2)).toBeUndefined();
    expect(strokeDashToArray('dashed', 2)).toEqual([6, 4]);
    expect(strokeDashToArray('dotted', 2)).toEqual([2, 4]);
  });
});
