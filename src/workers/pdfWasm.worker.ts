/// <reference lib="webworker" />
import type * as MuPdfNamespace from 'mupdf';
import mupdfWasmUrl from '../../node_modules/mupdf/dist/mupdf-wasm.wasm?url';
import type {
  CompileSourceDocInput,
  WorkerEnvelope,
  WorkerMethod,
  WorkerResponse,
} from '@/types/worker';
import {
  extractEmbeddedFontsFromPdfBytes,
  getExtractedFontAssetPayloads,
  clearExtractedFontsForDoc,
} from '@/engine/embeddedFontExtractor';
import {
  compilePdfDocument,
  inspectPdfDocument,
  prepareCleanPreviewPagePdf,
  splitPdfToZip,
  type MuPdfModule,
} from '@/engine/pdfCompiler';
import { ensureRustCoreReady } from '@/engine/rustCoreBridge';
import { extractTextBlocksFromMuPdfPage } from '@/engine/textExtractor';
import { loadWorkerUnicodeFonts } from '@/engine/unicodeFonts';

let mupdfPromise: Promise<MuPdfModule> | null = null;

async function getMuPdf(): Promise<MuPdfModule> {
  if (!mupdfPromise) {
    mupdfPromise = (async () => {
      (globalThis as Record<string, unknown>).$libmupdf_wasm_Module = {
        locateFile: () => mupdfWasmUrl,
      };
      const [mod] = await Promise.all([import('mupdf'), ensureRustCoreReady()]);
      return (mod.default ?? mod) as MuPdfModule;
    })();
  }
  return mupdfPromise;
}

const registeredSourceBytes = new Map<string, Uint8Array>();

// LRU cache of open source MuPDF documents (max 6) so per-page text extraction and
// live clean-page preview rendering execute in milliseconds without re-parsing large PDFs.
const MAX_CACHED_DOCS = 6;
const sourceDocCache = new Map<string, MuPdfNamespace.Document>();

function resolveDocBytes(sourceDocId: string, inlineBytes?: Uint8Array): Uint8Array {
  if (inlineBytes) {
    registeredSourceBytes.set(sourceDocId, inlineBytes);
    return inlineBytes;
  }
  const existing = registeredSourceBytes.get(sourceDocId);
  if (!existing) {
    throw new Error(`SOURCE_DOC_NOT_REGISTERED:${sourceDocId}`);
  }
  return existing;
}

function getOrOpenCachedSourceDoc(
  mupdf: MuPdfModule,
  sourceDocId: string,
  inlineBytes?: Uint8Array,
): MuPdfNamespace.Document {
  const bytes = resolveDocBytes(sourceDocId, inlineBytes);
  const cacheKey = `${sourceDocId}:${bytes.byteLength}`;
  const existing = sourceDocCache.get(cacheKey);
  if (existing) {
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

function releaseDocHandles(sourceDocId: string): void {
  registeredSourceBytes.delete(sourceDocId);
  clearExtractedFontsForDoc(sourceDocId);
  for (const [cacheKey, doc] of [...sourceDocCache.entries()]) {
    if (cacheKey.startsWith(`${sourceDocId}:`)) {
      sourceDocCache.delete(cacheKey);
      try {
        doc.destroy();
      } catch {
        // Ignore
      }
    }
  }
}

function hydrateSourceDocs(inputs: CompileSourceDocInput[]): Array<{ id: string; bytes: Uint8Array }> {
  return inputs.map((src) => ({
    id: src.id,
    bytes: resolveDocBytes(src.id, src.bytes),
  }));
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
      case 'registerSourceDoc': {
        const p = payload as WorkerEnvelope<'registerSourceDoc'>['payload'];
        registeredSourceBytes.set(p.sourceDocId, p.bytes);
        result = { ok: true };
        break;
      }
      case 'releaseSourceDoc': {
        const p = payload as WorkerEnvelope<'releaseSourceDoc'>['payload'];
        releaseDocHandles(p.sourceDocId);
        result = { ok: true };
        break;
      }
      case 'inspectPdf': {
        const p = payload as WorkerEnvelope<'inspectPdf'>['payload'];
        const res = await inspectPdfDocument(mupdf, p.bytes, p.password);
        let registeredInWorker = false;
        if (res.status === 'ok' && p.sourceDocId) {
          const workerBytes = res.decryptedBytes ?? p.bytes;
          registeredSourceBytes.set(p.sourceDocId, workerBytes);
          registeredInWorker = true;
          if (res.decryptedBytes) {
            // Keep workerBytes in worker and send a copy to main thread (until F1 moves raster to PDFium worker)
            const copyForMain = res.decryptedBytes.slice();
            res.decryptedBytes = copyForMain;
            transfer.push(copyForMain.buffer);
          }
        } else if (res.decryptedBytes) {
          transfer.push(res.decryptedBytes.buffer);
        }
        result = { ...res, registeredInWorker };
        break;
      }
      case 'extractEmbeddedFonts': {
        const p = payload as WorkerEnvelope<'extractEmbeddedFonts'>['payload'];
        const bytes = resolveDocBytes(p.sourceDocId, p.bytes);
        const fonts = await extractEmbeddedFontsFromPdfBytes(p.sourceDocId, bytes);
        const rawAssets = getExtractedFontAssetPayloads(fonts.map((f) => f.id));
        const assets = rawAssets.map((a) => {
          const cloned = {
            family: a.family,
            regular: a.regular ? a.regular.slice() : undefined,
            bold: a.bold ? a.bold.slice() : undefined,
            italic: a.italic ? a.italic.slice() : undefined,
            boldItalic: a.boldItalic ? a.boldItalic.slice() : undefined,
          };
          if (cloned.regular) transfer.push(cloned.regular.buffer);
          if (cloned.bold) transfer.push(cloned.bold.buffer);
          if (cloned.italic) transfer.push(cloned.italic.buffer);
          if (cloned.boldItalic) transfer.push(cloned.boldItalic.buffer);
          return cloned;
        });
        result = { fonts, assets };
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
        const hydratedDocs = hydrateSourceDocs(p.sourceDocs);
        const bytes = await compilePdfDocument(mupdf, {
          ...p,
          sourceDocs: hydratedDocs,
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
        const hydratedDocs = hydrateSourceDocs(p.sourceDocs);
        const zipBytes = await splitPdfToZip(mupdf, {
          ...p,
          sourceDocs: hydratedDocs,
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
