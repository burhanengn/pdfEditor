import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import pdfiumWasmUrl from '../../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm?url';

export type PdfiumRuntimeModule = WrappedPdfiumModule & {
  pdfium: WrappedPdfiumModule['pdfium'] & {
    HEAPU8: Uint8Array;
  };
};

let sharedPromise: Promise<PdfiumRuntimeModule> | null = null;
let sharedInstance: PdfiumRuntimeModule | null = null;

function isNodeEnv(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

/**
 * Lazily initializes and returns a single shared `@embedpdf/pdfium` Wasm instance
 * compatible with Browser Web Workers, main-thread fallback, and Node/Vitest tests.
 */
export async function getSharedPdfium(): Promise<PdfiumRuntimeModule> {
  if (sharedInstance) {
    return sharedInstance;
  }
  if (!sharedPromise) {
    sharedPromise = (async () => {
      let mod: WrappedPdfiumModule;
      if (isNodeEnv()) {
        const [{ default: fs }, { default: path }] = await Promise.all([
          import('node:fs'),
          import('node:path'),
        ]);
        const wasmPath = path.resolve(
          process.cwd(),
          'node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
        );
        const wasmBinary = fs.readFileSync(wasmPath);
        mod = await init({ wasmBinary });
      } else {
        mod = await init({ locateFile: () => pdfiumWasmUrl });
      }
      mod.PDFiumExt_Init();
      sharedInstance = mod as PdfiumRuntimeModule;
      return sharedInstance;
    })();
  }
  return sharedPromise;
}
