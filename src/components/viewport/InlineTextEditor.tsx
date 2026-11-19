import { useEffect, useRef } from 'react';
import type { TextAddElement, TextEditElement } from '@/types/elements';
import type { RotationAngle, TextRun } from '@/types/pdf';
import { rectBaseToDisplayFrame } from '@/engine/coordinates';
import { calibrateDomTextMetrics, resolveFontDisplayStatus } from '@/engine/fonts';
import {
  applyStyleToRunRange,
  ensureRunsFromElement,
  getSelectionCharOffsets,
  parseContainerRuns,
  renderRunsIntoContainer,
  restoreSelectionCharOffsets,
} from '@/engine/richText';
import { useEditorStore } from '@/store/useEditorStore';

export const RICH_FORMAT_EVENT = 'aether-inline-rich-format';

export interface RichFormatDetail {
  elementId: string;
  script?: 'super' | 'sub' | 'normal';
  toggleBold?: boolean;
  toggleItalic?: boolean;
}

export function dispatchInlineRichFormat(detail: RichFormatDetail): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent<RichFormatDetail>(RICH_FORMAT_EVENT, { detail }));
}

function computeRunsSignature(runs: TextRun[], bold: boolean, italic: boolean): string {
  return `${bold ? 1 : 0}:${italic ? 1 : 0}:${runs
    .map((r) => `${r.bold ? 1 : 0}${r.italic ? 1 : 0}${r.script ?? 'n'}:${r.text}`)
    .join('\u0001')}`;
}

interface InlineTextEditorProps {
  element: TextEditElement | TextAddElement;
  baseWidth: number;
  baseHeight: number;
  userRotation: RotationAngle;
  zoom: number;
  isBaseStripped?: boolean;
  onFinish: () => void;
}

