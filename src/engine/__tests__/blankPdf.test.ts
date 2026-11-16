import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractPdfTextWithPdfium,
  getPdfPageCountWithPdfium,
  renderPdfPageRgbaWithPdfium,
} from '../pdfium/__tests__/pdfTestHelpers';
import { BLANK_PAGE_PRESETS, generateBlankPdfBytes } from '../blankPdf';
import { compilePdfDocument, inspectPdfDocument } from '../pdfCompiler';
import type { TextAddElement, VectorShapeElement } from '@/types/elements';
import type { PageMeta } from '@/types/pdf';
import type { FontAssetPayload } from '@/types/worker';

function loadMinimalUnicodeSansFonts(): FontAssetPayload[] {
  const djDir = path.resolve(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf');
  const uoDir = path.resolve(process.cwd(), 'node_modules/@universal-office/font-files');
  const readDj = (file: string) => new Uint8Array(fs.readFileSync(path.join(djDir, file)));
  const readUo = (file: string) => new Uint8Array(fs.readFileSync(path.join(uoDir, file)));
  return [
    {
      family: 'category:sans',
      regular: readUo('liberationsans-regular.ttf'),
      bold: readUo('liberationsans-bold.ttf'),
      italic: readUo('liberationsans-italic.ttf'),
      boldItalic: readUo('liberationsans-bolditalic.ttf'),
    },
    {
      family: 'fallback:sans',
      regular: readDj('DejaVuSans.ttf'),
      bold: readDj('DejaVuSans-Bold.ttf'),
      italic: readDj('DejaVuSans-Oblique.ttf'),
      boldItalic: readDj('DejaVuSans-BoldOblique.ttf'),
    },
  ];
}

describe('blankPdf engine', () => {
  it('generates valid blank PDFs for A4 Portrait, A4 Landscape, Letter, and multi-page counts', async () => {
    expect(BLANK_PAGE_PRESETS['a4-portrait']).toMatchObject({ width: 595, height: 842 });
    expect(BLANK_PAGE_PRESETS['a4-landscape']).toMatchObject({ width: 842, height: 595 });
    expect(BLANK_PAGE_PRESETS['letter-portrait']).toMatchObject({ width: 612, height: 792 });
    expect(BLANK_PAGE_PRESETS['letter-landscape']).toMatchObject({ width: 792, height: 612 });

    const defaultBytes = await generateBlankPdfBytes();
    const defaultInfo = await inspectPdfDocument(defaultBytes);
    expect(defaultInfo.status).toBe('ok');
    expect(defaultInfo.wasEncrypted).toBe(false);
    expect(defaultInfo.pageCount).toBe(1);
    expect(defaultInfo.pages[0].baseWidth).toBe(595);
    expect(defaultInfo.pages[0].baseHeight).toBe(842);

    const landscapeBytes = await generateBlankPdfBytes({
      preset: 'a4-landscape',
      pageCount: 3,
    });
    const landscapeInfo = await inspectPdfDocument(landscapeBytes);
    expect(landscapeInfo.status).toBe('ok');
    expect(landscapeInfo.pageCount).toBe(3);
    for (const p of landscapeInfo.pages) {
      expect(p.baseWidth).toBe(842);
      expect(p.baseHeight).toBe(595);
    }

    const letterBytes = await generateBlankPdfBytes({ preset: 'letter-portrait' });
    const letterInfo = await inspectPdfDocument(letterBytes);
    expect(letterInfo.pages[0].baseWidth).toBe(612);
    expect(letterInfo.pages[0].baseHeight).toBe(792);

    const customBytes = await generateBlankPdfBytes({ width: 500, height: 700, pageCount: 2 });
    const customInfo = await inspectPdfDocument(customBytes);
    expect(customInfo.pageCount).toBe(2);
    expect(customInfo.pages[0].baseWidth).toBe(500);
    expect(customInfo.pages[0].baseHeight).toBe(700);
  });

  it('supports adding Turkish text and rounded shapes onto a blank PDF and compiling with MuPDF', async () => {
    const blankBytes = await generateBlankPdfBytes({ preset: 'a4-portrait' });
    const info = await inspectPdfDocument(blankBytes);
    const p = info.pages[0];
    const pages: PageMeta[] = [
      {
        id: 'page_blank_0',
        sourceDocId: 'src_blank',
        sourcePageIndex: p.sourcePageIndex,
        baseWidth: p.baseWidth,
        baseHeight: p.baseHeight,
        intrinsicRotation: p.intrinsicRotation,
        userRotation: 0,
        mediaBox: p.mediaBox,
        cropBox: p.cropBox,
      },
    ];

    const roundedShape: VectorShapeElement = {
      id: 'shp_blank_1',
      pageId: 'page_blank_0',
      kind: 'shape',
      shapeType: 'rect',
      x: 60,
      y: 80,
      width: 140,
      height: 80,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      fillColor: '#10b981',
      strokeColor: '#064e3b',
      strokeWidth: 2,
      borderRadius: 16,
    };

    const turkishText: TextAddElement = {
      id: 'txt_blank_1',
      pageId: 'page_blank_0',
      kind: 'text-add',
      x: 60,
      y: 220,
      width: 360,
      height: 40,
      rotation: 0,
      opacity: 1,
      zIndex: 2,
      text: 'Boş Sayfa Şablonu: ğüşıİöç',
      fontFamily: 'DejaVuSans',
      fontSize: 16,
      color: '#0f172a',
      bold: false,
      italic: false,
      align: 'left',
      lineHeight: 1.3,
    };

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'src_blank', bytes: blankBytes }],
      pages,
      elements: [roundedShape, turkishText],
      fonts: loadMinimalUnicodeSansFonts(),
    });

    expect(await getPdfPageCountWithPdfium(compiled)).toBe(1);
    expect(await extractPdfTextWithPdfium(compiled, 0)).toContain('Boş Sayfa Şablonu');

    const { data: px, width: w } = await renderPdfPageRgbaWithPdfium(compiled, 0, 1);
    const n = 4;
    // Blank background spot (20, 20) stays pure white
    const bgIdx = (20 * w + 20) * n;
    expect(px[bgIdx]).toBeGreaterThan(245);
    expect(px[bgIdx + 1]).toBeGreaterThan(245);
    expect(px[bgIdx + 2]).toBeGreaterThan(245);
    // Green fill inside rounded shape (130, 120)
    const shapeIdx = (120 * w + 130) * n;
    expect(px[shapeIdx + 1]).toBeGreaterThan(150);
    expect(px[shapeIdx]).toBeLessThan(60);
  });
});
