import { useEffect, useRef, useState } from 'react';
import { useLayoutClass } from '@/hooks/useLayoutClass';
import { useI18n } from '@/i18n/useI18n';
import { useEditorStore } from '@/store/useEditorStore';
import { useViewerStore } from '@/store/useViewerStore';

interface FloatingViewerControlsProps {
  onJumpToPage: (pageIndex: number) => void;
}

export function FloatingViewerControls({ onJumpToPage }: FloatingViewerControlsProps) {
  const { t } = useI18n();
  const { layoutClass } = useLayoutClass();
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const appMode = useEditorStore((s) => s.appMode);
  const zoom = useEditorStore((s) => s.zoom);
  const setGoToPageOpen = useViewerStore((s) => s.setGoToPageOpen);
  const immersiveHidden = useViewerStore((s) => s.immersiveControlsHidden);
  const leftHandedMode = useViewerStore((s) => s.leftHandedMode);
  const fastScrolling = useViewerStore((s) => s.fastScrolling);

  const [dimmed, setDimmed] = useState(false);
  const [scrubberDragging, setScrubberDragging] = useState(false);
  const [scrubPageIndex, setScrubPageIndex] = useState<number>(0);
  const idleTimerRef = useRef<number | null>(null);

  const activeIdx = Math.max(
    0,
    pages.findIndex((p) => p.id === activePageId),
  );

  // Dim pills after 2.5s of inactivity (02 §3.1)
  useEffect(() => {
    setDimmed(false);
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setDimmed(true);
    }, 2500);
    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    };
  }, [activeIdx, zoom, fastScrolling]);

  if (pages.length === 0 || appMode !== 'view') return null;
  if (layoutClass === 'compact' && immersiveHidden) return null;

  const showScrubber = layoutClass === 'compact' && pages.length > 3;

  return (
    <>
      {/* Floating Page Indicator & Zoom Pill */}
      <div
        className={`pointer-events-none fixed left-1/2 z-25 -translate-x-1/2 transition-opacity duration-200 ${
          layoutClass === 'compact' ? 'bottom-20' : 'bottom-4'
        } ${dimmed || fastScrolling ? 'opacity-45 hover:opacity-100' : 'opacity-95'}`}
      >
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-slate-300/80 bg-white/95 px-1.5 py-1 text-xs font-semibold text-slate-800 shadow-lg backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/95 dark:text-slate-100">
          <button
            type="button"
            data-testid="floating-page-pill"
            onClick={() => setGoToPageOpen(true)}
            title={t('nav.goToPage')}
            className="min-h-[32px] rounded-full px-3 py-1 tabular-nums hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {activeIdx + 1} / {pages.length}
          </button>
          <span className="h-3.5 w-px bg-slate-300 dark:bg-slate-700" />
          <span
            data-testid="floating-zoom-pill"
            className="px-2.5 py-1 tabular-nums text-slate-600 dark:text-slate-300"
          >
            {Math.round(zoom * 100)}%
          </span>
        </div>
      </div>

      {/* Mobile Edge Fast Scrubber (44x56px thumb handle, 03 §2.4) */}
      {showScrubber && (
        <div
          className={`fixed top-16 bottom-24 z-25 flex w-11 items-center ${
            leftHandedMode ? 'left-1 justify-start' : 'right-1 justify-end'
          }`}
        >
          <div
            role="slider"
            aria-label={t('nav.goToPage')}
            aria-valuemin={1}
            aria-valuemax={pages.length}
            aria-valuenow={scrubberDragging ? scrubPageIndex + 1 : activeIdx + 1}
            style={{
              touchAction: 'none',
              transform: `translateY(${((scrubberDragging ? scrubPageIndex : activeIdx) / Math.max(1, pages.length - 1) - 0.5) * 260}px)`,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              setScrubberDragging(true);
              setScrubPageIndex(activeIdx);
            }}
            onPointerMove={(e) => {
              if (!scrubberDragging) return;
              const parent = e.currentTarget.parentElement;
              if (!parent) return;
              const rect = parent.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
              const idx = Math.round(ratio * (pages.length - 1));
              if (idx !== scrubPageIndex) {
                setScrubPageIndex(idx);
                onJumpToPage(idx);
              }
            }}
            onPointerUp={() => setScrubberDragging(false)}
            onPointerCancel={() => setScrubberDragging(false)}
            className={`relative flex h-14 w-11 items-center justify-center rounded-full transition-opacity ${
              scrubberDragging || fastScrolling ? 'opacity-100' : 'opacity-40'
            }`}
          >
            <div className="flex h-10 w-6 items-center justify-center rounded-full border border-slate-300 bg-white/95 shadow-md dark:border-slate-700 dark:bg-slate-800/95">
              <div className="h-4 w-1 rounded-full bg-blue-500" />
            </div>
            {scrubberDragging && (
              <div
                className={`absolute whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold tabular-nums text-white shadow-xl ${
                  leftHandedMode ? 'left-12' : 'right-12'
                }`}
              >
                {scrubPageIndex + 1} / {pages.length}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
