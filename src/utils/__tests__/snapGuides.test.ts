import { describe, expect, it } from 'vitest';
import { computeSnapPosition } from '../snapGuides';

describe('computeSnapPosition', () => {
  it('snaps element center to page horizontal/vertical centerlines', () => {
    const res = computeSnapPosition(
      { x: 253, y: 373, width: 100, height: 50 }, // center is 303, 398 on 612x792 (center 306, 396)
      612,
      792,
      [],
      true,
    );
    expect(res.x).toBeCloseTo(256, 5);
    expect(res.y).toBeCloseTo(371, 5);
    expect(res.guides).toHaveLength(2);
  });

  it('snaps left edge to sibling element right edge within threshold', () => {
    const res = computeSnapPosition(
      { x: 203, y: 120, width: 80, height: 40 },
      612,
      792,
      [{ x: 100, y: 120, width: 100, height: 40 }], // right edge = 200
      true,
    );
    expect(res.x).toBe(200);
    expect(res.y).toBe(120);
  });

  it('does not snap when disabled', () => {
    const res = computeSnapPosition(
      { x: 253, y: 373, width: 100, height: 50 },
      612,
      792,
      [],
      false,
    );
    expect(res.x).toBe(253);
    expect(res.y).toBe(373);
    expect(res.guides).toHaveLength(0);
  });
});
