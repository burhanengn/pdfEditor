import type { TextRun, TextScriptMode } from '@/types/pdf';
import { normalizeUnicodeForPdf } from './fonts';

export interface RunPiece {
  text: string;
  bold: boolean;
  italic: boolean;
  script: TextScriptMode;
  isSpace: boolean;
}

export interface WrappedRichLine {
  pieces: RunPiece[];
  naturalWidth: number;
  spaceCount: number;
  endsParagraph: boolean;
}

export function normalizeTextRuns(
  runs: TextRun[],
  baseBold = false,
  baseItalic = false,
): TextRun[] {
  const result: TextRun[] = [];
  for (const run of runs) {
    const text = normalizeUnicodeForPdf(run.text ?? '');
    if (text.length === 0) continue;
    const bold = run.bold ?? baseBold;
    const italic = run.italic ?? baseItalic;
    const script: TextScriptMode = run.script ?? 'normal';
    const prev = result[result.length - 1];
    if (
      prev &&
      (prev.bold ?? baseBold) === bold &&
      (prev.italic ?? baseItalic) === italic &&
      (prev.script ?? 'normal') === script
    ) {
      prev.text += text;
    } else {
      result.push({ text, bold, italic, script });
    }
  }
  return result;
}

export function runsToPlainText(runs: TextRun[]): string {
  return runs.map((r) => r.text).join('');
}

export function ensureRunsFromElement(
  text: string,
  runs: TextRun[] | undefined,
  baseBold: boolean,
  baseItalic: boolean,
): TextRun[] {
  const normalizedText = normalizeUnicodeForPdf(text);
  if (runs && runs.length > 0) {
    const norm = normalizeTextRuns(runs, baseBold, baseItalic);
    if (runsToPlainText(norm) === normalizedText) {
      return norm;
    }
  }
  return normalizeTextRuns(
    [{ text: normalizedText, bold: baseBold, italic: baseItalic, script: 'normal' }],
    baseBold,
    baseItalic,
  );
}

interface AtomicUnit {
  isSpace: boolean;
  pieces: RunPiece[];
}

function splitParagraphRunsToAtomicUnits(
  paraPieces: Array<{ text: string; bold: boolean; italic: boolean; script: TextScriptMode }>,
): AtomicUnit[] {
  const units: AtomicUnit[] = [];
  let activeWord: RunPiece[] = [];

  const flushWord = () => {
    if (activeWord.length > 0) {
      units.push({ isSpace: false, pieces: activeWord });
      activeWord = [];
    }
  };

  for (const seg of paraPieces) {
    const parts = seg.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        flushWord();
        units.push({
          isSpace: true,
          pieces: [
            {
              text: part,
              bold: seg.bold,
              italic: seg.italic,
              script: seg.script,
              isSpace: true,
            },
          ],
        });
      } else {
        activeWord.push({
          text: part,
          bold: seg.bold,
          italic: seg.italic,
          script: seg.script,
          isSpace: false,
        });
      }
    }
  }
  flushWord();
  return units;
}

/**
 * Splits normalized rich-text runs into explicit paragraphs by '\n' and wraps each paragraph
 * across `maxWidth`, keeping atomic word+superscript/subscript clusters (e.g. "m²", "4¹") unbroken
 * and flagging soft-wrapped lines (`endsParagraph: false`) for clean two-side justification.
 */
