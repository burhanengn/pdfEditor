export interface CachedTileEntry {
  key: string;
  pageId: string;
  pageIndex: number;
  isPreview: boolean;
  scaleBucket: string;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  byteSize: number;
  lastUsed: number;
}

export function getDefaultTileMemoryBudgetBytes(): number {
  const isMobile =
    typeof window !== 'undefined' &&
    (window.innerWidth < 768 || window.matchMedia?.('(pointer: coarse)').matches);
  const baseMb = isMobile ? 128 : 384;
  const deviceMem =
    typeof navigator !== 'undefined' &&
    'deviceMemory' in navigator &&
    typeof (navigator as unknown as { deviceMemory?: number }).deviceMemory === 'number'
      ? (navigator as unknown as { deviceMemory: number }).deviceMemory
      : 4;
  const factor = Math.max(0.5, Math.min(1.5, deviceMem / 4));
  return Math.round(baseMb * factor * 1024 * 1024);
}

/**
 * Byte-budgeted LRU tile & preview bitmap cache (01 §6.5).
 * Evicts distant tiles -> stale scale buckets -> distant previews -> oldest entries,
 * calling `ImageBitmap.close()` to release GPU/browser memory immediately.
 */
export class TileCache {
  private entries = new Map<string, CachedTileEntry>();
  private totalBytes = 0;
  private budgetBytes: number;
  private activePageIndex = 0;
  private activeScaleBucket = '';
  private tick = 0;

  constructor(budgetBytes = getDefaultTileMemoryBudgetBytes()) {
    this.budgetBytes = Math.max(16 * 1024 * 1024, budgetBytes);
  }

  setBudgetBytes(budgetBytes: number): void {
    this.budgetBytes = Math.max(8 * 1024 * 1024, budgetBytes);
    this.evictIfNeeded();
  }

  setActiveContext(pageIndex: number, scaleBucket: string): void {
    this.activePageIndex = pageIndex;
    this.activeScaleBucket = scaleBucket;
  }

  get(key: string): CachedTileEntry | undefined {
    const existing = this.entries.get(key);
    if (!existing) return undefined;
    existing.lastUsed = ++this.tick;
    this.entries.delete(key);
    this.entries.set(key, existing);
    return existing;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  put(entry: Omit<CachedTileEntry, 'byteSize' | 'lastUsed'>): void {
    const prev = this.entries.get(entry.key);
    if (prev) {
      this.totalBytes -= prev.byteSize;
      try {
        prev.bitmap.close();
      } catch {
        // Ignore closed bitmap
      }
      this.entries.delete(entry.key);
    }

    const byteSize = Math.max(1, entry.width * entry.height * 4);
    const stored: CachedTileEntry = {
      ...entry,
      byteSize,
      lastUsed: ++this.tick,
    };
    this.entries.set(entry.key, stored);
    this.totalBytes += byteSize;
    this.evictIfNeeded();
  }

  invalidatePage(pageId: string): void {
    for (const [k, entry] of [...this.entries.entries()]) {
      if (entry.pageId === pageId) {
        this.removeEntry(k, entry);
      }
    }
  }

  /**
   * Trims cache on visibility change or memory pressure (01 §6.5).
   * `'background'` keeps only previews near the active page; `'critical'` clears all except active page preview.
   */
  trim(level: 'background' | 'critical' = 'background'): void {
    for (const [k, entry] of [...this.entries.entries()]) {
      const dist = Math.abs(entry.pageIndex - this.activePageIndex);
      if (level === 'critical') {
        if (!entry.isPreview || dist > 0) {
          this.removeEntry(k, entry);
        }
      } else if (!entry.isPreview || dist > 2) {
        this.removeEntry(k, entry);
      }
    }
  }

  clear(): void {
    for (const [k, entry] of [...this.entries.entries()]) {
      this.removeEntry(k, entry);
    }
    this.totalBytes = 0;
  }

  getStats(): { count: number; totalBytes: number; budgetBytes: number } {
    return {
      count: this.entries.size,
      totalBytes: this.totalBytes,
      budgetBytes: this.budgetBytes,
    };
  }

  private removeEntry(key: string, entry: CachedTileEntry): void {
    this.entries.delete(key);
    this.totalBytes = Math.max(0, this.totalBytes - entry.byteSize);
    try {
      entry.bitmap.close();
    } catch {
      // Ignore already closed bitmap
    }
  }

  private evictIfNeeded(): void {
    if (this.totalBytes <= this.budgetBytes) return;

    // Score candidates for eviction: lower score = evict first
    // Tier 0: distant non-preview tiles
    // Tier 1: stale scale-bucket tiles
    // Tier 2: distant previews
    // Tier 3: nearby tiles / previews
    const scored = [...this.entries.values()].map((entry) => {
      const dist = Math.abs(entry.pageIndex - this.activePageIndex);
      let tier = 3;
      if (!entry.isPreview && dist > 2) tier = 0;
      else if (!entry.isPreview && this.activeScaleBucket && entry.scaleBucket !== this.activeScaleBucket) {
        tier = 1;
      } else if (entry.isPreview && dist > 3) {
        tier = 2;
      }
      return { entry, tier };
    });

    scored.sort((a, b) => a.tier - b.tier || a.entry.lastUsed - b.entry.lastUsed);

    for (const { entry } of scored) {
      if (this.totalBytes <= this.budgetBytes) break;
      this.removeEntry(entry.key, entry);
    }
  }
}

export const viewerTileCache = new TileCache();
export const thumbnailTileCache = new TileCache(28 * 1024 * 1024);
