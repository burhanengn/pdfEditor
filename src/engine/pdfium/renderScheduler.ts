import type { ReadingTheme, RotationAngle } from '@/types/pdf';
import { createId } from '@/utils/id';
import type {
  PdfiumOpenResult,
  PdfLinkAnnotation,
  PdfOutlineNode,
  PdfSearchHit,
  PdfTextSpan,
  TileRenderRequest,
} from './pdfiumTypes';
import type { PdfiumWorkerInbound, PdfiumWorkerOutbound } from '@/workers/pdfiumRender.worker';
import { thumbnailTileCache, viewerTileCache } from './tileCache';

export enum RenderPriority {
  VISIBLE_TILE = 1,
  VISIBLE_PREVIEW = 2,
  PRELOAD_ADJACENT = 3,
  THUMBNAIL = 4,
  BACKGROUND = 5,
}

export interface TileCacheKeyParams {
  docRev: number;
  pageId: string;
  pageRev: number;
  scaleBucket: string;
  tx: number;
  ty: number;
  theme: ReadingTheme;
  darkInvert: boolean;
  rotation: RotationAngle;
  isPreview?: boolean;
}

export function buildTileCacheKey(p: TileCacheKeyParams): string {
  const kind = p.isPreview ? 'prev' : `${p.tx},${p.ty}`;
  return `${p.docRev}:${p.pageId}:${p.pageRev}:${p.scaleBucket}:${kind}:${p.theme}:${p.darkInvert ? 1 : 0}:${p.rotation}`;
}

export function getScaleBucket(zoom: number, dpr: number): string {
  const effective = zoom * dpr;
  // Quantize scale buckets slightly to avoid thrashing on tiny float jitter while preserving crispness
  const quantized = Math.round(effective * 100) / 100;
  return quantized.toFixed(2);
}

interface PendingRpc {
  resolve: (value: never) => void;
  reject: (err: unknown) => void;
}

interface QueuedRenderJob {
  key: string;
  priority: RenderPriority;
  pageId: string;
  pageIndex: number;
  scaleBucket: string;
  isPreview: boolean;
  isThumbnail?: boolean;
  request: TileRenderRequest;
  callbacks: Array<{
    resolve: (bitmap: ImageBitmap) => void;
    reject: (err: unknown) => void;
  }>;
  cancelled: boolean;
}

interface WorkerSlot {
  worker: Worker;
  pending: Map<string, PendingRpc>;
  inFlightCount: number;
  openedDocs: Set<string>;
}

const MAX_DESKTOP_DOC_BYTES_FOR_DUAL_WORKER = 50 * 1024 * 1024;

/**
 * Coordinates PDFium Render Worker(s) with priority scheduling, cancellation,
 * and automatic memory trimming (01 §6.4–§6.6).
 */
export class PdfiumRenderScheduler {
  private slots: WorkerSlot[] = [];
  private queue: QueuedRenderJob[] = [];
  private docBytesCache = new Map<string, Uint8Array>();
  private searchListeners = new Map<
    string,
    (chunk: Extract<PdfiumWorkerOutbound, { type: 'searchChunk' }>) => void
  >();
  private totalDocBytes = 0;
  private visibilityBound = false;

  constructor() {
    this.bindLifecycle();
  }