export function buildWrappedRichLines(
  runs: TextRun[],
  maxWidth: number,
  measurePiece: (text: string, bold: boolean, italic: boolean, script: TextScriptMode) => number,
  baseBold: boolean,
  baseItalic: boolean,
): WrappedRichLine[] {
  const safeMaxWidth = Math.max(maxWidth, 12);
  const norm = normalizeTextRuns(runs, baseBold, baseItalic);

  // Split runs at explicit '\n' newlines into paragraphs
  const paragraphs: Array<Array<{ text: string; bold: boolean; italic: boolean; script: TextScriptMode }>> = [
    [],
  ];
  for (const run of norm) {
    const clean = run.text.replace(/\r\n/g, '\n');
    const parts = clean.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        paragraphs.push([]);
      }
      if (parts[i].length > 0) {
        paragraphs[paragraphs.length - 1].push({
          text: parts[i],
          bold: run.bold ?? baseBold,
          italic: run.italic ?? baseItalic,
          script: run.script ?? 'normal',
        });
      }
    }
  }

  const output: WrappedRichLine[] = [];

  for (const para of paragraphs) {
    if (para.length === 0) {
      output.push({ pieces: [], naturalWidth: 0, spaceCount: 0, endsParagraph: true });
      continue;
    }

    const units = splitParagraphRunsToAtomicUnits(para);
    let lineUnits: AtomicUnit[] = [];
    let lineWidth = 0;

    const unitWidth = (unit: AtomicUnit) =>
      unit.pieces.reduce((sum, p) => sum + measurePiece(p.text, p.bold, p.italic, p.script), 0);

    const flushLine = (endsParagraph: boolean) => {
      // Drop leading/trailing space units on wrapped lines
      let start = 0;
      while (start < lineUnits.length && lineUnits[start].isSpace) start++;
      let end = lineUnits.length - 1;
      while (end >= start && lineUnits[end].isSpace) end--;

      const trimmed = lineUnits.slice(start, end + 1);
      const pieces: RunPiece[] = [];
      let w = 0;
      let spaceCount = 0;
      for (const u of trimmed) {
        for (const p of u.pieces) {
          pieces.push(p);
          w += measurePiece(p.text, p.bold, p.italic, p.script);
          if (p.isSpace) {
            spaceCount += p.text.length;
          }
        }
      }
      output.push({
        pieces,
        naturalWidth: w,
        spaceCount,
        endsParagraph,
      });
      lineUnits = [];
      lineWidth = 0;
    };

    for (const unit of units) {
      if (lineUnits.length === 0 && unit.isSpace) {
        continue;
      }
      const uw = unitWidth(unit);
      if (lineUnits.length === 0 || lineWidth + uw <= safeMaxWidth + 0.01) {
        lineUnits.push(unit);
        lineWidth += uw;
      } else {
        flushLine(false);
        if (unit.isSpace) continue;

        if (uw > safeMaxWidth) {
          // Break oversized single word character-by-character across its pieces
          let chunkPieces: RunPiece[] = [];
          let chunkWidth = 0;
          for (const piece of unit.pieces) {
            for (const ch of piece.text) {
              const cw = measurePiece(ch, piece.bold, piece.italic, piece.script);
              if (chunkPieces.length > 0 && chunkWidth + cw > safeMaxWidth) {
                output.push({
                  pieces: chunkPieces,
                  naturalWidth: chunkWidth,
                  spaceCount: 0,
                  endsParagraph: false,
                });
                chunkPieces = [
                  {
                    text: ch,
                    bold: piece.bold,
                    italic: piece.italic,
                    script: piece.script,
                    isSpace: false,
                  },
                ];
                chunkWidth = cw;
              } else {
                const last = chunkPieces[chunkPieces.length - 1];
                if (
                  last &&
                  last.bold === piece.bold &&
                  last.italic === piece.italic &&
                  last.script === piece.script
                ) {
                  last.text += ch;
                } else {
                  chunkPieces.push({
                    text: ch,
                    bold: piece.bold,
                    italic: piece.italic,
                    script: piece.script,
                    isSpace: false,
                  });
                }
                chunkWidth += cw;
              }
            }
          }
          if (chunkPieces.length > 0) {
            lineUnits = [{ isSpace: false, pieces: chunkPieces }];
            lineWidth = chunkWidth;
          }
        } else {
          lineUnits = [unit];
          lineWidth = uw;
        }
      }
    }

    flushLine(true);
  }

  return output.length > 0
    ? output
    : [{ pieces: [], naturalWidth: 0, spaceCount: 0, endsParagraph: true }];
}

/**
 * Renders structured TextRun[] directly into a contentEditable container without altering layout metrics.
 */
