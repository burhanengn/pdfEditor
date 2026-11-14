import type { WorkerEnvelope, WorkerMethod, WorkerRequestMap, WorkerResponse } from '@/types/worker';
import { createId } from '@/utils/id';

interface PendingCall {
  resolve: (value: never) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

class WasmWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingCall>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/pdfWasm.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { id, ok, result, error } = event.data;
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timeoutId);
        if (ok) {
          entry.resolve(result as never);
        } else {
          entry.reject(new Error(error || 'PDF worker error'));
        }
      };
      this.worker.onerror = (err) => {
        for (const [id, entry] of this.pending.entries()) {
          clearTimeout(entry.timeoutId);
          entry.reject(new Error(err.message || 'PDF worker crashed'));
          this.pending.delete(id);
        }
        this.terminate();
      };
    }
    return this.worker;
  }

  call<M extends WorkerMethod>(
    method: M,
    payload: WorkerRequestMap[M]['payload'],
    timeoutMs = 120_000,
  ): Promise<WorkerRequestMap[M]['result']> {
    const worker = this.ensureWorker();
    const id = createId('rpc');
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Worker call "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: never) => void,
        reject,
        timeoutId,
      });

      const envelope: WorkerEnvelope<M> = { id, method, payload };
      worker.postMessage(envelope);
    });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timeoutId);
      entry.reject(new Error('Worker terminated'));
      this.pending.delete(id);
    }
  }
}

export const wasmWorkerClient = new WasmWorkerClient();
