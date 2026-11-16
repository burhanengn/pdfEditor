import { describe, expect, it, vi } from 'vitest';
import type { PageMeta } from '@/types/pdf';
import { buildPageOffsetIndex, findPageIndexAtSurfaceY } from '@/engine/pageOffsets';
import { normalizeForTurkishSearch } from '../pdfiumEngine';
import { TileCache } from '../tileCache';

function fakeBitmap(w: number, h: number) {
  return {
    width: w,
    height: h,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

describe('TileCache LRU, PageOffsetIndex binary search, and Turkish folding', () => {
  it('enforces byte budget eviction order and calls ImageBitmap.close()', () => {
    // 100x100 RGBA = 40,000 bytes per tile; set budget = 100,000 bytes (only 2 tiles fit)
    const cache = new TileCache(100_000);
    // TileCache ctor clamps minimum to 16 MB; use setBudgetBytes? Ctor clamps 16MB, setBudgetBytes clamps 8MB.
    // Test with large tiles (2048x2048 = 16MB each) against 16MB budget:
    const cache16 = new TileCache(16 * 1024 * 1024);
    cache16.setActiveContext(0, '1.00');

    const bActivePrev = fakeBitmap(1024, 1024); // 4MB
    const bDistantTile = fakeBitmap(2048, 2048); // 16MB -> triggers eviction when next arrives
    const bNearTile = fakeBitmap(1024, 1024); // 4MB

    cache16.put({
      key: 'active_prev',
      pageId: 'p0',
      pageIndex: 0,
      isPreview: true,
      scaleBucket: '0.40',
      bitmap: bActivePrev,
      width: 1024,
      height: 1024,
    });
    cache16.put({
      key: 'distant_tile',
      pageId: 'p20',
      pageIndex: 20,
      isPreview: false,
      scaleBucket: '1.00',
      bitmap: bDistantTile,
      width: 2048,
      height: 2048,
    });
    // Now total is 20MB > 16MB -> distant_tile (tier 0) must be evicted first, keeping active_prev!
    expect(cache16.has('distant_tile')).toBe(false);
    expect(bDistantTile.close).toHaveBeenCalledTimes(1);
    expect(cache16.has('active_prev')).toBe(true);

    cache16.put({
      key: 'near_tile',
      pageId: 'p0',
      pageIndex: 0,
      isPreview: false,
      scaleBucket: '1.00',
      bitmap: bNearTile,
      width: 1024,
      height: 1024,
    });
    expect(cache16.has('near_tile')).toBe(true);

    cache16.trim('critical');
    expect(cache16.has('near_tile')).toBe(false);
    expect(bNearTile.close).toHaveBeenCalledTimes(1);
    expect(cache16.has('active_prev')).toBe(true);

    cache.clear();
  });

  it('locates pages in O(log N) binary search across 300 pages', () => {
    const pages: PageMeta[] = Array.from({ length: 300 }, (_, i) => ({
      id: `p_${i}`,
      sourceDocId: 'src',
      sourcePageIndex: i,
      baseWidth: 595,
      baseHeight: i % 2 === 0 ? 842 : 600,
      intrinsicRotation: 0,
      userRotation: 0,
      mediaBox: [0, 0, 595, 842],
      cropBox: [0, 0, 595, 842],
    }));

    const index = buildPageOffsetIndex(pages, 1.0, {
      surfaceWidth: 800,
      maxPageScaledWidth: 595,
      viewportMarginX: 40,
      viewportMarginY: 32,
    });

    expect(findPageIndexAtSurfaceY(index, 0)).toBe(0);
    expect(findPageIndexAtSurfaceY(index, index.rowTops[149] + 100)).toBe(149);
    expect(findPageIndexAtSurfaceY(index, index.rowTops[299] + 50)).toBe(299);
    expect(findPageIndexAtSurfaceY(index, index.totalHeight + 500)).toBe(299);
  });

  it('folds Turkish dotted/dotless I and diacritics accurately', () => {
    expect(normalizeForTurkishSearch('İSTANBUL ŞİFRESİ')).toBe('istanbul sifresi');
    expect(normalizeForTurkishSearch('IĞDIR ÇAĞRI')).toBe('igdir cagri');
    expect(normalizeForTurkishSearch('öğrenci ünitesi')).toBe('ogrenci unitesi');
  });
});
