import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import {
  compilePdfDocument,
  inspectPdfDocument,
  prepareCleanPreviewPagePdf,
  splitPdfToZip,
} from '../pdfCompiler';
import { extractTextBlocksFromMuPdfPage } from '../textExtractor';
import type { PageMeta } from '@/types/pdf';
import type { ImageReplacementElement, TextAddElement, TextEditElement } from '@/types/elements';
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

// Minimal valid 2x2 red PNG image bytes
function createSamplePngBytes(): Uint8Array {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 20, 20], false);
  try {
    pixmap.clear(220);
    return new Uint8Array(pixmap.asPNG());
  } finally {
    pixmap.destroy();
  }
}

async function createSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Page 1: portrait with target text + keep text + embedded PNG image
  const p1 = doc.addPage([612, 792]);
  p1.drawText('REPLACE_ME_HEADER', { x: 72, y: 720, size: 18, font, color: rgb(0, 0, 0) });
  p1.drawText('KEEP_THIS_LINE_INTACT', { x: 72, y: 660, size: 14, font, color: rgb(0.1, 0.2, 0.5) });

  const png = await doc.embedPng(createSamplePngBytes());
  p1.drawImage(png, { x: 72, y: 500, width: 100, height: 100 });

  // Page 2: intrinsically rotated 90 deg
  const p2 = doc.addPage([612, 792]);
  p2.setRotation(degrees(90));
  p2.drawText('ROTATED_PAGE_TEXT', { x: 100, y: 700, size: 16, font, color: rgb(0, 0, 0) });

  return doc.save();
}

