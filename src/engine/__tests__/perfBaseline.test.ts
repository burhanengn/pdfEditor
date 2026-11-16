import { describe, expect, it } from 'vitest';
import { perfMetrics } from '../perfMetrics';
import { generateReferencePdf } from '../referencePdfSet';
import {
  getPdfPageCountWithPdfium,
  renderPdfPageRgbaWithPdfium,
} from '../pdfium/__tests__/pdfTestHelpers';

describe('F0.1 performance baseline & reference PDF suite', () => {
  it('generates all reference PDF documents and measures parse/render timings', async () => {
    perfMetrics.reset();

    const formBytes = await generateReferencePdf('form-1p');
    const text120Bytes = await generateReferencePdf('text-120p', { pageCount: 120 });
    const scanned300Bytes = await generateReferencePdf('scanned-300p', { pageCount: 300 });
    const vectorBytes = await generateReferencePdf('vector-dense', { vectorSegments: 1200 });

    expect(formBytes.byteLength).toBeGreaterThan(500);
    expect(text120Bytes.byteLength).toBeGreaterThan(20_000);
    expect(scanned300Bytes.byteLength).toBeGreaterThan(30_000);
    expect(vectorBytes.byteLength).toBeGreaterThan(10_000);

    perfMetrics.markDocOpenStart('text-120p');
    const textPages = await getPdfPageCountWithPdfium(text120Bytes);
    expect(textPages).toBe(120);

    const rendered = await renderPdfPageRgbaWithPdfium(text120Bytes, 0, 1);
    expect(rendered.width).toBeGreaterThan(100);
    expect(rendered.height).toBeGreaterThan(100);
    const ttfp = perfMetrics.recordFirstPagePainted();
    expect(ttfp).not.toBeNull();
    expect(ttfp!).toBeGreaterThanOrEqual(0);

    const scannedPages = await getPdfPageCountWithPdfium(scanned300Bytes);
    expect(scannedPages).toBe(300);

    const report = perfMetrics.getReport();
    expect(report.ttfpMs).not.toBeNull();
  });
});
