import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTestPdfWithPdfium,
  createSolidPngBytes,
  extractPdfCharsWithPdfium,
  extractPdfTextWithPdfium,
  getPdfPageImageBoxesWithPdfium,
  renderPdfPageRgbaWithPdfium,
} from '../pdfium/__tests__/pdfTestHelpers';
import {
  compilePdfDocument,
  inspectPdfDocument,
  prepareCleanPreviewPagePdf,
  splitPdfToZip,
} from '../pdfCompiler';
import { extractTextBlocksFromPdfBytes } from '../textExtractor';
import { normalizeUnicodeForPdf } from '../fonts';
import type { PageMeta } from '@/types/pdf';
import type {
  ImageReplacementElement,
  ShapeReplacementElement,
  TextAddElement,
  TextEditElement,
} from '@/types/elements';
import type { FontAssetPayload } from '@/types/worker';

function loadNodeUnicodeFontPack(): FontAssetPayload[] {
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
      family: 'category:serif',
      regular: readUo('liberationserif-regular.ttf'),
      bold: readUo('liberationserif-bold.ttf'),
      italic: readUo('liberationserif-italic.ttf'),
      boldItalic: readUo('liberationserif-bolditalic.ttf'),
    },
    {
      family: 'category:mono',
      regular: readUo('liberationmono-regular.ttf'),
      bold: readUo('liberationmono-bold.ttf'),
      italic: readUo('liberationmono-italic.ttf'),
      boldItalic: readUo('liberationmono-bolditalic.ttf'),
    },
    {
      family: 'category:calibri',
      regular: readUo('carlito-regular.ttf'),
      bold: readUo('carlito-bold.ttf'),
      italic: readUo('carlito-italic.ttf'),
      boldItalic: readUo('carlito-bolditalic.ttf'),
    },
    {
      family: 'category:cambria',
      regular: readUo('caladea-regular.ttf'),
      bold: readUo('caladea-bold.ttf'),
      italic: readUo('caladea-italic.ttf'),
      boldItalic: readUo('caladea-bolditalic.ttf'),
    },
    {
      family: 'category:script',
      regular: readUo('liberationserif-italic.ttf'),
      bold: readUo('liberationserif-bolditalic.ttf'),
      italic: readUo('liberationserif-italic.ttf'),
      boldItalic: readUo('liberationserif-bolditalic.ttf'),
    },
    {
      family: 'fallback:sans',
      regular: readDj('DejaVuSans.ttf'),
      bold: readDj('DejaVuSans-Bold.ttf'),
      italic: readDj('DejaVuSans-Oblique.ttf'),
      boldItalic: readDj('DejaVuSans-BoldOblique.ttf'),
    },
    {
      family: 'fallback:serif',
      regular: readDj('DejaVuSerif.ttf'),
      bold: readDj('DejaVuSerif-Bold.ttf'),
      italic: readDj('DejaVuSerif-Italic.ttf'),
      boldItalic: readDj('DejaVuSerif-BoldItalic.ttf'),
    },
    {
      family: 'fallback:mono',
      regular: readDj('DejaVuSansMono.ttf'),
      bold: readDj('DejaVuSansMono-Bold.ttf'),
      italic: readDj('DejaVuSansMono-Oblique.ttf'),
      boldItalic: readDj('DejaVuSansMono-BoldOblique.ttf'),
    },
    {
      family: 'fallback:script',
      regular: readDj('DejaVuSerif-Italic.ttf'),
      bold: readDj('DejaVuSerif-BoldItalic.ttf'),
      italic: readDj('DejaVuSerif-Italic.ttf'),
      boldItalic: readDj('DejaVuSerif-BoldItalic.ttf'),
    },
  ];
}

function createSamplePngBytes(): Uint8Array {
  return createSolidPngBytes(20, 20, [220, 220, 220, 255]);
}

async function createSamplePdf(): Promise<Uint8Array> {
  return buildTestPdfWithPdfium([
    {
      width: 612,
      height: 792,
      texts: [
        { text: 'REPLACE_ME_HEADER', x: 72, yPdf: 720, fontSize: 18, color: [0, 0, 0] },
        { text: 'KEEP_THIS_LINE_INTACT', x: 72, yPdf: 660, fontSize: 14, color: [26, 51, 128] },
      ],
      images: [
        { pngBytes: createSamplePngBytes(), x: 72, yPdf: 500, width: 100, height: 100 },
      ],
    },
    {
      width: 612,
      height: 792,
      rotation: 90,
      texts: [{ text: 'ROTATED_PAGE_TEXT', x: 100, yPdf: 700, fontSize: 16, color: [0, 0, 0] }],
    },
  ]);
}

