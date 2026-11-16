# Performance & Bundle Baseline (Pre-Optimization Snapshot)

Captured on: `2026-11-17` against commit `6515126` (plus F0.1 instrumentation).

## 1. Bundle & PWA Precache Baseline (`vite build`)
- Main entry JS (`dist/assets/index-*.js`): **1,686.03 kB** (**647.67 kB** gzip)
- Main CSS (`dist/assets/index-*.css`): **47.15 kB** (**8.37 kB** gzip)
- Vendor chunks: `ui-vendor` 216.21 kB (64.74 kB gzip), `pdfjs-vendor` 413.73 kB (122.81 kB gzip)
- Worker bundles: `pdfWasm.worker` 1,318.32 kB, `pdf.worker` 2,161.15 kB
- MuPDF Wasm: `mupdf-wasm.wasm` 10,416.69 kB (4,766.19 kB gzip)
- Workbox PWA precache: **65 entries (32,327.15 KiB)**

## 2. Runtime Baseline (Chromium Headless, 120-page Reference Text PDF)
Measured via `e2e/perf-baseline.spec.ts` (`window.__gpPerf.getReport()`):
- **TTFP (Time to First Page Paint):** `449.34 ms`
- **Long Tasks (> 50 ms):** `1` (`maxLongTaskMs: 62 ms`, `totalLongTaskMs: 62 ms`)
- **Worker Calls on Open (Read-only):** `4` (`ping` + `inspectPdf` + automatic `extractPageText` on mounted pages)
- **Worker Bytes Cloned (Structured Clone):** `398,004 bytes`
- **Worker Bytes Transferred (`Transferable`):** `0 bytes`
- **JS Heap (`usedJSHeapSize` / `totalJSHeapSize`):** `14.79 MB` / `23.38 MB`

## 3. Post-F0 Measurement (Chromium Headless, 120-page Reference Text PDF)
- **TTFP (Time to First Page Paint):** `405.03 ms` (-9.9%)
- **Worker Bytes Cloned (Structured Clone):** `0 bytes` (down from `398,004 bytes` — 100% eliminated!)
- **Worker Bytes Transferred (`Transferable`):** `99,501 bytes` (single transfer on inspect)
- **JS Heap (`usedJSHeapSize` / `totalJSHeapSize`):** `12.51 MB` / `21.23 MB` (down from `14.79 MB` / `23.38 MB`)

## 4. Target Improvement Milestones
- **After F0:** `workerBytesCloned` for page text/clean-preview calls drops to `0`, `extractPageText`/`extractPageImagesAndRules` do not run on read-only open, `embeddedFontExtractor` runs off main thread, and `sourceDocs` bytes do not live in Zustand snapshots.
- **After F1:** Main JS viewer initial payload `<= 350 KB` gzip, PDFium Wasm tile pipeline replaces `pdfjs-dist` rendering, 0 long tasks (`> 50 ms`) during scroll/pinch.
- **After F3:** Zero `mupdf` / `pdfjs-dist` / `pdf-lib` runtime or bundle weight; single PDFium Rust/Wasm engine.
