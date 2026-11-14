import fs from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import * as mupdf from 'mupdf';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  clearExtractedFontsForDoc,
  extractEmbeddedFontsFromPdfBytes,
  getExtractedFontAssetPayloads,
} from '../embeddedFontExtractor';
import {
  FONT_OPTIONS,
  normalizeFontMatchKey,
  parsePdfFontMetadata,
  resolveBlockFontAssignment,
  resolveFontDisplayStatus,
} from '../fonts';
import {
  DEFAULT_PAGE_NUMBERING_CONFIG,
  computePageNumberLayout,
  formatPageNumberLabel,
  toRomanNumeral,
} from '../pageNumbers';
import { compilePdfDocument } from '../pdfCompiler';
import { extractTextBlocksFromMuPdfPage } from '../textExtractor';
import {
  deleteUserCustomFont,
  getUserFontAssetPayloads,
  importUserCustomFontFiles,
} from '@/utils/customFontStorage';
import { buildRealisticInkVectorPaths } from '@/utils/realisticInk';
import type { ImageAddElement, TextAddElement, TextEditElement } from '@/types/elements';
import type { PageMeta } from '@/types/pdf';

describe('upgraded PDF engine modules', () => {
  it('parses PDF font subset prefixes, custom fallback warnings, and condensed widths', () => {
    const std = parsePdfFontMetadata('ABCDEF+Helvetica-Bold');
    expect(std.cleanFontName).toBe('Helvetica-Bold');
    expect(std.fontFamily).toBe('Helvetica');
    expect(std.bold).toBe(true);
    expect(std.isCustomFont).toBe(false);

    const condensed = parsePdfFontMetadata('XYZABC+MyCustomBrand-CondensedOblique');
    expect(condensed.cleanFontName).toBe('MyCustomBrand-CondensedOblique');
    expect(condensed.italic).toBe(true);
    expect(condensed.isCustomFont).toBe(true);
    expect(condensed.estimatedHorizontalScale).toBeCloseTo(0.85, 2);
  });

  it('prevents table column text blocks from merging across vertical vector rules or wide gutters', async () => {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const p = doc.addPage([595, 842]);

    // Vertical rule dividing column A and column B
    p.drawLine({
      start: { x: 220, y: 690 },
      end: { x: 220, y: 740 },
      thickness: 1.5,
      color: rgb(0, 0, 0),
    });
    p.drawText('Column Alpha', { x: 70, y: 710, size: 11, font: helv });
    p.drawText('Column Beta', { x: 232, y: 710, size: 11, font: helv });

    // Borderless 2-column row separated by a clear cell gutter
    p.drawText('Left Key Label', { x: 70, y: 650, size: 11, font: helv });
    p.drawText('Right Value Entry', { x: 260, y: 650, size: 11, font: helv });

    const bytes = await doc.save();
    const md = mupdf.Document.openDocument(bytes, 'application/pdf');
    try {
      const mp = md.loadPage(0);
      try {
        const blocks = extractTextBlocksFromMuPdfPage(mp, 'p_tbl', {
          verticalRules: [{ x: 220, y0: 842 - 740, y1: 842 - 690 }],
          horizontalRules: [],
          cellRects: [
            { x: 65, y: 842 - 740, width: 155, height: 50 },
            { x: 220, y: 842 - 740, width: 160, height: 50 },
          ],
        });
        const texts = blocks.map((b) => b.text);
        expect(texts.some((t) => t.includes('Column Alpha') && !t.includes('Column Beta'))).toBe(true);
        expect(texts.some((t) => t.includes('Column Beta') && !t.includes('Column Alpha'))).toBe(true);
        expect(texts.some((t) => t.includes('Left Key Label') && !t.includes('Right Value Entry'))).toBe(true);
        expect(texts.some((t) => t.includes('Right Value Entry') && !t.includes('Left Key Label'))).toBe(true);
      } finally {
        mp.destroy();
      }
    } finally {
      md.destroy();
    }
  });

  it('modulates realistic ink nib width by stroke velocity', () => {
    const paths = buildRealisticInkVectorPaths(
      [
        {
          points: [
            { x: 10, y: 20, t: 0 },
            { x: 14, y: 21, t: 80 }, // very slow dwell (~0.05 px/ms -> wider stroke)
            { x: 180, y: 60, t: 105 }, // very fast flick (~6.8 px/ms -> tapered thin stroke)
          ],
        },
      ],
      3.5,
      '#0f2b5b',
    );
    expect(paths.length).toBeGreaterThanOrEqual(3);
    // Index 0 is capillary outer halo, index 1 slow segment, index 2 fast segment
    expect(paths[0].opacity).toBeLessThan(0.3);
    expect(paths[1].strokeWidth).toBeGreaterThan(paths[2].strokeWidth);
  });

  it('formats dynamic Roman and localized page numbers and stamps them cleanly onto exported PDFs', async () => {
    expect(toRomanNumeral(4, true)).toBe('IV');
    expect(toRomanNumeral(9, false)).toBe('ix');

    const cfg = {
      ...DEFAULT_PAGE_NUMBERING_CONFIG,
      enabled: true,
      format: 'page-number-of-total' as const,
      startFromPage: 2,
      startNumber: 1,
    };
    expect(formatPageNumberLabel(0, 4, cfg)).toBeNull();
    expect(formatPageNumberLabel(1, 4, cfg)).toBe('Sayfa 1 / 3');
    const layout = computePageNumberLayout(595, 842, 1, 4, cfg);
    expect(layout?.text).toBe('Sayfa 1 / 3');

    const srcDoc = await PDFDocument.create();
    srcDoc.registerFontkit(fontkit);
    srcDoc.addPage([595, 842]);
    srcDoc.addPage([595, 842]);
    srcDoc.addPage([595, 842]);
    srcDoc.addPage([595, 842]);
    const srcBytes = new Uint8Array(await srcDoc.save());

    const tinyPix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 20, 20], false);
    const pngBytes = new Uint8Array(tinyPix.asPNG());
    tinyPix.destroy();

    const pages: PageMeta[] = [0, 1, 2, 3].map((idx) => ({
      id: `pg_${idx + 1}`,
      sourceDocId: 'src_1',
      sourcePageIndex: idx,
      baseWidth: 595,
      baseHeight: 842,
      intrinsicRotation: 0,
      userRotation: 0,
      mediaBox: [0, 0, 595, 842],
      cropBox: [0, 0, 595, 842],
    }));

    const flippedImg: ImageAddElement = {
      id: 'img_flip',
      pageId: 'pg_2',
      kind: 'image',
      name: 'flipped.png',
      mimeType: 'image/png',
      bytes: pngBytes,
      previewUrl: 'blob:test',
      naturalWidth: 20,
      naturalHeight: 20,
      aspectLocked: true,
      flipX: true,
      flipY: false,
      x: 100,
      y: 100,
      width: 60,
      height: 60,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
    };

    const compiled = await compilePdfDocument(mupdf, {
      sourceDocs: [{ id: 'src_1', bytes: srcBytes }],
      pages,
      elements: [flippedImg],
      pageNumbering: cfg,
      optimizeWithMupdf: true,
    });

    const outDoc = mupdf.Document.openDocument(compiled, 'application/pdf');
    try {
      const p0 = outDoc.loadPage(0);
      const p1 = outDoc.loadPage(1);
      const p3 = outDoc.loadPage(3);
      try {
        expect(p0.toStructuredText('preserve-whitespace').asText().trim()).toBe('');
        expect(p1.toStructuredText('preserve-whitespace').asText()).toContain('Sayfa 1 / 3');
        expect(p3.toStructuredText('preserve-whitespace').asText()).toContain('Sayfa 3 / 3');
      } finally {
        p0.destroy();
        p1.destroy();
        p3.destroy();
      }
    } finally {
      outDoc.destroy();
    }
  });

  it('extracts embedded custom TTF fonts, auto-matches user uploads, and exports missing subset glyphs cleanly', async () => {
    const djDir = path.resolve(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf');
    const uoDir = path.resolve(process.cwd(), 'node_modules/@universal-office/font-files');
    const djBoldBytes = new Uint8Array(fs.readFileSync(path.join(djDir, 'DejaVuSans-Bold.ttf')));
    const libSansReg = new Uint8Array(
      fs.readFileSync(path.join(uoDir, 'liberationsans-regular.ttf')),
    );
    const libSansBold = new Uint8Array(
      fs.readFileSync(path.join(uoDir, 'liberationsans-bold.ttf')),
    );

    // Expanded built-in library should offer significantly more than 10 families
    expect(FONT_OPTIONS.length).toBeGreaterThanOrEqual(16);

    // 1. Build a PDF embedding a custom-named subset font ("MyBrandCustom-Bold")
    const srcDoc = await PDFDocument.create();
    srcDoc.registerFontkit(fontkit);
    const customFont = await srcDoc.embedFont(djBoldBytes, {
      subset: true,
      customName: 'MyBrandCustom-Bold',
    });
    const page = srcDoc.addPage([595, 842]);
    page.drawText('CUSTOM BRAND HEADER', {
      x: 60,
      y: 740,
      size: 16,
      font: customFont,
      color: rgb(0, 0, 0),
    });
    const srcBytes = new Uint8Array(await srcDoc.save());

    // 2. Extract usable embedded SFNT fonts from the PDF
    const docId = 'doc_embedded_custom_test';
    const extracted = await extractEmbeddedFontsFromPdfBytes(docId, srcBytes);
    try {
      expect(extracted.length).toBeGreaterThanOrEqual(1);
      const brandFont = extracted.find((f) =>
        normalizeFontMatchKey(f.cleanName).baseKey.includes('mybrandcustom'),
      );
      expect(brandFont).toBeDefined();
      expect(brandFont!.unicodeUsable).toBe(true);
      expect(brandFont!.variants.bold).toBe(true);
      expect(brandFont!.supportedCodePoints).toContain('C'.charCodeAt(0));

      const payloads = getExtractedFontAssetPayloads([brandFont!.id]);
      expect(payloads).toHaveLength(1);
      expect(payloads[0].bold?.byteLength).toBeGreaterThan(100);

      // 3. Assign block font -> uses extracted embedded font when no user upload matches yet
      const assignedEmbedded = resolveBlockFontAssignment({
        rawFontName: 'MyBrandCustom-Bold',
        originalFontName: 'MyBrandCustom-Bold',
        currentFontFamily: 'Helvetica',
        isCustomFont: true,
        sourceDocId: docId,
        userFonts: [],
        extractedFonts: extracted,
      });
      expect(assignedEmbedded.fontFamily).toBe(brandFont!.id);
      expect(assignedEmbedded.fontSource).toBe('embedded');

      // Status reports complete for existing ASCII subset glyphs, partial when Turkish glyphs are added
      const asciiStatus = resolveFontDisplayStatus({
        fontFamily: assignedEmbedded.fontFamily,
        fallbackFontFamily: assignedEmbedded.fallbackFontFamily,
        originalFontName: 'MyBrandCustom-Bold',
        isCustomFont: true,
        text: 'CUSTOM HEADER',
        userFonts: [],
        extractedFonts: extracted,
      });
      expect(asciiStatus.status).toBe('embedded-complete');
      expect(asciiStatus.missingChars).toEqual([]);

      const turkishPartialStatus = resolveFontDisplayStatus({
        fontFamily: assignedEmbedded.fontFamily,
        fallbackFontFamily: assignedEmbedded.fallbackFontFamily,
        originalFontName: 'MyBrandCustom-Bold',
        isCustomFont: true,
        text: 'CUSTOM ŞİĞÜÖÇ',
        userFonts: [],
        extractedFonts: extracted,
      });
      expect(turkishPartialStatus.status).toBe('embedded-partial');
      expect(turkishPartialStatus.missingChars).toContain('Ş');

      // 4. Import user-uploaded TTF font family (Liberation Sans Regular + Bold) and verify auto-matching
      const { allFonts, affectedIds } = await importUserCustomFontFiles([
        { name: 'LiberationSans-Regular.ttf', bytes: libSansReg },
        { name: 'LiberationSans-Bold.ttf', bytes: libSansBold },
      ]);
      expect(affectedIds.length).toBeGreaterThanOrEqual(1);
      const uploadedLibSans = allFonts.find((f) => f.baseKey === 'liberationsans');
      expect(uploadedLibSans).toBeDefined();
      expect(uploadedLibSans!.variants.regular).toBe(true);
      expect(uploadedLibSans!.variants.bold).toBe(true);

      const userAutoMatch = resolveBlockFontAssignment({
        rawFontName: 'ABCDEF+LiberationSans-Bold',
        originalFontName: 'ABCDEF+LiberationSans-Bold',
        currentFontFamily: 'Helvetica',
        isCustomFont: false,
        sourceDocId: docId,
        userFonts: allFonts,
        extractedFonts: extracted,
      });
      expect(userAutoMatch.fontFamily).toBe(uploadedLibSans!.id);
      expect(userAutoMatch.fontSource).toBe('user');

      const userStatus = resolveFontDisplayStatus({
        fontFamily: uploadedLibSans!.id,
        fallbackFontFamily: 'Helvetica',
        text: 'Öğrenci Başarı ŞİĞÜ',
        userFonts: allFonts,
        extractedFonts: extracted,
      });
      expect(userStatus.status).toBe('user-complete');

      // 5. Compile / Export PDF using both extracted embedded font (with Turkish missing-glyph fallback)
      //    and user-uploaded custom font
      const pages: PageMeta[] = [
        {
          id: 'pg_emb_1',
          sourceDocId: docId,
          sourcePageIndex: 0,
          baseWidth: 595,
          baseHeight: 842,
          intrinsicRotation: 0,
          userRotation: 0,
          mediaBox: [0, 0, 595, 842],
          cropBox: [0, 0, 595, 842],
        },
      ];
      const editEl: TextEditElement = {
        id: 'edit_emb_1',
        pageId: 'pg_emb_1',
        kind: 'text-edit',
        originalBlockId: 'blk_emb_1',
        originalRect: { x: 60, y: 86, width: 320, height: 24 },
        originalText: 'CUSTOM BRAND HEADER',
        text: 'CUSTOM ŞİĞÜÖÇ HEADER',
        x: 60,
        y: 86,
        width: 320,
        height: 24,
        rotation: 0,
        opacity: 1,
        zIndex: 3,
        fontSize: 16,
        fontFamily: brandFont!.id,
        fallbackFontFamily: 'Helvetica',
        fontSource: 'embedded',
        color: '#000000',
        bold: true,
        italic: false,
        align: 'left',
        lineHeight: 1.2,
      };
      const addEl: TextAddElement = {
        id: 'edit_user_2',
        pageId: 'pg_emb_1',
        kind: 'text-add',
        text: 'Özel Yüklenen Font İle Metin',
        x: 60,
        y: 200,
        width: 300,
        height: 22,
        rotation: 0,
        opacity: 1,
        zIndex: 3,
        fontSize: 13,
        fontFamily: uploadedLibSans!.id,
        fallbackFontFamily: 'Helvetica',
        fontSource: 'user',
        color: '#112233',
        bold: true,
        italic: false,
        align: 'left',
        lineHeight: 1.2,
      };

      const compiled = await compilePdfDocument(mupdf, {
        sourceDocs: [{ id: docId, bytes: srcBytes }],
        pages,
        elements: [editEl, addEl],
        fonts: [
          ...getUserFontAssetPayloads([uploadedLibSans!.id]),
          ...getExtractedFontAssetPayloads([brandFont!.id]),
          {
            family: 'fallback:sans',
            regular: new Uint8Array(fs.readFileSync(path.join(djDir, 'DejaVuSans.ttf'))),
            bold: djBoldBytes,
            italic: new Uint8Array(fs.readFileSync(path.join(djDir, 'DejaVuSans-Oblique.ttf'))),
            boldItalic: new Uint8Array(
              fs.readFileSync(path.join(djDir, 'DejaVuSans-BoldOblique.ttf')),
            ),
          },
        ],
      });

      const outDoc = mupdf.Document.openDocument(compiled, 'application/pdf');
      try {
        const outPage = outDoc.loadPage(0);
        try {
          const outText = outPage.toStructuredText('preserve-whitespace').asText();
          expect(outText).toContain('CUSTOM');
          expect(outText).toContain('ŞİĞÜÖÇ');
          expect(outText).toContain('HEADER');
          expect(outText).toContain('Özel Yüklenen Font İle Metin');
        } finally {
          outPage.destroy();
        }
      } finally {
        outDoc.destroy();
      }

      // Cleanup uploaded user font
      if (uploadedLibSans) {
        await deleteUserCustomFont(uploadedLibSans.id);
      }
    } finally {
      clearExtractedFontsForDoc(docId);
    }
  });
});
