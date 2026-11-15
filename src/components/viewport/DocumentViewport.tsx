import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
  type DragEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FilePlus, FileUp, Sparkles } from 'lucide-react';
import type { BlankPagePreset } from '@/engine/blankPdf';
import {
  computeViewportSurfaceMetrics,
  findAnchorPageIndex,
  getDisplayDimensions,
  getPageOffsetInSurface,
  VIEWPORT_MAX_ZOOM,
  VIEWPORT_MIN_ZOOM,
  VIEWPORT_PAGE_GAP,
} from '@/engine/coordinates';
import {
  createBlankDocument,
  insertImageFileOnPage,
  mergePdfFile,
  openPdfBytes,
  openPdfFile,
} from '@/engine/documentController';
import { generateSamplePdfBytes } from '@/engine/samplePdf';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useEditorStore } from '@/store/useEditorStore';
import { BrandLogo } from '../BrandLogo';
import { PageCanvas } from './PageCanvas';

export interface DocumentViewportHandle {
  scrollToPage: (pageIndex: number) => void;
}

interface PinchSession {
  startZoom: number;
  startDist: number;
  anchorPageIndex: number;
  pdfLocalX: number;
  pdfLocalY: number;
  anchorSurfaceX: number;
  anchorSurfaceY: number;
  liveZoom: number;
  lastRelX: number;
  lastRelY: number;
}

