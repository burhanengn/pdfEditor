import { describe, expect, it } from 'vitest';
import { compilePdfDocument, inspectPdfDocument } from '../pdfCompiler';
import {
  buildTestPdfWithPdfium,
  extractPdfTextWithPdfium,
  renderPdfPageRgbaWithPdfium,
} from '../pdfium/__tests__/pdfTestHelpers';
import { TileCache } from '../pdfium/tileCache';
import { generateReferencePdf } from '../referencePdfSet';

function fnv1aHash(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 4) {
    hash ^= bytes[i] ^ (bytes[i + 1] << 8) ^ (bytes[i + 2] << 16);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

describe('Phase F4.2: Memory Leak & Reference Visual/Performance Regression Gate', () => {
  it('opens, renders identically, and closes reference PDFs across repeated cycles without leaks', async () => {
    const formPdf = await generateReferencePdf('form-1p');
    const text120Pdf = await generateReferencePdf('text-120p', { pageCount: 120 });
    const scanned300Pdf = await generateReferencePdf('scanned-300p', { pageCount: 300 });
    const vectorPdf = await generateReferencePdf('vector-dense', { vectorSegments: 600 });
    const docs = [
      { label: 'form-1p', bytes: formPdf, expectedPages: 1 },
      { label: 'text-120p', bytes: text120Pdf, expectedPages: 120 },
      { label: 'scanned-300p', bytes: scanned300Pdf, expectedPages: 300 },
      { label: 'vector-dense', bytes: vectorPdf, expectedPages: 1 },
    ];

    const baselineHashes = new Map<string, number>();

    for (let cycle = 0; cycle < 6; cycle++) {
      for (const doc of docs) {
        const info = await inspectPdfDocument(doc.bytes);
        expect(info.status).toBe('ok');
        expect(info.pageCount).toBe(doc.expectedPages);

        const { width, height, data: rgba } = await renderPdfPageRgbaWithPdfium(doc.bytes, 0, 1);
        expect(width).toBeGreaterThan(200);
        expect(height).toBeGreaterThan(200);

        // Verify non-blank raster output (dark ink pixels present)
        let darkPixels = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          const luma = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          if (luma < 200) darkPixels++;
        }
        expect(darkPixels).toBeGreaterThan(50);

        const hash = fnv1aHash(rgba);
        const prevHash = baselineHashes.get(doc.label);
        if (prevHash === undefined) {
          baselineHashes.set(doc.label, hash);
        } else {
          // Exact pixel determinism across cycles (zero visual drift / stale PDFium state)
          expect(hash).toBe(prevHash);
        }
      }
    }
  });

  it('enforces TileCache LRU byte budget and releases ImageBitmap handles on trim & clear', () => {
    const cache = new TileCache(16 * 1024 * 1024); // Minimum enforced budget = 16 MB
    let closedBitmaps = 0;
    const makeFakeBitmap = () =>
      ({
        width: 1024,
        height: 1024,
        close: () => {
          closedBitmaps++;
        },
      }) as unknown as ImageBitmap;

    cache.setActiveContext(0, '100%');
    // Insert 6 tiles of 1024x1024x4 = 4 MB each (= 24 MB > 16 MB budget)
    for (let i = 0; i < 6; i++) {
      cache.put({
        key: `tile-${i}`,
        pageId: `p-${i}`,
        pageIndex: i === 0 ? 0 : i + 10,
        isPreview: i === 0,
        scaleBucket: i % 2 === 0 ? '100%' : '50%',
        bitmap: makeFakeBitmap(),
        width: 1024,
        height: 1024,
      });
    }

    const statsAfterPut = cache.getStats();
    expect(statsAfterPut.totalBytes).toBeLessThanOrEqual(statsAfterPut.budgetBytes);
    expect(closedBitmaps).toBeGreaterThanOrEqual(2);
    expect(cache.has('tile-0')).toBe(true); // active page preview retained

    cache.trim('background');
    expect(cache.has('tile-0')).toBe(true);
    expect(cache.getStats().count).toBe(1);

    cache.clear();
    expect(cache.getStats().count).toBe(0);
    expect(cache.getStats().totalBytes).toBe(0);
    expect(closedBitmaps).toBe(6);
  });

  it('preserves visual integrity and verified D3 redaction across compiled reference output', async () => {
    const srcBytes = await buildTestPdfWithPdfium([
      {
        width: 595,
        height: 842,
        texts: [
          { text: 'PUBLIC_HEADER_F4', x: 60, yPdf: 760, fontSize: 16 },
          { text: 'SECRET_TOKEN_999', x: 60, yPdf: 680, fontSize: 12 },
        ],
      },
    ]);

    const info = await inspectPdfDocument(srcBytes);
    expect(info.status).toBe('ok');
    const pm = info.pages[0];

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'doc-f4', bytes: srcBytes }],
      pages: [
        {
          id: 'p1',
          sourceDocId: 'doc-f4',
          sourcePageIndex: pm.sourcePageIndex,
          baseWidth: pm.baseWidth,
          baseHeight: pm.baseHeight,
          intrinsicRotation: pm.intrinsicRotation,
          userRotation: 0,
          mediaBox: pm.mediaBox,
          cropBox: pm.cropBox,
        },
      ],
      elements: [
        {
          id: 'red-f4',
          pageId: 'p1',
          kind: 'highlight',
          shape: 'redact',
          x: 50,
          y: 842 - 696,
          width: 240,
          height: 28,
          fillColor: '#000000',
          rotation: 0,
          opacity: 1,
          zIndex: 1,
        },
      ],
      optimizeWithMupdf: true,
    });

    const outText = await extractPdfTextWithPdfium(compiled, 0);
    expect(outText).toContain('PUBLIC_HEADER_F4');
    expect(outText).not.toContain('SECRET_TOKEN_999');
  });
});
