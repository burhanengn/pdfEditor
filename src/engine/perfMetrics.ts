export interface PerfLongTaskEntry {
  startTime: number;
  duration: number;
  name: string;
}

export interface PerfMetricReport {
  docOpenStartMs: number | null;
  firstPagePaintMs: number | null;
  ttfpMs: number | null;
  marks: Record<string, number>;
  durationsMs: Record<string, number>;
  longTaskCount: number;
  maxLongTaskMs: number;
  totalLongTaskMs: number;
  longTasks: PerfLongTaskEntry[];
  workerBytesCloned: number;
  workerBytesTransferred: number;
  workerCallCount: number;
  heapUsedBytes: number | null;
  heapTotalBytes: number | null;
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

class PerfMetricsTracker {
  private docOpenStartMs: number | null = null;
  private firstPagePaintMs: number | null = null;
  private marks = new Map<string, number>();
  private durationsMs = new Map<string, number>();
  private longTasks: PerfLongTaskEntry[] = [];
  private longTaskObserver: PerformanceObserver | null = null;
  private workerBytesCloned = 0;
  private workerBytesTransferred = 0;
  private workerCallCount = 0;

  startLongTaskObserver(): void {
    if (
      this.longTaskObserver ||
      typeof PerformanceObserver === 'undefined' ||
      !PerformanceObserver.supportedEntryTypes?.includes('longtask')
    ) {
      return;
    }
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) {
            this.longTasks.push({
              startTime: Math.round(entry.startTime),
              duration: Number(entry.duration.toFixed(2)),
              name: entry.name,
            });
          }
        }
      });
      this.longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      this.longTaskObserver = null;
    }
  }

  reset(): void {
    this.docOpenStartMs = null;
    this.firstPagePaintMs = null;
    this.marks.clear();
    this.durationsMs.clear();
    this.longTasks = [];
    this.workerBytesCloned = 0;
    this.workerBytesTransferred = 0;
    this.workerCallCount = 0;
  }

  markDocOpenStart(label?: string): number {
    const now = performance.now();
    this.docOpenStartMs = now;
    this.firstPagePaintMs = null;
    this.marks.set('doc_open_start', now);
    if (label) {
      this.marks.set(`doc_open_start:${label}`, now);
    }
    return now;
  }

  recordFirstPagePainted(): number | null {
    if (this.docOpenStartMs === null || this.firstPagePaintMs !== null) {
      return this.firstPagePaintMs !== null && this.docOpenStartMs !== null
        ? this.firstPagePaintMs - this.docOpenStartMs
        : null;
    }
    const now = performance.now();
    this.firstPagePaintMs = now;
    const ttfp = Math.max(0, Number((now - this.docOpenStartMs).toFixed(2)));
    this.marks.set('first_page_paint', now);
    this.durationsMs.set('ttfp', ttfp);
    return ttfp;
  }

  mark(name: string): number {
    const now = performance.now();
    this.marks.set(name, now);
    return now;
  }

  measure(name: string, startMark: string, endMark?: string): number | null {
    const start = this.marks.get(startMark);
    if (start === undefined) return null;
    const end = endMark ? this.marks.get(endMark) : performance.now();
    if (end === undefined) return null;
    const duration = Math.max(0, Number((end - start).toFixed(2)));
    this.durationsMs.set(name, duration);
    return duration;
  }

  recordDuration(name: string, durationMs: number): void {
    this.durationsMs.set(name, Math.max(0, Number(durationMs.toFixed(2))));
  }

  recordWorkerTransfer(bytesCopied: number, bytesTransferred: number): void {
    this.workerCallCount += 1;
    this.workerBytesCloned += Math.max(0, bytesCopied);
    this.workerBytesTransferred += Math.max(0, bytesTransferred);
  }

  getReport(): PerfMetricReport {
    const mem = (performance as PerformanceWithMemory).memory;
    const ttfpMs =
      this.docOpenStartMs !== null && this.firstPagePaintMs !== null
        ? Math.max(0, Number((this.firstPagePaintMs - this.docOpenStartMs).toFixed(2)))
        : null;

    let maxLongTaskMs = 0;
    let totalLongTaskMs = 0;
    for (const task of this.longTasks) {
      if (task.duration > maxLongTaskMs) maxLongTaskMs = task.duration;
      totalLongTaskMs += task.duration;
    }

    return {
      docOpenStartMs: this.docOpenStartMs,
      firstPagePaintMs: this.firstPagePaintMs,
      ttfpMs,
      marks: Object.fromEntries(this.marks.entries()),
      durationsMs: Object.fromEntries(this.durationsMs.entries()),
      longTaskCount: this.longTasks.length,
      maxLongTaskMs: Number(maxLongTaskMs.toFixed(2)),
      totalLongTaskMs: Number(totalLongTaskMs.toFixed(2)),
      longTasks: [...this.longTasks],
      workerBytesCloned: this.workerBytesCloned,
      workerBytesTransferred: this.workerBytesTransferred,
      workerCallCount: this.workerCallCount,
      heapUsedBytes: mem ? mem.usedJSHeapSize : null,
      heapTotalBytes: mem ? mem.totalJSHeapSize : null,
    };
  }
}

export const perfMetrics = new PerfMetricsTracker();

export function installBrowserPerfHook(): void {
  if (typeof window === 'undefined') return;
  perfMetrics.startLongTaskObserver();
  (window as unknown as { __gpPerf?: unknown }).__gpPerf = {
    getReport: () => perfMetrics.getReport(),
    reset: () => perfMetrics.reset(),
  };
}
