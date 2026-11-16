/// <reference lib="webworker" />
import pdfiumWasmUrl from '../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm?url';
import { PdfiumEngine } from '@/engine/pdfium/pdfiumEngine';
import { ensureRustCoreReady } from '@/engine/rustCoreBridge';
import type {
  PdfiumOpenResult,
  PdfLinkAnnotation,
  PdfOutlineNode,
  PdfSearchHit,
  PdfTextSpan,
  TileRenderRequest,
} from '@/engine/pdfium/pdfiumTypes';

export type PdfiumWorkerInbound =
  | { id: string; method: 'init'; payload: Record<string, never> }
  | {
      id: string;
      method: 'openDoc';
      payload: { sourceDocId: string; bytes: Uint8Array; password?: string };
    }
  | { id: string; method: 'closeDoc'; payload: { sourceDocId: string } }
  | { id: string; method: 'renderTile'; payload: TileRenderRequest }
  | { id: string; method: 'extractTextSpans'; payload: { sourceDocId: string; pageIndex: number } }
  | { id: string; method: 'getLinks'; payload: { sourceDocId: string; pageIndex: number } }
  | {
      id: string;
      method: 'searchDoc';
      payload: {
        searchId: string;
        sourceDocId: string;
        query: string;
        matchCase: boolean;
        wholeWord: boolean;
        startPageIndex: number;
        pageIndices: number[];
      };
    }
  | { id: string; method: 'cancelSearch'; payload: { searchId: string } }
  | { id: string; method: 'trim'; payload: { maxOpenPages: number } };

export type PdfiumWorkerOutbound =
  | {
      id: string;
      ok: true;
      type?: 'rpc';
      result:
        | { ready: true }
        | (PdfiumOpenResult & { outline: PdfOutlineNode[] })
        | { ok: true }
        | { width: number; height: number; bitmap?: ImageBitmap; rgbaBuffer?: ArrayBuffer }
        | { spans: PdfTextSpan[] }
        | { links: PdfLinkAnnotation[] };
    }
  | { id: string; ok: false; type?: 'rpc'; error: string }
  | {
      type: 'searchChunk';
      searchId: string;
      hits: PdfSearchHit[];
      scannedPages: number;
      totalPages: number;
      done: boolean;
    };

const engine = new PdfiumEngine();
let initPromise: Promise<void> | null = null;
const cancelledSearches = new Set<string>();

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Promise.all([
      engine.init({
        locateFile: () => pdfiumWasmUrl,
      }),
      ensureRustCoreReady(),
    ]).then(() => undefined);
  }
  return initPromise;
}

// Serialize all PDFium Wasm calls sequentially within this worker (00 -> D2)
let chain: Promise<void> = Promise.resolve();

function buildOutwardOrder(pageIndices: number[], startIdx: number): number[] {
  const ordered: number[] = [];
  const total = pageIndices.length;
  const clampedStart = Math.max(0, Math.min(total - 1, startIdx));
  const seen = new Set<number>();
  for (let delta = 0; delta < total; delta++) {
    const fwd = clampedStart + delta;
    if (fwd < total && !seen.has(fwd)) {
      seen.add(fwd);
      ordered.push(pageIndices[fwd]);
    }
    const bwd = clampedStart - delta;
    if (delta > 0 && bwd >= 0 && !seen.has(bwd)) {
      seen.add(bwd);
      ordered.push(pageIndices[bwd]);
    }
  }
  return ordered;
}

async function runStreamingSearch(
  msgId: string,
  payload: Extract<PdfiumWorkerInbound, { method: 'searchDoc' }>['payload'],
): Promise<void> {
  const { searchId, sourceDocId, query, matchCase, wholeWord, startPageIndex, pageIndices } =
    payload;
  cancelledSearches.delete(searchId);

  const ordered = buildOutwardOrder(pageIndices, startPageIndex);
  const totalPages = ordered.length;

  self.postMessage({ id: msgId, ok: true, result: { ok: true } } satisfies PdfiumWorkerOutbound);

  let scanned = 0;
  for (const pageIdx of ordered) {
    if (cancelledSearches.has(searchId)) {
      cancelledSearches.delete(searchId);
      return;
    }

    await new Promise<void>((resolve) => {
      chain = chain.then(async () => {
        if (cancelledSearches.has(searchId)) {
          resolve();
          return;
        }
        try {
          await ensureInit();
          if (!engine.hasDocument(sourceDocId)) {
            resolve();
            return;
          }
          const hits = engine.searchPage(sourceDocId, pageIdx, query, { matchCase, wholeWord });
          scanned += 1;
          const done = scanned >= totalPages;
          if (hits.length > 0 || done) {
            self.postMessage({
              type: 'searchChunk',
              searchId,
              hits,
              scannedPages: scanned,
              totalPages,
              done,
            } satisfies PdfiumWorkerOutbound);
          }
        } catch {
          scanned += 1;
        }
        resolve();
      });
    });

    // Yield to worker event loop so visible tile renders can preempt search pages
    await new Promise((r) => setTimeout(r, 0));
  }

  if (scanned === 0) {
    self.postMessage({
      type: 'searchChunk',
      searchId,
      hits: [],
      scannedPages: 0,
      totalPages,
      done: true,
    } satisfies PdfiumWorkerOutbound);
  }
}

self.onmessage = (event: MessageEvent<PdfiumWorkerInbound>) => {
  const msg = event.data;

  if (msg.method === 'cancelSearch') {
    cancelledSearches.add(msg.payload.searchId);
    self.postMessage({ id: msg.id, ok: true, result: { ok: true } } satisfies PdfiumWorkerOutbound);
    return;
  }

  if (msg.method === 'searchDoc') {
    void runStreamingSearch(msg.id, msg.payload);
    return;
  }

  chain = chain.then(async () => {
    try {
      await ensureInit();
      const transfer: Transferable[] = [];
      let result: unknown;

      switch (msg.method) {
        case 'init': {
          result = { ready: true };
          break;
        }
        case 'openDoc': {
          const res = engine.openDocument(
            msg.payload.sourceDocId,
            msg.payload.bytes,
            msg.payload.password,
          );
          const outline =
            res.status === 'ok' ? engine.getOutline(msg.payload.sourceDocId) : [];
          result = { ...res, outline };
          break;
        }
        case 'closeDoc': {
          engine.closeDocument(msg.payload.sourceDocId);
          result = { ok: true };
          break;
        }
        case 'trim': {
          engine.trimPages(msg.payload.maxOpenPages);
          result = { ok: true };
          break;
        }
        case 'renderTile': {
          const { width, height, rgba } = engine.renderTileRgba(msg.payload);
          const pixels = new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength);
          if (typeof createImageBitmap === 'function') {
            const imgData = new ImageData(pixels, width, height);
            const bitmap = await createImageBitmap(imgData);
            transfer.push(bitmap);
            result = { width, height, bitmap };
          } else {
            const copy = new Uint8ClampedArray(pixels);
            transfer.push(copy.buffer);
            result = { width, height, rgbaBuffer: copy.buffer };
          }
          break;
        }
        case 'extractTextSpans': {
          const spans = engine.extractPageTextSpans(
            msg.payload.sourceDocId,
            msg.payload.pageIndex,
          );
          result = { spans };
          break;
        }
        case 'getLinks': {
          const links = engine.getLinks(msg.payload.sourceDocId, msg.payload.pageIndex);
          result = { links };
          break;
        }
      }

      self.postMessage({ id: msg.id, ok: true, result } as PdfiumWorkerOutbound, transfer);
    } catch (err) {
      self.postMessage({
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies PdfiumWorkerOutbound);
    }
  });
};
