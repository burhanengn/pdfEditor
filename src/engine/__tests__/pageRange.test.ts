import { describe, expect, it } from 'vitest';
import { parsePageRangeExpression } from '../pageRange';

describe('parsePageRangeExpression', () => {
  it('parses single pages and ascending/descending ranges', () => {
    const res = parsePageRangeExpression('1-3, 5, 8-6', 10);
    expect(res.error).toBeUndefined();
    expect(res.allIndices).toEqual([0, 1, 2, 4, 7, 6, 5]);
    expect(res.groups).toHaveLength(3);
    expect(res.groups[0]).toEqual({ label: '1-3', pageIndices: [0, 1, 2] });
    expect(res.groups[1]).toEqual({ label: '5', pageIndices: [4] });
    expect(res.groups[2]).toEqual({ label: '8-6', pageIndices: [7, 6, 5] });
  });

  it('deduplicates allIndices across overlapping ranges', () => {
    const res = parsePageRangeExpression('1-4, 3-5', 6);
    expect(res.error).toBeUndefined();
    expect(res.allIndices).toEqual([0, 1, 2, 3, 4]);
  });

  it('rejects out-of-bounds or malformed expressions', () => {
    expect(parsePageRangeExpression('', 5).error).toBeDefined();
    expect(parsePageRangeExpression('0-2', 5).error).toBeDefined();
    expect(parsePageRangeExpression('2-7', 5).error).toBeDefined();
    expect(parsePageRangeExpression('abc', 5).error).toBeDefined();
  });
});