export const DocumentViewport = forwardRef<DocumentViewportHandle>(function DocumentViewport(
  _props,
  ref,
) {
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const zoom = useEditorStore((s) => s.zoom);
  const zoomMode = useEditorStore((s) => s.zoomMode);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setActivePage = useEditorStore((s) => s.setActivePage);
  const setPinchState = useEditorStore((s) => s.setPinchState);
  const pendingSignaturePlacement = useEditorStore((s) => s.pendingSignaturePlacement);
  const cancelPendingSignaturePlacement = useEditorStore((s) => s.cancelPendingSignaturePlacement);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchSessionRef = useRef<PinchSession | null>(null);
  const pinchRafRef = useRef<number | null>(null);
  const pendingGpuTransformRef = useRef<{ tx: number; ty: number; s: number } | null>(null);
  const pendingScrollRef = useRef<{
    left: number;
    top: number;
    targetZoom?: number;
    targetSurfaceWidth?: number;
  } | null>(null);
  const lastAutoPositionedFirstPageRef = useRef<string | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const isMobile = useMediaQuery('(max-width: 767px)');
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;

  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  }));

  const surfaceMetrics = computeViewportSurfaceMetrics(
    pages,
    viewportSize.width,
    viewportSize.height,
    zoom,
    isMobile,
  );

  const totalDocHeight = pages.reduce((acc, p) => {
    const dims = getDisplayDimensions(p.baseWidth, p.baseHeight, p.userRotation, zoom);
    return acc + dims.height + VIEWPORT_PAGE_GAP;
  }, 0);
  const surfaceHeight = totalDocHeight + surfaceMetrics.viewportMarginY * 2;

  const recalculateAutoZoom = useCallback(() => {
    const el = containerRef.current;
    if (pages.length === 0) {
      lastAutoPositionedFirstPageRef.current = null;
      return;
    }
    if (!el || zoomMode === 'custom') return;
    const isInitialDocOpen = lastAutoPositionedFirstPageRef.current !== pages[0].id;
    const currentActiveId = useEditorStore.getState().activePageId;
    const refIdx = Math.max(
      0,
      pages.findIndex((p) => p.id === currentActiveId),
    );
    const refPage = pages[refIdx] ?? pages[0];
    if (!refPage) return;
    const dims = getDisplayDimensions(refPage.baseWidth, refPage.baseHeight, refPage.userRotation, 1);
    const availW = Math.max(240, el.clientWidth - 72);
    const availH = Math.max(240, el.clientHeight - 72);

    const prevZoom = useEditorStore.getState().zoom;
    let nextZoom = prevZoom;
    if (zoomMode === 'fit-width') {
      nextZoom = Math.min(2.5, Math.max(0.3, availW / dims.width));
      setZoom(nextZoom, 'fit-width');
    } else if (zoomMode === 'fit-page') {
      nextZoom = Math.min(2.5, Math.max(0.25, Math.min(availW / dims.width, availH / dims.height)));
      setZoom(nextZoom, 'fit-page');
    }

    if (isInitialDocOpen || Math.abs(nextZoom - prevZoom) >= 0.0005) {
      const containerW = el.clientWidth || window.innerWidth;
      const containerH = el.clientHeight || window.innerHeight;
      const nextMetrics = computeViewportSurfaceMetrics(
        pages,
        containerW,
        containerH,
        nextZoom,
        isMobileRef.current,
      );
      const offset = getPageOffsetInSurface(pages, refIdx, nextZoom, nextMetrics);
      const centeredLeft = Math.max(0, Math.round(offset.left + offset.width / 2 - containerW / 2));
      const targetTop = isInitialDocOpen ? nextMetrics.viewportMarginY : el.scrollTop;
      if (isInitialDocOpen) {
        lastAutoPositionedFirstPageRef.current = pages[0].id;
      }
      const committedTargetZoom = Math.min(5, Math.max(0.25, Number(nextZoom.toFixed(3))));
      if (
        Math.abs(committedTargetZoom - prevZoom) >= 0.0005 ||
        el.scrollWidth < centeredLeft + el.clientWidth
      ) {
        pendingScrollRef.current = {
          left: centeredLeft,
          top: targetTop,
          targetZoom: committedTargetZoom,
          targetSurfaceWidth: nextMetrics.surfaceWidth,
        };
      } else {
        el.scrollLeft = centeredLeft;
        el.scrollTop = targetTop;
        pendingScrollRef.current = null;
      }
    }
  }, [pages, zoomMode, setZoom]);

  useEffect(() => {
    recalculateAutoZoom();
  }, [recalculateAutoZoom]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const w = el.clientWidth || window.innerWidth;
      const h = el.clientHeight || window.innerHeight;
      setViewportSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      recalculateAutoZoom();
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [recalculateAutoZoom]);

  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (idx) => {
      const p = pages[idx];
      if (!p) return 800;
      const dims = getDisplayDimensions(p.baseWidth, p.baseHeight, p.userRotation, zoom);
      return dims.height + VIEWPORT_PAGE_GAP;
    },
    overscan: 2,
  });

  // Re-measure virtualized rows synchronously whenever zoom or page geometry changes
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, zoom, pages]);

  // Apply pinch or initial-document scroll compensation synchronously in the same paint frame
  useLayoutEffect(() => {
    const el = containerRef.current;
    const pending = pendingScrollRef.current;
    if (!el || !pending) return;
    if (pending.targetZoom !== undefined && Math.abs(zoom - pending.targetZoom) >= 0.001) {
      return;
    }
    if (
      pending.targetSurfaceWidth !== undefined &&
      surfaceMetrics.surfaceWidth + 1 < pending.targetSurfaceWidth
    ) {
      return;
    }
    el.scrollLeft = pending.left;
    el.scrollTop = pending.top;
    pendingScrollRef.current = null;
  }, [pages, zoom, surfaceMetrics.surfaceWidth]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage: (pageIndex: number) => {
        const el = containerRef.current;
        if (!el || pageIndex < 0 || pageIndex >= pages.length) return;
        const offset = getPageOffsetInSurface(pages, pageIndex, zoom, surfaceMetrics);
        const centeredLeft = Math.max(
          0,
          Math.round(offset.left + offset.width / 2 - (el.clientWidth || window.innerWidth) / 2),
        );
        el.scrollTo({ top: Math.max(0, offset.rowTop), left: centeredLeft });
      },
    }),
    [pages, zoom, surfaceMetrics],
  );

  // Ctrl/Cmd + Wheel smooth zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const currentZoom = useEditorStore.getState().zoom;
      setZoom(currentZoom * factor, 'custom');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  // Multi-touch Pinch-to-Zoom & Two-Finger Pan (GPU-composited during gesture, committed once on release)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const clearSurfaceTransform = () => {
      if (pinchRafRef.current !== null) {
        window.cancelAnimationFrame(pinchRafRef.current);
        pinchRafRef.current = null;
      }
      pendingGpuTransformRef.current = null;
      const surf = surfaceRef.current;
      if (surf) {
        surf.style.transform = '';
        surf.style.transformOrigin = '';
        surf.style.willChange = '';
      }
    };

    const scheduleSurfaceTransform = (tx: number, ty: number, s: number) => {
      pendingGpuTransformRef.current = { tx, ty, s };
      if (pinchRafRef.current !== null) return;
      pinchRafRef.current = window.requestAnimationFrame(() => {
        pinchRafRef.current = null;
        const t = pendingGpuTransformRef.current;
        const surf = surfaceRef.current;
        if (!t || !surf) return;
        surf.style.transformOrigin = '0 0';
        surf.style.willChange = 'transform';
        surf.style.transform = `translate3d(${t.tx.toFixed(2)}px, ${t.ty.toFixed(2)}px, 0) scale(${t.s.toFixed(5)})`;
      });
    };

    const startPinchSession = (
      p1: { x: number; y: number },
      p2: { x: number; y: number },
    ): PinchSession | null => {
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (dist < 8) return null;
      const state = useEditorStore.getState();
      if (state.pages.length === 0) return null;
      const currentZoom = state.zoom;
      const rect = el.getBoundingClientRect();
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const relX = midX - rect.left;
      const relY = midY - rect.top;
      const containerW = el.clientWidth || window.innerWidth;
      const containerH = el.clientHeight || window.innerHeight;
      const metrics = computeViewportSurfaceMetrics(
        state.pages,
        containerW,
        containerH,
        currentZoom,
        isMobileRef.current,
      );
      const activeIdx = Math.max(
        0,
        state.pages.findIndex((p) => p.id === state.activePageId),
      );
      const anchorPageIndex = findAnchorPageIndex(
        state.pages,
        el.scrollTop,
        relY,
        currentZoom,
        metrics,
        activeIdx,
      );
      const offset = getPageOffsetInSurface(state.pages, anchorPageIndex, currentZoom, metrics);
      const anchorSurfaceX = el.scrollLeft + relX;
      const anchorSurfaceY = el.scrollTop + relY;
      return {
        startZoom: currentZoom,
        startDist: dist,
        anchorPageIndex,
        pdfLocalX: (anchorSurfaceX - offset.left) / currentZoom,
        pdfLocalY: (anchorSurfaceY - offset.top) / currentZoom,
        anchorSurfaceX,
        anchorSurfaceY,
        liveZoom: currentZoom,
        lastRelX: relX,
        lastRelY: relY,
      };
    };

    const applyPinchGeometry = (
      p1: { x: number; y: number },
      p2: { x: number; y: number },
    ) => {
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      let session = pinchSessionRef.current;
      if (!session) {
        session = startPinchSession(p1, p2);
        pinchSessionRef.current = session;
        return;
      }
      if (dist < 8) return;

      const state = useEditorStore.getState();
      if (state.pages.length === 0) return;

      const rect = el.getBoundingClientRect();
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const relX = midX - rect.left;
      const relY = midY - rect.top;

      const rawNextZoom = session.startZoom * (dist / session.startDist);
      const nextZoom = Math.min(
        VIEWPORT_MAX_ZOOM,
        Math.max(VIEWPORT_MIN_ZOOM, Number(rawNextZoom.toFixed(3))),
      );

      session.liveZoom = nextZoom;
      session.lastRelX = relX;
      session.lastRelY = relY;

      const scaleFactor = nextZoom / session.startZoom;
      const tx = el.scrollLeft + relX - session.anchorSurfaceX * scaleFactor;
      const ty = el.scrollTop + relY - session.anchorSurfaceY * scaleFactor;
      scheduleSurfaceTransform(tx, ty, scaleFactor);
    };

    const commitPinchSession = () => {
      const session = pinchSessionRef.current;
      pinchSessionRef.current = null;
      clearSurfaceTransform();
      if (!session) return;

      const state = useEditorStore.getState();
      if (state.pages.length === 0) return;

      const nextZoom = Math.min(
        VIEWPORT_MAX_ZOOM,
        Math.max(VIEWPORT_MIN_ZOOM, Number(session.liveZoom.toFixed(3))),
      );
      const containerW = el.clientWidth || window.innerWidth;
      const containerH = el.clientHeight || window.innerHeight;
      const nextMetrics = computeViewportSurfaceMetrics(
        state.pages,
        containerW,
        containerH,
        nextZoom,
        isMobileRef.current,
      );
      const nextOffset = getPageOffsetInSurface(
        state.pages,
        session.anchorPageIndex,
        nextZoom,
        nextMetrics,
      );

      const nextScrollLeft = Math.max(
        0,
        nextOffset.left + session.pdfLocalX * nextZoom - session.lastRelX,
      );
      const nextScrollTop = Math.max(
        0,
        nextOffset.top + session.pdfLocalY * nextZoom - session.lastRelY,
      );
      pendingScrollRef.current = {
        left: nextScrollLeft,
        top: nextScrollTop,
        targetZoom: nextZoom,
      };

      if (Math.abs(nextZoom - state.zoom) < 0.0005) {
        el.scrollLeft = nextScrollLeft;
        el.scrollTop = nextScrollTop;
        pendingScrollRef.current = null;
      } else {
        setZoom(nextZoom, 'custom');
      }
    };

    const endTouchPointer = (pointerId: number) => {
      if (!touchPointersRef.current.delete(pointerId)) return;
      const remaining = touchPointersRef.current.size;
      if (remaining < 2) {
        commitPinchSession();
        el.style.touchAction = 'pan-x pan-y';
        setPinchState(false, remaining);
      } else {
        commitPinchSession();
        const pts = Array.from(touchPointersRef.current.values());
        pinchSessionRef.current = startPinchSession(pts[0], pts[1]);
        setPinchState(true, remaining);
      }
    };

    const notifyMultitouchStart = () => {
      window.dispatchEvent(new CustomEvent('gullac:multitouch-start'));
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const count = touchPointersRef.current.size;
      if (count >= 2) {
        el.style.touchAction = 'none';
        setPinchState(true, count);
        notifyMultitouchStart();
        const pts = Array.from(touchPointersRef.current.values());
        pinchSessionRef.current = startPinchSession(pts[0], pts[1]);
      } else {
        setPinchState(false, count);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !touchPointersRef.current.has(e.pointerId)) return;
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointersRef.current.size >= 2) {
        const pts = Array.from(touchPointersRef.current.values());
        applyPinchGeometry(pts[0], pts[1]);
      }
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      endTouchPointer(e.pointerId);
    };

    // Fallback native TouchEvent pinch guard (prevents iOS/browser page-level pinch & handles synthetic TouchEvents)
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        notifyMultitouchStart();
        if (touchPointersRef.current.size < 2) {
          el.style.touchAction = 'none';
          setPinchState(true, e.touches.length);
          pinchSessionRef.current = startPinchSession(
            { x: e.touches[0].clientX, y: e.touches[0].clientY },
            { x: e.touches[1].clientX, y: e.touches[1].clientY },
          );
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        if (touchPointersRef.current.size < 2) {
          applyPinchGeometry(
            { x: e.touches[0].clientX, y: e.touches[0].clientY },
            { x: e.touches[1].clientX, y: e.touches[1].clientY },
          );
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2 && touchPointersRef.current.size < 2) {
        commitPinchSession();
        el.style.touchAction = 'pan-x pan-y';
        setPinchState(false, e.touches.length);
      }
    };

    el.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      clearSurfaceTransform();
      el.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [setZoom, setPinchState]);

  // Sync active page on scroll
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el || pages.length === 0) return;
    const centerOffset = el.scrollTop - surfaceMetrics.viewportMarginY + el.clientHeight * 0.35;
    const items = virtualizer.getVirtualItems();
    for (const item of items) {
      const rowOffset = getPageOffsetInSurface(pages, item.index, zoom, surfaceMetrics);
      const itemStart = rowOffset.rowTop - surfaceMetrics.viewportMarginY;
      const itemEnd = itemStart + rowOffset.height + VIEWPORT_PAGE_GAP;
      if (centerOffset >= itemStart && centerOffset <= itemEnd) {
        const p = pages[item.index];
        if (p && p.id !== activePageId) {
          setActivePage(p.id);
        }
        break;
      }
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    setDropActive(false);
    const files = [...(e.dataTransfer.files ?? [])];
    if (files.length === 0) return;
    e.preventDefault();

    void (async () => {
      for (const f of files) {
        const lower = f.name.toLowerCase();
        if (f.type === 'application/pdf' || lower.endsWith('.pdf')) {
          if (useEditorStore.getState().pages.length === 0) {
            await openPdfFile(f);
          } else {
            await mergePdfFile(f);
          }
        } else if (f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(lower)) {
          const targetPage =
            useEditorStore.getState().activePageId ?? useEditorStore.getState().pages[0]?.id;
          if (targetPage) {
            await insertImageFileOnPage(f, targetPage);
          }
        }
      }
    })();
  };

  const [blankPreset, setBlankPreset] = useState<BlankPagePreset>('a4-portrait');

  const handleLoadSample = async () => {
    const bytes = await generateSamplePdfBytes();
    await openPdfBytes('Sample-Architecture-Brief.pdf', bytes);
  };

  const handleCreateBlank = async (preset: BlankPagePreset = blankPreset) => {
    await createBlankDocument({ preset });
  };

  return (
    <main
      ref={containerRef}
      onScroll={handleScroll}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={handleDrop}
      data-testid="document-viewport"
      style={{ touchAction: 'pan-x pan-y' }}
      className="relative flex-1 overflow-auto bg-slate-200/80 dark:bg-slate-900"
    >
      {pendingSignaturePlacement && pages.length > 0 && (
        <div
          data-testid="signature-placement-banner"
          className="sticky top-2 z-40 mx-auto mt-2 flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full border border-blue-500/40 bg-slate-900/95 px-3.5 py-2 text-xs font-medium text-white shadow-xl backdrop-blur"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-400" />
          <span className="truncate">İmzayı yerleştirmek istediğiniz yere dokunun</span>
          <button
            type="button"
            data-testid="banner-cancel-signature-btn"
            onClick={cancelPendingSignaturePlacement}
            className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-sky-200 hover:bg-white/25"
          >
            İptal
          </button>
        </div>
      )}

      {pages.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-lg rounded-2xl border-2 border-dashed border-slate-300 bg-white/90 p-6 text-center shadow-xl dark:border-slate-700 dark:bg-slate-950/90 sm:p-10">
            <div className="mx-auto mb-3 flex items-center justify-center">
              <BrandLogo variant="stacked" className="h-32 w-auto sm:h-36" decorative />
            </div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Drop a PDF or start with a blank page
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              gullacpdf (GüllaçPdf) runs 100% client-side with WebAssembly. Edit existing PDF text
              in-place, start from a blank PDF page, manage images, place signatures/parafs, and
              organize pages privately.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void handleCreateBlank()}
                data-testid="welcome-blank-btn"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500"
              >
                <FilePlus className="h-4 w-4" />
                Boş Sayfa ile Başla
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                data-testid="welcome-open-btn"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
              >
                <FileUp className="h-4 w-4" />
                Open PDF File
              </button>
              <button
                type="button"
                onClick={() => void handleLoadSample()}
                data-testid="welcome-sample-btn"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Sparkles className="h-4 w-4 text-amber-500" />
                Load Sample PDF
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
              <span className="text-slate-400 dark:text-slate-500">Sayfa boyutu:</span>
              {(
                [
                  ['a4-portrait', 'A4 Dikey'],
                  ['a4-landscape', 'A4 Yatay'],
                  ['letter-portrait', 'Letter'],
                ] as const
              ).map(([presetId, label]) => {
                const active = blankPreset === presetId;
                return (
                  <button
                    key={presetId}
                    type="button"
                    onClick={() => setBlankPreset(presetId)}
                    data-testid={`welcome-preset-${presetId}`}
                    className={`rounded-md border px-2 py-1 font-medium transition-colors ${
                      active
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-500/70 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void openPdfFile(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      ) : (
        <div
          ref={surfaceRef}
          style={{
            height: `${surfaceHeight}px`,
            width: `${surfaceMetrics.surfaceWidth}px`,
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((vItem) => {
            const page = pages[vItem.index];
            const rowOffset = getPageOffsetInSurface(pages, vItem.index, zoom, surfaceMetrics);
            return (
              <div
                key={page.id}
                data-index={vItem.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${surfaceMetrics.surfaceWidth}px`,
                  height: `${rowOffset.height + VIEWPORT_PAGE_GAP}px`,
                  paddingTop: `${VIEWPORT_PAGE_GAP / 2}px`,
                  paddingLeft: `${rowOffset.left}px`,
                  boxSizing: 'border-box',
                  transform: `translateY(${rowOffset.rowTop}px)`,
                }}
                className="flex justify-start"
              >
                <PageCanvas page={page} pageIndex={vItem.index} zoom={zoom} />
              </div>
            );
          })}
        </div>
      )}

      {dropActive && pages.length > 0 && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-blue-600/15 backdrop-blur-[1px]">
          <div className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-xl">
            Drop PDF to Merge or Image to Insert
          </div>
        </div>
      )}
    </main>
  );
});
