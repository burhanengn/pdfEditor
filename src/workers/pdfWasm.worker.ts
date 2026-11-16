import {
  clearExtractedFontsForDoc,
  extractEmbeddedFontsFromPdfBytes,
  getExtractedFontAssetPayloads,
} from '@/engine/embeddedFontExtractor';
import {
  compilePdfDocument,
  inspectPdfDocument,
  prepareCleanPreviewPagePdf,
  splitPdfToZip,
} from '@/engine/pdfCompiler';
import { pdfiumAnalyzer } from '@/engine/pdfium/pdfiumAnalyzer';
import { getSharedPdfium } from '@/engine/pdfium/pdfiumLoader';
import { ensureRustCoreReady } from '@/engine/rustCoreBridge';
import { extractTextBlocksFromPdfBytes } from '@/engine/textExtractor';
import { loadWorkerUnicodeFonts } from '@/engine/unicodeFonts';
import type {
  CompileSourceDocInput,
  FontAssetPayload,
  WorkerEnvelope,
  WorkerMethod,
} from '@/types/worker';

const registeredSourceBytes = new Map<string, Uint8Array>();

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

function releaseDocHandles(sourceDocId: string): void {
  registeredSourceBytes.delete(sourceDocId);
  clearExtractedFontsForDoc(sourceDocId);
  pdfiumAnalyzer.clearCacheForDoc(sourceDocId);
}

function hydrateSourceDocs(inputs: CompileSourceDocInput[]): Array<{ id: string; bytes: Uint8Array }> {
  return inputs.map((src) => ({
    id: src.id,
    bytes: resolveDocBytes(src.id, src.bytes),
  }));
}

async function mergeWorkerFontPayloads(
  customFonts?: FontAssetPayload[],
): Promise<FontAssetPayload[]> {
  const builtinUnicodeFonts = await loadWorkerUnicodeFonts();
  return customFonts && customFonts.length > 0
    ? [...builtinUnicodeFonts, ...customFonts]
    : builtinUnicodeFonts;
}

self.onmessage = async (event: MessageEvent<WorkerEnvelope>) => {
  const { id, method, payload } = event.data;

  try {
    const [pdfium, wasm] = await Promise.all([getSharedPdfium(), ensureRustCoreReady()]);
    let result: unknown;
    const transfer: Transferable[] = [];

    switch (method as WorkerMethod) {
      case 'ping': {
        result = { ready: true, mupdfLoaded: Boolean(pdfium && wasm) };
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
        const res = await inspectPdfDocument(p.bytes, p.password);
        let registeredInWorker = false;
        if (res.status === 'ok' && p.sourceDocId) {
          const workerBytes = res.decryptedBytes ?? p.bytes;
          registeredSourceBytes.set(p.sourceDocId, workerBytes);
          registeredInWorker = true;
          if (res.decryptedBytes) {
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
        const bytes = resolveDocBytes(p.sourceDocId, p.bytes);
        const textBlocks = await extractTextBlocksFromPdfBytes(
          bytes,
          p.sourcePageIndex,
          p.pageId,
          {
            horizontalRules: p.horizontalRules,
            verticalRules: p.verticalRules,
            cellRects: p.cellRects,
          },
        );
        result = { textBlocks };
        break;
      }
      case 'prepareCleanPage': {
        const p = payload as WorkerEnvelope<'prepareCleanPage'>['payload'];
        const bytes = resolveDocBytes(p.sourceDocId, p.bytes);
        const previewPdfBytes = await prepareCleanPreviewPagePdf(
          bytes,
          p.sourcePageIndex,
          p.textRects,
          p.imageRects,
          p.shapeRects,
        );
        transfer.push(previewPdfBytes.buffer);
        result = { bytes: previewPdfBytes };
        break;
      }
      case 'compilePdf': {
        const p = payload as WorkerEnvelope<'compilePdf'>['payload'];
        const mergedFonts = await mergeWorkerFontPayloads(p.fonts);
        const outBytes = await compilePdfDocument({
          ...p,
          sourceDocs: hydrateSourceDocs(p.sourceDocs),
          fonts: mergedFonts,
        });
        transfer.push(outBytes.buffer);
        result = { bytes: outBytes };
        break;
      }
      case 'splitPdfZip': {
        const p = payload as WorkerEnvelope<'splitPdfZip'>['payload'];
        const mergedFonts = await mergeWorkerFontPayloads(p.fonts);
        const zipBytes = await splitPdfToZip({
          ...p,
          sourceDocs: hydrateSourceDocs(p.sourceDocs),
          fonts: mergedFonts,
        });
        transfer.push(zipBytes.buffer);
        result = { zipBytes };
        break;
      }
      default:
        throw new Error(`Unsupported worker method: ${String(method)}`);
    }

    (self as unknown as Worker).postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
