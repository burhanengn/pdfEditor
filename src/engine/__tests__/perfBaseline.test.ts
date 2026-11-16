import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { perfMetrics } from '../perfMetrics';
import { generateReferencePdf } from '../referencePdfSet';

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
    const doc = mupdf.Document.openDocument(text120Bytes, 'application/pdf');
    try {
      expect(doc.countPages()).toBe(120);
      const p0 = doc.loadPage(0);
      try {
        const pix = p0.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
        pix.destroy();
        const ttfp = perfMetrics.recordFirstPagePainted();
        expect(ttfp).not.toBeNull();
        expect(ttfp!).toBeGreaterThanOrEqual(0);
      } finally {
        p0.destroy();
      }
    } finally {
      doc.destroy();
    }

    const scannedDoc = mupdf.Document.openDocument(scanned300Bytes, 'application/pdf');
    try {
      expect(scannedDoc.countPages()).toBe(300);
    } finally {
      scannedDoc.destroy();
    }

    const report = perfMetrics.getReport();
    expect(report.ttfpMs).not.toBeNull();
  });
});