export function renderRunsIntoContainer(
  container: HTMLElement,
  runs: TextRun[],
  baseBold: boolean,
  baseItalic: boolean,
): void {
  const doc = container.ownerDocument;
  container.textContent = '';

  const norm = normalizeTextRuns(runs, baseBold, baseItalic);
  for (const run of norm) {
    const parts = run.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        container.appendChild(doc.createElement('br'));
      }
      const chunk = parts[i];
      if (!chunk) continue;

      const script = run.script ?? 'normal';
      const bold = run.bold ?? baseBold;
      const italic = run.italic ?? baseItalic;

      let el: HTMLElement;
      if (script === 'super') {
        el = doc.createElement('sup');
        el.style.fontSize = '0.60em';
        el.style.position = 'static';
        el.style.top = '0';
        el.style.bottom = 'auto';
        el.style.verticalAlign = '0.48em';
        el.style.lineHeight = '0';
      } else if (script === 'sub') {
        el = doc.createElement('sub');
        el.style.fontSize = '0.60em';
        el.style.position = 'static';
        el.style.top = 'auto';
        el.style.bottom = '0';
        el.style.verticalAlign = '-0.22em';
        el.style.lineHeight = '0';
      } else {
        el = doc.createElement('span');
      }

      if (bold !== baseBold) {
        el.style.fontWeight = bold ? '700' : '400';
        el.dataset.bold = bold ? '1' : '0';
      }
      if (italic !== baseItalic) {
        el.style.fontStyle = italic ? 'italic' : 'normal';
        el.dataset.italic = italic ? '1' : '0';
      }
      el.textContent = chunk;
      container.appendChild(el);
    }
  }
}

/**
 * Parses live DOM nodes from a contentEditable editor back into clean normalized TextRun[] and plain text.
 */
export function parseContainerRuns(
  container: HTMLElement,
  baseBold: boolean,
  baseItalic: boolean,
): { text: string; runs: TextRun[] } {
  const rawRuns: TextRun[] = [];
  const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'LI', 'BLOCKQUOTE']);

  const appendText = (
    str: string,
    bold: boolean,
    italic: boolean,
    script: TextScriptMode,
  ) => {
    if (!str) return;
    rawRuns.push({ text: str, bold, italic, script });
  };

  const walk = (node: Node, bold: boolean, italic: boolean, script: TextScriptMode) => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const value = (node.textContent ?? '').replace(/\u00a0/g, ' ');
      appendText(value, bold, italic, script);
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;

    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();

    if (tag === 'BR') {
      // Skip browser-inserted sentinel <br> when it is the final trailing child inside a block/root
      const isLast = !el.nextSibling;
      const parentIsRootOrBlock =
        el.parentElement === container || (el.parentElement && BLOCK_TAGS.has(el.parentElement.tagName));
      if (isLast && parentIsRootOrBlock && rawRuns.length > 0 && rawRuns[rawRuns.length - 1].text.endsWith('\n')) {
        return;
      }
      if (isLast && el.parentElement === container && rawRuns.length === 0) {
        return;
      }
      appendText('\n', baseBold, baseItalic, 'normal');
      return;
    }

    let nextBold = bold;
    let nextItalic = italic;
    let nextScript = script;

    if (tag === 'SUP' || el.style.verticalAlign === 'super') {
      nextScript = 'super';
    } else if (tag === 'SUB' || el.style.verticalAlign === 'sub') {
      nextScript = 'sub';
    }

    if (el.dataset.bold === '1' || tag === 'B' || tag === 'STRONG') {
      nextBold = true;
    } else if (el.dataset.bold === '0' || el.style.fontWeight === '400' || el.style.fontWeight === 'normal') {
      nextBold = false;
    } else if (el.style.fontWeight === '700' || el.style.fontWeight === 'bold') {
      nextBold = true;
    }

    if (el.dataset.italic === '1' || tag === 'I' || tag === 'EM') {
      nextItalic = true;
    } else if (el.dataset.italic === '0' || el.style.fontStyle === 'normal') {
      nextItalic = false;
    } else if (el.style.fontStyle === 'italic' || el.style.fontStyle === 'oblique') {
      nextItalic = true;
    }

    const isBlock = el !== container && BLOCK_TAGS.has(tag);
    if (isBlock && rawRuns.length > 0) {
      const last = rawRuns[rawRuns.length - 1].text;
      if (!last.endsWith('\n')) {
        appendText('\n', baseBold, baseItalic, 'normal');
      }
    }

    for (const child of Array.from(el.childNodes)) {
      walk(child, nextBold, nextItalic, nextScript);
    }
  };

  walk(container, baseBold, baseItalic, 'normal');
  const runs = normalizeTextRuns(rawRuns, baseBold, baseItalic);
  return {
    text: runsToPlainText(runs),
    runs,
  };
}

/**
 * Computes character offset [start, end] within plain parsed text for the current Selection inside container.
 */
