import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useLayoutClass } from '@/hooks/useLayoutClass';

export type SheetDetent = 'peek' | 'half' | 'full';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  detent?: SheetDetent;
  onDetentChange?: (detent: SheetDetent) => void;
  allowedDetents?: SheetDetent[];
  side?: 'left' | 'right';
  forceModal?: boolean;
  testId?: string;
  headerActions?: ReactNode;
  children: ReactNode;
}

function getDetentHeightPx(detent: SheetDetent, viewportH: number): number {
  const safeMax = Math.max(240, viewportH - 16);
  if (detent === 'peek') return 92;
  if (detent === 'half') return Math.round(Math.min(safeMax, Math.max(260, viewportH * 0.46)));
  return safeMax;
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  detent: controlledDetent,
  onDetentChange,
  allowedDetents = ['peek', 'half', 'full'],
  side = 'right',
  forceModal = false,
  testId = 'gp-sheet',
  headerActions,
  children,
}: SheetProps) {
  const { layoutClass, height: viewportH } = useLayoutClass();
  const [internalDetent, setInternalDetent] = useState<SheetDetent>(
    controlledDetent ?? (allowedDetents.includes('half') ? 'half' : allowedDetents[0]),
  );
  const activeDetent = controlledDetent ?? internalDetent;

  const setDetent = useCallback(
    (next: SheetDetent) => {
      setInternalDetent(next);
      onDetentChange?.(next);
    },
    [onDetentChange],
  );

  const [vvHeight, setVvHeight] = useState<number>(viewportH);
  useEffect(() => {
    setVvHeight(viewportH);
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const onResize = () => setVvHeight(vv.height);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [viewportH]);

  const sheetRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number;
    startY: number;
    lastY: number;
    lastTime: number;
    velocityY: number;
    startHeight: number;
    liveHeight: number;
  } | null>(null);

  const isCompactBottom = layoutClass === 'compact';
  const currentHeight = getDetentHeightPx(activeDetent, vvHeight);
  const isModalBackdrop = forceModal || activeDetent === 'full' || !isCompactBottom;

  // Step down one detent on Esc before closing (03 §3.1)
  const stepDownOrClose = useCallback(() => {
    if (isCompactBottom) {
      const idx = allowedDetents.indexOf(activeDetent);
      if (idx > 0) {
        setDetent(allowedDetents[idx - 1]);
        return;
      }
    }
    onClose();
  }, [isCompactBottom, allowedDetents, activeDetent, setDetent, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        stepDownOrClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, stepDownOrClose]);

  // Restore focus on close for modal sheets
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    return () => {
      prevFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const commitDragHeight = (finalHeight: number, velocityY: number) => {
    // Fast downward flick closes or drops a detent
    if (velocityY > 0.65) {
      if (activeDetent === 'peek' || finalHeight < 70) {
        onClose();
        return;
      }
      const idx = allowedDetents.indexOf(activeDetent);
      if (idx > 0) {
        setDetent(allowedDetents[idx - 1]);
        return;
      }
      onClose();
      return;
    }

    if (velocityY < -0.65) {
      const idx = allowedDetents.indexOf(activeDetent);
      if (idx >= 0 && idx < allowedDetents.length - 1) {
        setDetent(allowedDetents[idx + 1]);
        return;
      }
    }

    if (finalHeight < 52) {
      onClose();
      return;
    }

    let bestDetent = activeDetent;
    let bestDiff = Infinity;
    for (const d of allowedDetents) {
      const target = getDetentHeightPx(d, vvHeight);
      const diff = Math.abs(finalHeight - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestDetent = d;
      }
    }
    setDetent(bestDetent);
  };

  const handleGrabberPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isCompactBottom) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      lastTime: performance.now(),
      velocityY: 0,
      startHeight: currentHeight,
      liveHeight: currentHeight,
    };
  };

  const handleGrabberPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st || !st.active || st.pointerId !== e.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - st.lastTime);
    st.velocityY = (e.clientY - st.lastY) / dt;
    st.lastY = e.clientY;
    st.lastTime = now;

    const deltaY = e.clientY - st.startY;
    const maxH = getDetentHeightPx('full', vvHeight);
    st.liveHeight = Math.max(36, Math.min(maxH, st.startHeight - deltaY));
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
      sheetRef.current.style.height = `${Math.round(st.liveHeight)}px`;
    }
  };

  const handleGrabberPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st || !st.active || st.pointerId !== e.pointerId) return;
    dragStateRef.current = null;
    if (sheetRef.current) {
      sheetRef.current.style.transition = '';
    }
    commitDragHeight(st.liveHeight, st.velocityY);
  };

  const cycleDetentUp = () => {
    const idx = allowedDetents.indexOf(activeDetent);
    if (idx < allowedDetents.length - 1) setDetent(allowedDetents[idx + 1]);
  };

  const cycleDetentDown = () => {
    const idx = allowedDetents.indexOf(activeDetent);
    if (idx > 0) setDetent(allowedDetents[idx - 1]);
    else onClose();
  };

  // Medium / Tablet layout renders a 360px side sheet (03 §2.2, §3.2)
  if (!isCompactBottom) {
    return (
      <div
        className="fixed inset-0 z-40 flex bg-slate-950/35 backdrop-blur-[1px]"
        style={{ justifyContent: side === 'left' ? 'flex-start' : 'flex-end' }}
        onClick={onClose}
      >
        <section
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          data-testid={testId}
          onClick={(e) => e.stopPropagation()}
          className={`safe-pt safe-pb flex h-full w-[360px] max-w-[92vw] flex-col bg-white shadow-2xl dark:bg-slate-950 ${
            side === 'left'
              ? 'border-r border-slate-200 dark:border-slate-800'
              : 'border-l border-slate-200 dark:border-slate-800'
          }`}
        >
          <div className="flex min-h-[52px] items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-800">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                {title}
              </h2>
              {subtitle && (
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {headerActions}
              <button
                type="button"
                aria-label={`Close ${title}`}
                onClick={onClose}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto touch-pan-y">
            {children}
          </div>
        </section>
      </div>
    );
  }

  // Compact Mobile Bottom Sheet (Peek/Half non-modal; Full modal)
  return (
    <div
      className={`fixed inset-0 z-40 flex flex-col justify-end ${
        isModalBackdrop ? 'bg-slate-950/55 backdrop-blur-[1px]' : 'pointer-events-none'
      }`}
      onClick={isModalBackdrop ? onClose : undefined}
    >
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal={isModalBackdrop}
        aria-label={title}
        data-testid={testId}
        data-detent={activeDetent}
        onClick={(e) => e.stopPropagation()}
        style={{
          height: `${currentHeight}px`,
          transition: 'height var(--gp-motion-duration, 180ms) cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        className="pointer-events-auto safe-pb flex w-full flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
      >
        {/* 44px touch grabber strip with 36x4px visual pill (03 §3.1) */}
        <div
          role="slider"
          aria-label="Sheet size"
          aria-valuemin={0}
          aria-valuemax={2}
          aria-valuenow={allowedDetents.indexOf(activeDetent)}
          tabIndex={0}
          onPointerDown={handleGrabberPointerDown}
          onPointerMove={handleGrabberPointerMove}
          onPointerUp={handleGrabberPointerUp}
          onPointerCancel={handleGrabberPointerUp}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') cycleDetentUp();
            else if (e.key === 'ArrowDown') cycleDetentDown();
          }}
          style={{ touchAction: 'none' }}
          className="flex h-11 shrink-0 cursor-ns-resize items-center justify-center"
        >
          <div className="h-1 w-9 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        <div className="flex items-center justify-between border-b border-slate-200 px-4 pb-2 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            {subtitle && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {headerActions}
            {allowedDetents.length > 1 && (
              <button
                type="button"
                aria-label={activeDetent === 'full' ? 'Collapse sheet' : 'Expand sheet'}
                onClick={activeDetent === 'full' ? cycleDetentDown : cycleDetentUp}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {activeDetent === 'full' ? (
                  <ChevronDown className="h-5 w-5" />
                ) : (
                  <ChevronUp className="h-5 w-5" />
                )}
              </button>
            )}
            <button
              type="button"
              aria-label={`Close ${title}`}
              onClick={onClose}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {activeDetent !== 'peek' && (
          <div
            ref={bodyRef}
            style={{ touchAction: 'pan-y' }}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            {children}
          </div>
        )}
      </section>
    </div>
  );
}