export function InlineTextEditor({
  element,
  baseWidth,
  baseHeight,
  userRotation,
  zoom,
  isBaseStripped = false,
  onFinish,
}: InlineTextEditorProps) {
  const updateElements = useEditorStore((s) => s.updateElements);
  const beginTransaction = useEditorStore((s) => s.beginTransaction);
  const commitTransaction = useEditorStore((s) => s.commitTransaction);
  const abortTransaction = useEditorStore((s) => s.abortTransaction);
  const userFonts = useEditorStore((s) => s.userFonts);
  const extractedFonts = useEditorStore((s) => s.extractedFonts);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);
  const readyForBlurRef = useRef(false);
  const lastSignatureRef = useRef<string>('');
  const elementRef = useRef(element);
  elementRef.current = element;
  // Snapshot of the text/runs when the editing session started. `onInput` keeps the store in
  // sync on every keystroke, so "did anything change?" must compare against this snapshot,
  // not against the (already updated) live element.
  const initialSnapshotRef = useRef<{ text: string; runsSig: string } | null>(null);
  if (initialSnapshotRef.current === null) {
    initialSnapshotRef.current = {
      text: element.text,
      runsSig: computeRunsSignature(
        ensureRunsFromElement(element.text, element.runs, element.bold, element.italic),
        element.bold,
        element.italic,
      ),
    };
  }

  const frame = rectBaseToDisplayFrame(
    { x: element.x, y: element.y, width: element.width, height: element.height },
    element.rotation,
    baseWidth,
    baseHeight,
    userRotation,
    zoom,
  );

  const originalFontName =
    'originalFontName' in element && element.originalFontName
      ? element.originalFontName
      : 'rawFontName' in element && element.rawFontName
        ? element.rawFontName.replace(/^[A-Z]{6}\+/, '')
        : '';

  const fontStatus = resolveFontDisplayStatus({
    fontFamily: element.fontFamily,
    fallbackFontFamily: element.fallbackFontFamily,
    originalFontName,
    isCustomFont: 'isCustomFont' in element ? element.isCustomFont : false,
    text: element.text,
    userFonts,
    extractedFonts,
  });

  const measureAndSync = (parsedText: string, parsedRuns: TextRun[]) => {
    const ed = editorRef.current;
    const el = elementRef.current;
    let nextHeight = el.height;
    let renderedLineCount = Math.max(1, parsedText.split('\n').length);
    if (ed) {
      const prevHeight = ed.style.height;
      const prevMinH = ed.style.minHeight;
      ed.style.minHeight = '0px';
      ed.style.height = 'auto';
      const rawScrollHeightPx = ed.scrollHeight;
      const scrollH = Math.ceil(rawScrollHeightPx / zoom + 1);
      ed.style.height = prevHeight;
      ed.style.minHeight = prevMinH;
      const minSingleLineH = Math.ceil(el.fontSize * el.lineHeight + 2);
      nextHeight = Math.max(minSingleLineH, scrollH);
      const lineStepPx = Math.max(1, el.fontSize * zoom * el.lineHeight);
      const contentHeightPx = Math.max(lineStepPx, rawScrollHeightPx);
      renderedLineCount = Math.max(1, Math.round(contentHeightPx / lineStepPx));
    }

    lastSignatureRef.current = computeRunsSignature(parsedRuns, el.bold, el.italic);
    updateElements(
      [
        {
          id: el.id,
          patch: {
            text: parsedText,
            runs: parsedRuns,
            height: nextHeight,
            renderedLineCount,
          },
        },
      ],
      false,
    );
  };

  // Sync initial DOM runs on mount and whenever external inspector/undo edits happen
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const runs = ensureRunsFromElement(element.text, element.runs, element.bold, element.italic);
    const sig = computeRunsSignature(runs, element.bold, element.italic);
    if (sig !== lastSignatureRef.current) {
      const selOffsets = getSelectionCharOffsets(ed);
      renderRunsIntoContainer(ed, runs, element.bold, element.italic);
      lastSignatureRef.current = sig;
      if (selOffsets && document.activeElement === ed) {
        restoreSelectionCharOffsets(ed, selOffsets.start, selOffsets.end);
      }
    }
  }, [element.text, element.runs, element.bold, element.italic]);

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      beginTransaction();
    }
    const ed = editorRef.current;
    if (ed) {
      ed.focus();
      const plainLen = elementRef.current.text.length;
      restoreSelectionCharOffsets(ed, plainLen, plainLen);
    }
    const raf = requestAnimationFrame(() => {
      readyForBlurRef.current = true;
      editorRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [beginTransaction]);

  // Mobile virtual keyboard avoidance via visualViewport resize/scroll
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;

    const ensureVisibleAboveKeyboard = () => {
      const ed = editorRef.current;
      if (!ed) return;
      const rect = ed.getBoundingClientRect();
      const visibleBottom = vv.offsetTop + vv.height - 20;
      const visibleTop = vv.offsetTop + 60;
      const scrollHost = ed.closest('[data-testid="document-viewport"]') as HTMLElement | null;

      if (rect.bottom > visibleBottom) {
        const delta = rect.bottom - visibleBottom;
        if (scrollHost) {
          scrollHost.scrollBy({ top: delta, behavior: 'smooth' });
        } else {
          ed.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      } else if (rect.top < visibleTop) {
        const delta = rect.top - visibleTop;
        if (scrollHost) {
          scrollHost.scrollBy({ top: delta, behavior: 'smooth' });
        }
      }
    };

    ensureVisibleAboveKeyboard();
    vv.addEventListener('resize', ensureVisibleAboveKeyboard);
    vv.addEventListener('scroll', ensureVisibleAboveKeyboard);
    return () => {
      vv.removeEventListener('resize', ensureVisibleAboveKeyboard);
      vv.removeEventListener('scroll', ensureVisibleAboveKeyboard);
    };
  }, []);

  // Listen to Rich Format events (Superscript / Subscript / Inline Bold / Inline Italic) from Inspector
  useEffect(() => {
    const onRichFormat = (evt: Event) => {
      const detail = (evt as CustomEvent<RichFormatDetail>).detail;
      const el = elementRef.current;
      const ed = editorRef.current;
      if (!detail || detail.elementId !== el.id || !ed) return;

      const offsets = getSelectionCharOffsets(ed);
      if (!offsets || offsets.end <= offsets.start) return;

      const parsed = parseContainerRuns(ed, el.bold, el.italic);
      const nextRuns = applyStyleToRunRange(
        parsed.runs,
        offsets.start,
        offsets.end,
        {
          script: detail.script,
          toggleBold: detail.toggleBold,
          toggleItalic: detail.toggleItalic,
        },
        el.bold,
        el.italic,
      );
      renderRunsIntoContainer(ed, nextRuns, el.bold, el.italic);
      ed.focus();
      restoreSelectionCharOffsets(ed, offsets.start, offsets.end);
      measureAndSync(parsed.text, nextRuns);
    };

    document.addEventListener(RICH_FORMAT_EVENT, onRichFormat);
    return () => document.removeEventListener(RICH_FORMAT_EVENT, onRichFormat);
  });

  const finishEditing = () => {
    const ed = editorRef.current;
    const el = elementRef.current;
    if (useEditorStore.getState().editingTextElementId !== el.id) {
      onFinish();
      return;
    }
    let changed = false;
    if (ed) {
      const prevHeight = ed.style.height;
      const prevMinH = ed.style.minHeight;
      ed.style.minHeight = '0px';
      ed.style.height = 'auto';
      const lineStepPx = Math.max(1, el.fontSize * zoom * el.lineHeight);
      const contentHeightPx = Math.max(lineStepPx, ed.scrollHeight);
      ed.style.height = prevHeight;
      ed.style.minHeight = prevMinH;
      const renderedLineCount = Math.max(1, Math.round(contentHeightPx / lineStepPx));
      const parsed = parseContainerRuns(ed, el.bold, el.italic);
      const parsedSig = computeRunsSignature(parsed.runs, el.bold, el.italic);
      const snapshot = initialSnapshotRef.current;
      changed =
        !snapshot || parsed.text !== snapshot.text || parsedSig !== snapshot.runsSig;
      const liveSig = computeRunsSignature(
        ensureRunsFromElement(el.text, el.runs, el.bold, el.italic),
        el.bold,
        el.italic,
      );
      const needsSync =
        parsed.text !== el.text ||
        parsedSig !== liveSig ||
        el.renderedLineCount !== renderedLineCount;
      if (changed && needsSync) {
        updateElements(
          [{ id: el.id, patch: { text: parsed.text, runs: parsed.runs, renderedLineCount } }],
          false,
        );
      }
    }
    // Style edits made from the inspector during the session (font, size, color…) also count.
    if (!changed) {
      const state = useEditorStore.getState();
      const before = state.transactionBaseline?.elements.find((x) => x.id === el.id);
      const now = state.elements.find((x) => x.id === el.id);
      if (before && now && JSON.stringify(before) !== JSON.stringify(now)) {
        changed = true;
      }
    }
    if (changed) {
      commitTransaction();
    } else {
      abortTransaction();
    }
    onFinish();
  };

  const editorBg =
    element.kind === 'text-edit'
      ? isBaseStripped
        ? 'rgba(37, 99, 235, 0.05)'
        : (element.maskColor ?? '#ffffff')
      : element.backgroundColor || 'rgba(255, 255, 255, 0.94)';

  const hScale =
    element.horizontalScale && Math.abs(element.horizontalScale - 1) > 0.005
      ? element.horizontalScale
      : 1;
  const hasHScale = Math.abs(hScale - 1) > 0.005;
  const letterSpacingPx =
    element.letterSpacing && element.letterSpacing !== 0
      ? `${(element.letterSpacing * zoom).toFixed(3)}px`
      : undefined;
  const calibration = calibrateDomTextMetrics({
    sampleText: element.text,
    targetPdfWidthPt: 0,
    fontSizePt: element.fontSize,
    lineHeight: element.lineHeight,
    baselineOffsetPt: element.baselineOffset,
    fontFamily: element.fontFamily,
    cssFontFamily: fontStatus.cssFamily,
    fontWeight: element.bold ? 700 : 400,
    fontStyle: element.italic ? 'italic' : 'normal',
    initialHorizontalScale: hScale,
  });
  const topOffsetPx = calibration.topOffsetPt * zoom;

  const bannerText =
    fontStatus.status === 'embedded-complete'
      ? `Extracted embedded PDF font (${fontStatus.label}) active`
      : fontStatus.status === 'user-complete'
        ? `Custom font (${fontStatus.label}) active`
        : fontStatus.status === 'embedded-partial' || fontStatus.status === 'user-partial'
          ? `${fontStatus.label} is a subset — missing [${fontStatus.missingChars.slice(0, 5).join(' ')}] using fallback [${fontStatus.fallbackLabel}]`
          : fontStatus.status === 'fallback'
            ? `Embedded custom font${originalFontName ? ` (${originalFontName})` : ''} has restricted encoding — using [${fontStatus.fallbackLabel}]`
            : null;
  const isWarningBanner =
    fontStatus.status === 'fallback' ||
    fontStatus.status === 'embedded-partial' ||
    fontStatus.status === 'user-partial';

  return (
    <div
      style={{
        position: 'absolute',
        left: `${frame.left}px`,
        top: `${frame.top}px`,
        width: `${Math.max(16, frame.width)}px`,
        minHeight: `${Math.max(20, frame.height)}px`,
        transform: `rotate(${frame.rotation}deg)`,
        transformOrigin: 'center center',
        zIndex: 550,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {bannerText && (
        <div
          data-testid={isWarningBanner ? 'custom-font-warning-banner' : 'custom-font-active-banner'}
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            marginBottom: '6px',
            maxWidth: '460px',
            pointerEvents: 'none',
            zIndex: 560,
          }}
          className={
            isWarningBanner
              ? 'flex items-center gap-1.5 rounded-md border border-amber-400/50 bg-amber-950/95 px-2.5 py-1 text-xs font-medium text-amber-100 shadow-lg backdrop-blur whitespace-nowrap'
              : 'flex items-center gap-1.5 rounded-md border border-emerald-400/50 bg-emerald-950/95 px-2.5 py-1 text-xs font-medium text-emerald-100 shadow-lg backdrop-blur whitespace-nowrap'
          }
        >
          <span
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
              isWarningBanner ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
          />
          <span>{bannerText}</span>
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-testid="inline-text-editor"
        onInput={() => {
          const ed = editorRef.current;
          if (!ed) return;
          const el = elementRef.current;
          const parsed = parseContainerRuns(ed, el.bold, el.italic);
          measureAndSync(parsed.text, parsed.runs);
        }}
        onPaste={(e) => {
          e.preventDefault();
          const plain = e.clipboardData.getData('text/plain');
          if (!plain) return;
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const textNode = document.createTextNode(plain);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          const ed = editorRef.current;
          if (ed) {
            const el = elementRef.current;
            const parsed = parseContainerRuns(ed, el.bold, el.italic);
            measureAndSync(parsed.text, parsed.runs);
          }
        }}
        onBlur={(e) => {
          // Keep editing active when clicking formatting buttons that preserve focus via preventDefault
          const nextFocused = e.relatedTarget as HTMLElement | null;
          if (nextFocused?.dataset?.keepInlineEditor === 'true') return;
          if (readyForBlurRef.current) {
            finishEditing();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            finishEditing();
          }
          e.stopPropagation();
        }}
        spellCheck={false}
        style={{
          position: 'relative',
          top: `${topOffsetPx}px`,
          boxSizing: 'border-box',
          width: hasHScale ? `${100 / hScale}%` : '100%',
          transform: hasHScale ? `scaleX(${hScale})` : undefined,
          transformOrigin: 'left top',
          minHeight: `${Math.max(20, frame.height)}px`,
          fontFamily: fontStatus.cssFamily,
          fontSize: `${element.fontSize * zoom}px`,
          fontWeight: element.bold ? 700 : 400,
          fontStyle: element.italic ? 'italic' : 'normal',
          letterSpacing: letterSpacingPx,
          color: element.color,
          lineHeight: element.lineHeight,
          textAlign: element.align,
          fontKerning: 'normal',
          backgroundColor: editorBg,
          opacity: element.opacity,
          padding: 0,
          border: 0,
          margin: 0,
          outline: '1.5px solid #2563eb',
          outlineOffset: '1px',
          borderRadius: '2px',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          wordBreak: 'normal',
          cursor: 'text',
        }}
      />
    </div>
  );
}
