import type { WorkerEnvelope, WorkerMethod, WorkerRequestMap, WorkerResponse } from '@/types/worker';
import { createId } from '@/utils/id';
import { perfMetrics } from './perfMetrics';
import { getSourceDocBytes } from './sourceDocRegistry';

interface PendingCall {
  resolve: (value: never) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

class WasmWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingCall>();
  private registeredIds = new Set<string>();

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

  private postCall<M extends WorkerMethod>(
    method: M,
    payload: WorkerRequestMap[M]['payload'],
    timeoutMs = 120_000,
    transfer: Transferable[] = [],
  ): Promise<WorkerRequestMap[M]['result']> {
    const worker = this.ensureWorker();
    const id = createId('rpc');

    const transferredBytes = transfer.reduce<number>((sum, item) => {
      if (item instanceof ArrayBuffer) return sum + item.byteLength;
      return sum;
    }, 0);
    let payloadBytes = 0;
    const p = payload as unknown as { bytes?: Uint8Array; sourceDocs?: Array<{ bytes?: Uint8Array }> };
    if (p?.bytes instanceof Uint8Array) payloadBytes += p.bytes.byteLength;
    if (Array.isArray(p?.sourceDocs)) {
      for (const sd of p.sourceDocs) {
        if (sd?.bytes instanceof Uint8Array) payloadBytes += sd.bytes.byteLength;
      }
    }
    perfMetrics.recordWorkerTransfer(Math.max(0, payloadBytes - transferredBytes), transferredBytes);

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
      worker.postMessage(envelope, transfer);
    });
  }

  markSourceDocRegistered(sourceDocId: string): void {
    this.registeredIds.add(sourceDocId);
  }

  isSourceDocRegistered(sourceDocId: string): boolean {
    return this.registeredIds.has(sourceDocId);
  }

  async registerSourceDoc(sourceDocId: string, bytes: Uint8Array): Promise<void> {
    const copy = bytes.slice();
    await this.postCall(
      'registerSourceDoc',
      { sourceDocId, bytes: copy },
      30_000,
      [copy.buffer],
    );
    this.registeredIds.add(sourceDocId);
  }

  async releaseSourceDoc(sourceDocId: string): Promise<void> {
    this.registeredIds.delete(sourceDocId);
    if (!this.worker) return;
    await this.postCall('releaseSourceDoc', { sourceDocId }, 10_000).catch(() => {
      // Ignore if worker already terminated
    });
  }

  async releaseAllSourceDocs(): Promise<void> {
    const ids = [...this.registeredIds];
    this.registeredIds.clear();
    await Promise.all(ids.map((id) => this.releaseSourceDoc(id)));
  }

  async call<M extends WorkerMethod>(
    method: M,
    payload: WorkerRequestMap[M]['payload'],
    timeoutMs = 120_000,
    transfer: Transferable[] = [],
  ): Promise<WorkerRequestMap[M]['result']> {
    try {
      const res = await this.postCall(method, payload, timeoutMs, transfer);
      if (method === 'inspectPdf') {
        const inspectPayload = payload as WorkerRequestMap['inspectPdf']['payload'];
        const inspectResult = res as WorkerRequestMap['inspectPdf']['result'];
        if (inspectPayload.sourceDocId && inspectResult.registeredInWorker) {
          this.registeredIds.add(inspectPayload.sourceDocId);
        }
      }
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const prefix = 'SOURCE_DOC_NOT_REGISTERED:';
      if (msg.startsWith(prefix)) {
        const missingId = msg.slice(prefix.length).trim();
        const bytes = getSourceDocBytes(missingId);
        if (bytes) {
          await this.registerSourceDoc(missingId, bytes);
          return this.postCall(method, payload, timeoutMs, transfer);
        }
      }
      throw err;
    }
  }

  terminate(): void {
    this.registeredIds.clear();
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