function extractPagePlainText(bytes: Uint8Array, pageIndex: number): Promise<string> {
  return extractPdfTextWithPdfium(bytes, pageIndex);
}

function getPageImageBoxes(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<Array<[number, number, number, number]>> {
  return getPdfPageImageBoxesWithPdfium(bytes, pageIndex);
}

describe('pdfCompiler with real MuPDF Wasm + pdf-lib', () => {
  it('inspects multi-page PDF and detects intrinsic rotation', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(bytes);
    expect(info.status).toBe('ok');
    expect(info.wasEncrypted).toBe(false);
    expect(info.pageCount).toBe(2);
    expect(info.pages[0].baseWidth).toBe(612);
    expect(info.pages[0].baseHeight).toBe(792);
    expect(info.pages[0].intrinsicRotation).toBe(0);
    expect(info.pages[1].intrinsicRotation).toBe(90);
    expect(info.pages[1].baseWidth).toBe(792);
    expect(info.pages[1].baseHeight).toBe(612);
  });

  it('handles encrypted PDFs with password prompt and decryption', async () => {
    const encryptedBytes = await buildTestPdfWithPdfium(
      [
        {
          width: 612,
          height: 792,
          texts: [{ text: 'SECRET_1', x: 72, yPdf: 720, fontSize: 16 }],
        },
        {
          width: 612,
          height: 792,
          texts: [{ text: 'SECRET_2', x: 72, yPdf: 720, fontSize: 16 }],
        },
      ],
      { userPassword: 'hunter2', ownerPassword: 'admin' },
    );

    const noPw = await inspectPdfDocument(encryptedBytes);
    expect(noPw.status).toBe('needs-password');

    const badPw = await inspectPdfDocument(encryptedBytes, 'wrong');
    expect(badPw.status).toBe('invalid-password');

    const okPw = await inspectPdfDocument(encryptedBytes, 'hunter2');
    expect(okPw.status).toBe('ok');
    expect(okPw.wasEncrypted).toBe(true);
    expect(okPw.decryptedBytes).toBeDefined();
    expect(okPw.pageCount).toBe(2);
  });

  it('strips original text stream operators via MuPDF Wasm and renders edited text cleanly', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(bytes);

    const pages: PageMeta[] = info.pages.map((p, idx) => ({
      id: `page_${idx}`,
      sourceDocId: 'src_1',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    // In visual coords on 612x792 page: y_pdf=720 baseline -> visual top ~ 792 - 738 = 54, height ~ 24
    const textEdit: TextEditElement = {
      id: 'edit_1',
      pageId: 'page_0',
      kind: 'text-edit',
      originalBlockId: 'blk_1',
      originalRect: { x: 68, y: 50, width: 240, height: 28 },
      originalText: 'REPLACE_ME_HEADER',
      x: 68,
      y: 50,
      width: 260,
      height: 28,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      text: 'UPDATED_TITLE_WASM',
      fontFamily: 'Helvetica',
      fontSize: 18,
      color: '#1d4ed8',
      bold: true,
      italic: false,
      align: 'left',
      lineHeight: 1.2,
    };

    const textAdd: TextAddElement = {
      id: 'add_1',
      pageId: 'page_1',
      kind: 'text-add',
      x: 100,
      y: 100,
      width: 200,
      height: 30,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      text: 'ADDED_ON_ROTATED_PAGE',
      fontFamily: 'Courier',
      fontSize: 14,
      color: '#dc2626',
      bold: false,
      italic: false,
      align: 'left',
      lineHeight: 1.2,
    };

    const imgReplace: ImageReplacementElement = {
      id: 'img_rep_1',
      pageId: 'page_0',
      kind: 'image-replacement',
      originalImageId: 'img_1',
      resourceName: 'Im1',
      originalRect: { x: 72, y: 192, width: 100, height: 100 },
      name: 'MovedImage.png',
      mimeType: 'image/png',
      bytes: createSamplePngBytes(),
      previewUrl: '',
      x: 320,
      y: 250,
      width: 140,
      height: 140,
      rotation: 15,
      opacity: 0.9,
      zIndex: 2,
      naturalWidth: 20,
      naturalHeight: 20,
      aspectLocked: true,
    };

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [textEdit, textAdd, imgReplace],
      optimizeWithMupdf: true,
    });

    const p0Text = await extractPagePlainText(compiled, 0);
    expect(p0Text).not.toContain('REPLACE_ME_HEADER');
    expect(p0Text).toContain('UPDATED_TITLE_WASM');
    expect(p0Text).toContain('KEEP_THIS_LINE_INTACT');

    const p1Text = await extractPagePlainText(compiled, 1);
    expect(p1Text).toContain('ROTATED_PAGE_TEXT');
    expect(p1Text).toContain('ADDED_ON_ROTATED_PAGE');

    // Original image was removed and re-embedded once at its moved/resized geometry
    const imgBoxes = await getPageImageBoxes(compiled, 0);
    expect(imgBoxes).toHaveLength(1);
    expect(imgBoxes[0][0]).toBeGreaterThan(280);
  });

  it('splits pages into multiple PDFs bundled in a valid ZIP archive', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(bytes);
    const pages: PageMeta[] = info.pages.map((p, idx) => ({
      id: `page_${idx}`,
      sourceDocId: 'src_1',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    const zipBytes = await splitPdfToZip({
      sourceDocs: [{ id: 'src_1', bytes }],
      elements: [],
      jobs: [
        { id: 'j1', filename: 'part-1.pdf', pages: [pages[0]] },
        { id: 'j2', filename: 'part-2.pdf', pages: [pages[1]] },
      ],
    });

    expect(zipBytes.byteLength).toBeGreaterThan(200);
    // ZIP magic bytes PK\x03\x04
    expect(zipBytes[0]).toBe(0x50);
    expect(zipBytes[1]).toBe(0x4b);
  });

  it('compiles 100-page document with strokes, highlights, black redaction, and vector signature', async () => {
    const rawBytes = await buildTestPdfWithPdfium(
      Array.from({ length: 100 }, (_, i) => ({
        width: 612,
        height: 792,
        texts: [
          { text: `Page ${i + 1}`, x: 50, yPdf: 720, fontSize: 12 },
          ...(i === 0 ? [{ text: 'CONFIDENTIAL_SECRET', x: 50, yPdf: 650, fontSize: 14 }] : []),
        ],
      })),
    );
    const info = await inspectPdfDocument(rawBytes);
    expect(info.pageCount).toBe(100);

    const pages: PageMeta[] = info.pages.map((p, idx) => ({
      id: `p_${idx}`,
      sourceDocId: 'big',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    const out = await compilePdfDocument({
      sourceDocs: [{ id: 'big', bytes: rawBytes }],
      pages,
      elements: [
        {
          id: 'redact_1',
          pageId: 'p_0',
          kind: 'highlight',
          shape: 'redact',
          x: 45,
          y: 124,
          width: 190,
          height: 24,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          fillColor: '#000000',
        },
        {
          id: 'stroke_1',
          pageId: 'p_0',
          kind: 'stroke',
          x: 100,
          y: 250,
          width: 120,
          height: 60,
          rotation: 0,
          opacity: 0.85,
          zIndex: 2,
          points: [
            { x: 0, y: 0.5 },
            { x: 0.5, y: 0 },
            { x: 1, y: 1 },
          ],
          strokeColor: '#ef4444',
          strokeWidth: 3,
        },
        {
          id: 'sig_vec',
          pageId: 'p_99',
          kind: 'signature',
          signatureId: 's1',
          label: 'Vector Sig',
          pngBytes: createSamplePngBytes(),
          previewUrl: '',
          naturalWidth: 200,
          naturalHeight: 80,
          aspectLocked: true,
          svgPaths: [{ d: 'M 10 40 Q 80 10 180 50', strokeWidth: 3, color: '#1d4ed8' }],
          viewBoxWidth: 200,
          viewBoxHeight: 80,
          x: 120,
          y: 500,
          width: 160,
          height: 64,
          rotation: 0,
          opacity: 1,
          zIndex: 3,
        },
      ],
      optimizeWithMupdf: true,
    });

    const p0Text = await extractPagePlainText(out, 0);
    expect(p0Text).not.toContain('CONFIDENTIAL_SECRET');
    expect(p0Text).toContain('Page 1');

    const check = await inspectPdfDocument(out);
    expect(check.pageCount).toBe(100);
  });

  it('completely removes deleted embedded image XObject operators on export', async () => {
    const bytes = await createSamplePdf();
    expect(await getPageImageBoxes(bytes, 0)).toHaveLength(1);

    const info = await inspectPdfDocument(bytes);
    const pages: PageMeta[] = info.pages.map((p, idx) => ({
      id: `page_${idx}`,
      sourceDocId: 'src_1',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    const deletedImg: ImageReplacementElement = {
      id: 'img_del_1',
      pageId: 'page_0',
      kind: 'image-replacement',
      originalImageId: 'img_1',
      resourceName: 'Im1',
      originalRect: { x: 72, y: 192, width: 100, height: 100 },
      deleted: true,
      name: 'Deleted.png',
      mimeType: 'image/png',
      bytes: createSamplePngBytes(),
      previewUrl: '',
      x: 72,
      y: 192,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      naturalWidth: 20,
      naturalHeight: 20,
      aspectLocked: true,
    };

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [deletedImg],
      optimizeWithMupdf: true,
    });

    expect(await getPageImageBoxes(compiled, 0)).toHaveLength(0);
    expect(await extractPagePlainText(compiled, 0)).toContain('REPLACE_ME_HEADER');
  });

  it('embeds full Turkish & Unicode glyphs cleanly without question-mark fallback', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(bytes);
    const pages: PageMeta[] = info.pages.map((p, idx) => ({
      id: `page_${idx}`,
      sourceDocId: 'src_1',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    const turkishText: TextAddElement = {
      id: 'tr_1',
      pageId: 'page_0',
      kind: 'text-add',
      x: 54,
      y: 300,
      width: 450,
      height: 80,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      text: 'YURT DIŞI ÖĞRENCİ BİLGİLERİ: öğrenciyle görüşülerek şğüöçıİŞĞÜÖÇ ₺1.250',
      fontFamily: 'TimesRoman',
      fontSize: 13,
      color: '#111827',
      bold: true,
      italic: true,
      align: 'left',
      lineHeight: 1.25,
    };

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [turkishText],
      fonts: loadNodeUnicodeFontPack(),
      optimizeWithMupdf: true,
    });

    const outText = await extractPagePlainText(compiled, 0);
    expect(outText).not.toContain('?');
    expect(outText).toContain('ÖĞRENCİ');
    expect(outText).toContain('öğrenciyle');
    expect(outText).toContain('şğüöçıİŞĞÜÖÇ');
    expect(outText).toContain('₺1.250');
  });

  it('prepareCleanPreviewPagePdf removes overlapping background image while preserving table text', async () => {
    const bytes = await buildTestPdfWithPdfium([
      {
        width: 612,
        height: 792,
        images: [{ pngBytes: createSamplePngBytes(), x: 40, yPdf: 120, width: 520, height: 600 }],
        lines: [{ x1: 40, y1Pdf: 650, x2: 560, y2Pdf: 650, stroke: [0, 0, 0], strokeWidth: 2 }],
        texts: [{ text: 'OVERLAID_TABLE_CELL', x: 60, yPdf: 660, fontSize: 12 }],
      },
    ]);

    expect(await getPageImageBoxes(bytes, 0)).toHaveLength(1);

    const cleanBytes = await prepareCleanPreviewPagePdf(
      bytes,
      0,
      [],
      [{ x: 40, y: 72, width: 520, height: 600 }],
    );

    expect(await getPageImageBoxes(cleanBytes, 0)).toHaveLength(0);
    expect(await extractPagePlainText(cleanBytes, 0)).toContain('OVERLAID_TABLE_CELL');
  });

  it('exports Calibri metric font cleanly with Turkish characters and currency fallback', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(bytes);
    const pages: PageMeta[] = info.pages.map((p, idx) => ({
      id: `page_${idx}`,
      sourceDocId: 'src_1',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    const calibriText: TextAddElement = {
      id: 'cal_1',
      pageId: 'page_0',
      kind: 'text-add',
      x: 54,
      y: 340,
      width: 440,
      height: 50,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      text: 'Calibri Metrik Doğrulaması: şğüöçıİŞĞÜÖÇ ₺2.500',
      fontFamily: 'Calibri',
      fontSize: 12,
      color: '#111827',
      bold: false,
      italic: false,
      align: 'left',
      lineHeight: 1.25,
    };

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [calibriText],
      fonts: loadNodeUnicodeFontPack(),
      optimizeWithMupdf: true,
    });

    const outText = await extractPagePlainText(compiled, 0);
    expect(outText).toContain('Calibri Metrik Doğrulaması');
    expect(outText).toContain('şğüöçıİŞĞÜÖÇ');
    expect(outText).toContain('₺2.500');
  });

  it('justifies soft-wrapped lines flush to both edges while keeping final line left-aligned', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(bytes);
    const pages: PageMeta[] = [info.pages[0]].map((p) => ({
      id: 'page_0',
      sourceDocId: 'src_1',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    const boxX = 60;
    const boxWidth = 260;
    const justifiedEl: TextAddElement = {
      id: 'just_1',
      pageId: 'page_0',
      kind: 'text-add',
      x: boxX,
      y: 220,
      width: boxWidth,
      height: 120,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      text: 'Öğrencinin yurt dışı öğrenim programı kapsamında düzenlenen resmi onay belgesi kurallar uyarınca iki yana yaslı biçimde hizalanır.',
      fontFamily: 'TimesRoman',
      fontSize: 11,
      color: '#000000',
      bold: false,
      italic: false,
      align: 'justify',
      lineHeight: 1.3,
    };

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [justifiedEl],
      fonts: loadNodeUnicodeFontPack(),
      optimizeWithMupdf: true,
    });

    const chars = await extractPdfCharsWithPdfium(compiled, 0);
    const rowMap: Array<{ y: number; x0: number; x1: number; text: string }> = [];
    for (const ch of chars) {
      if (!ch.ch.trim()) continue;
      if (ch.originY < 215 || ch.originY > 360) continue;
      const existing = rowMap.find((r) => Math.abs(r.y - ch.originY) <= 2.5);
      if (existing) {
        existing.x0 = Math.min(existing.x0, ch.x0);
        existing.x1 = Math.max(existing.x1, ch.x1);
        existing.text += ch.ch;
      } else {
        rowMap.push({ y: ch.originY, x0: ch.x0, x1: ch.x1, text: ch.ch });
      }
    }
    rowMap.sort((a, b) => a.y - b.y);

    expect(rowMap.length).toBeGreaterThanOrEqual(3);
    expect(rowMap[0].x0).toBeCloseTo(boxX, 0);
    expect(rowMap[0].x1).toBeGreaterThan(boxX + boxWidth - 8);
    expect(rowMap[1].x1).toBeGreaterThan(boxX + boxWidth - 8);
    const last = rowMap[rowMap.length - 1];
    expect(last.x1).toBeLessThan(boxX + boxWidth - 20);

    const blocks = await extractTextBlocksFromPdfBytes(compiled, 0, 'page_0');
    const roundTripped = blocks.find((b) => b.text.includes('iki yana yaslı'));
    expect(roundTripped).toBeDefined();
    expect(roundTripped!.align).toBe('justify');
  });

  it('exports superscript and subscript runs with raised and lowered baseline coordinates', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(bytes);
    const pages: PageMeta[] = [info.pages[0]].map((p) => ({
      id: 'page_0',
      sourceDocId: 'src_1',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    const richEl: TextAddElement = {
      id: 'rich_1',
      pageId: 'page_0',
      kind: 'text-add',
      x: 72,
      y: 360,
      width: 300,
      height: 50,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      text: 'Alan 10X kimyasal HYO',
      runs: [
        { text: 'Alan 10', script: 'normal' },
        { text: 'X', script: 'super' },
        { text: ' kimyasal H', script: 'normal' },
        { text: 'Y', script: 'sub' },
        { text: 'O', script: 'normal' },
      ],
      fontFamily: 'TimesRoman',
      fontSize: 14,
      color: '#000000',
      bold: false,
      italic: false,
      align: 'left',
      lineHeight: 1.3,
    };

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [richEl],
      fonts: loadNodeUnicodeFontPack(),
      optimizeWithMupdf: true,
    });

    const glyphs = (await extractPdfCharsWithPdfium(compiled, 0)).filter(
      (g) => g.originY >= 350 && g.originY <= 410,
    );

    const baseH = glyphs.find((g) => g.ch === 'H');
    const superX = glyphs.find((g) => g.ch === 'X');
    const subY = glyphs.find((g) => g.ch === 'Y');

    expect(baseH).toBeDefined();
    expect(superX).toBeDefined();
    expect(subY).toBeDefined();
    expect(superX!.originY).toBeLessThan(baseH!.originY - 2.5);
    expect(superX!.size).toBeLessThan(baseH!.size - 2);
    expect(subY!.originY).toBeGreaterThan(baseH!.originY + 1.5);
    expect(subY!.size).toBeLessThan(baseH!.size - 2);
  });

  it('keeps moved behindContent watermark behind dark table lines and text on export', async () => {
    const bytes = await buildTestPdfWithPdfium([
      {
        width: 612,
        height: 792,
        images: [{ pngBytes: createSamplePngBytes(), x: 100, yPdf: 400, width: 200, height: 200 }],
        lines: [{ x1: 80, y1Pdf: 500, x2: 400, y2Pdf: 500, stroke: [0, 0, 0], strokeWidth: 4 }],
        texts: [{ text: 'TABLE_TEXT_IN_FRONT', x: 120, yPdf: 515, fontSize: 12 }],
      },
    ]);

    const info = await inspectPdfDocument(bytes);
    const pages: PageMeta[] = [info.pages[0]].map((pm) => ({
      id: 'page_0',
      sourceDocId: 'src_1',
      sourcePageIndex: pm.sourcePageIndex,
      baseWidth: pm.baseWidth,
      baseHeight: pm.baseHeight,
      intrinsicRotation: pm.intrinsicRotation,
      userRotation: 0,
      mediaBox: pm.mediaBox,
      cropBox: pm.cropBox,
    }));

    // Replace/move watermark image with behindContent=true
    const movedWatermark: ImageReplacementElement = {
      id: 'wm_behind',
      pageId: 'page_0',
      kind: 'image-replacement',
      originalImageId: 'img_1',
      resourceName: 'Im1',
      originalRect: { x: 100, y: 192, width: 200, height: 200 },
      name: 'Watermark.png',
      mimeType: 'image/png',
      bytes: createSamplePngBytes(),
      previewUrl: '',
      x: 120,
      y: 192,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 0.45,
      zIndex: 0,
      behindContent: true,
      naturalWidth: 20,
      naturalHeight: 20,
      aspectLocked: true,
    };

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [movedWatermark],
      fonts: loadNodeUnicodeFontPack(),
      optimizeWithMupdf: true,
    });

    const { data: px, width: w } = await renderPdfPageRgbaWithPdfium(compiled, 0, 1);
    const n = 4;
    // Sample middle of black line at (x=200, y=292) inside moved watermark [120..320, 192..392]
    let minLuma = 255;
    for (let dy = -2; dy <= 2; dy++) {
      const idx = ((292 + dy) * w + 200) * n;
      const luma = 0.2126 * px[idx] + 0.7152 * px[idx + 1] + 0.0722 * px[idx + 2];
      minLuma = Math.min(minLuma, luma);
    }
    // Dark border line MUST remain black in front of moved watermark!
    expect(minLuma).toBeLessThan(40);
  });

  it('keeps single-line Turkish text on 1 line and emits PDF Tz scaling when slightly wider than box', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(bytes);
    const pages: PageMeta[] = [info.pages[0]].map((p) => ({
      id: 'page_0',
      sourceDocId: 'src_1',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    // Box width is intentionally ~4% narrower than natural glyph width at 12pt DejaVu Sans,
    // forcing `disableSoftWrap` + PDF `Tz` scaling to keep the text on 1 single line inside `width`.
    const boxX = 54;
    const boxWidth = 164;
    const singleLineEl: TextAddElement = {
      id: 'single_tz_1',
      pageId: 'page_0',
      kind: 'text-add',
      x: boxX,
      y: 260,
      width: boxWidth,
      height: 16,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      text: 'ĞÜŞİÖÇ ğüşiöç ıİ Tek Satır Test',
      fontFamily: 'Helvetica',
      fontSize: 12,
      color: '#111827',
      bold: false,
      italic: false,
      align: 'left',
      lineHeight: 1.2,
      renderedLineCount: 1,
      widthResizedByUser: false,
    };

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [singleLineEl],
      fonts: loadNodeUnicodeFontPack(),
      optimizeWithMupdf: false,
    });

    const chars = await extractPdfCharsWithPdfium(compiled, 0);
    const rows: Array<{ y: number; x0: number; x1: number; text: string }> = [];
    for (const ch of chars) {
      if (!ch.ch.trim()) continue;
      if (ch.originY < 255 || ch.originY > 310) continue;
      const existing = rows.find((r) => Math.abs(r.y - ch.originY) <= 2.5);
      if (existing) {
        existing.x0 = Math.min(existing.x0, ch.x0);
        existing.x1 = Math.max(existing.x1, ch.x1);
        existing.text += ch.ch;
      } else {
        rows.push({ y: ch.originY, x0: ch.x0, x1: ch.x1, text: ch.ch });
      }
    }
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toContain('TekSatırTest');
    expect(rows[0].x1).toBeLessThanOrEqual(boxX + boxWidth + 2);
  });

  it('composes decomposed Turkish combining dot (I\\u0307 -> İ) cleanly during normalization & PDF export', async () => {
    expect(normalizeUnicodeForPdf('I\u0307stanbul i\u0307lk')).toBe('\u0130stanbul ilk');

    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(bytes);
    const pages: PageMeta[] = [info.pages[0]].map((p) => ({
      id: 'page_0',
      sourceDocId: 'src_1',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    const decomposedEl: TextAddElement = {
      id: 'tr_nfc_1',
      pageId: 'page_0',
      kind: 'text-add',
      x: 54,
      y: 260,
      width: 300,
      height: 24,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      text: 'I\u0307STANBUL i\u0307zmir ğüşöç',
      fontFamily: 'Helvetica',
      fontSize: 12,
      color: '#111827',
      bold: false,
      italic: false,
      align: 'left',
      lineHeight: 1.2,
      renderedLineCount: 1,
    };

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [decomposedEl],
      fonts: loadNodeUnicodeFontPack(),
      optimizeWithMupdf: true,
    });

    const outText = await extractPagePlainText(compiled, 0);
    expect(outText).toContain('İSTANBUL');
    expect(outText).toContain('izmir ğüşöç');
  });

  it('strips and re-colors a behind-content vector header banner while preserving white title text', async () => {
    const bytes = await buildTestPdfWithPdfium([
      {
        width: 612,
        height: 792,
        rects: [
          { x: 48, yPdf: 700, width: 516, height: 54, fill: [20, 36, 71] },
          { x: 48, yPdf: 690, width: 516, height: 1, fill: [128, 128, 128] },
        ],
        texts: [
          { text: 'Q4 Product Architecture Brief', x: 64, yPdf: 720, fontSize: 22, color: [255, 255, 255] },
        ],
      },
    ]);

    // 1. Clean preview strips only the banner vector shape while keeping overlapping white title
    const cleanBytes = await prepareCleanPreviewPagePdf(
      bytes,
      0,
      [],
      [],
      [{ x: 47.5, y: 37.5, width: 517, height: 55 }],
    );
    expect(await extractPagePlainText(cleanBytes, 0)).toContain('Q4 Product Architecture Brief');

    const { data: cpx, width: cw } = await renderPdfPageRgbaWithPdfium(cleanBytes, 0, 1);
    const idx = (65 * cw + 520) * 4;
    // Banner fill removed cleanly -> white paper pixel
    expect(cpx[idx]).toBeGreaterThan(240);
    expect(cpx[idx + 1]).toBeGreaterThan(240);
    expect(cpx[idx + 2]).toBeGreaterThan(240);

    // 2. Full export replaces behind-content banner with solid red (#dc2626) behind original white title
    const info = await inspectPdfDocument(bytes);
    const pages: PageMeta[] = [info.pages[0]].map((p) => ({
      id: 'page_0',
      sourceDocId: 'src_banner',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    const shapeEdit: ShapeReplacementElement = {
      id: 'shp_edit_1',
      pageId: 'page_0',
      kind: 'shape-replacement',
      originalShapeId: 'shp_orig_1',
      originalRect: { x: 48, y: 38, width: 516, height: 54 },
      originalStrokeWidth: 0,
      x: 48,
      y: 38,
      width: 516,
      height: 54,
      rotation: 0,
      opacity: 1,
      zIndex: 7,
      fillColor: '#dc2626',
      strokeWidth: 0,
      behindContent: true,
      isBackgroundLayer: true,
    };

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'src_banner', bytes }],
      pages,
      elements: [shapeEdit],
      optimizeWithMupdf: true,
    });

    expect(await extractPagePlainText(compiled, 0)).toContain('Q4 Product Architecture Brief');

    const { data: px, width: w } = await renderPdfPageRgbaWithPdfium(compiled, 0, 1);
    const n = 4;
    // Open right side of banner is now red (#dc2626)
    const bannerIdx = (65 * w + 520) * n;
    expect(px[bannerIdx]).toBeGreaterThan(190);
    expect(px[bannerIdx + 1]).toBeLessThan(65);
    expect(px[bannerIdx + 2]).toBeLessThan(65);

    // Scan title text box (x:62..360, y:50..78) and verify white glyph pixels render ON TOP of red banner
    let foundWhiteTextOverRed = false;
    for (let py = 50; py <= 78; py++) {
      for (let pxX = 62; pxX <= 360; pxX++) {
        const pIdx = (py * w + pxX) * n;
        if (px[pIdx] > 230 && px[pIdx + 1] > 230 && px[pIdx + 2] > 230) {
          foundWhiteTextOverRed = true;
          break;
        }
      }
      if (foundWhiteTextOverRed) break;
    }
    expect(foundWhiteTextOverRed).toBe(true);

    // Hairline rule at y=101 remained untouched
    const ruleIdx = (101 * w + 100) * n;
    expect(px[ruleIdx]).toBeLessThan(170);
  });

  it('exports vector rounded rectangles, circles, and closed joined paths crisply via PDFium', async () => {
    const bytes = await buildTestPdfWithPdfium([{ width: 400, height: 400 }]);
    const info = await inspectPdfDocument(bytes);
    const pages: PageMeta[] = [info.pages[0]].map((p) => ({
      id: 'p_vec',
      sourceDocId: 'src_vec',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    const out = await compilePdfDocument({
      sourceDocs: [{ id: 'src_vec', bytes }],
      pages,
      elements: [
        // Heavily rounded blue square at (40, 40, 120x120, r=30)
        {
          id: 'shp_round',
          pageId: 'p_vec',
          kind: 'shape',
          shapeType: 'rect',
          x: 40,
          y: 40,
          width: 120,
          height: 120,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          fillColor: '#2563eb',
          strokeColor: '#0f172a',
          strokeWidth: 2,
          borderRadius: 30,
        },
        // Red filled circle (ellipse) at (220, 40, 100x100)
        {
          id: 'shp_circle',
          pageId: 'p_vec',
          kind: 'shape',
          shapeType: 'ellipse',
          x: 220,
          y: 40,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          zIndex: 2,
          fillColor: '#dc2626',
          strokeColor: 'transparent',
          strokeWidth: 0,
        },
        // Joined closed green triangle path at (60, 220, 120x100)
        {
          id: 'path_tri',
          pageId: 'p_vec',
          kind: 'path',
          x: 60,
          y: 220,
          width: 120,
          height: 100,
          rotation: 0,
          opacity: 1,
          zIndex: 3,
          points: [
            { x: 0.5, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
          closed: true,
          smooth: false,
          fillColor: '#16a34a',
          strokeColor: '#0f172a',
          strokeWidth: 2,
        },
      ],
      optimizeWithMupdf: true,
    });

    const { data: px, width: w } = await renderPdfPageRgbaWithPdfium(out, 0, 1);
    const n = 4;

    // Rounded rect center (100, 100) is blue (#2563eb)
    const rectCenter = (100 * w + 100) * n;
    expect(px[rectCenter]).toBeLessThan(80);
    expect(px[rectCenter + 2]).toBeGreaterThan(190);

    // Very outer bounding corner (41, 41) outside radius=30 curve stays crisp white!
    const outerCorner = (41 * w + 41) * n;
    expect(px[outerCorner]).toBeGreaterThan(240);
    expect(px[outerCorner + 1]).toBeGreaterThan(240);
    expect(px[outerCorner + 2]).toBeGreaterThan(240);

    // Circle center (270, 90) is red (#dc2626); outer bbox corner (222, 42) stays white!
    const circleCenter = (90 * w + 270) * n;
    expect(px[circleCenter]).toBeGreaterThan(190);
    expect(px[circleCenter + 1]).toBeLessThan(65);
    const circleCorner = (42 * w + 222) * n;
    expect(px[circleCorner]).toBeGreaterThan(240);

    // Closed triangle interior centroid (120, 290) is green (#16a34a)
    const triCenter = (290 * w + 120) * n;
    expect(px[triCenter + 1]).toBeGreaterThan(140);
    expect(px[triCenter]).toBeLessThan(60);
  });
});
