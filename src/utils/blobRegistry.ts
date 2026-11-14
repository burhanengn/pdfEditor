/**
 * Tracks object URLs created via URL.createObjectURL so they can be
 * garbage-collected once unreferenced by active elements, history, or caches.
 */
class BlobRegistry {
  private readonly tracked = new Map<string, 'doc' | 'cache' | 'export'>();

  createUrl(blob: Blob, scope: 'doc' | 'cache' | 'export' = 'doc'): string {
    const url = URL.createObjectURL(blob);
    this.tracked.set(url, scope);
    return url;
  }

  createUrlFromBytes(
    bytes: Uint8Array,
    mimeType: string,
    scope: 'doc' | 'cache' | 'export' = 'doc',
  ): string {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return this.createUrl(new Blob([copy], { type: mimeType }), scope);
  }

  revoke(url: string | undefined | null): void {
    if (!url || !url.startsWith('blob:')) return;
    if (this.tracked.has(url)) {
      this.tracked.delete(url);
    }
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore already-revoked or invalid URLs
    }
  }

  revokeScope(scope: 'doc' | 'cache' | 'export'): void {
    for (const [url, itemScope] of this.tracked.entries()) {
      if (itemScope === scope) {
        this.tracked.delete(url);
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore
        }
      }
    }
  }

  gc(activeUrls: Set<string>): number {
    let freed = 0;
    for (const [url, scope] of this.tracked.entries()) {
      if (scope === 'export') continue;
      if (!activeUrls.has(url)) {
        this.tracked.delete(url);
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore
        }
        freed++;
      }
    }
    return freed;
  }

  revokeAll(): void {
    for (const url of this.tracked.keys()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore
      }
    }
    this.tracked.clear();
  }

  get size(): number {
    return this.tracked.size;
  }
}

export const blobRegistry = new BlobRegistry();
