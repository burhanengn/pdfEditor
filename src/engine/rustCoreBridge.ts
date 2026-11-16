import initWasm, * as gpWasm from './wasm-core/gp_wasm';
import wasmUrl from './wasm-core/gp_wasm_bg.wasm?url';

export type GpWasmModule = typeof gpWasm;

let readyPromise: Promise<GpWasmModule> | null = null;
let initialized = false;

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

/**
 * Initializes the compiled Rust/Wasm core (`gp-wasm`) inside browser, Web Worker,
 * or Node/Vitest environments transparently.
 */
export async function ensureRustCoreReady(): Promise<GpWasmModule> {
  if (initialized) {
    return gpWasm;
  }
  if (!readyPromise) {
    readyPromise = (async () => {
      if (isNodeRuntime()) {
        const [{ default: fs }, { default: path }] = await Promise.all([
          import('node:fs'),
          import('node:path'),
        ]);
        const candidatePaths = [
          path.resolve(process.cwd(), 'src/engine/wasm-core/gp_wasm_bg.wasm'),
        ];
        for (const p of candidatePaths) {
          if (fs.existsSync(p)) {
            gpWasm.initSync({ module: fs.readFileSync(p) });
            initialized = true;
            return gpWasm;
          }
        }
      }
      await initWasm({ module_or_path: wasmUrl });
      initialized = true;
      return gpWasm;
    })();
  }
  return readyPromise;
}

/**
 * Synchronously initializes the Rust/Wasm module from raw `.wasm` bytes (used in Vitest/Node).
 */
export function initRustCoreSync(wasmBytes: Uint8Array | ArrayBuffer): GpWasmModule {
  if (!initialized) {
    const bufferSource = wasmBytes instanceof Uint8Array ? wasmBytes : new Uint8Array(wasmBytes);
    gpWasm.initSync({ module: bufferSource });
    initialized = true;
    readyPromise = Promise.resolve(gpWasm);
  }
  return gpWasm;
}

export function isRustCoreReady(): boolean {
  return initialized;
}

export function getRustCore(): GpWasmModule | null {
  return initialized ? gpWasm : null;
}

export function createRustSession(tileCacheBudgetBytes = 64 * 1024 * 1024): gpWasm.WasmSession {
  if (!initialized) {
    throw new Error('Rust/Wasm core must be initialized before instantiating WasmSession');
  }
  return new gpWasm.WasmSession(tileCacheBudgetBytes);
}