function extractPagePlainText(bytes: Uint8Array, pageIndex: number): string {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const page = doc.loadPage(pageIndex);
    try {
      const stext = page.toStructuredText('preserve-whitespace');
      try {
        return stext.asText();
      } finally {
        stext.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}

function getPageImageBoxes(
  bytes: Uint8Array,
  pageIndex: number,
): Array<[number, number, number, number]> {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const page = doc.loadPage(pageIndex);
    try {
      const stext = page.toStructuredText('preserve-images');
      try {
        const boxes: Array<[number, number, number, number]> = [];
        stext.walk({
          onImageBlock(bbox) {
            boxes.push([...bbox]);
          },
        });
        return boxes;
      } finally {
        stext.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}

describe('pdfCompiler with real MuPDF Wasm + pdf-lib', () => {
  it('inspects multi-page PDF and detects intrinsic rotation', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(mupdf, bytes);
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
    const plainBytes = await createSamplePdf();
    const mupdfDoc = mupdf.Document.openDocument(plainBytes, 'application/pdf');
    let encryptedBytes: Uint8Array;
    try {
      const pdfDoc = mupdfDoc.asPDF()!;
      const encBuf = pdfDoc.saveToBuffer('encrypt=aes-256,user-password=hunter2,owner-password=admin');
      try {
        encryptedBytes = new Uint8Array(encBuf.asUint8Array());
      } finally {
        encBuf.destroy();
      }
    } finally {
      mupdfDoc.destroy();
    }

    const noPw = await inspectPdfDocument(mupdf, encryptedBytes);
    expect(noPw.status).toBe('needs-password');

    const badPw = await inspectPdfDocument(mupdf, encryptedBytes, 'wrong');
    expect(badPw.status).toBe('invalid-password');

    const okPw = await inspectPdfDocument(mupdf, encryptedBytes, 'hunter2');
    expect(okPw.status).toBe('ok');
    expect(okPw.wasEncrypted).toBe(true);
    expect(okPw.decryptedBytes).toBeDefined();
    expect(okPw.pageCount).toBe(2);
  });

  it('strips original text stream operators via MuPDF Wasm and renders edited text cleanly', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(mupdf, bytes);

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

    const compiled = await compilePdfDocument(mupdf, {
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [textEdit, textAdd, imgReplace],
      optimizeWithMupdf: true,
    });

    const p0Text = extractPagePlainText(compiled, 0);
    expect(p0Text).not.toContain('REPLACE_ME_HEADER');
    expect(p0Text).toContain('UPDATED_TITLE_WASM');
    expect(p0Text).toContain('KEEP_THIS_LINE_INTACT');

    const p1Text = extractPagePlainText(compiled, 1);
    expect(p1Text).toContain('ROTATED_PAGE_TEXT');
    expect(p1Text).toContain('ADDED_ON_ROTATED_PAGE');

    // Original image was removed and re-embedded once at its moved/resized geometry
    const imgBoxes = getPageImageBoxes(compiled, 0);
    expect(imgBoxes).toHaveLength(1);
    expect(imgBoxes[0][0]).toBeGreaterThan(280);
  });

  it('splits pages into multiple PDFs bundled in a valid ZIP archive', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(mupdf, bytes);
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

    const zipBytes = await splitPdfToZip(mupdf, {
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
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 100; i++) {
      const p = doc.addPage([612, 792]);
      p.drawText(`Page ${i + 1}`, { x: 50, y: 720, size: 12, font });
      if (i === 0) {
        p.drawText('CONFIDENTIAL_SECRET', { x: 50, y: 650, size: 14, font });
      }
    }
    const rawBytes = await doc.save();
    const info = await inspectPdfDocument(mupdf, rawBytes);
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

    const out = await compilePdfDocument(mupdf, {
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

    const p0Text = extractPagePlainText(out, 0);
    expect(p0Text).not.toContain('CONFIDENTIAL_SECRET');
    expect(p0Text).toContain('Page 1');

    const check = await inspectPdfDocument(mupdf, out);
    expect(check.pageCount).toBe(100);
  });

  it('completely removes deleted embedded image XObject operators on export', async () => {
    const bytes = await createSamplePdf();
    expect(getPageImageBoxes(bytes, 0)).toHaveLength(1);

    const info = await inspectPdfDocument(mupdf, bytes);
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

    const compiled = await compilePdfDocument(mupdf, {
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [deletedImg],
      optimizeWithMupdf: true,
    });

    expect(getPageImageBoxes(compiled, 0)).toHaveLength(0);
    expect(extractPagePlainText(compiled, 0)).toContain('REPLACE_ME_HEADER');
  });

  it('embeds full Turkish & Unicode glyphs cleanly without question-mark fallback', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(mupdf, bytes);
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

    const compiled = await compilePdfDocument(mupdf, {
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [turkishText],
      fonts: loadNodeUnicodeFontPack(),
      optimizeWithMupdf: true,
    });

    const outText = extractPagePlainText(compiled, 0);
    expect(outText).not.toContain('?');
    expect(outText).toContain('ÖĞRENCİ');
    expect(outText).toContain('öğrenciyle');
    expect(outText).toContain('şğüöçıİŞĞÜÖÇ');
    expect(outText).toContain('₺1.250');
  });

  it('prepareCleanPreviewPagePdf removes overlapping background image while preserving table text', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p = doc.addPage([612, 792]);
    const bgPng = await doc.embedPng(createSamplePngBytes());
    // Huge background image behind the form
    p.drawImage(bgPng, { x: 40, y: 120, width: 520, height: 600 });
    // Table lines & text drawn over the background image
    p.drawLine({ start: { x: 40, y: 650 }, end: { x: 560, y: 650 }, thickness: 2, color: rgb(0, 0, 0) });
    p.drawText('OVERLAID_TABLE_CELL', { x: 60, y: 660, size: 12, font, color: rgb(0, 0, 0) });
    const bytes = await doc.save();

    expect(getPageImageBoxes(bytes, 0)).toHaveLength(1);

    const mdoc = mupdf.Document.openDocument(bytes, 'application/pdf');
    let cleanBytes: Uint8Array;
    try {
      cleanBytes = prepareCleanPreviewPagePdf(
        mupdf,
        mdoc.asPDF()!,
        0,
        [],
        [{ x: 40, y: 72, width: 520, height: 600 }],
      );
    } finally {
      mdoc.destroy();
    }

    expect(getPageImageBoxes(cleanBytes, 0)).toHaveLength(0);
    expect(extractPagePlainText(cleanBytes, 0)).toContain('OVERLAID_TABLE_CELL');
  });

  it('exports Calibri metric font cleanly with Turkish characters and currency fallback', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(mupdf, bytes);
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

    const compiled = await compilePdfDocument(mupdf, {
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [calibriText],
      fonts: loadNodeUnicodeFontPack(),
      optimizeWithMupdf: true,
    });

    const outText = extractPagePlainText(compiled, 0);
    expect(outText).toContain('Calibri Metrik Doğrulaması');
    expect(outText).toContain('şğüöçıİŞĞÜÖÇ');
    expect(outText).toContain('₺2.500');
  });

  it('justifies soft-wrapped lines flush to both edges while keeping final line left-aligned', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(mupdf, bytes);
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

    const compiled = await compilePdfDocument(mupdf, {
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [justifiedEl],
      fonts: loadNodeUnicodeFontPack(),
      optimizeWithMupdf: true,
    });

    const md = mupdf.Document.openDocument(compiled, 'application/pdf');
    try {
      const mp = md.loadPage(0);
      try {
        const st = mp.toStructuredText('preserve-whitespace');
        try {
          // Group all non-whitespace glyphs belonging to the same visual row (originY within 2.5pt),
          // because justified inter-word gaps can make MuPDF split sub-runs across beginLine calls.
          const rowMap: Array<{ y: number; x0: number; x1: number; text: string }> = [];
          st.walk({
            onChar(c, origin, _font, _size, quad) {
              if (!c.trim()) return;
              if (origin[1] < 215 || origin[1] > 360) return;
              const charX0 = Math.min(quad[0], quad[4]);
              const charX1 = Math.max(quad[2], quad[6]);
              const existing = rowMap.find((r) => Math.abs(r.y - origin[1]) <= 2.5);
              if (existing) {
                existing.x0 = Math.min(existing.x0, charX0);
                existing.x1 = Math.max(existing.x1, charX1);
                existing.text += c;
              } else {
                rowMap.push({ y: origin[1], x0: charX0, x1: charX1, text: c });
              }
            },
          });
          rowMap.sort((a, b) => a.y - b.y);

          expect(rowMap.length).toBeGreaterThanOrEqual(3);
          // First wrapped line should start near boxX and stretch nearly to boxX + boxWidth
          expect(rowMap[0].x0).toBeCloseTo(boxX, 0);
          expect(rowMap[0].x1).toBeGreaterThan(boxX + boxWidth - 8);
          // Second wrapped line should also stretch near boxX + boxWidth
          expect(rowMap[1].x1).toBeGreaterThan(boxX + boxWidth - 8);
          // Final line should NOT stretch to the right margin
          const last = rowMap[rowMap.length - 1];
          expect(last.x1).toBeLessThan(boxX + boxWidth - 20);
        } finally {
          st.destroy();
        }

        // Also confirm round-trip extraction detects align === 'justify' cleanly
        const blocks = extractTextBlocksFromMuPdfPage(mp, 'page_0');
        const roundTripped = blocks.find((b) => b.text.includes('iki yana yaslı'));
        expect(roundTripped).toBeDefined();
        expect(roundTripped!.align).toBe('justify');
      } finally {
        mp.destroy();
      }
    } finally {
      md.destroy();
    }
  });

  it('exports superscript and subscript runs with raised and lowered baseline coordinates', async () => {
    const bytes = await createSamplePdf();
    const info = await inspectPdfDocument(mupdf, bytes);
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

    const compiled = await compilePdfDocument(mupdf, {
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [richEl],
      fonts: loadNodeUnicodeFontPack(),
      optimizeWithMupdf: true,
    });

    const md = mupdf.Document.openDocument(compiled, 'application/pdf');
    try {
      const mp = md.loadPage(0);
      try {
        const st = mp.toStructuredText('preserve-whitespace');
        try {
          const glyphs: Array<{ ch: string; originY: number; size: number }> = [];
          st.walk({
            onChar(c, origin, _font, size) {
              if (origin[1] >= 350 && origin[1] <= 410) {
                glyphs.push({ ch: c, originY: origin[1], size });
              }
            },
          });

          const baseH = glyphs.find((g) => g.ch === 'H');
          const superX = glyphs.find((g) => g.ch === 'X');
          const subY = glyphs.find((g) => g.ch === 'Y');

          expect(baseH).toBeDefined();
          expect(superX).toBeDefined();
          expect(subY).toBeDefined();
          // MuPDF originY is top-down: superscript has smaller Y (higher on page) and smaller font size
          expect(superX!.originY).toBeLessThan(baseH!.originY - 2.5);
          expect(superX!.size).toBeLessThan(baseH!.size - 2);
          // Subscript has larger Y (lower on page) and smaller font size
          expect(subY!.originY).toBeGreaterThan(baseH!.originY + 1.5);
          expect(subY!.size).toBeLessThan(baseH!.size - 2);
        } finally {
          st.destroy();
        }
      } finally {
        mp.destroy();
      }
    } finally {
      md.destroy();
    }
  });

  it('keeps moved behindContent watermark behind dark table lines and text on export', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p = doc.addPage([612, 792]);
    // Light watermark image placed under a dark black table line + text
    const bgPng = await doc.embedPng(createSamplePngBytes());
    p.drawImage(bgPng, { x: 100, y: 400, width: 200, height: 200, opacity: 0.45 });
    // Black border crossing right across y=500 (top-down y=292)
    p.drawLine({
      start: { x: 80, y: 500 },
      end: { x: 400, y: 500 },
      thickness: 4,
      color: rgb(0, 0, 0),
    });
    p.drawText('TABLE_TEXT_IN_FRONT', { x: 120, y: 515, size: 12, font, color: rgb(0, 0, 0) });
    const bytes = await doc.save();

    const info = await inspectPdfDocument(mupdf, bytes);
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

    const compiled = await compilePdfDocument(mupdf, {
      sourceDocs: [{ id: 'src_1', bytes }],
      pages,
      elements: [movedWatermark],
      fonts: loadNodeUnicodeFontPack(),
      optimizeWithMupdf: true,
    });

    // Rasterize exported PDF via MuPDF Pixmap and inspect dark ink line at y=292 (PDF y=500)
    const md = mupdf.Document.openDocument(compiled, 'application/pdf');
    try {
      const mp = md.loadPage(0);
      try {
        const pixmap = mp.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
        try {
          const w = pixmap.getWidth();
          const n = pixmap.getNumberOfComponents();
          const px = pixmap.getPixels();
          // Sample middle of black line at (x=200, y=292) inside moved watermark [120..320, 192..392]
          let minLuma = 255;
          for (let dy = -2; dy <= 2; dy++) {
            const idx = ((292 + dy) * w + 200) * n;
            const luma = 0.2126 * px[idx] + 0.7152 * px[idx + 1] + 0.0722 * px[idx + 2];
            minLuma = Math.min(minLuma, luma);
          }
          // Dark border line MUST remain black in front of moved watermark!
          expect(minLuma).toBeLessThan(40);
        } finally {
          pixmap.destroy();
        }
      } finally {
        mp.destroy();
      }
    } finally {
      md.destroy();
    }
  });
});
