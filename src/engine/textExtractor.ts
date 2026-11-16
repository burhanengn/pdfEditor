import type { PdfiumRuntimeModule } from './pdfium/pdfiumLoader';
import { getSharedPdfium } from './pdfium/pdfiumLoader';
import type {
  DetectedTextBlock,
  FontFamilyOption,
  RectBox,
  TextAlignOption,
  TextRun,
  TextScriptMode,
} from '@/types/pdf';
import type { HorizontalRule, VerticalRule } from '@/types/worker';
import { createId } from '@/utils/id';
import { isBuiltinFontFamily, normalizeUnicodeForPdf, parsePdfFontMetadata } from './fonts';
import { normalizeTextRuns, runsToPlainText } from './richText';

export interface TableVectorBarriers {
  horizontalRules?: HorizontalRule[];
  verticalRules?: VerticalRule[];
  cellRects?: RectBox[];
}

export interface RawMuLine {
  text: string;
  runs?: TextRun[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  baselineY: number;
  fontSize: number;
  spaceWidth?: number;
  firstWordWidth: number;
  maxWordSpace?: number;
  color: string;
  fontFamily: FontFamilyOption;
  rawFontName: string;
  originalFontName?: string;
  isCustomFont?: boolean;
  horizontalScale?: number;
  bold: boolean;
  italic: boolean;
  serif: boolean;
  mono: boolean;
  mupdfBlockIdx: number;
}

function rgbFloatsToHex(color: number[]): string {
  const r = Math.round(Math.max(0, Math.min(1, color[0] ?? 0)) * 255)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round(Math.max(0, Math.min(1, color[1] ?? 0)) * 255)
    .toString(16)
    .padStart(2, '0');
  const b = Math.round(Math.max(0, Math.min(1, color[2] ?? 0)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${b}`;
}

function areColorsSimilar(a: string, b: string, maxChannelDiff = 34): boolean {
  if (a === b) return true;
  const parse = (hex: string) => [
    Number.parseInt(hex.slice(1, 3), 16) || 0,
    Number.parseInt(hex.slice(3, 5), 16) || 0,
    Number.parseInt(hex.slice(5, 7), 16) || 0,
  ];
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return (
    Math.abs(r1 - r2) <= maxChannelDiff &&
    Math.abs(g1 - g2) <= maxChannelDiff &&
    Math.abs(b1 - b2) <= maxChannelDiff
  );
}

function hasHorizontalRuleBetween(
  prev: RawMuLine,
  next: RawMuLine,
  colLeft: number,
  colRight: number,
  rules?: HorizontalRule[],
): boolean {
  if (!rules || rules.length === 0) return false;
  const topY = prev.baselineY - prev.fontSize * 0.1;
  const botY = next.baselineY - next.fontSize * 0.35;
  if (botY <= topY) return false;

  const spanLeft = Math.min(colLeft, next.x0);
  const spanRight = Math.max(colRight, next.x1);
  const minOverlap = Math.max(8, Math.min(prev.fontSize, next.fontSize) * 1.2);

  for (const r of rules) {
    if (r.y >= topY && r.y <= botY) {
      const overlap = Math.min(r.x1, spanRight) - Math.max(r.x0, spanLeft);
      if (overlap >= minOverlap) {
        return true;
      }
    }
  }
  return false;
}

function findInnermostCellIndex(
  cx: number,
  cy: number,
  cellRects?: RectBox[],
): number {
  if (!cellRects || cellRects.length === 0) return -1;
  let bestIdx = -1;
  let bestArea = Infinity;
  for (let i = 0; i < cellRects.length; i++) {
    const r = cellRects[i];
    if (cx >= r.x - 1 && cx <= r.x + r.width + 1 && cy >= r.y - 1 && cy <= r.y + r.height + 1) {
      const area = r.width * r.height;
      if (area < bestArea) {
        bestArea = area;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

function hasVerticalBarrierBetween(
  xLeft: number,
  xRight: number,
  yTop: number,
  yBottom: number,
  barriers?: TableVectorBarriers,
): boolean {
  if (!barriers) return false;
  const vRules = barriers.verticalRules;
  if (vRules && vRules.length > 0) {
    const minYOverlap = Math.max(3, (yBottom - yTop) * 0.3);
    for (const v of vRules) {
      if (v.x >= xLeft - 2 && v.x <= xRight + 2) {
        const yOverlap = Math.min(v.y1, yBottom) - Math.max(v.y0, yTop);
        if (yOverlap >= minYOverlap) {
          return true;
        }
      }
    }
  }
  const cellRects = barriers.cellRects;
  if (cellRects && cellRects.length > 0) {
    const midY = (yTop + yBottom) / 2;
    const c1 = findInnermostCellIndex(Math.max(0, xLeft - 2), midY, cellRects);
    const c2 = findInnermostCellIndex(xRight + 2, midY, cellRects);
    if (c1 !== c2) {
      return true;
    }
  }
  return false;
}

function normalizeBarriers(
  rulesOrBarriers?: HorizontalRule[] | TableVectorBarriers,
): TableVectorBarriers {
  if (!rulesOrBarriers) return {};
  if (Array.isArray(rulesOrBarriers)) {
    return { horizontalRules: rulesOrBarriers };
  }
  return rulesOrBarriers;
}

function isBulletLineStart(text: string): boolean {
  return /^([•●◦▪■\-*–—]|\d+[.)]|\([a-zA-Z0-9]\))\s+/.test(text.trimStart());
}

function detectParagraphAlignment(
  group: RawMuLine[],
  softWrappedFlags: boolean[],
  minX: number,
  maxR: number,
): TextAlignOption {
  if (group.length < 2) return 'left';
  const blockWidth = maxR - minX;
  const fs = group[0].fontSize;
  const tol = Math.max(2.5, fs * 0.34);

  // Count lines flush to the right margin on soft-wrapped lines
  let justifiedHits = 0;
  let softCount = 0;
  let hasStretchedSpace = false;

  for (let i = 0; i < group.length - 1; i++) {
    if (!softWrappedFlags[i]) continue;
    softCount++;
    const line = group[i];
    const leftOk =
      Math.abs(line.x0 - minX) <= tol ||
      (i === 0 && line.x0 > minX && line.x0 - minX <= fs * 4.5);
    const rightOk = Math.abs(line.x1 - maxR) <= tol;
    if (leftOk && rightOk) {
      justifiedHits++;
    }
    if ((line.maxWordSpace ?? 0) >= fs * 0.34) {
      hasStretchedSpace = true;
    }
  }

  if (
    blockWidth >= fs * 10 &&
    softCount >= 1 &&
    (justifiedHits >= 2 || (justifiedHits === 1 && softCount === 1 && hasStretchedSpace))
  ) {
    return 'justify';
  }

  // Check centered or right-aligned multi-line blocks (where left edges visibly vary)
  const blockCenter = (minX + maxR) / 2;
  const x0Spread = Math.max(...group.map((l) => l.x0)) - Math.min(...group.map((l) => l.x0));
  const x1Spread = Math.max(...group.map((l) => l.x1)) - Math.min(...group.map((l) => l.x1));

  if (x0Spread > fs * 0.5) {
    const allRightFlush = group.every((l) => Math.abs(l.x1 - maxR) <= tol);
    if (allRightFlush) return 'right';

    const allCentered = group.every(
      (l) => Math.abs((l.x0 + l.x1) / 2 - blockCenter) <= tol,
    );
    if (allCentered && x1Spread > fs * 0.5) return 'center';
  }

  return 'left';
}

/**
 * Pure line-to-paragraph grouping, justification inference, and soft-wrap reflow joiner.
 * Merges consecutive compatible prose lines (including 1.5x/2x leading, first-line indent,
 * inline superscript/subscript/bold spans, and justified spacing) into unified editable blocks
 * while preserving table cell and heading boundaries.
 */
export function buildDetectedTextBlocksFromMuLines(
  rawLines: RawMuLine[],
  pageId: string,
  rulesOrBarriers?: HorizontalRule[] | TableVectorBarriers,
): DetectedTextBlock[] {
  if (rawLines.length === 0) return [];
  const barriers = normalizeBarriers(rulesOrBarriers);
  const horizontalRules = barriers.horizontalRules;

  const groups: RawMuLine[][] = [];

  const canMergeIntoGroup = (group: RawMuLine[], candidate: RawMuLine): boolean => {
    const prev = group[group.length - 1];
    const minFs = Math.min(prev.fontSize, candidate.fontSize);
    const maxFs = Math.max(prev.fontSize, candidate.fontSize);

    // Same vertical reading flow down a column
    const verticalGap = candidate.baselineY - prev.baselineY;
    if (verticalGap <= minFs * 0.4 || verticalGap > maxFs * 2.3) {
      return false;
    }
    if (candidate.y0 - prev.y1 > maxFs * 1.65) {
      return false;
    }

    // If paragraph already has established intra-line leading, reject large paragraph-spacing gaps
    if (group.length >= 2) {
      let sumGap = 0;
      for (let i = 1; i < group.length; i++) {
        sumGap += group[i].baselineY - group[i - 1].baselineY;
      }
      const avgLeading = sumGap / (group.length - 1);
      if (avgLeading > 0 && verticalGap > avgLeading * 1.62 && verticalGap > maxFs * 1.95) {
        return false;
      }
    }

    // Never merge across horizontal/vertical table borders or cell boundaries
    const colLeft = Math.min(...group.map((l) => l.x0));
    const colRight = Math.max(...group.map((l) => l.x1));
    if (hasHorizontalRuleBetween(prev, candidate, colLeft, colRight, horizontalRules)) {
      return false;
    }

    if (barriers.cellRects && barriers.cellRects.length > 0) {
      const prevCell = findInnermostCellIndex(
        (prev.x0 + prev.x1) / 2,
        (prev.y0 + prev.y1) / 2,
        barriers.cellRects,
      );
      const candCell = findInnermostCellIndex(
        (candidate.x0 + candidate.x1) / 2,
        (candidate.y0 + candidate.y1) / 2,
        barriers.cellRects,
      );
      if (prevCell !== candCell) {
        return false;
      }
    }

    const prevMidX = (prev.x0 + prev.x1) / 2;
    const candMidX = (candidate.x0 + candidate.x1) / 2;
    if (
      Math.abs(candMidX - prevMidX) > 2 &&
      barriers.verticalRules &&
      barriers.verticalRules.some(
        (v) =>
          v.x >= Math.min(prevMidX, candMidX) &&
          v.x <= Math.max(prevMidX, candMidX) &&
          v.y1 >= prev.y0 &&
          v.y0 <= candidate.y1,
      )
    ) {
      return false;
    }

    // Font metrics and ink color compatibility
    if (Math.abs(candidate.fontSize - prev.fontSize) > Math.max(1.35, minFs * 0.14)) {
      return false;
    }
    if (!areColorsSimilar(candidate.color, prev.color)) {
      return false;
    }
    if (candidate.mono !== prev.mono) {
      return false;
    }
    // Allow inline mixed font variants within proportional prose (e.g., bold lead-in subset font
    // resolved to Inter vs body Helvetica, or a math/symbol char flipping serif flags on one line)
    if (candidate.fontFamily !== prev.fontFamily && candidate.serif !== prev.serif) {
      const sameLeftEdge = Math.abs(candidate.x0 - prev.x0) <= maxFs * 0.8;
      const sameRightEdge = Math.abs(candidate.x1 - prev.x1) <= maxFs * 1.2;
      if (!sameLeftEdge && !sameRightEdge) {
        return false;
      }
    }

    // Horizontal alignment & column overlap check
    const overlap = Math.min(candidate.x1, colRight) - Math.max(candidate.x0, colLeft);
    if (overlap <= 0) {
      return false;
    }

    const colCenter = (colLeft + colRight) / 2;
    const candCenter = (candidate.x0 + candidate.x1) / 2;
    const leftAligned = Math.abs(candidate.x0 - colLeft) <= maxFs * 1.8;
    const prevLeftAligned = Math.abs(candidate.x0 - prev.x0) <= maxFs * 1.8;
    const firstLineIndented =
      group.length === 1 &&
      prev.x0 > candidate.x0 &&
      prev.x0 - candidate.x0 <= maxFs * 4.5 &&
      candidate.x1 >= prev.x0;
    const hangingIndent =
      group.length === 1 &&
      candidate.x0 > prev.x0 &&
      candidate.x0 - prev.x0 <= maxFs * 4.5 &&
      (isBulletLineStart(prev.text) ||
        Math.abs(candidate.x1 - prev.x1) <= maxFs * 2.5 ||
        prev.x1 - prev.x0 >= maxFs * 8);
    const centerAligned = Math.abs(candCenter - colCenter) <= maxFs * 1.25;
    const rightAligned = Math.abs(candidate.x1 - colRight) <= maxFs * 1.25;

    if (
      !leftAligned &&
      !prevLeftAligned &&
      !firstLineIndented &&
      !hangingIndent &&
      !centerAligned &&
      !rightAligned
    ) {
      return false;
    }

    // Protect short bold headings above regular body paragraphs from merging into the body,
    // while allowing bold lead-in first lines whose wrap stopped because candidate's first word overflowed.
    if (group.length === 1 && prev.bold && !candidate.bold) {
      const expectedRight = Math.max(colRight, candidate.x1);
      const wordCouldFitOnPrev =
        prev.x1 + prev.fontSize * 0.35 + candidate.firstWordWidth < expectedRight - prev.fontSize * 1.2;
      const prevShortHeading = prev.x1 + prev.fontSize * 1.5 < candidate.x1 && wordCouldFitOnPrev;
      if (prevShortHeading) {
        return false;
      }
    }

    // Explicit hard paragraph boundary: prev ended a sentence well before right margin
    const trimmedPrev = prev.text.trimEnd();
    const sortedRights = group.map((l) => l.x1).sort((a, b) => a - b);
    const typicalRight =
      group.length >= 3 ? sortedRights[Math.max(0, sortedRights.length - 2)] : colRight;
    if (
      group.length >= 2 &&
      /[.!?:…»”)]$/.test(trimmedPrev) &&
      prev.x1 + prev.fontSize * 0.35 + candidate.firstWordWidth < typicalRight - prev.fontSize * 1.65
    ) {
      return false;
    }

    return true;
  };

  // Process lines stably in visual top-to-bottom order and match against active columns/groups
  // so 2-column layouts or interleaved watermark/margin items never fragment prose paragraphs.
  const orderedLines = rawLines
    .filter((l) => l.text.trim().length > 0)
    .sort((a, b) => {
      if (Math.abs(a.baselineY - b.baselineY) > 0.5) return a.baselineY - b.baselineY;
      return a.x0 - b.x0;
    });

  const groupLastSortedIdx: number[] = [];
  for (let i = 0; i < orderedLines.length; i++) {
    const cand = orderedLines[i];
    let bestGroupIdx = -1;
    let bestScore = Infinity;

    for (let gIdx = groups.length - 1; gIdx >= 0; gIdx--) {
      const group = groups[gIdx];
      const prev = group[group.length - 1];
      if (cand.baselineY - prev.baselineY > Math.max(prev.fontSize, cand.fontSize) * 2.5) {
        continue;
      }
      if (!canMergeIntoGroup(group, cand)) continue;

      // Ensure no intermediate line sits inside the same horizontal band between prev & cand
      const lastLineIdx = groupLastSortedIdx[gIdx];
      const spanMinX = Math.min(prev.x0, cand.x0);
      const spanMaxX = Math.max(prev.x1, cand.x1);
      let blockedByIntervening = false;
      for (let k = lastLineIdx + 1; k < i; k++) {
        const mid = orderedLines[k];
        if (mid.baselineY > prev.baselineY + 1 && mid.baselineY < cand.baselineY - 1) {
          const hOverlap = Math.min(mid.x1, spanMaxX) - Math.max(mid.x0, spanMinX);
          if (hOverlap > 2) {
            blockedByIntervening = true;
            break;
          }
        }
      }
      if (blockedByIntervening) continue;

      const score =
        Math.abs(cand.x0 - prev.x0) * 0.5 + (cand.baselineY - prev.baselineY);
      if (score < bestScore) {
        bestScore = score;
        bestGroupIdx = gIdx;
      }
    }

    if (bestGroupIdx !== -1) {
      groups[bestGroupIdx].push(cand);
      groupLastSortedIdx[bestGroupIdx] = i;
    } else {
      groups.push([cand]);
      groupLastSortedIdx.push(i);
    }
  }

  const blocks: DetectedTextBlock[] = [];

  for (const group of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    const minX = Math.min(...group.map((l) => l.x0));
    const minY = Math.min(first.baselineY - first.fontSize * 0.88, ...group.map((l) => l.y0));
    const maxR = Math.max(...group.map((l) => l.x1));
    const maxB = Math.max(last.baselineY + last.fontSize * 0.25, ...group.map((l) => l.y1));

    let lineHeight = 1.2;
    if (group.length > 1) {
      const diffs: number[] = [];
      for (let i = 1; i < group.length; i++) {
        diffs.push(group[i].baselineY - group[i - 1].baselineY);
      }
      const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      lineHeight = Math.max(1.0, Math.min(2.1, Number((avgDiff / first.fontSize).toFixed(2))));
    }

    // Pick dominant font styles weighted across lines
    const boldCount = group.filter((l) => l.bold).length;
    const italicCount = group.filter((l) => l.italic).length;
    const domBold = boldCount > group.length / 2;
    const domItalic = italicCount > group.length / 2;

    const lineRuns = (l: RawMuLine): TextRun[] =>
      l.runs && l.runs.length > 0
        ? l.runs
        : [{ text: l.text.trim(), bold: l.bold, italic: l.italic, script: 'normal' }];

    // Reconstruct logical paragraph text and rich runs across soft-wrapped lines vs explicit breaks
    const softWrappedFlags: boolean[] = [];
    const mergedRuns: TextRun[] = [...lineRuns(group[0])];

    for (let i = 0; i < group.length - 1; i++) {
      const prev = group[i];
      const next = group[i + 1];
      const prevTrimmed = prev.text.trimEnd();
      const nextTrimmed = next.text.trimStart();
      const spaceW = prev.fontSize * 0.28;
      const firstWordW = Math.max(next.firstWordWidth, prev.fontSize * 0.75);
      const wordCount = prevTrimmed.split(/\s+/).filter(Boolean).length;
      const startsBullet = isBulletLineStart(nextTrimmed);
      const isShortLabel =
        prevTrimmed.endsWith(':') || (maxR - minX < prev.fontSize * 12 && wordCount < 4);
      const isSentenceEndWithGap =
        /[.!?…»”)]$/.test(prevTrimmed) &&
        maxR - prev.x1 > firstWordW + prev.fontSize * 1.4;

      const softWrapped =
        !startsBullet &&
        !isShortLabel &&
        !isSentenceEndWithGap &&
        prev.x1 + spaceW + firstWordW >= maxR - prev.fontSize * 0.95;

      softWrappedFlags.push(softWrapped);
      mergedRuns.push({
        text: softWrapped ? ' ' : '\n',
        bold: domBold,
        italic: domItalic,
        script: 'normal',
      });
      mergedRuns.push(...lineRuns(next));
    }

    const normalizedRuns = normalizeTextRuns(mergedRuns, domBold, domItalic);
    const finalText = runsToPlainText(normalizedRuns).trim();
    if (!finalText) continue;

    const align = detectParagraphAlignment(group, softWrappedFlags, minX, maxR);
    const hasRichVariation = normalizedRuns.some(
      (r) =>
        (r.script ?? 'normal') !== 'normal' ||
        (r.bold ?? domBold) !== domBold ||
        (r.italic ?? domItalic) !== domItalic,
    );

    const parsedDominantFont = parsePdfFontMetadata(first.rawFontName, {
      isSerif: first.serif,
      isMono: first.mono,
      isBold: domBold,
      isItalic: domItalic,
    });
    const hasCustomFont = group.some((l) => l.isCustomFont) || parsedDominantFont.isCustomFont;
    const avgScale =
      group.reduce(
        (s, l) => s + (l.horizontalScale ?? parsedDominantFont.estimatedHorizontalScale),
        0,
      ) / group.length;

    blocks.push({
      id: createId('txtblk'),
      pageId,
      text: normalizeUnicodeForPdf(finalText),
      runs: hasRichVariation ? normalizedRuns : undefined,
      x: minX,
      y: minY,
      width: Math.max(10, maxR - minX),
      height: Math.max(first.fontSize * 1.15, maxB - minY),
      fontSize: Number(first.fontSize.toFixed(3)),
      fontFamily: first.fontFamily,
      fallbackFontFamily: isBuiltinFontFamily(first.fontFamily)
        ? first.fontFamily
        : parsedDominantFont.fontFamily,
      fontSource: 'builtin',
      rawFontName: first.rawFontName,
      originalFontName: first.originalFontName ?? parsedDominantFont.cleanFontName,
      isCustomFont: hasCustomFont,
      horizontalScale: Number(avgScale.toFixed(3)),
      letterSpacing: 0,
      paragraphWidth: Number((maxR - minX).toFixed(2)),
      bold: domBold,
      italic: domItalic,
      align,
      color: first.color,
      lineHeight,
      baselineOffset: first.baselineY - minY,
    });
  }

  return blocks;
}

interface ExtractedChar {
  c: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  baselineY: number;
  size: number;
  color: string;
  fontName: string;
  cleanFontName?: string;
  isCustomFont?: boolean;
  horizontalScale?: number;
  fontFamily: FontFamilyOption;
  bold: boolean;
  italic: boolean;
  serif: boolean;
  mono: boolean;
  forcedScript?: TextScriptMode;
}

interface CharAccumulator {
  chars: ExtractedChar[];
  mupdfBlockIdx: number;
}

/**
 * Joins same-baseline prose chunks that MuPDF StructuredText split due to justified inter-word
 * gaps or separate PDF Tj operators, without merging across wide column gaps, vector table borders,
 * or absorbing smaller superscript/subscript spans.
 */
function mergeSameBaselineSegments(
  segments: CharAccumulator[],
  barriers?: TableVectorBarriers,
): CharAccumulator[] {
  if (segments.length <= 1) return segments;

  type SegMeta = {
    empty: boolean;
    size: number;
    baseY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    spaceWidth: number;
    avgInternalWordGap: number;
    color: string;
    mono: boolean;
    serif: boolean;
    fontFamily: FontFamilyOption;
  };

  const getMeta = (seg: CharAccumulator): SegMeta => {
    const visible = seg.chars.filter((ch) => !/^\s$/.test(ch.c));
    if (visible.length === 0) {
      return {
        empty: true,
        size: 0,
        baseY: 0,
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0,
        spaceWidth: 3,
        avgInternalWordGap: 0,
        color: '#000000',
        mono: false,
        serif: false,
        fontFamily: 'Helvetica',
      };
    }
    const maxSize = Math.max(...visible.map((ch) => ch.size));
    const body = visible.filter((ch) => ch.size >= maxSize * 0.84);
    const pool = body.length > 0 ? body : visible;
    const avgSize = pool.reduce((s, ch) => s + ch.size, 0) / pool.length;
    const baseY = pool.reduce((s, ch) => s + ch.baselineY, 0) / pool.length;
    const lead = pool[0];

    const spaces = seg.chars.filter((ch) => ch.c === ' ' && ch.x1 > ch.x0);
    const spaceWidth =
      spaces.length > 0
        ? spaces.reduce((s, ch) => s + (ch.x1 - ch.x0), 0) / spaces.length
        : Math.max(2.2, avgSize * 0.27);

    const internalGaps: number[] = [];
    for (let i = 1; i < visible.length; i++) {
      const g = visible[i].x0 - visible[i - 1].x1;
      if (g > Math.max(1.5, avgSize * 0.14)) {
        internalGaps.push(g);
      }
    }
    const avgInternalWordGap =
      internalGaps.length > 0
        ? internalGaps.reduce((s, g) => s + g, 0) / internalGaps.length
        : 0;

    return {
      empty: false,
      size: avgSize,
      baseY,
      minX: Math.min(...visible.map((ch) => ch.x0)),
      maxX: Math.max(...visible.map((ch) => ch.x1)),
      minY: Math.min(...visible.map((ch) => ch.y0)),
      maxY: Math.max(...visible.map((ch) => ch.y1)),
      spaceWidth,
      avgInternalWordGap,
      color: lead.color,
      mono: lead.mono,
      serif: lead.serif,
      fontFamily: lead.fontFamily,
    };
  };

  // Clone arrays before sorting/merging left-to-right chains
  const items = segments
    .map((seg, origIdx) => ({ seg: { ...seg, chars: [...seg.chars] }, origIdx, meta: getMeta(seg) }))
    .filter((item) => !item.meta.empty);

  const used = new Set<number>();
  const result: Array<{ seg: CharAccumulator; origIdx: number }> = [];

  // First coalesce uniform multi-word justified rows (e.g., 5+ evenly spaced single-word runs
  // with stretched inter-word spacing <= 4.2*fontSize and no vertical borders) that MuPDF emits separately
  const preMergedMap = new Map<number, number>();
  const rowSortedIdx = items
    .map((_, idx) => idx)
    .sort((a, b) => {
      const ma = items[a].meta;
      const mb = items[b].meta;
      if (Math.abs(ma.baseY - mb.baseY) > 2.5) return ma.baseY - mb.baseY;
      return ma.minX - mb.minX;
    });

  let rStart = 0;
  while (rStart < rowSortedIdx.length) {
    const seed = items[rowSortedIdx[rStart]];
    const rowChain = [rowSortedIdx[rStart]];
    let rEnd = rStart + 1;
    while (rEnd < rowSortedIdx.length) {
      const cand = items[rowSortedIdx[rEnd]];
      const prev = items[rowChain[rowChain.length - 1]];
      const minFs = Math.min(prev.meta.size, cand.meta.size);
      if (
        Math.abs(cand.meta.baseY - seed.meta.baseY) <= minFs * 0.28 &&
        Math.abs(cand.meta.size - seed.meta.size) <= 1.25 &&
        cand.meta.mono === seed.meta.mono &&
        cand.meta.serif === seed.meta.serif &&
        cand.meta.fontFamily === seed.meta.fontFamily &&
        areColorsSimilar(cand.meta.color, seed.meta.color) &&
        !hasVerticalBarrierBetween(
          prev.meta.maxX,
          cand.meta.minX,
          Math.min(prev.meta.minY, cand.meta.minY),
          Math.max(prev.meta.maxY, cand.meta.maxY),
          barriers,
        )
      ) {
        rowChain.push(rowSortedIdx[rEnd]);
        rEnd++;
      } else {
        break;
      }
    }

    if (rowChain.length >= 3) {
      const rowGaps: number[] = [];
      let hasInternalTight = false;
      let maxFsRow = 0;
      for (let idx = 0; idx < rowChain.length; idx++) {
        const it = items[rowChain[idx]];
        maxFsRow = Math.max(maxFsRow, it.meta.size);
        if (it.meta.avgInternalWordGap > 0) hasInternalTight = true;
        if (idx > 0) {
          rowGaps.push(it.meta.minX - items[rowChain[idx - 1]].meta.maxX);
        }
      }
      const minG = Math.min(...rowGaps);
      const maxG = Math.max(...rowGaps);
      const ratioLimit = rowChain.length >= 4 ? 1.55 : 1.45;
      if (
        !hasInternalTight &&
        minG > maxFsRow * 0.14 &&
        maxG <= maxFsRow * 4.5 &&
        maxG / Math.max(1, minG) <= ratioLimit
      ) {
        for (const memberIdx of rowChain) {
          preMergedMap.set(memberIdx, rowChain[0]);
        }
      }
    }
    rStart = rEnd;
  }

  // Collapse detected justified baseline chains immediately into single line accumulators
  const justifiedConsumed = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const leader = preMergedMap.get(i);
    if (leader !== undefined && leader !== i) {
      const host = items[leader];
      const gap = items[i].meta.minX - host.meta.maxX;
      const lastChar = host.seg.chars[host.seg.chars.length - 1];
      const firstCand = items[i].seg.chars[0];
      if (
        gap > host.meta.size * 0.14 &&
        lastChar &&
        firstCand &&
        !/^\s$/.test(lastChar.c) &&
        !/^\s$/.test(firstCand.c)
      ) {
        host.seg.chars.push({
          ...lastChar,
          c: ' ',
          x0: host.meta.maxX,
          x1: items[i].meta.minX,
        });
      }
      host.seg.chars.push(...items[i].seg.chars);
      host.meta = getMeta(host.seg);
      justifiedConsumed.add(i);
    }
  }

  // Process leftmost-first among baseline peers so horizontal chains stitch deterministically
  const byGeoOrder = items
    .map((_, idx) => idx)
    .filter((idx) => !justifiedConsumed.has(idx))
    .sort((a, b) => {
      const ma = items[a].meta;
      const mb = items[b].meta;
      if (Math.abs(ma.baseY - mb.baseY) > 2.5) return ma.baseY - mb.baseY;
      return ma.minX - mb.minX;
    });

  for (const seedIdx of byGeoOrder) {
    if (used.has(seedIdx) || justifiedConsumed.has(seedIdx)) continue;
    used.add(seedIdx);

    const host = items[seedIdx];
    let hostMeta = host.meta;
    let firstOrigIdx = host.origIdx;

    let mergedAny = true;
    while (mergedAny) {
      mergedAny = false;
      // Find closest compatible peer immediately to the right on the same baseline
      let bestIdx = -1;
      let bestGap = Infinity;

      for (let k = 0; k < items.length; k++) {
        if (used.has(k) || justifiedConsumed.has(k)) continue;
        const cand = items[k];
        const cm = cand.meta;
        const minFs = Math.min(hostMeta.size, cm.size);
        const maxFs = Math.max(hostMeta.size, cm.size);

        if (Math.abs(hostMeta.baseY - cm.baseY) > minFs * 0.3) continue;
        // Leave smaller superscript/subscript fragments for mergeOrphanScriptSegments
        if (Math.abs(hostMeta.size - cm.size) > 1.25) continue;
        if (hostMeta.mono !== cm.mono || !areColorsSimilar(hostMeta.color, cm.color)) {
          continue;
        }

        const gap = cm.minX - hostMeta.maxX;
        if (gap < -minFs * 0.25) continue;

        const refSpaceW = Math.min(hostMeta.spaceWidth, cm.spaceWidth);
        const isTightInlinePeer = gap <= Math.max(refSpaceW * 2.2, maxFs * 0.95);
        if (!isTightInlinePeer && (hostMeta.serif !== cm.serif || hostMeta.fontFamily !== cm.fontFamily)) {
          continue;
        }

        if (
          hasVerticalBarrierBetween(
            hostMeta.maxX,
            cm.minX,
            Math.min(hostMeta.minY, cm.minY),
            Math.max(hostMeta.maxY, cm.maxY),
            barriers,
          )
        ) {
          continue;
        }

        const tightJoinThreshold = Math.max(refSpaceW * 1.8, maxFs * 0.55);
        if (gap > tightJoinThreshold) {
          const hostInternal = hostMeta.avgInternalWordGap;
          const candInternal = cm.avgInternalWordGap;
          const unevenColumnJump =
            (hostInternal > 0 && gap > hostInternal * 1.95 && gap > refSpaceW * 2.1) ||
            (candInternal > 0 && gap > candInternal * 1.95 && gap > refSpaceW * 2.1);
          if (unevenColumnJump || gap > maxFs * 2.05) {
            continue;
          }
        }

        if (gap < bestGap) {
          bestGap = gap;
          bestIdx = k;
        }
      }

      if (bestIdx !== -1) {
        const right = items[bestIdx];
        const lastChar = host.seg.chars[host.seg.chars.length - 1];
        const firstRight = right.seg.chars[0];
        if (
          bestGap > hostMeta.size * 0.14 &&
          lastChar &&
          firstRight &&
          !/^\s$/.test(lastChar.c) &&
          !/^\s$/.test(firstRight.c)
        ) {
          host.seg.chars.push({
            ...lastChar,
            c: ' ',
            x0: hostMeta.maxX,
            x1: right.meta.minX,
          });
        }
        host.seg.chars.push(...right.seg.chars);
        used.add(bestIdx);
        firstOrigIdx = Math.min(firstOrigIdx, right.origIdx);
        hostMeta = getMeta(host.seg);
        host.meta = hostMeta;
        mergedAny = true;
      }
    }

    result.push({ seg: host.seg, origIdx: firstOrigIdx });
  }

  result.sort((a, b) => a.origIdx - b.origIdx);
  return result.map((r) => r.seg);
}

/**
 * Re-attaches standalone tiny superscript/subscript segments that MuPDF's StructuredText split
 * into a separate micro-line onto their parent text segment in proper left-to-right order.
 */
function mergeOrphanScriptSegments(segments: CharAccumulator[]): CharAccumulator[] {
  const meta = segments.map((seg) => {
    const visible = seg.chars.filter((ch) => !/^\s$/.test(ch.c));
    if (visible.length === 0) {
      return { empty: true, maxSize: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, baseY: 0, count: 0 };
    }
    const maxSize = Math.max(...visible.map((ch) => ch.size));
    const bodyChars = visible.filter((ch) => ch.size >= maxSize * 0.84);
    const bodyBaseY =
      bodyChars.reduce((s, ch) => s + ch.baselineY, 0) / Math.max(1, bodyChars.length);
    return {
      empty: false,
      maxSize,
      minX: Math.min(...visible.map((ch) => ch.x0)),
      maxX: Math.max(...visible.map((ch) => ch.x1)),
      minY: Math.min(...visible.map((ch) => ch.y0)),
      maxY: Math.max(...visible.map((ch) => ch.y1)),
      baseY: bodyBaseY,
      count: visible.length,
    };
  });

  const absorbed = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    const m = meta[i];
    if (m.empty || m.count > 8) continue;

    // Look for an enclosing or tightly adjacent host line with clearly larger body font size
    let bestHost = -1;
    let bestDist = Infinity;

    for (let j = 0; j < segments.length; j++) {
      if (i === j || absorbed.has(j)) continue;
      const h = meta[j];
      if (h.empty || h.count < 1) continue;
      if (m.maxSize > h.maxSize * 0.83) continue;

      // Vertical proximity to host line box
      if (m.maxY < h.minY - h.maxSize * 0.45 || m.minY > h.maxY + h.maxSize * 0.35) continue;
      // Distinct superscript / subscript vertical shift from host baseline
      if (Math.abs(m.baseY - h.baseY) < h.maxSize * 0.1) continue;

      // Horizontal overlap or tight right-edge adjacency (e.g., footnote after final word)
      const hGap = Math.max(0, m.minX - h.maxX, h.minX - m.maxX);
      const insideOrAdjacent =
        (m.minX >= h.minX - 2 && m.minX <= h.maxX + h.maxSize * 1.2) ||
        (m.maxX >= h.minX - 2 && m.maxX <= h.maxX + 2);
      if (!insideOrAdjacent) continue;

      const d = hGap * 2 + Math.abs(m.baseY - h.baseY);
      if (d < bestDist) {
        bestDist = d;
        bestHost = j;
      }
    }

    if (bestHost !== -1) {
      const hostMeta = meta[bestHost];
      const script: TextScriptMode = m.baseY < hostMeta.baseY ? 'super' : 'sub';
      const patchedChars = segments[i].chars
        .filter((ch) => !/^\s$/.test(ch.c))
        .map((ch) => ({ ...ch, forcedScript: script }));
      segments[bestHost].chars.push(...patchedChars);
      segments[bestHost].chars.sort((a, b) => a.x0 - b.x0);
      absorbed.add(i);
    }
  }

  return segments.filter((_, idx) => !absorbed.has(idx));
}

/**
 * Splits a single collected MuPDF visual line at vector borders, cell boundaries,
 * or non-justified column gutters, while preserving stretched uniform spaces on justified prose lines.
 */
function splitLineCharsAtBarriersAndColumns(
  chars: ExtractedChar[],
  mupdfBlockIdx: number,
  barriers: TableVectorBarriers,
): CharAccumulator[] {
  if (chars.length === 0) return [];
  const visIndices: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (!/^\s$/.test(chars[i].c)) visIndices.push(i);
  }
  if (visIndices.length <= 1) {
    return [{ chars, mupdfBlockIdx }];
  }

  const explicitSpaces = chars.filter((ch) => ch.c === ' ' && ch.x1 > ch.x0);
  const avgFontSize =
    visIndices.reduce((s, idx) => s + chars[idx].size, 0) / visIndices.length;
  const spaceW =
    explicitSpaces.length > 0
      ? explicitSpaces.reduce((s, ch) => s + (ch.x1 - ch.x0), 0) / explicitSpaces.length
      : Math.max(2.2, avgFontSize * 0.27);

  interface GapInfo {
    nextCharIdx: number;
    gap: number;
    refSize: number;
    crossedBorder: boolean;
  }

  const transitions: GapInfo[] = [];
  for (let i = 1; i < visIndices.length; i++) {
    const prev = chars[visIndices[i - 1]];
    const cur = chars[visIndices[i]];
    const refSize = Math.max(prev.size, cur.size);
    const gap = cur.x0 - prev.x1;
    const crossedBorder = hasVerticalBarrierBetween(
      prev.x1,
      cur.x0,
      Math.min(prev.y0, cur.y0),
      Math.max(prev.y1, cur.y1),
      barriers,
    );
    if (crossedBorder || gap > Math.max(1.5, refSize * 0.14)) {
      transitions.push({
        nextCharIdx: visIndices[i],
        gap,
        refSize,
        crossedBorder,
      });
    }
  }

  if (transitions.length === 0) {
    return [{ chars, mupdfBlockIdx }];
  }

  const wordGaps = transitions.filter((t) => !t.crossedBorder);
  const tightGaps = wordGaps
    .filter((t) => t.gap <= Math.max(spaceW * 1.8, t.refSize * 0.65))
    .map((t) => t.gap)
    .sort((a, b) => a - b);
  const medianTightGap =
    tightGaps.length > 0 ? tightGaps[Math.floor(tightGaps.length / 2)] : 0;

  let isUniformJustified = false;
  if (wordGaps.length >= 3 && tightGaps.length === 0) {
    const minG = Math.min(...wordGaps.map((g) => g.gap));
    const maxG = Math.max(...wordGaps.map((g) => g.gap));
    const maxRef = Math.max(...wordGaps.map((g) => g.refSize));
    if (minG > maxRef * 0.18 && maxG <= maxRef * 4.2 && maxG / Math.max(1, minG) <= 1.55) {
      isUniformJustified = true;
    }
  }

  const splitPoints = new Set<number>();
  const allGapsSorted = wordGaps.map((g) => g.gap).sort((a, b) => a - b);
  const medianAllGap =
    allGapsSorted.length > 0 ? allGapsSorted[Math.floor(allGapsSorted.length / 2)] : spaceW;

  for (const t of transitions) {
    if (t.crossedBorder) {
      splitPoints.add(t.nextCharIdx);
      continue;
    }
    if (isUniformJustified) continue;

    if (tightGaps.length > 0) {
      if (
        t.gap > Math.max(22, spaceW * 2.2, t.refSize * 2.2) &&
        t.gap > medianTightGap * 2.8
      ) {
        splitPoints.add(t.nextCharIdx);
      }
    } else if (
      wordGaps.length <= 2
        ? t.gap > Math.max(20, t.refSize * 1.85)
        : t.gap > Math.max(22, t.refSize * 2.1, medianAllGap * 1.75)
    ) {
      splitPoints.add(t.nextCharIdx);
    }
  }

  if (splitPoints.size === 0) {
    return [{ chars, mupdfBlockIdx }];
  }

  const out: CharAccumulator[] = [];
  let cur: ExtractedChar[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (splitPoints.has(i) && cur.length > 0) {
      out.push({ chars: cur, mupdfBlockIdx });
      cur = [];
    }
    cur.push(chars[i]);
  }
  if (cur.length > 0) {
    out.push({ chars: cur, mupdfBlockIdx });
  }
  return out;
}

/**
 * Extracts accurate Unicode text, rich inline formatting (bold, italic, superscript, subscript),
 * true ink colors, alignment, and smartly grouped paragraphs directly via PDFium (`FPDFText_*`),
 * completely free of MuPDF.
 */
export function extractTextBlocksFromPdfiumPage(
  mod: PdfiumRuntimeModule,
  pagePtr: number,
  pageHeight: number,
  pageId: string,
  rulesOrBarriers?: HorizontalRule[] | TableVectorBarriers,
): DetectedTextBlock[] {
  const barriers = normalizeBarriers(rulesOrBarriers);
  const textPage = mod.FPDFText_LoadPage(pagePtr);
  if (!textPage) return [];

  const rawSegments: CharAccumulator[] = [];
  const boxPtr = mod.pdfium.wasmExports.malloc(32); // 4 doubles
  const originPtr = mod.pdfium.wasmExports.malloc(16); // 2 doubles
  const colorPtr = mod.pdfium.wasmExports.malloc(16); // r, g, b, a u32
  const fontBufBytes = 256;
  const fontBufPtr = mod.pdfium.wasmExports.malloc(fontBufBytes);
  const flagsPtr = mod.pdfium.wasmExports.malloc(4);

  let activeLine: CharAccumulator = { chars: [], mupdfBlockIdx: 0 };
  let blockIdx = 0;

  const commitLine = () => {
    if (activeLine.chars.length > 0) {
      rawSegments.push(
        ...splitLineCharsAtBarriersAndColumns(activeLine.chars, activeLine.mupdfBlockIdx, barriers),
      );
      activeLine = { chars: [], mupdfBlockIdx: blockIdx };
    }
  };

  try {
    const charCount = mod.FPDFText_CountChars(textPage);
    for (let i = 0; i < charCount; i++) {
      const code = mod.FPDFText_GetUnicode(textPage, i);
      if (code === 0 || code === 0xfffe || code === 0xffff) continue;
      const c = String.fromCodePoint(code);
      if (c === '\r' || c === '\n') {
        commitLine();
        blockIdx++;
        activeLine.mupdfBlockIdx = blockIdx;
        continue;
      }

      const okBox = mod.FPDFText_GetCharBox(
        textPage,
        i,
        boxPtr,
        boxPtr + 8,
        boxPtr + 16,
        boxPtr + 24,
      );
      if (!okBox) continue;

      const left = mod.pdfium.getValue(boxPtr, 'double');
      const right = mod.pdfium.getValue(boxPtr + 8, 'double');
      const bottom = mod.pdfium.getValue(boxPtr + 16, 'double');
      const top = mod.pdfium.getValue(boxPtr + 24, 'double');

      const okOrig = mod.FPDFText_GetCharOrigin(textPage, i, originPtr, originPtr + 8);
      const origY = okOrig ? mod.pdfium.getValue(originPtr + 8, 'double') : bottom;

      const x0 = Math.min(left, right);
      const x1 = Math.max(left, right);
      const y0 = Math.max(0, pageHeight - Math.max(top, bottom));
      const y1 = Math.max(y0, pageHeight - Math.min(top, bottom));
      const baselineY = Math.max(0, pageHeight - origY);

      const rawSize = mod.FPDFText_GetFontSize(textPage, i) || 12;
      const size = Math.max(4, rawSize);

      // Font descriptor flags & name
      mod.pdfium.setValue(flagsPtr, 0, 'i32');
      const fontLen = mod.FPDFText_GetFontInfo(textPage, i, fontBufPtr, fontBufBytes, flagsPtr);
      const fontName =
        fontLen > 0 ? mod.pdfium.UTF8ToString(fontBufPtr).replace(/^\//, '').trim() : '';
      const flags = mod.pdfium.getValue(flagsPtr, 'i32');
      const weight = mod.FPDFText_GetFontWeight(textPage, i);

      const flagMono = (flags & 0x01) !== 0;
      const flagSerif = (flags & 0x02) !== 0;
      const flagItalic = (flags & 0x40) !== 0;
      const flagBold = (flags & 0x40000) !== 0 || weight >= 600;

      const parsedFont = parsePdfFontMetadata(fontName, {
        isSerif: flagSerif,
        isMono: flagMono,
        isBold: flagBold,
        isItalic: flagItalic,
      });

      const explicitSans =
        parsedFont.fontFamily === 'Calibri' ||
        parsedFont.fontFamily === 'Inter' ||
        parsedFont.fontFamily === 'DejaVuSans' ||
        parsedFont.fontFamily === 'DejaVuSansCondensed' ||
        parsedFont.fontFamily === 'Verdana' ||
        /sans|arial|helvetica|calibri|carlito|tahoma|verdana|segoe|roboto|opensans|noto.?sans|trebuchet|cantarell|ubuntu|corbel|candara/i.test(
          fontName,
        );
      const mono =
        flagMono ||
        parsedFont.fontFamily === 'Courier' ||
        parsedFont.fontFamily === 'JetBrainsMono' ||
        parsedFont.fontFamily === 'DejaVuSansMono';
      const serif =
        !mono &&
        !explicitSans &&
        (parsedFont.fontFamily === 'TimesRoman' ||
          parsedFont.fontFamily === 'Cambria' ||
          parsedFont.fontFamily === 'Merriweather' ||
          parsedFont.fontFamily === 'Georgia' ||
          parsedFont.fontFamily === 'Garamond' ||
          parsedFont.fontFamily === 'DejaVuSerif' ||
          parsedFont.fontFamily === 'DejaVuSerifCondensed' ||
          flagSerif);
      const resolvedFamily: FontFamilyOption = mono
        ? parsedFont.fontFamily === 'JetBrainsMono' || parsedFont.fontFamily === 'DejaVuSansMono'
          ? parsedFont.fontFamily
          : 'Courier'
        : explicitSans
          ? parsedFont.fontFamily
          : parsedFont.fontFamily === 'Cambria' ||
              parsedFont.fontFamily === 'Merriweather' ||
              parsedFont.fontFamily === 'Georgia' ||
              parsedFont.fontFamily === 'Garamond' ||
              parsedFont.fontFamily === 'DejaVuSerif' ||
              parsedFont.fontFamily === 'DejaVuSerifCondensed'
            ? parsedFont.fontFamily
            : serif
              ? 'TimesRoman'
              : parsedFont.fontFamily;

      let hexColor = '#000000';
      if (
        mod.FPDFText_GetFillColor(
          textPage,
          i,
          colorPtr,
          colorPtr + 4,
          colorPtr + 8,
          colorPtr + 12,
        )
      ) {
        const r = (mod.pdfium.getValue(colorPtr, 'i32') & 0xff) / 255;
        const g = (mod.pdfium.getValue(colorPtr + 4, 'i32') & 0xff) / 255;
        const b = (mod.pdfium.getValue(colorPtr + 8, 'i32') & 0xff) / 255;
        hexColor = rgbFloatsToHex([r, g, b]);
      }

      const prev = activeLine.chars[activeLine.chars.length - 1];
      if (prev) {
        const baselineDelta = Math.abs(baselineY - prev.baselineY);
        const maxFs = Math.max(prev.size, size);
        const horizontalReset = x0 < prev.x0 - maxFs * 1.5;
        if (baselineDelta > maxFs * 0.42 || horizontalReset) {
          commitLine();
          if (baselineDelta > maxFs * 1.1) {
            blockIdx++;
            activeLine.mupdfBlockIdx = blockIdx;
          }
        }
      }

      const safeX1 = c === ' ' && x1 - x0 < 0.2 ? x0 + size * 0.28 : x1;
      activeLine.chars.push({
        c,
        x0,
        y0,
        x1: safeX1,
        y1,
        baselineY,
        size,
        color: hexColor,
        fontName,
        cleanFontName: parsedFont.cleanFontName,
        isCustomFont: parsedFont.isCustomFont,
        horizontalScale: parsedFont.estimatedHorizontalScale,
        fontFamily: resolvedFamily,
        bold: flagBold || parsedFont.bold,
        italic: flagItalic || parsedFont.italic,
        serif,
        mono,
      });
    }
    commitLine();
  } finally {
    mod.pdfium.wasmExports.free(boxPtr);
    mod.pdfium.wasmExports.free(originPtr);
    mod.pdfium.wasmExports.free(colorPtr);
    mod.pdfium.wasmExports.free(fontBufPtr);
    mod.pdfium.wasmExports.free(flagsPtr);
    mod.FPDFText_ClosePage(textPage);
  }

  const withScripts = mergeOrphanScriptSegments(rawSegments);
  const consolidatedSegments = mergeSameBaselineSegments(withScripts, barriers);
  const lines: RawMuLine[] = [];

  for (const seg of consolidatedSegments) {
    let start = 0;
    while (start < seg.chars.length && /^\s$/.test(seg.chars[start].c)) start++;
    let end = seg.chars.length - 1;
    while (end >= start && /^\s$/.test(seg.chars[end].c)) end--;
    if (start > end) continue;

    const visibleSpan = seg.chars.slice(start, end + 1);
    const nonSpace = visibleSpan.filter((ch) => !/^\s$/.test(ch.c));
    if (nonSpace.length === 0) continue;

    const maxCharSize = Math.max(...nonSpace.map((ch) => ch.size));
    const bodyChars = nonSpace.filter(
      (ch) => !ch.forcedScript && ch.size >= maxCharSize * 0.84,
    );
    const baselinePool = bodyChars.length > 0 ? bodyChars : nonSpace;
    const rawBodySize =
      baselinePool.reduce((s, ch) => s + ch.size, 0) / baselinePool.length;
    const bodySize = Number(rawBodySize.toFixed(3));
    const bodyBaselineY =
      baselinePool.reduce((s, ch) => s + ch.baselineY, 0) / baselinePool.length;

    const bodyVisibleBounds = baselinePool;
    const x0 = Math.min(...nonSpace.map((ch) => ch.x0));
    const y0 = Math.min(...bodyVisibleBounds.map((ch) => ch.y0));
    const x1 = Math.max(...nonSpace.map((ch) => ch.x1));
    const y1 = Math.max(...bodyVisibleBounds.map((ch) => ch.y1));

    let firstWordEndX = nonSpace[0].x1;
    for (const ch of visibleSpan) {
      if (/^\s$/.test(ch.c)) break;
      firstWordEndX = Math.max(firstWordEndX, ch.x1);
    }
    const firstWordWidth = Math.max(4, firstWordEndX - x0);

    let maxWordSpace = 0;
    for (let i = 1; i < nonSpace.length; i++) {
      const gap = nonSpace[i].x0 - nonSpace[i - 1].x1;
      if (gap > maxWordSpace) maxWordSpace = gap;
    }

    const colorCounts = new Map<string, number>();
    let boldCount = 0;
    let italicCount = 0;
    let serifCount = 0;
    let monoCount = 0;
    const fontCounts = new Map<string, number>();
    const familyCounts = new Map<FontFamilyOption, number>();

    for (const ch of baselinePool) {
      colorCounts.set(ch.color, (colorCounts.get(ch.color) ?? 0) + 1);
      fontCounts.set(ch.fontName, (fontCounts.get(ch.fontName) ?? 0) + 1);
      familyCounts.set(ch.fontFamily, (familyCounts.get(ch.fontFamily) ?? 0) + 1);
      if (ch.bold) boldCount++;
      if (ch.italic) italicCount++;
      if (ch.serif) serifCount++;
      if (ch.mono) monoCount++;
    }

    let dominantColor = '#000000';
    let bestColorHits = -1;
    for (const [hex, hits] of colorCounts.entries()) {
      if (hits > bestColorHits) {
        bestColorHits = hits;
        dominantColor = hex;
      }
    }

    let dominantRawFont = '';
    let bestFontHits = -1;
    for (const [fn, hits] of fontCounts.entries()) {
      if (hits > bestFontHits) {
        bestFontHits = hits;
        dominantRawFont = fn;
      }
    }

    let dominantFamily: FontFamilyOption = 'Helvetica';
    let bestFamHits = -1;
    for (const [fam, hits] of familyCounts.entries()) {
      if (hits > bestFamHits) {
        bestFamHits = hits;
        dominantFamily = fam;
      }
    }

    const lineBold = boldCount > baselinePool.length / 2;
    const lineItalic = italicCount > baselinePool.length / 2;
    const mono = monoCount > baselinePool.length / 2;
    const serif = !mono && serifCount > baselinePool.length / 2;

    const charRuns: TextRun[] = [];
    for (let i = 0; i < visibleSpan.length; i++) {
      const ch = visibleSpan[i];
      const isSpace = /^\s$/.test(ch.c);
      if (isSpace) {
        const prev = charRuns[charRuns.length - 1];
        if (prev && !prev.text.endsWith(' ')) {
          charRuns.push({ text: ' ', bold: lineBold, italic: lineItalic, script: 'normal' });
        }
        continue;
      }

      let script: TextScriptMode = ch.forcedScript ?? 'normal';
      if (script === 'normal' && ch.size <= bodySize * 0.84) {
        if (ch.baselineY <= bodyBaselineY - bodySize * 0.14) {
          script = 'super';
        } else if (ch.baselineY >= bodyBaselineY + bodySize * 0.08) {
          script = 'sub';
        }
      }

      charRuns.push({
        text: ch.c,
        bold: ch.bold,
        italic: ch.italic,
        script,
      });
    }

    const normalizedLineRuns = normalizeTextRuns(charRuns, lineBold, lineItalic);
    const text = normalizeUnicodeForPdf(runsToPlainText(normalizedLineRuns));
    if (!text.trim()) continue;

    const customFontVotes = baselinePool.filter((ch) => ch.isCustomFont).length;
    const avgHScale =
      baselinePool.reduce((s, ch) => s + (ch.horizontalScale ?? 1), 0) / baselinePool.length;
    const dominantParsedFont = parsePdfFontMetadata(dominantRawFont, {
      isSerif: serif,
      isMono: mono,
      isBold: lineBold,
      isItalic: lineItalic,
    });

    lines.push({
      text,
      runs: normalizedLineRuns,
      x0,
      y0,
      x1,
      y1,
      baselineY: bodyBaselineY,
      fontSize: bodySize,
      firstWordWidth,
      maxWordSpace,
      color: dominantColor,
      fontFamily: dominantFamily,
      rawFontName: dominantRawFont,
      originalFontName: dominantParsedFont.cleanFontName,
      isCustomFont: customFontVotes > baselinePool.length / 2 || dominantParsedFont.isCustomFont,
      horizontalScale: Number(avgHScale.toFixed(3)),
      bold: lineBold,
      italic: lineItalic,
      serif,
      mono,
      mupdfBlockIdx: seg.mupdfBlockIdx,
    });
  }

  return buildDetectedTextBlocksFromMuLines(lines, pageId, barriers);
}

/**
 * Convenience helper for extracting text blocks from raw PDF bytes using PDFium.
 */
export async function extractTextBlocksFromPdfBytes(
  pdfBytes: Uint8Array,
  sourcePageIndex: number,
  pageId: string,
  rulesOrBarriers?: HorizontalRule[] | TableVectorBarriers,
): Promise<DetectedTextBlock[]> {
  const mod = await getSharedPdfium();
  const dataPtr = mod.pdfium.wasmExports.malloc(pdfBytes.byteLength);
  if (!dataPtr) return [];
  mod.pdfium.HEAPU8.set(pdfBytes, dataPtr);
  const docPtr = mod.FPDF_LoadMemDocument(dataPtr, pdfBytes.byteLength, '');
  if (!docPtr) {
    mod.pdfium.wasmExports.free(dataPtr);
    return [];
  }
  try {
    const pagePtr = mod.FPDF_LoadPage(docPtr, sourcePageIndex);
    if (!pagePtr) return [];
    try {
      const pageHeight = mod.FPDF_GetPageHeightF(pagePtr) || 792;
      return extractTextBlocksFromPdfiumPage(mod, pagePtr, pageHeight, pageId, rulesOrBarriers);
    } finally {
      mod.FPDF_ClosePage(pagePtr);
    }
  } finally {
    mod.FPDF_CloseDocument(docPtr);
    mod.pdfium.wasmExports.free(dataPtr);
  }
}
