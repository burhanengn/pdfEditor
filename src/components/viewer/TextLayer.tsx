import { useEffect, useRef, useState } from 'react';
import { Copy, Highlighter, StickyNote, Underline } from 'lucide-react';
import type { PageMeta } from '@/types/pdf';
import type { HighlightElement, TextAddElement } from '@/types/elements';
import { axisAlignedRectBaseToDisplay } from '@/engine/coordinates';
import { pdfiumScheduler } from '@/engine/pdfium/renderScheduler';
import type { PdfTextSpan } from '@/engine/pdfium/pdfiumTypes';
import { useI18n } from '@/i18n/useI18n';
import { useEditorStore } from '@/store/useEditorStore';
import { useViewerStore } from '@/store/useViewerStore';
import { createId } from '@/utils/id';

const spanCache = new Map<string, PdfTextSpan[]>();
const MAX_CACHED_SPAN_PAGES = 16;

function getCachedSpans(key: string): PdfTextSpan[] | undefined {
  const hit = spanCache.get(key);
  if (!hit) return undefined;
  spanCache.delete(key);
  spanCache.set(key, hit);
  return hit;
}

function setCachedSpans(key: string, spans: PdfTextSpan[]): void {
  spanCache.set(key, spans);
  while (spanCache.size > MAX_CACHED_SPAN_PAGES) {
    const oldest = spanCache.keys().next().value;
    if (!oldest) break;
    spanCache.delete(oldest);
  }
}

interface TextLayerProps {
  page: PageMeta;
  zoom: number;
}

