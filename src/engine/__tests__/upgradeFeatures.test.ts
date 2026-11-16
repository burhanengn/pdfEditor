import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTestPdfWithPdfium,
  createSolidPngBytes,
  extractPdfTextWithPdfium,
  patchTtfFontForTest,
} from '../pdfium/__tests__/pdfTestHelpers';
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
import { extractTextBlocksFromPdfBytes } from '../textExtractor';
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
    const bytes = await buildTestPdfWithPdfium([
      {
        width: 595,
        height: 842,
        lines: [{ x1: 220, y1Pdf: 690, x2: 220, y2Pdf: 740, stroke: [0, 0, 0], strokeWidth: 1.5 }],
        texts: [
          { text: 'Column Alpha', x: 70, yPdf: 710, fontSize: 11 },
          { text: 'Column Beta', x: 232, yPdf: 710, fontSize: 11 },
          { text: 'Left Key Label', x: 70, yPdf: 650, fontSize: 11 },
          { text: 'Right Value Entry', x: 260, yPdf: 650, fontSize: 11 },
        ],
      },
    ]);

    const blocks = await extractTextBlocksFromPdfBytes(bytes, 0, 'p_tbl', {
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

    const srcBytes = await buildTestPdfWithPdfium([
      { width: 595, height: 842 },
      { width: 595, height: 842 },
      { width: 595, height: 842 },
      { width: 595, height: 842 },
    ]);

    const pngBytes = createSolidPngBytes(20, 20, [200, 200, 200, 255]);

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

    const compiled = await compilePdfDocument({
      sourceDocs: [{ id: 'src_1', bytes: srcBytes }],
      pages,
      elements: [flippedImg],
      pageNumbering: cfg,
    });

    expect((await extractPdfTextWithPdfium(compiled, 0)).trim()).toBe('');
    expect(await extractPdfTextWithPdfium(compiled, 1)).toContain('Sayfa 1 / 3');
    expect(await extractPdfTextWithPdfium(compiled, 3)).toContain('Sayfa 3 / 3');
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
    const myBrandSubset = patchTtfFontForTest(djBoldBytes, {
      postscriptName: 'MyBrandCustom-Bold',
      subsetChars: 'CUSTOM BRAND HEADERABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
    });
    const srcBytes = await buildTestPdfWithPdfium(
      [
        {
          width: 595,
          height: 842,
          texts: [
            {
              text: 'CUSTOM BRAND HEADER',
              x: 60,
              yPdf: 740,
              fontSize: 16,
              color: [0, 0, 0],
              fontKey: 'brand',
            },
          ],
        },
      ],
      { customFonts: { brand: myBrandSubset } },
    );

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

      const compiled = await compilePdfDocument({
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

      const outText = await extractPdfTextWithPdfium(compiled, 0);
      expect(outText).toContain('CUSTOM');
      expect(outText).toContain('ŞİĞÜÖÇ');
      expect(outText).toContain('HEADER');
      expect(outText).toContain('Özel Yüklenen Font İle Metin');

      // Cleanup uploaded user font
      if (uploadedLibSans) {
        await deleteUserCustomFont(uploadedLibSans.id);
      }
    } finally {
      clearExtractedFontsForDoc(docId);
    }
  });
});