  private bindLifecycle(): void {
    if (this.visibilityBound || typeof document === 'undefined') return;
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        viewerTileCache.trim('background');
        thumbnailTileCache.trim('background');
        this.trimWorkers(2);
      }
    });
  }

  private ensureSlot(index: number): WorkerSlot {
    if (this.slots[index]) return this.slots[index];
    const worker = new Worker(
      new URL('../../workers/pdfiumRender.worker.ts', import.meta.url),
      { type: 'module' },
    );
    const slot: WorkerSlot = {
      worker,
      pending: new Map(),
      inFlightCount: 0,
      openedDocs: new Set(),
    };
    worker.onmessage = (event: MessageEvent<PdfiumWorkerOutbound>) => {
      const data = event.data;
      if (data.type === 'searchChunk') {
        const listener = this.searchListeners.get(data.searchId);
        listener?.(data);
        if (data.done) {
          this.searchListeners.delete(data.searchId);
        }
        return;
      }
      const entry = slot.pending.get(data.id);
      if (!entry) return;
      slot.pending.delete(data.id);
      if (data.ok) {
        entry.resolve(data.result as never);
      } else {
        entry.reject(new Error(data.error));
      }
    };
    worker.onerror = (err) => {
      for (const [id, entry] of slot.pending.entries()) {
        entry.reject(new Error(err.message || 'PDFium worker crashed'));
        slot.pending.delete(id);
      }
    };
    this.slots[index] = slot;
    return slot;
  }

  private shouldUseSecondWorker(): boolean {
    if (typeof window === 'undefined') return false;
    const isDesktop = window.innerWidth >= 1024;
    return isDesktop && this.totalDocBytes > 0 && this.totalDocBytes < MAX_DESKTOP_DOC_BYTES_FOR_DUAL_WORKER;
  }

  private sendToSlot<T>(
    slot: WorkerSlot,
    method: PdfiumWorkerInbound['method'],
    payload: Record<string, unknown>,
    transfer: Transferable[] = [],
  ): Promise<T> {
    const id = createId('pdfium');
    return new Promise<T>((resolve, reject) => {
      slot.pending.set(id, {
        resolve: resolve as (v: never) => void,
        reject,
      });
      slot.worker.postMessage({ id, method, payload } as PdfiumWorkerInbound, transfer);
    });
  }

  private async ensureDocOpenedOnSlot(slot: WorkerSlot, sourceDocId: string): Promise<void> {
    if (slot.openedDocs.has(sourceDocId)) return;
    const bytes = this.docBytesCache.get(sourceDocId);
    if (!bytes) {
      throw new Error(`Document ${sourceDocId} is not loaded in RenderScheduler`);
    }
    const copy = bytes.slice();
    const res = await this.sendToSlot<PdfiumOpenResult & { outline: PdfOutlineNode[] }>(
      slot,
      'openDoc',
      { sourceDocId, bytes: copy },
      [copy.buffer],
    );
    if (res.status === 'ok') {
      slot.openedDocs.add(sourceDocId);
    }
  }

  async openDocument(
    sourceDocId: string,
    bytes: Uint8Array,
    password?: string,
  ): Promise<PdfiumOpenResult & { outline: PdfOutlineNode[] }> {
    this.closeDocument(sourceDocId);
    this.docBytesCache.set(sourceDocId, bytes);
    this.recomputeTotalBytes();

    const primary = this.ensureSlot(0);
    const copy = bytes.slice();
    const res = await this.sendToSlot<PdfiumOpenResult & { outline: PdfOutlineNode[] }>(
      primary,
      'openDoc',
      { sourceDocId, bytes: copy, password },
      [copy.buffer],
    );
    if (res.status === 'ok') {
      primary.openedDocs.add(sourceDocId);
    } else {
      this.docBytesCache.delete(sourceDocId);
      this.recomputeTotalBytes();
    }
    return res;
  }

  closeDocument(sourceDocId: string): void {
    this.cancelByDoc(sourceDocId);
    this.docBytesCache.delete(sourceDocId);
    this.recomputeTotalBytes();
    for (const slot of this.slots) {
      if (!slot) continue;
      slot.openedDocs.delete(sourceDocId);
      void this.sendToSlot(slot, 'closeDoc', { sourceDocId }).catch(() => {});
    }
  }

  closeAllDocuments(): void {
    for (const id of [...this.docBytesCache.keys()]) {
      this.closeDocument(id);
    }
    viewerTileCache.clear();
    thumbnailTileCache.clear();
  }

  private recomputeTotalBytes(): void {
    let total = 0;
    for (const b of this.docBytesCache.values()) {
      total += b.byteLength;
    }
    this.totalDocBytes = total;
  }

  trimWorkers(maxOpenPages = 2): void {
    for (const slot of this.slots) {
      if (!slot) continue;
      void this.sendToSlot(slot, 'trim', { maxOpenPages }).catch(() => {});
    }
  }

  async extractTextSpans(sourceDocId: string, pageIndex: number): Promise<PdfTextSpan[]> {
    const primary = this.ensureSlot(0);
    await this.ensureDocOpenedOnSlot(primary, sourceDocId);
    const res = await this.sendToSlot<{ spans: PdfTextSpan[] }>(primary, 'extractTextSpans', {
      sourceDocId,
      pageIndex,
    });
    return res.spans;
  }

  async getLinks(sourceDocId: string, pageIndex: number): Promise<PdfLinkAnnotation[]> {
    const primary = this.ensureSlot(0);
    await this.ensureDocOpenedOnSlot(primary, sourceDocId);
    const res = await this.sendToSlot<{ links: PdfLinkAnnotation[] }>(primary, 'getLinks', {
      sourceDocId,
      pageIndex,
    });
    return res.links;
  }

  startSearch(
    params: {
      sourceDocId: string;
      query: string;
      matchCase: boolean;
      wholeWord: boolean;
      startPageIndex: number;
      pageIndices: number[];
    },
    onChunk: (chunk: {
      hits: PdfSearchHit[];
      scannedPages: number;
      totalPages: number;
      done: boolean;
    }) => void,
  ): { searchId: string; cancel: () => void } {
    const searchId = createId('srch');
    const primary = this.ensureSlot(0);

    this.searchListeners.set(searchId, (chunk) => {
      onChunk({
        hits: chunk.hits,
        scannedPages: chunk.scannedPages,
        totalPages: chunk.totalPages,
        done: chunk.done,
      });
    });

    void this.ensureDocOpenedOnSlot(primary, params.sourceDocId).then(() =>
      this.sendToSlot(primary, 'searchDoc', {
        searchId,
        ...params,
      }),
    );

    return {
      searchId,
      cancel: () => {
        this.searchListeners.delete(searchId);
        void this.sendToSlot(primary, 'cancelSearch', { searchId }).catch(() => {});
      },
    };
  }

  scheduleTileRender(params: {
    key: string;
    priority: RenderPriority;
    pageId: string;
    pageIndex: number;
    scaleBucket: string;
    isPreview: boolean;
    isThumbnail?: boolean;
    request: TileRenderRequest;
  }): { promise: Promise<ImageBitmap>; cancel: () => void } {
    const cache = params.isThumbnail ? thumbnailTileCache : viewerTileCache;
    const cached = cache.get(params.key);
    if (cached) {
      return {
        promise: Promise.resolve(cached.bitmap),
        cancel: () => {},
      };
    }

    let cancelled = false;
    let callbackEntry: QueuedRenderJob['callbacks'][number] | null = null;

    const promise = new Promise<ImageBitmap>((resolve, reject) => {
      callbackEntry = {
        resolve: (bmp) => {
          if (!cancelled) resolve(bmp);
        },
        reject: (err) => {
          if (!cancelled) reject(err);
        },
      };

      const existing = this.queue.find((j) => j.key === params.key && !j.cancelled);
      if (existing) {
        if (params.priority < existing.priority) {
          existing.priority = params.priority;
        }
        existing.callbacks.push(callbackEntry);
      } else {
        this.queue.push({
          key: params.key,
          priority: params.priority,
          pageId: params.pageId,
          pageIndex: params.pageIndex,
          scaleBucket: params.scaleBucket,
          isPreview: params.isPreview,
          isThumbnail: params.isThumbnail,
          request: params.request,
          callbacks: [callbackEntry],
          cancelled: false,
        });
      }
      this.pump();
    });

    return {
      promise,
      cancel: () => {
        cancelled = true;
        const job = this.queue.find((j) => j.key === params.key);
        if (!job || !callbackEntry) return;
        job.callbacks = job.callbacks.filter((cb) => cb !== callbackEntry);
        if (job.callbacks.length === 0) {
          job.cancelled = true;
          this.queue = this.queue.filter((j) => j !== job);
        }
      },
    };
  }

  cancelPageJobs(pageId: string): void {
    this.queue = this.queue.filter((job) => {
      if (job.pageId === pageId) {
        job.cancelled = true;
        return false;
      }
      return true;
    });
  }

  cancelStaleScaleTiles(keepScaleBucket: string): void {
    this.queue = this.queue.filter((job) => {
      if (!job.isPreview && !job.isThumbnail && job.scaleBucket !== keepScaleBucket) {
        job.cancelled = true;
        return false;
      }
      return true;
    });
  }

  private cancelByDoc(sourceDocId: string): void {
    this.queue = this.queue.filter((job) => {
      if (job.request.sourceDocId === sourceDocId) {
        job.cancelled = true;
        return false;
      }
      return true;
    });
  }

  private pump(): void {
    const maxWorkers = this.shouldUseSecondWorker() ? 2 : 1;
    for (let slotIdx = 0; slotIdx < maxWorkers; slotIdx++) {
      const slot = this.ensureSlot(slotIdx);
      if (slot.inFlightCount > 0) continue;
      if (this.queue.length === 0) break;

      this.queue.sort((a, b) => a.priority - b.priority);
      const nextJob = this.queue.shift();
      if (!nextJob || nextJob.cancelled) continue;

      slot.inFlightCount += 1;
      void this.executeJob(slot, nextJob).finally(() => {
        slot.inFlightCount = Math.max(0, slot.inFlightCount - 1);
        this.pump();
      });
    }
  }

  private async executeJob(slot: WorkerSlot, job: QueuedRenderJob): Promise<void> {
    try {
      await this.ensureDocOpenedOnSlot(slot, job.request.sourceDocId);
      if (job.cancelled) return;

      const res = await this.sendToSlot<{
        width: number;
        height: number;
        bitmap?: ImageBitmap;
        rgbaBuffer?: ArrayBuffer;
      }>(slot, 'renderTile', job.request as unknown as Record<string, unknown>);

      let bitmap = res.bitmap;
      if (!bitmap && res.rgbaBuffer) {
        const rgba = new Uint8ClampedArray(res.rgbaBuffer);
        bitmap = await createImageBitmap(new ImageData(rgba, res.width, res.height));
      }
      if (!bitmap) {
        throw new Error('Worker returned no bitmap');
      }

      if (job.cancelled) {
        bitmap.close();
        return;
      }

      const cache = job.isThumbnail ? thumbnailTileCache : viewerTileCache;
      cache.put({
        key: job.key,
        pageId: job.pageId,
        pageIndex: job.pageIndex,
        isPreview: job.isPreview,
        scaleBucket: job.scaleBucket,
        bitmap,
        width: res.width,
        height: res.height,
      });

      for (const cb of job.callbacks) {
        cb.resolve(bitmap);
      }
    } catch (err) {
      for (const cb of job.callbacks) {
        cb.reject(err);
      }
    }
  }
}

export const pdfiumScheduler = new PdfiumRenderScheduler();
