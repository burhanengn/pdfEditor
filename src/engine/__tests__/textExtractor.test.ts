import fs from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import * as mupdf from 'mupdf';
import { PDFDocument, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  buildDetectedTextBlocksFromMuLines,
  extractTextBlocksFromMuPdfPage,
  type RawMuLine,
} from '../textExtractor';
import { calibrateDomTextMetrics, inferFontFromPdfName } from '../fonts';

function loadDejaVuFont(fileName: string): Uint8Array {
  return new Uint8Array(
    fs.readFileSync(path.resolve(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf', fileName)),
  );
}

describe('textExtractor paragraph grouping & soft-wrap reflow', () => {
  it('merges a 3-line soft-wrapped prose paragraph and joins wrapped lines with spaces', () => {
    // Line 1: x0=60..460, firstWord of Line 2 ("yazısı") has width=42 -> 460 + 3 + 42 > 470 (soft wrap!)
    const lines: RawMuLine[] = [
      {
        text: 'Birinci Satır uzun metin deneme',
        x0: 60,
        y0: 100,
        x1: 460,
        y1: 112,
        baselineY: 110,
        fontSize: 11,
        firstWordWidth: 38,
        color: '#000000',
        fontFamily: 'TimesRoman',
        rawFontName: 'DejaVuSerif',
        bold: false,
        italic: false,
        serif: true,
        mono: false,
        mupdfBlockIdx: 0,
      },
      {
        text: 'yazısı devam ederek olan',
        x0: 60,
        y0: 116,
        x1: 468,
        y1: 128,
        baselineY: 126,
        fontSize: 11,
        firstWordWidth: 42,
        color: '#000000',
        fontFamily: 'TimesRoman',
        rawFontName: 'DejaVuSerif',
        bold: false,
        italic: false,
        serif: true,
        mono: false,
        mupdfBlockIdx: 0,
      },
      {
        text: 'bir yazı.',
        x0: 60,
        y0: 132,
        x1: 120,
        y1: 144,
        baselineY: 142,
        fontSize: 11,
        firstWordWidth: 20,
        color: '#000000',
        fontFamily: 'TimesRoman',
        rawFontName: 'DejaVuSerif',
        bold: false,
        italic: false,
        serif: true,
        mono: false,
        mupdfBlockIdx: 0,
      },
    ];

    const blocks = buildDetectedTextBlocksFromMuLines(lines, 'p1');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe(
      'Birinci Satır uzun metin deneme yazısı devam ederek olan bir yazı.',
    );
  });

  it('merges indented first line of a paragraph while splitting across horizontal table borders', () => {
    const lines: RawMuLine[] = [
      // Indented first line (+24pt)
      {
        text: 'İlk satır paragraf girintisi ile başlayan uzun bir cümle',
        x0: 84,
        y0: 100,
        x1: 480,
        y1: 112,
        baselineY: 110,
        fontSize: 11,
        firstWordWidth: 20,
        color: '#000000',
        fontFamily: 'Helvetica',
        rawFontName: 'DejaVuSans',
        bold: false,
        italic: false,
        serif: false,
        mono: false,
        mupdfBlockIdx: 0,
      },
      {
        text: 'devamında sola yaslı olarak sürer.',
        x0: 60,
        y0: 116,
        x1: 280,
        y1: 128,
        baselineY: 126,
        fontSize: 11,
        firstWordWidth: 68,
        color: '#000000',
        fontFamily: 'Helvetica',
        rawFontName: 'DejaVuSans',
        bold: false,
        italic: false,
        serif: false,
        mono: false,
        mupdfBlockIdx: 1,
      },
      // Separate table cell below a horizontal rule at y=134
      {
        text: 'Tablo hücresi 2',
        x0: 60,
        y0: 140,
        x1: 180,
        y1: 152,
        baselineY: 150,
        fontSize: 11,
        firstWordWidth: 35,
        color: '#000000',
        fontFamily: 'Helvetica',
        rawFontName: 'DejaVuSans',
        bold: false,
        italic: false,
        serif: false,
        mono: false,
        mupdfBlockIdx: 2,
      },
    ];

    const blocks = buildDetectedTextBlocksFromMuLines(lines, 'p1', [
      { y: 134, x0: 48, x1: 540 },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe(
      'İlk satır paragraf girintisi ile başlayan uzun bir cümle devamında sola yaslı olarak sürer.',
    );
    expect(blocks[1].text).toBe('Tablo hücresi 2');
  });

  it('extracts Turkish Unicode, white header ink, and 3-line paragraph reflow directly from MuPDF', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const serifReg = await doc.embedFont(loadDejaVuFont('DejaVuSerif.ttf'), { subset: true });
    const sansBold = await doc.embedFont(loadDejaVuFont('DejaVuSans-Bold.ttf'), { subset: true });

    const p = doc.addPage([612, 792]);
    // Dark maroon banner + white Turkish bold heading
    p.drawRectangle({ x: 48, y: 700, width: 516, height: 34, color: rgb(0.5, 0.14, 0.14) });
    p.drawText('YURT DIŞI ÖĞRENCİ BİLGİLERİ', {
      x: 64,
      y: 711,
      size: 14,
      font: sansBold,
      color: rgb(1, 1, 1),
    });

    // Side-by-side table row (should stay 2 blocks)
    p.drawText('Öğrenim Görülecek Ülke', { x: 54, y: 672, size: 11, font: serifReg });
    p.drawText('Hollanda', { x: 260, y: 672, size: 11, font: serifReg });

    // 3-line paragraph drawn at exact fixed width lines (1.35x leading)
    p.drawText('Yukarıda ismi yazılı danışmanı/koordinatörü olduğum', {
      x: 54,
      y: 620,
      size: 11,
      font: serifReg,
    });
    p.drawText('öğrenciyle 03/11/2026 tarihinde görüşerek kabul', {
      x: 54,
      y: 604,
      size: 11,
      font: serifReg,
    });
    p.drawText('edilmesini arz ederim.', {
      x: 54,
      y: 588,
      size: 11,
      font: serifReg,
    });

    const bytes = await doc.save();
    const md = mupdf.Document.openDocument(bytes, 'application/pdf');
    try {
      const mp = md.loadPage(0);
      try {
        const blocks = extractTextBlocksFromMuPdfPage(mp, 'p0');
        const heading = blocks.find((b) => b.text.includes('YURT DIŞI ÖĞRENCİ'));
        expect(heading).toBeDefined();
        expect(heading!.color).toBe('#ffffff');
        expect(heading!.bold).toBe(true);

        const countryLabel = blocks.find((b) => b.text.includes('Öğrenim Görülecek Ülke'));
        const countryValue = blocks.find((b) => b.text === 'Hollanda');
        expect(countryLabel).toBeDefined();
        expect(countryValue).toBeDefined();
        expect(countryLabel!.text).not.toContain('Hollanda');

        const para = blocks.find((b) => b.text.includes('danışmanı/koordinatörü'));
        expect(para).toBeDefined();
        expect(para!.text).toContain('öğrenciyle 03/11/2026 tarihinde görüşerek kabul');
        expect(para!.text).toContain('edilmesini arz ederim.');
        // Wrapped lines must be joined with spaces so editing line 1 reflows line 2 & 3!
        expect(para!.text).not.toContain('\n');
      } finally {
        mp.destroy();
      }
    } finally {
      md.destroy();
    }
  });

  it('infers original PDF subset font families accurately without switching styles', () => {
    expect(inferFontFromPdfName('ABCDEE+TimesNewRomanPS-BoldMT')).toEqual({
      fontFamily: 'TimesRoman',
      bold: true,
      italic: false,
    });
    expect(inferFontFromPdfName('XYZFGH+Calibri-Italic')).toEqual({
      fontFamily: 'Calibri',
      bold: false,
      italic: true,
    });
    expect(inferFontFromPdfName('Cambria-BoldItalic')).toEqual({
      fontFamily: 'Cambria',
      bold: true,
      italic: true,
    });
    expect(inferFontFromPdfName('LiberationSans')).toEqual({
      fontFamily: 'Helvetica',
      bold: false,
      italic: false,
    });
  });

  it('detects justify alignment across flush left+right multi-line paragraphs', () => {
    const lines: RawMuLine[] = [
      {
        text: 'Öğrencinin yurt dışı eğitim programı kapsamında hazırlanan belge iki',
        x0: 60,
        y0: 100,
        x1: 540,
        y1: 112,
        baselineY: 110,
        fontSize: 11,
        firstWordWidth: 48,
        color: '#000000',
        fontFamily: 'TimesRoman',
        rawFontName: 'TimesNewRomanPSMT',
        bold: false,
        italic: false,
        serif: true,
        mono: false,
        mupdfBlockIdx: 0,
      },
      {
        text: 'yana yaslı paragraf hizalaması korunarak tüm satır genişliğine yayılmış',
        x0: 60,
        y0: 116,
        x1: 539.5,
        y1: 128,
        baselineY: 126,
        fontSize: 11,
        firstWordWidth: 24,
        color: '#000000',
        fontFamily: 'TimesRoman',
        rawFontName: 'TimesNewRomanPSMT',
        bold: false,
        italic: false,
        serif: true,
        mono: false,
        mupdfBlockIdx: 0,
      },
      {
        text: 'son satırda sona erer.',
        x0: 60,
        y0: 132,
        x1: 190,
        y1: 144,
        baselineY: 142,
        fontSize: 11,
        firstWordWidth: 20,
        color: '#000000',
        fontFamily: 'TimesRoman',
        rawFontName: 'TimesNewRomanPSMT',
        bold: false,
        italic: false,
        serif: true,
        mono: false,
        mupdfBlockIdx: 0,
      },
    ];

    const blocks = buildDetectedTextBlocksFromMuLines(lines, 'p_just');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].align).toBe('justify');
    expect(blocks[0].width).toBeGreaterThanOrEqual(478);
  });

  it('preserves superscript and subscript runs inside extracted MuPDF paragraphs', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const serifReg = await doc.embedFont(loadDejaVuFont('DejaVuSerif.ttf'), { subset: true });
    const p = doc.addPage([612, 792]);

    // Line with "Alan 10" + raised superscript "2" + " m" + subscript "x"
    p.drawText('Alan 10', { x: 60, y: 650, size: 12, font: serifReg });
    const wMain = serifReg.widthOfTextAtSize('Alan 10', 12);
    p.drawText('2', { x: 60 + wMain + 0.5, y: 655, size: 7.5, font: serifReg });
    const wSup = serifReg.widthOfTextAtSize('2', 7.5);
    p.drawText(' ve kimyasal H', { x: 60 + wMain + wSup + 1, y: 650, size: 12, font: serifReg });
    const wMid = serifReg.widthOfTextAtSize(' ve kimyasal H', 12);
    p.drawText('2', { x: 60 + wMain + wSup + wMid + 1.5, y: 646.5, size: 7.5, font: serifReg });
    const wSub = serifReg.widthOfTextAtSize('2', 7.5);
    p.drawText('O değeridir.', {
      x: 60 + wMain + wSup + wMid + wSub + 2,
      y: 650,
      size: 12,
      font: serifReg,
    });

    const bytes = await doc.save();
    const md = mupdf.Document.openDocument(bytes, 'application/pdf');
    try {
      const mp = md.loadPage(0);
      try {
        const blocks = extractTextBlocksFromMuPdfPage(mp, 'p_script');
        const target = blocks.find((b) => b.text.includes('Alan 10'));
        expect(target).toBeDefined();
        expect(target!.text).toContain('Alan 102');
        expect(target!.text).toContain('H2O');
        expect(target!.runs).toBeDefined();
        expect(target!.runs!.some((r) => r.script === 'super' && r.text.includes('2'))).toBe(true);
        expect(target!.runs!.some((r) => r.script === 'sub' && r.text.includes('2'))).toBe(true);
      } finally {
        mp.destroy();
      }
    } finally {
      md.destroy();
    }
  });

  it('preserves explicit Calibri sans family even when subsetted TTF flags report serif', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const carlito = await doc.embedFont(
      new Uint8Array(
        fs.readFileSync(
          path.resolve(process.cwd(), 'node_modules/@universal-office/font-files/carlito-regular.ttf'),
        ),
      ),
      { subset: true },
    );
    const p = doc.addPage([595, 842]);
    p.drawText('Calibri Doğrulama Metni', { x: 54, y: 700, size: 12, font: carlito });

    const bytes = await doc.save();
    const md = mupdf.Document.openDocument(bytes, 'application/pdf');
    try {
      const mp = md.loadPage(0);
      try {
        const blocks = extractTextBlocksFromMuPdfPage(mp, 'p_cal');
        const target = blocks.find((b) => b.text.includes('Calibri Doğrulama'));
        expect(target).toBeDefined();
        expect(target!.fontFamily).toBe('Calibri');
      } finally {
        mp.destroy();
      }
    } finally {
      md.destroy();
    }
  });

  it('merges hanging-indent numbered/bulleted multi-line paragraphs and mixed bold lead-ins cleanly', () => {
    const hangingLines: RawMuLine[] = [
      {
        text: '1. Başvuru sahiplerinin eğitim kurumundan aldıkları onaylı',
        x0: 54,
        y0: 100,
        x1: 472,
        y1: 112,
        baselineY: 110,
        fontSize: 11,
        firstWordWidth: 14,
        color: '#000000',
        fontFamily: 'DejaVuSans',
        rawFontName: 'DejaVuSans-Bold',
        bold: true,
        italic: false,
        serif: false,
        mono: false,
        mupdfBlockIdx: 0,
      },
      {
        text: 'belgeleri eksiksiz olarak koordinatörlüğe teslim etmesi',
        x0: 74,
        y0: 116,
        x1: 468,
        y1: 128,
        baselineY: 126,
        fontSize: 11,
        firstWordWidth: 48,
        color: '#000000',
        fontFamily: 'TimesRoman',
        rawFontName: 'DejaVuSerif',
        bold: false,
        italic: false,
        serif: true,
        mono: false,
        mupdfBlockIdx: 1,
      },
      {
        text: 'gerekmektedir.',
        x0: 74,
        y0: 132,
        x1: 162,
        y1: 144,
        baselineY: 142,
        fontSize: 11,
        firstWordWidth: 70,
        color: '#000000',
        fontFamily: 'TimesRoman',
        rawFontName: 'DejaVuSerif',
        bold: false,
        italic: false,
        serif: true,
        mono: false,
        mupdfBlockIdx: 1,
      },
    ];

    const blocks = buildDetectedTextBlocksFromMuLines(hangingLines, 'p_hang');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe(
      '1. Başvuru sahiplerinin eğitim kurumundan aldıkları onaylı belgeleri eksiksiz olarak koordinatörlüğe teslim etmesi gerekmektedir.',
    );
  });

  it('merges interleaved 2-column PDF stream lines into 2 distinct multi-line column paragraphs', () => {
    const interleavedLines: RawMuLine[] = [
      {
        text: 'Sol sütun birinci satır açıklaması devam',
        x0: 48,
        y0: 100,
        x1: 262,
        y1: 112,
        baselineY: 110,
        fontSize: 10,
        firstWordWidth: 20,
        color: '#000000',
        fontFamily: 'Helvetica',
        rawFontName: 'Helvetica',
        bold: false,
        italic: false,
        serif: false,
        mono: false,
        mupdfBlockIdx: 0,
      },
      {
        text: 'Sağ sütun birinci satır başlangıcı uzun',
        x0: 315,
        y0: 100,
        x1: 534,
        y1: 112,
        baselineY: 110,
        fontSize: 10,
        firstWordWidth: 22,
        color: '#000000',
        fontFamily: 'Helvetica',
        rawFontName: 'Helvetica',
        bold: false,
        italic: false,
        serif: false,
        mono: false,
        mupdfBlockIdx: 1,
      },
      {
        text: 'ediyor ve ikinci satıra geçerek',
        x0: 48,
        y0: 115,
        x1: 258,
        y1: 127,
        baselineY: 125,
        fontSize: 10,
        firstWordWidth: 34,
        color: '#000000',
        fontFamily: 'Helvetica',
        rawFontName: 'Helvetica',
        bold: false,
        italic: false,
        serif: false,
        mono: false,
        mupdfBlockIdx: 2,
      },
      {
        text: 'metni ikinci satırda da sürdürerek',
        x0: 315,
        y0: 115,
        x1: 530,
        y1: 127,
        baselineY: 125,
        fontSize: 10,
        firstWordWidth: 28,
        color: '#000000',
        fontFamily: 'Helvetica',
        rawFontName: 'Helvetica',
        bold: false,
        italic: false,
        serif: false,
        mono: false,
        mupdfBlockIdx: 3,
      },
      {
        text: 'sonlanıyor.',
        x0: 48,
        y0: 130,
        x1: 112,
        y1: 142,
        baselineY: 140,
        fontSize: 10,
        firstWordWidth: 40,
        color: '#000000',
        fontFamily: 'Helvetica',
        rawFontName: 'Helvetica',
        bold: false,
        italic: false,
        serif: false,
        mono: false,
        mupdfBlockIdx: 4,
      },
      {
        text: 'bitiyor.',
        x0: 315,
        y0: 130,
        x1: 365,
        y1: 142,
        baselineY: 140,
        fontSize: 10,
        firstWordWidth: 32,
        color: '#000000',
        fontFamily: 'Helvetica',
        rawFontName: 'Helvetica',
        bold: false,
        italic: false,
        serif: false,
        mono: false,
        mupdfBlockIdx: 5,
      },
    ];

    const blocks = buildDetectedTextBlocksFromMuLines(interleavedLines, 'p_2col');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe(
      'Sol sütun birinci satır açıklaması devam ediyor ve ikinci satıra geçerek sonlanıyor.',
    );
    expect(blocks[1].text).toBe(
      'Sağ sütun birinci satır başlangıcı uzun metni ikinci satırda da sürdürerek bitiyor.',
    );
  });

  it('keeps real MuPDF wrapped paragraph unified even when justified word spacing is stretched', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const serif = await doc.embedFont(loadDejaVuFont('DejaVuSerif.ttf'), { subset: false });
    const p = doc.addPage([595, 842]);

    // Simulate justified line 1 by drawing words slightly spread apart on same baseline,
    // followed by line 2 and short line 3.
    const y1 = 720;
    const line1Words = ['Program', 'kapsamında', 'öğrencilerin', 'belge', 'teslim'];
    let curX = 60;
    for (const w of line1Words) {
      p.drawText(w, { x: curX, y: y1, size: 11, font: serif, color: rgb(0, 0, 0) });
      curX += serif.widthOfTextAtSize(w, 11) + 12;
    }
    p.drawText('süreci danışman onayı ile birlikte eksiksiz biçimde', {
      x: 60,
      y: y1 - 16,
      size: 11,
      font: serif,
      color: rgb(0, 0, 0),
    });
    p.drawText('tamamlanır.', {
      x: 60,
      y: y1 - 32,
      size: 11,
      font: serif,
      color: rgb(0, 0, 0),
    });

    const bytes = await doc.save();
    const md = mupdf.Document.openDocument(bytes, 'application/pdf');
    try {
      const mp = md.loadPage(0);
      try {
        const blocks = extractTextBlocksFromMuPdfPage(mp, 'p_just');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].text).toContain('Program kapsamında öğrencilerin');
        expect(blocks[0].text).toContain('tamamlanır.');
      } finally {
        mp.destroy();
      }
    } finally {
      md.destroy();
    }
  });

  it('preserves 3-decimal fractional fontSize without 0.5pt quantization', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const sans = await doc.embedFont(loadDejaVuFont('DejaVuSans.ttf'), { subset: false });
    const p = doc.addPage([595, 842]);
    p.drawText('Alt piksel font testi 10.62pt', {
      x: 50,
      y: 700,
      size: 10.62,
      font: sans,
      color: rgb(0, 0, 0),
    });
    const bytes = await doc.save();
    const md = mupdf.Document.openDocument(bytes, 'application/pdf');
    try {
      const mp = md.loadPage(0);
      try {
        const blocks = extractTextBlocksFromMuPdfPage(mp, 'p_frac');
        expect(blocks).toHaveLength(1);
        expect(blocks[0].fontSize).toBeCloseTo(10.62, 2);
        expect(blocks[0].fontSize).not.toBe(10.5);
      } finally {
        mp.destroy();
      }
    } finally {
      md.destroy();
    }
  });

  it('computes finite DOM calibration baseline and scale metrics', () => {
    const cal = calibrateDomTextMetrics({
      sampleText: 'Örnek Başlık Metni',
      targetPdfWidthPt: 112,
      fontSizePt: 10.62,
      lineHeight: 1.24,
      baselineOffsetPt: 9.8,
      fontFamily: 'Helvetica',
      fontWeight: 400,
      fontStyle: 'normal',
      initialHorizontalScale: 0.96,
    });
    expect(Number.isFinite(cal.topOffsetPt)).toBe(true);
    expect(Number.isFinite(cal.cssBaselineFromTopPt)).toBe(true);
    expect(cal.topOffsetPt).toBeCloseTo(9.8 - cal.cssBaselineFromTopPt, 4);
    expect(cal.horizontalScale).toBeGreaterThanOrEqual(0.7);
    expect(cal.horizontalScale).toBeLessThanOrEqual(1.35);
    expect(cal.letterSpacingPt).toBeGreaterThanOrEqual(-0.45);
    expect(cal.letterSpacingPt).toBeLessThanOrEqual(1.2);
  });
});
