/// <reference lib="webworker" />
import type * as MuPdfNamespace from 'mupdf';
import mupdfWasmUrl from '../../node_modules/mupdf/dist/mupdf-wasm.wasm?url';
import type { WorkerEnvelope, WorkerMethod, WorkerResponse } from '@/types/worker';
import {
  compilePdfDocument,
  inspectPdfDocument,
  prepareCleanPreviewPagePdf,
  splitPdfToZip,
  type MuPdfModule,
} from '@/engine/pdfCompiler';
import { extractTextBlocksFromMuPdfPage } from '@/engine/textExtractor';
import { loadWorkerUnicodeFonts } from '@/engine/unicodeFonts';

let mupdfPromise: Promise<MuPdfModule> | null = null;

async function getMuPdf(): Promise<MuPdfModule> {
  if (!mupdfPromise) {
    mupdfPromise = (async () => {
      (globalThis as Record<string, unknown>).$libmupdf_wasm_Module = {
        locateFile: () => mupdfWasmUrl,
      };
      const mod = await import('mupdf');
      return (mod.default ?? mod) as MuPdfModule;
    })();
  }
  return mupdfPromise;
}

// LRU cache of open source MuPDF documents (max 6) so per-page text extraction and
// live clean-page preview rendering execute in milliseconds without re-parsing large PDFs.
const MAX_CACHED_DOCS = 6;
const sourceDocCache = new Map<string, MuPdfNamespace.Document>();

function getOrOpenCachedSourceDoc(
  mupdf: MuPdfModule,
  sourceDocId: string,
  bytes: Uint8Array,
): MuPdfNamespace.Document {
  const cacheKey = `${sourceDocId}:${bytes.byteLength}`;
  const existing = sourceDocCache.get(cacheKey);
  if (existing) {
    // Refresh LRU recency
    sourceDocCache.delete(cacheKey);
    sourceDocCache.set(cacheKey, existing);
    return existing;
  }

  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  sourceDocCache.set(cacheKey, doc);
  while (sourceDocCache.size > MAX_CACHED_DOCS) {
    const oldestKey = sourceDocCache.keys().next().value;
    if (!oldestKey) break;
    const oldestDoc = sourceDocCache.get(oldestKey);
    sourceDocCache.delete(oldestKey);
    try {
      oldestDoc?.destroy();
    } catch {
      // Ignore already freed handle
    }
  }
  return doc;
}

self.onmessage = async (event: MessageEvent<WorkerEnvelope>) => {
  const { id, method, payload } = event.data;

  try {
    const mupdf = await getMuPdf();
    let result: unknown;
    const transfer: Transferable[] = [];

    switch (method as WorkerMethod) {
      case 'ping': {
        result = { ready: true, mupdfLoaded: Boolean(mupdf) };
        break;
      }
      case 'inspectPdf': {
        const p = payload as WorkerEnvelope<'inspectPdf'>['payload'];
        const res = await inspectPdfDocument(mupdf, p.bytes, p.password);
        if (res.decryptedBytes) {
          transfer.push(res.decryptedBytes.buffer);
        }
        result = res;
        break;
      }
      case 'extractPageText': {
        const p = payload as WorkerEnvelope<'extractPageText'>['payload'];
        const doc = getOrOpenCachedSourceDoc(mupdf, p.sourceDocId, p.bytes);
        const page = doc.loadPage(p.sourcePageIndex);
        try {
          const textBlocks = extractTextBlocksFromMuPdfPage(page, p.pageId, {
            horizontalRules: p.horizontalRules,
            verticalRules: p.verticalRules,
            cellRects: p.cellRects,
          });
          result = { textBlocks };
        } finally {
          page.destroy();
        }
        break;
      }
      case 'prepareCleanPage': {
        const p = payload as WorkerEnvelope<'prepareCleanPage'>['payload'];
        const doc = getOrOpenCachedSourceDoc(mupdf, p.sourceDocId, p.bytes);
        const pdfDoc = doc.asPDF();
        if (!pdfDoc) {
          throw new Error('Clean preview is unavailable for non-PDF document.');
        }
        const bytes = prepareCleanPreviewPagePdf(
          mupdf,
          pdfDoc,
          p.sourcePageIndex,
          p.textRects,
          p.imageRects,
          p.shapeRects ?? [],
        );
        transfer.push(bytes.buffer);
        result = { bytes };
        break;
      }
      case 'compilePdf': {
        const p = payload as WorkerEnvelope<'compilePdf'>['payload'];
        const unicodeFonts = await loadWorkerUnicodeFonts();
        const mergedFonts = p.fonts ? [...p.fonts, ...unicodeFonts] : unicodeFonts;
        const bytes = await compilePdfDocument(mupdf, {
          ...p,
          fonts: mergedFonts,
        });
        transfer.push(bytes.buffer);
        result = { bytes };
        break;
      }
      case 'splitPdfZip': {
        const p = payload as WorkerEnvelope<'splitPdfZip'>['payload'];
        const unicodeFonts = await loadWorkerUnicodeFonts();
        const mergedFonts = p.fonts ? [...p.fonts, ...unicodeFonts] : unicodeFonts;
        const zipBytes = await splitPdfToZip(mupdf, {
          ...p,
          fonts: mergedFonts,
        });
        transfer.push(zipBytes.buffer);
        result = { zipBytes };
        break;
      }
      default:
        throw new Error(`Unknown worker method: ${String(method)}`);
    }

    const response: WorkerResponse = { id, ok: true, result: result as never };
    self.postMessage(response, transfer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const response: WorkerResponse = { id, ok: false, error: message };
    self.postMessage(response);
  }
};