export function TextLayer({ page, zoom }: TextLayerProps) {
  const { t } = useI18n();
  const appMode = useEditorStore((s) => s.appMode);
  const addElement = useEditorStore((s) => s.addElement);
  const docCanCopyText = useViewerStore((s) => s.docCanCopyText);
  const docRevision = useViewerStore((s) => s.docRevision);
  const [spans, setSpans] = useState<PdfTextSpan[]>([]);
  const [selectedSpan, setSelectedSpan] = useState<{
    span: PdfTextSpan;
    text: string;
    menuX: number;
    menuY: number;
  } | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);
  const [touchLoupe, setTouchLoupe] = useState<{
    x: number;
    y: number;
    preview: string;
    startHandle: { x: number; y: number };
    endHandle: { x: number; y: number };
  } | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const touchDownRef = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(
    null,
  );
  const draggingHandleRef = useRef<'start' | 'end' | null>(null);

  const cacheKey = `${docRevision}:${page.sourceDocId}:${page.sourcePageIndex}`;

  useEffect(() => {
    const cached = getCachedSpans(cacheKey);
    if (cached) {
      setSpans(cached);
      return;
    }
    let cancelled = false;
    pdfiumScheduler
      .extractTextSpans(page.sourceDocId, page.sourcePageIndex)
      .then((res) => {
        if (cancelled) return;
        setCachedSpans(cacheKey, res);
        setSpans(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cacheKey, page.sourceDocId, page.sourcePageIndex]);

  // Clear selection popover when switching out of Viewer mode
  useEffect(() => {
    if (appMode !== 'view') {
      setSelectedSpan(null);
      setTouchLoupe(null);
    }
  }, [appMode]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  if (appMode !== 'view') return null;

  const findSpanAtPoint = (clientX: number, clientY: number): { span: PdfTextSpan; disp: { x: number; y: number; width: number; height: number } } | null => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect || spans.length === 0) return null;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: { span: PdfTextSpan; disp: { x: number; y: number; width: number; height: number }; dist: number } | null = null;
    for (const s of spans) {
      const disp = axisAlignedRectBaseToDisplay(
        { x: s.x, y: s.y, width: s.width, height: s.height },
        page.baseWidth,
        page.baseHeight,
        page.userRotation,
        zoom,
      );
      const cx = disp.x + disp.width / 2;
      const cy = disp.y + disp.height / 2;
      const inside =
        px >= disp.x - 10 &&
        px <= disp.x + disp.width + 10 &&
        py >= disp.y - 10 &&
        py <= disp.y + disp.height + 10;
      const dist = inside ? 0 : Math.hypot(px - cx, py - cy);
      if (dist <= 36 && (!best || dist < best.dist)) {
        best = { span: s, disp, dist };
      }
    }
    return best ? { span: best.span, disp: best.disp } : null;
  };

  const selectSpanWithHandles = (span: PdfTextSpan, disp: { x: number; y: number; width: number; height: number }, showLoupe = false) => {
    setSelectedSpan({
      span,
      text: span.text,
      menuX: disp.x + disp.width / 2,
      menuY: Math.max(8, disp.y - 52),
    });
    setTouchLoupe(
      showLoupe
        ? {
            x: disp.x + disp.width / 2,
            y: Math.max(4, disp.y - 94),
            preview: span.text,
            startHandle: { x: disp.x, y: disp.y + disp.height },
            endHandle: { x: disp.x + disp.width, y: disp.y + disp.height },
          }
        : {
            x: -9999,
            y: -9999,
            preview: '',
            startHandle: { x: disp.x, y: disp.y + disp.height },
            endHandle: { x: disp.x + disp.width, y: disp.y + disp.height },
          },
    );
  };

  const handleCopy = async () => {
    if (!selectedSpan || !docCanCopyText) return;
    const selText = window.getSelection()?.toString().trim() || selectedSpan.text;
    try {
      await navigator.clipboard.writeText(selText);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 1200);
    } catch {
      // Clipboard denied fallback
    }
    setSelectedSpan(null);
  };

  const applyHighlightOrUnderline = (kind: 'highlight' | 'underline') => {
    if (!selectedSpan) return;
    const { span } = selectedSpan;
    const el: HighlightElement = {
      id: createId('hl'),
      pageId: page.id,
      kind: 'highlight',
      x: span.x,
      y: kind === 'underline' ? span.y + span.height - 2 : span.y,
      width: Math.max(8, span.width),
      height: kind === 'underline' ? 2.5 : Math.max(6, span.height),
      rotation: 0,
      opacity: kind === 'underline' ? 0.9 : 0.38,
      zIndex: 4,
      fillColor: kind === 'underline' ? '#2563eb' : '#facc15',
      shape: 'highlight',
    };
    addElement(el, false);
    setSelectedSpan(null);
  };

  const handleAddNote = () => {
    if (!selectedSpan) return;
    const { span } = selectedSpan;
    const note: TextAddElement = {
      id: createId('note'),
      pageId: page.id,
      kind: 'text-add',
      x: Math.min(page.baseWidth - 150, span.x),
      y: Math.max(8, span.y - 26),
      width: 150,
      height: 24,
      rotation: 0,
      opacity: 1,
      zIndex: 5,
      text: `Note: ${selectedSpan.text.slice(0, 40)}`,
      fontFamily: 'Helvetica',
      fontSize: 10,
      color: '#1e293b',
      backgroundColor: '#fef08a',
      bold: false,
      italic: false,
      align: 'left',
      lineHeight: 1.2,
    };
    addElement(note, false);
    setSelectedSpan(null);
  };

  return (
    <div
      ref={layerRef}
      data-testid={`viewer-text-layer-${page.id}`}
      className={`absolute inset-0 z-20 ${docCanCopyText ? 'select-text' : 'select-none'}`}
      aria-label="PDF text content"
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch') return;
        touchDownRef.current = {
          x: e.clientX,
          y: e.clientY,
          clientX: e.clientX,
          clientY: e.clientY,
        };
        if (longPressTimerRef.current !== null) {
          window.clearTimeout(longPressTimerRef.current);
        }
        const hit = findSpanAtPoint(e.clientX, e.clientY);
        if (!hit) return;
        longPressTimerRef.current = window.setTimeout(() => {
          selectSpanWithHandles(hit.span, hit.disp, true);
          longPressTimerRef.current = null;
        }, 350);
      }}
      onPointerMove={(e) => {
        if (draggingHandleRef.current && selectedSpan) {
          const hit = findSpanAtPoint(e.clientX, e.clientY);
          if (hit) {
            const startIdx = spans.findIndex((s) => s.id === selectedSpan.span.id);
            const endIdx = spans.findIndex((s) => s.id === hit.span.id);
            if (startIdx >= 0 && endIdx >= 0) {
              const lo = Math.min(startIdx, endIdx);
              const hi = Math.max(startIdx, endIdx);
              const combined = spans.slice(lo, hi + 1);
              const joinedText = combined.map((s) => s.text).join(' ').trim();
              const firstDisp = axisAlignedRectBaseToDisplay(
                { x: combined[0].x, y: combined[0].y, width: combined[0].width, height: combined[0].height },
                page.baseWidth,
                page.baseHeight,
                page.userRotation,
                zoom,
              );
              const last = combined[combined.length - 1];
              const lastDisp = axisAlignedRectBaseToDisplay(
                { x: last.x, y: last.y, width: last.width, height: last.height },
                page.baseWidth,
                page.baseHeight,
                page.userRotation,
                zoom,
              );
              setSelectedSpan({
                span: {
                  ...combined[0],
                  width: Math.max(combined[0].width, last.x + last.width - combined[0].x),
                  height: Math.max(combined[0].height, last.y + last.height - combined[0].y),
                  text: joinedText,
                },
                text: joinedText,
                menuX: (firstDisp.x + lastDisp.x + lastDisp.width) / 2,
                menuY: Math.max(8, firstDisp.y - 52),
              });
              setTouchLoupe({
                x: hit.disp.x + hit.disp.width / 2,
                y: Math.max(4, hit.disp.y - 94),
                preview: hit.span.text,
                startHandle: { x: firstDisp.x, y: firstDisp.y + firstDisp.height },
                endHandle: { x: lastDisp.x + lastDisp.width, y: lastDisp.y + lastDisp.height },
              });
            }
          }
          return;
        }
        if (touchDownRef.current && longPressTimerRef.current !== null) {
          if (Math.hypot(e.clientX - touchDownRef.current.x, e.clientY - touchDownRef.current.y) > 8) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        }
      }}
      onPointerUp={() => {
        if (longPressTimerRef.current !== null) {
          window.clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        touchDownRef.current = null;
        if (draggingHandleRef.current) {
          draggingHandleRef.current = null;
          setTouchLoupe((prev) => (prev ? { ...prev, preview: '' } : null));
        }
      }}
      onPointerCancel={() => {
        if (longPressTimerRef.current !== null) {
          window.clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        draggingHandleRef.current = null;
      }}
      onMouseUp={() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? '';
        if (text && sel && sel.rangeCount > 0) {
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          const parentRect = (
            document.querySelector(`[data-testid="viewer-text-layer-${page.id}"]`) as HTMLElement | null
          )?.getBoundingClientRect();
          if (parentRect && rect.width > 0) {
            // Find closest span for lightweight K4 highlight/note geometry
            const relX = (rect.left - parentRect.left) / zoom;
            const relY = (rect.top - parentRect.top) / zoom;
            const closest =
              spans.find(
                (s) =>
                  relX >= s.x - 10 &&
                  relX <= s.x + s.width + 10 &&
                  relY >= s.y - 10 &&
                  relY <= s.y + s.height + 10,
              ) ?? {
                id: 'sel',
                text,
                x: relX,
                y: relY,
                width: rect.width / zoom,
                height: rect.height / zoom,
                fontSize: 12,
                baselineY: relY + rect.height / zoom,
              };
            setSelectedSpan({
              span: closest,
              text,
              menuX: rect.left - parentRect.left + rect.width / 2,
              menuY: Math.max(8, rect.top - parentRect.top - 48),
            });
          }
        }
      }}
    >
      {spans.map((span) => {
        const disp = axisAlignedRectBaseToDisplay(
          { x: span.x, y: span.y, width: span.width, height: span.height },
          page.baseWidth,
          page.baseHeight,
          page.userRotation,
          zoom,
        );
        return (
          <span
            key={span.id}
            style={{
              position: 'absolute',
              left: `${disp.x}px`,
              top: `${disp.y}px`,
              width: `${Math.max(4, disp.width)}px`,
              height: `${Math.max(6, disp.height)}px`,
              fontSize: `${Math.max(6, span.fontSize * zoom)}px`,
              lineHeight: 1,
              color: 'transparent',
              whiteSpace: 'pre',
              overflow: 'hidden',
            }}
            onContextMenu={(e) => {
              if (!docCanCopyText) return;
              e.preventDefault();
              setSelectedSpan({
                span,
                text: span.text,
                menuX: disp.x + disp.width / 2,
                menuY: Math.max(8, disp.y - 48),
              });
            }}
          >
            {span.text}
          </span>
        );
      })}

      {/* Touch long-press loupe + 44x44 teardrop handles (03 §5.7) */}
      {selectedSpan && touchLoupe && (
        <>
          {touchLoupe.preview && (
            <div
              data-testid="touch-selection-loupe"
              style={{
                position: 'absolute',
                left: `${Math.max(56, touchLoupe.x)}px`,
                top: `${touchLoupe.y}px`,
                transform: 'translateX(-50%)',
              }}
              className="pointer-events-none z-50 max-w-[180px] truncate rounded-full border-2 border-blue-500 bg-white px-3 py-1 text-sm font-semibold text-slate-900 shadow-2xl"
            >
              {touchLoupe.preview}
            </div>
          )}
          <button
            type="button"
            aria-label="Adjust selection start"
            onPointerDown={(e) => {
              e.stopPropagation();
              draggingHandleRef.current = 'start';
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            style={{
              position: 'absolute',
              left: `${touchLoupe.startHandle.x - 22}px`,
              top: `${touchLoupe.startHandle.y - 6}px`,
            }}
            className="z-40 flex h-[44px] w-[44px] touch-none items-start justify-center"
          >
            <span className="h-4 w-4 rounded-b-full rounded-tr-full border-2 border-white bg-blue-600 shadow-md" />
          </button>
          <button
            type="button"
            aria-label="Adjust selection end"
            onPointerDown={(e) => {
              e.stopPropagation();
              draggingHandleRef.current = 'end';
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            style={{
              position: 'absolute',
              left: `${touchLoupe.endHandle.x - 22}px`,
              top: `${touchLoupe.endHandle.y - 6}px`,
            }}
            className="z-40 flex h-[44px] w-[44px] touch-none items-start justify-center"
          >
            <span className="h-4 w-4 rounded-b-full rounded-tl-full border-2 border-white bg-blue-600 shadow-md" />
          </button>
        </>
      )}

      {/* K4 Lightweight Viewer Selection Menu: Copy · Highlight · Underline · Note */}
      {selectedSpan && (
        <div
          role="toolbar"
          aria-label="Text selection actions"
          style={{
            position: 'absolute',
            left: `${Math.max(12, selectedSpan.menuX)}px`,
            top: `${selectedSpan.menuY}px`,
            transform: 'translateX(-50%)',
          }}
          className="z-40 flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900/95 p-1 text-xs font-medium text-white shadow-2xl backdrop-blur"
        >
          <button
            type="button"
            disabled={!docCanCopyText}
            onClick={() => void handleCopy()}
            title={docCanCopyText ? 'Copy' : t('viewer.copyRestricted')}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 disabled:opacity-40"
          >
            <Copy className="h-4 w-4" />
            <span>{copiedToast ? '✓' : 'Copy'}</span>
          </button>
          <button
            type="button"
            onClick={() => applyHighlightOrUnderline('highlight')}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-slate-800"
          >
            <Highlighter className="h-4 w-4 text-yellow-400" />
            <span>Highlight</span>
          </button>
          <button
            type="button"
            onClick={() => applyHighlightOrUnderline('underline')}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-slate-800"
          >
            <Underline className="h-4 w-4 text-sky-400" />
            <span>Underline</span>
          </button>
          <button
            type="button"
            onClick={handleAddNote}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-slate-800"
          >
            <StickyNote className="h-4 w-4 text-amber-300" />
            <span>Note</span>
          </button>
        </div>
      )}
    </div>
  );
}
