import { describe, expect, it } from 'vitest';
import type { CanvasElement, VectorShapeElement } from '@/types/elements';
import { computeAlignedPositions } from '../alignment';

function makeRect(id: string, x: number, y: number, width: number, height: number, rotation = 0): VectorShapeElement {
  return {
    id,
    pageId: 'p1',
    kind: 'shape',
    shapeType: 'rect',
    x,
    y,
    width,
    height,
    rotation,
    opacity: 1,
    zIndex: 1,
    fillColor: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 1,
  };
}

describe('computeAlignedPositions', () => {
  it('returns empty for fewer than 2 elements or distribute with fewer than 3', () => {
    const one = [makeRect('a', 10, 20, 40, 20)];
    expect(computeAlignedPositions(one, 'left')).toEqual({});
    const two = [makeRect('a', 10, 20, 40, 20), makeRect('b', 80, 50, 20, 30)];
    expect(computeAlignedPositions(two, 'distribute-h')).toEqual({});
    expect(computeAlignedPositions(two, 'distribute-v')).toEqual({});
  });

  it('aligns left, center-h, right, top, center-v, and bottom cleanly', () => {
    const els: CanvasElement[] = [
      makeRect('a', 20, 10, 40, 20),
      makeRect('b', 100, 60, 60, 40),
    ];
    // Group X: 20..160 (center 90), Group Y: 10..100 (center 55)
    expect(computeAlignedPositions(els, 'left')).toEqual({
      a: { x: 20, y: 10 },
      b: { x: 20, y: 60 },
    });
    expect(computeAlignedPositions(els, 'center-h')).toEqual({
      a: { x: 70, y: 10 },
      b: { x: 60, y: 60 },
    });
    expect(computeAlignedPositions(els, 'right')).toEqual({
      a: { x: 120, y: 10 },
      b: { x: 100, y: 60 },
    });
    expect(computeAlignedPositions(els, 'top')).toEqual({
      a: { x: 20, y: 10 },
      b: { x: 100, y: 10 },
    });
    expect(computeAlignedPositions(els, 'center-v')).toEqual({
      a: { x: 20, y: 45 },
      b: { x: 100, y: 35 },
    });
    expect(computeAlignedPositions(els, 'bottom')).toEqual({
      a: { x: 20, y: 80 },
      b: { x: 100, y: 60 },
    });
  });

  it('distributes horizontally and vertically with equal gaps between outer elements', () => {
    const els: CanvasElement[] = [
      makeRect('a', 0, 0, 20, 10),
      makeRect('b', 110, 80, 40, 20),
      makeRect('c', 30, 25, 20, 10),
    ];
    // Total X span 0..150, widths = 80 => gap = 70 / 2 = 35 => a:0, c:55, b:110
    const h = computeAlignedPositions(els, 'distribute-h');
    expect(h.a.x).toBeCloseTo(0);
    expect(h.c.x).toBeCloseTo(55);
    expect(h.b.x).toBeCloseTo(110);

    // Total Y span 0..100, heights = 40 => gap = 60 / 2 = 30 => a:0, c:40, b:80
    const v = computeAlignedPositions(els, 'distribute-v');
    expect(v.a.y).toBeCloseTo(0);
    expect(v.c.y).toBeCloseTo(40);
    expect(v.b.y).toBeCloseTo(80);
  });

  it('accounts for rotated element bounding boxes when aligning edges', () => {
    // 60x20 rotated 90 deg around center (100, 100) has bbox x: 90..110, y: 70..130
    const rot = makeRect('r', 70, 90, 60, 20, 90);
    const fixed = makeRect('f', 50, 200, 30, 30, 0);
    const aligned = computeAlignedPositions([fixed, rot], 'left');
    // r bbox.x = 90 -> shift -40 to align with fixed x=50 -> el.x = 30
    expect(aligned.r.x).toBeCloseTo(30, 4);
  });
});