export function getSelectionCharOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = container.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const measureOffset = (targetNode: Node, targetOffset: number): number => {
    const pre = container.ownerDocument.createRange();
    pre.selectNodeContents(container);
    pre.setEnd(targetNode, targetOffset);
    const frag = pre.cloneContents();
    const temp = container.ownerDocument.createElement('div');
    temp.appendChild(frag);
    return parseContainerRuns(temp, false, false).text.length;
  };

  const start = measureOffset(range.startContainer, range.startOffset);
  const end = measureOffset(range.endContainer, range.endOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}

/**
 * Restores character selection [start, end] inside a rendered contentEditable container.
 */
export function restoreSelectionCharOffsets(
  container: HTMLElement,
  start: number,
  end: number,
): void {
  const doc = container.ownerDocument;
  const sel = doc.getSelection();
  if (!sel) return;

  const resolvePos = (targetOffset: number): { node: Node; offset: number } | null => {
    let remaining = Math.max(0, targetOffset);
    const walker = doc.createTreeWalker(container, 4 /* NodeFilter.SHOW_TEXT */ | 1 /* SHOW_ELEMENT */);
    let cur: Node | null = walker.currentNode;
    let lastText: Node | null = null;

    while ((cur = walker.nextNode())) {
      if (cur.nodeType === 3) {
        const len = (cur.textContent ?? '').length;
        lastText = cur;
        if (remaining <= len) {
          return { node: cur, offset: remaining };
        }
        remaining -= len;
      } else if (cur.nodeType === 1 && (cur as HTMLElement).tagName === 'BR') {
        if (remaining <= 1) {
          const parent = cur.parentNode ?? container;
          const idx = Array.from(parent.childNodes).indexOf(cur as ChildNode);
          return { node: parent, offset: idx + remaining };
        }
        remaining -= 1;
      }
    }

    if (lastText) {
      return { node: lastText, offset: (lastText.textContent ?? '').length };
    }
    return { node: container, offset: container.childNodes.length };
  };

  const s = resolvePos(start);
  const e = resolvePos(end);
  if (!s || !e) return;
  const range = doc.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Toggles script ('super' | 'sub') or bold/italic across a character range [start, end] of TextRun[].
 */
export function applyStyleToRunRange(
  runs: TextRun[],
  start: number,
  end: number,
  patch: { script?: 'super' | 'sub' | 'normal'; toggleBold?: boolean; toggleItalic?: boolean },
  baseBold: boolean,
  baseItalic: boolean,
): TextRun[] {
  if (end <= start) return normalizeTextRuns(runs, baseBold, baseItalic);

  const norm = normalizeTextRuns(runs, baseBold, baseItalic);
  const next: TextRun[] = [];
  let cursor = 0;

  // Determine active state across selection to support toggling cleanly
  let allSameScript = true;
  let allBold = true;
  let allItalic = true;
  for (const r of norm) {
    const rEnd = cursor + r.text.length;
    if (rEnd > start && cursor < end) {
      if (patch.script && (r.script ?? 'normal') !== patch.script) allSameScript = false;
      if (!(r.bold ?? baseBold)) allBold = false;
      if (!(r.italic ?? baseItalic)) allItalic = false;
    }
    cursor = rEnd;
  }

  cursor = 0;
  for (const r of norm) {
    const rStart = cursor;
    const rEnd = cursor + r.text.length;
    cursor = rEnd;

    if (rEnd <= start || rStart >= end) {
      next.push(r);
      continue;
    }

    const sliceStart = Math.max(0, start - rStart);
    const sliceEnd = Math.min(r.text.length, end - rStart);

    if (sliceStart > 0) {
      next.push({ ...r, text: r.text.slice(0, sliceStart) });
    }

    const mid: TextRun = {
      text: r.text.slice(sliceStart, sliceEnd),
      bold: patch.toggleBold ? !allBold : (r.bold ?? baseBold),
      italic: patch.toggleItalic ? !allItalic : (r.italic ?? baseItalic),
      script: patch.script ? (allSameScript ? 'normal' : patch.script) : (r.script ?? 'normal'),
    };
    next.push(mid);

    if (sliceEnd < r.text.length) {
      next.push({ ...r, text: r.text.slice(sliceEnd) });
    }
  }

  return normalizeTextRuns(next, baseBold, baseItalic);
}
