import { describe, expect, it } from 'vitest';
import {
  applyStyleToRunRange,
  buildWrappedRichLines,
  ensureRunsFromElement,
  normalizeTextRuns,
  runsToPlainText,
} from '../richText';
import type { TextRun } from '@/types/pdf';

describe('richText engine', () => {
  it('normalizes adjacent identical runs and drops empty runs', () => {
    const runs: TextRun[] = [
      { text: 'Madde ', bold: false, italic: false, script: 'normal' },
      { text: '4', bold: false, italic: false, script: 'normal' },
      { text: '', bold: true, italic: false, script: 'super' },
      { text: '1', bold: false, italic: false, script: 'super' },
      { text: ' ve H', bold: false, italic: false, script: 'normal' },
      { text: '2', bold: false, italic: false, script: 'sub' },
      { text: 'O', bold: false, italic: false, script: 'normal' },
    ];

    const norm = normalizeTextRuns(runs, false, false);
    expect(norm).toEqual([
      { text: 'Madde 4', bold: false, italic: false, script: 'normal' },
      { text: '1', bold: false, italic: false, script: 'super' },
      { text: ' ve H', bold: false, italic: false, script: 'normal' },
      { text: '2', bold: false, italic: false, script: 'sub' },
      { text: 'O', bold: false, italic: false, script: 'normal' },
    ]);
    expect(runsToPlainText(norm)).toBe('Madde 41 ve H2O');
  });

  it('keeps atomic word+superscript clusters unbroken while flagging endsParagraph for justification', () => {
    const runs: TextRun[] = [
      { text: 'Alan hesabı 10', script: 'normal' },
      { text: '2', script: 'super' },
      { text: ' metrekare olarak devam eder\nSon satır.', script: 'normal' },
    ];

    // Fixed glyph width helper (~6pt/char normal, ~4pt/char superscript)
    const measure = (text: string, _b: boolean, _i: boolean, script: 'normal' | 'super' | 'sub') =>
      text.length * (script === 'normal' ? 6 : 4);

    // Choose maxWidth so "Alan hesabı" fits, adding " 10²" overflows and wraps whole cluster "10²" together!
    const lines = buildWrappedRichLines(runs, 82, measure, false, false);

    expect(lines.length).toBeGreaterThanOrEqual(3);
    // Line 1 ends before "10²", so "10" and superscript "2" stay glued on line 2
    const line1Text = lines[0].pieces.map((p) => p.text).join('');
    const line2Text = lines[1].pieces.map((p) => p.text).join('');
    expect(line1Text).toBe('Alan hesabı');
    expect(lines[0].endsParagraph).toBe(false);
    expect(line2Text).toContain('102');
    expect(lines[1].pieces.some((p) => p.script === 'super' && p.text === '2')).toBe(true);

    // Final line before '\n' and final line overall both end their respective paragraphs
    const paraEndIdx = lines.findIndex((l) => l.pieces.map((p) => p.text).join('').includes('eder'));
    expect(paraEndIdx).toBeGreaterThanOrEqual(1);
    expect(lines[paraEndIdx].endsParagraph).toBe(true);
    expect(lines[lines.length - 1].endsParagraph).toBe(true);
    expect(lines[lines.length - 1].pieces.map((p) => p.text).join('')).toBe('Son satır.');
  });

  it('toggles super/sub/bold styles over character sub-ranges cleanly', () => {
    const base: TextRun[] = ensureRunsFromElement('Madde 41 H2O', undefined, false, false);
    // Mark '1' (index 7..8) as superscript
    const withSuper = applyStyleToRunRange(base, 7, 8, { script: 'super' }, false, false);
    expect(withSuper).toEqual([
      { text: 'Madde 4', bold: false, italic: false, script: 'normal' },
      { text: '1', bold: false, italic: false, script: 'super' },
      { text: ' H2O', bold: false, italic: false, script: 'normal' },
    ]);

    // Mark '2' (index 10..11) as subscript
    const withBoth = applyStyleToRunRange(withSuper, 10, 11, { script: 'sub' }, false, false);
    expect(withBoth).toEqual([
      { text: 'Madde 4', bold: false, italic: false, script: 'normal' },
      { text: '1', bold: false, italic: false, script: 'super' },
      { text: ' H', bold: false, italic: false, script: 'normal' },
      { text: '2', bold: false, italic: false, script: 'sub' },
      { text: 'O', bold: false, italic: false, script: 'normal' },
    ]);

    // Toggling superscript on index 7..8 again reverts it cleanly to normal
    const toggledOff = applyStyleToRunRange(withBoth, 7, 8, { script: 'super' }, false, false);
    expect(toggledOff[0]).toEqual({
      text: 'Madde 41 H',
      bold: false,
      italic: false,
      script: 'normal',
    });
  });
});
