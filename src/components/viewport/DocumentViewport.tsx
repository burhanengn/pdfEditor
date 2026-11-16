import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
  openPdfWithPickerFallback,
} from '@/engine/documentController';
import { buildPageOffsetIndex, findPageIndexAtSurfaceY } from '@/engine/pageOffsets';
import { GestureArena } from '@/gestures/gestureArena';
import { triggerHaptic, type PointerKind } from '@/gestures/gestureTypes';
import {
  applyPinchRubberBandAndSnap,
  resolveAxisLock,
  stepInertialVelocity,
  VelocityTracker,
} from '@/gestures/inertialScroller';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useI18n } from '@/i18n/useI18n';
import { useEditorStore } from '@/store/useEditorStore';
import { useViewerStore, type ViewportAnchor } from '@/store/useViewerStore';
import { BrandLogo } from '../BrandLogo';
import { PageCanvas } from './PageCanvas';

export interface DocumentViewportHandle {
  scrollToPage: (pageIndex: number) => void;
  captureAnchor: () => ViewportAnchor | null;
  restoreAnchor: (anchor: ViewportAnchor) => void;
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
  const { t } = useI18n();
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const zoom = useEditorStore((s) => s.zoom);
  const zoomMode = useEditorStore((s) => s.zoomMode);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setActivePage = useEditorStore((s) => s.setActivePage);
  const setPinchState = useEditorStore((s) => s.setPinchState);
  const pendingSignaturePlacement = useEditorStore((s) => s.pendingSignaturePlacement);
  const cancelPendingSignaturePlacement = useEditorStore((s) => s.cancelPendingSignaturePlacement);

  const scrollMode = useViewerStore((s) => s.scrollMode);
  const setFastScrolling = useViewerStore((s) => s.setFastScrolling);
  const toggleImmersiveControls = useViewerStore((s) => s.toggleImmersiveControls);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const surfaceMetrics = useMemo(
    () =>
      computeViewportSurfaceMetrics(
        pages,
        viewportSize.width,
        viewportSize.height,
        zoom,
        isMobile,
      ),
    [pages, viewportSize.width, viewportSize.height, zoom, isMobile],
  );

  // O(N) prefix-sum offset table replacing O(N) per-frame reduces (01 §6.3)
  const pageOffsets = useMemo(
    () => buildPageOffsetIndex(pages, zoom, surfaceMetrics),
    [pages, zoom, surfaceMetrics],
  );
  const surfaceHeight = pageOffsets.totalHeight;

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
    const availW = Math.max(240, el.clientWidth - (isMobileRef.current ? 24 : 72));
    const availH = Math.max(240, el.clientHeight - (isMobileRef.current ? 40 : 72));

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
    estimateSize: (idx) => pageOffsets.rowHeights[idx] || 800,
    overscan: 2,
  });

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, zoom, pages]);

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

  const scrollToPage = useCallback(
    (pageIndex: number) => {
      const el = containerRef.current;
      if (!el || pageIndex < 0 || pageIndex >= pages.length) return;
      const rowTop = pageOffsets.rowTops[pageIndex] ?? 0;
      const rowLeft = pageOffsets.rowLefts[pageIndex] ?? 0;
      const pageW = pageOffsets.pageWidths[pageIndex] ?? 0;
      const centeredLeft = Math.max(
        0,
        Math.round(rowLeft + pageW / 2 - (el.clientWidth || window.innerWidth) / 2),
      );
      el.scrollTo({ top: Math.max(0, rowTop), left: centeredLeft });
    },
    [pages.length, pageOffsets],
  );

  const captureAnchor = useCallback((): ViewportAnchor | null => {
    const el = containerRef.current;
    if (!el || pages.length === 0) return null;
    const centerY = el.scrollTop + el.clientHeight * 0.35;
    const idx = findPageIndexAtSurfaceY(pageOffsets, centerY);
    const page = pages[idx];
    if (!page) return null;
    const pageTop = pageOffsets.rowTops[idx] + VIEWPORT_PAGE_GAP * 0.5;
    const pageLeft = pageOffsets.rowLefts[idx];
    const pageW = Math.max(1, pageOffsets.pageWidths[idx]);
    const pageH = Math.max(1, pageOffsets.pageHeights[idx]);
    const centerX = el.scrollLeft + el.clientWidth * 0.5;
    return {
      pageId: page.id,
      normX: (centerX - pageLeft) / pageW,
      normY: (centerY - pageTop) / pageH,
      zoom,
    };
  }, [pages, pageOffsets, zoom]);

  const restoreAnchor = useCallback(
    (anchor: ViewportAnchor) => {
      const el = containerRef.current;
      if (!el || pages.length === 0) return;
      const idx = pages.findIndex((p) => p.id === anchor.pageId);
      if (idx < 0) return;
      const pageTop = pageOffsets.rowTops[idx] + VIEWPORT_PAGE_GAP * 0.5;
      const pageLeft = pageOffsets.rowLefts[idx];
      const pageW = pageOffsets.pageWidths[idx];
      const pageH = pageOffsets.pageHeights[idx];
      const targetCenterY = pageTop + anchor.normY * pageH;
      const targetCenterX = pageLeft + anchor.normX * pageW;
      el.scrollTop = Math.max(0, targetCenterY - el.clientHeight * 0.35);
      el.scrollLeft = Math.max(0, targetCenterX - el.clientWidth * 0.5);
    },
    [pages, pageOffsets],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage,
      captureAnchor,
      restoreAnchor,
    }),
    [scrollToPage, captureAnchor, restoreAnchor],
  );

  // Ctrl/Cmd + Wheel / Trackpad pinch smooth zoom
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

  // Unified Pointer-Events Touch Gesture Engine (03 §5)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const arena = new GestureArena();
    const velocity = new VelocityTracker();
    let inertiaRafId: number | null = null;
    let longPressTimerId: number | null = null;
    let panLastX = 0;
    let panLastY = 0;
    let panTotalDx = 0;
    let panTotalDy = 0;
    let axisLock: 'none' | 'x' | 'y' = 'none';
    const activePointerIds = new Set<number>();

    const stopInertia = () => {
      if (inertiaRafId !== null) {
        window.cancelAnimationFrame(inertiaRafId);
        inertiaRafId = null;
      }
    };

    const clearLongPressTimer = () => {
      if (longPressTimerId !== null) {
        window.clearTimeout(longPressTimerId);
        longPressTimerId = null;
      }
    };

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

    const computeFitWidthZoom = (): number | undefined => {
      const state = useEditorStore.getState();
      const refIdx = Math.max(0, state.pages.findIndex((p) => p.id === state.activePageId));
      const p = state.pages[refIdx] ?? state.pages[0];
      if (!p) return undefined;
      const dims = getDisplayDimensions(p.baseWidth, p.baseHeight, p.userRotation, 1);
      const availW = Math.max(240, (el.clientWidth || window.innerWidth) - (isMobileRef.current ? 24 : 72));
      return availW / dims.width;
    };

    const startPinchSession = (cx: number, cy: number, dist: number): PinchSession | null => {
      const state = useEditorStore.getState();
      if (state.pages.length === 0) return null;
      const currentZoom = state.zoom;
      const rect = el.getBoundingClientRect();
      const relX = cx - rect.left;
      const relY = cy - rect.top;
      const containerW = el.clientWidth || window.innerWidth;
      const containerH = el.clientHeight || window.innerHeight;
      const metrics = computeViewportSurfaceMetrics(
        state.pages,
        containerW,
        containerH,
        currentZoom,
        isMobileRef.current,
      );
      const activeIdx = Math.max(0, state.pages.findIndex((p) => p.id === state.activePageId));
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
        startDist: Math.max(8, dist),
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

    const updatePinchGeometry = (cx: number, cy: number, dist: number) => {
      let session = pinchSessionRef.current;
      if (!session) {
        session = startPinchSession(cx, cy, dist);
        pinchSessionRef.current = session;
        return;
      }
      if (dist < 8) return;
      const rect = el.getBoundingClientRect();
      const relX = cx - rect.left;
      const relY = cy - rect.top;

      const rawZoom = session.startZoom * (dist / session.startDist);
      const { zoom: rubberZoom } = applyPinchRubberBandAndSnap({
        rawZoom,
        minZoom: VIEWPORT_MIN_ZOOM,
        maxZoom: VIEWPORT_MAX_ZOOM,
        isLive: true,
      });

      session.liveZoom = rubberZoom;
      session.lastRelX = relX;
      session.lastRelY = relY;

      const scaleFactor = rubberZoom / session.startZoom;
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

      const fitW = computeFitWidthZoom();
      const { zoom: snappedZoom, snappedToFitWidth } = applyPinchRubberBandAndSnap({
        rawZoom: session.liveZoom,
        minZoom: VIEWPORT_MIN_ZOOM,
        maxZoom: VIEWPORT_MAX_ZOOM,
        fitWidthZoom: fitW,
        isLive: false,
      });
      if (snappedToFitWidth) {
        triggerHaptic(8);
      }

      const nextZoom = Number(snappedZoom.toFixed(3));
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
        setZoom(nextZoom, snappedToFitWidth ? 'fit-width' : 'custom');
      }
    };

    const startInertialGlide = (initVx: number, initVy: number) => {
      stopInertia();
      let vx = initVx;
      let vy = initVy;
      if (Math.hypot(vx, vy) < 0.05) return;
      let lastTime = performance.now();

      const tick = (now: number) => {
        const dt = Math.min(32, Math.max(1, now - lastTime));
        lastTime = now;
        const step = stepInertialVelocity(vx, vy, dt);
        vx = step.vx;
        vy = step.vy;
        if (axisLock !== 'y') el.scrollLeft -= step.dx;
        if (axisLock !== 'x') el.scrollTop -= step.dy;

        if (step.active) {
          inertiaRafId = window.requestAnimationFrame(tick);
        } else {
          inertiaRafId = null;
        }
      };
      inertiaRafId = window.requestAnimationFrame(tick);
    };

    const classifyTarget = (target: EventTarget | null): 'handle' | 'selected-element' | 'unselected-element' | 'viewer-text' | 'empty' => {
      const node = target as HTMLElement | null;
      if (!node) return 'empty';
      if (node.closest('[data-testid^="resize-handle-"], [data-testid="rotate-handle"]')) {
        return 'handle';
      }
      if (node.closest('[data-testid^="selection-box-"]')) {
        return 'selected-element';
      }
      if (node.closest('[data-detected-text], [data-detected-image], [data-detected-shape], [data-testid^="canvas-element-"]')) {
        return 'unselected-element';
      }
      if (node.closest('[data-testid^="viewer-text-layer-"]')) {
        return 'viewer-text';
      }
      return 'empty';
    };

    const handleArenaOutcomes = (outcomes: ReturnType<GestureArena['onPointerDown']>, pointerEvent: PointerEvent) => {
      const store = useEditorStore.getState();
      for (const out of outcomes) {
        switch (out.type) {
          case 'pinch-start': {
            stopInertia();
            clearLongPressTimer();
            setPinchState(true, arena.getPointerCount());
            window.dispatchEvent(new CustomEvent('gullac:multitouch-start'));
            pinchSessionRef.current = startPinchSession(out.cx, out.cy, out.dist);
            break;
          }
          case 'pinch-move': {
            updatePinchGeometry(out.cx, out.cy, out.dist);
            break;
          }
          case 'pinch-end': {
            commitPinchSession();
            setPinchState(false, arena.getPointerCount());
            break;
          }
          case 'start': {
            if (out.kind === 'pan') {
              panLastX = out.x;
              panLastY = out.y;
              panTotalDx = 0;
              panTotalDy = 0;
              axisLock = 'none';
              velocity.reset();
              velocity.addSample(out.x, out.y, performance.now());
            }
            break;
          }
          case 'move': {
            if (out.kind === 'pan') {
              const stepDx = out.x - panLastX;
              const stepDy = out.y - panLastY;
              panLastX = out.x;
              panLastY = out.y;
              panTotalDx += stepDx;
              panTotalDy += stepDy;

              if (axisLock === 'none') {
                const canScrollX = el.scrollWidth > el.clientWidth + 4;
                axisLock = resolveAxisLock(panTotalDx, panTotalDy, canScrollX);
              }
              if (axisLock !== 'y') el.scrollLeft -= stepDx;
              if (axisLock !== 'x') el.scrollTop -= stepDy;
              velocity.addSample(out.x, out.y, performance.now());
            }
            break;
          }
          case 'end': {
            if (out.kind === 'pan') {
              const v = velocity.getVelocityPxPerMs(performance.now());
              startInertialGlide(
                axisLock === 'y' ? 0 : v.vx,
                axisLock === 'x' ? 0 : v.vy,
              );
            }
            break;
          }
          case 'double-tap': {
            const fitW = computeFitWidthZoom() ?? 1;
            const cur = store.zoom;
            if (Math.abs(cur - fitW) < 0.08) {
              setZoom(Math.min(2.5, cur * 1.9), 'custom');
            } else {
              setZoom(fitW, 'fit-width');
            }
            break;
          }
          case 'tap': {
            if (
              store.appMode === 'view' &&
              isMobileRef.current &&
              out.hitKind === 'empty' &&
              !(pointerEvent.target as HTMLElement | null)?.closest('button, a, input')
            ) {
              toggleImmersiveControls();
            }
            break;
          }
          case 'long-press': {
            triggerHaptic(10);
            break;
          }
        }
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (useEditorStore.getState().pages.length === 0) return;

      // Ignore controls inside overlays/banners
      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest('[data-testid="signature-placement-banner"]')) return;

      const wasInertiaActive = inertiaRafId !== null;
      stopInertia();
      if (wasInertiaActive && e.pointerType === 'touch') {
        // Touch stops ongoing inertia immediately without firing tap (03 §5.5)
      }

      activePointerIds.add(e.pointerId);
      const store = useEditorStore.getState();
      const activeToolIsStroke =
        store.appMode === 'edit' &&
        (store.toolMode === 'draw' ||
          store.toolMode === 'highlight' ||
          store.toolMode === 'shape' ||
          store.toolMode === 'path');

      const outcomes = arena.onPointerDown({
        pointerId: e.pointerId,
        pointerType: e.pointerType as PointerKind,
        x: e.clientX,
        y: e.clientY,
        timeMs: performance.now(),
        hitKind: classifyTarget(e.target),
        activeToolIsStroke,
        appMode: store.appMode,
      });

      clearLongPressTimer();
      if (arena.getState() === 'pending') {
        longPressTimerId = window.setTimeout(() => {
          const lpOutcomes = arena.tickTimer(performance.now());
          if (lpOutcomes.length > 0) {
            handleArenaOutcomes(lpOutcomes, e);
          }
        }, 405);
      }

      handleArenaOutcomes(outcomes, e);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!activePointerIds.has(e.pointerId)) return;
      const coalesced =
        typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const eventsToProcess = coalesced.length > 0 ? coalesced : [e];
      for (const ev of eventsToProcess) {
        const outcomes = arena.onPointerMove({
          pointerId: e.pointerId,
          x: ev.clientX,
          y: ev.clientY,
          timeMs: performance.now(),
        });
        if (outcomes.length > 0) {
          handleArenaOutcomes(outcomes, e);
        }
      }
      if (arena.getState() !== 'pending') {
        clearLongPressTimer();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!activePointerIds.delete(e.pointerId)) return;
      clearLongPressTimer();
      const outcomes = arena.onPointerUp({
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        timeMs: performance.now(),
      });
      handleArenaOutcomes(outcomes, e);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (!activePointerIds.delete(e.pointerId)) return;
      clearLongPressTimer();
      const outcomes = arena.onPointerCancel(e.pointerId);
      handleArenaOutcomes(outcomes, e);
    };

    // Listen for pointerdown on viewport capture phase and move/up/cancel on window
    // so both real setPointerCapture AND Playwright synthetic window events work seamlessly
    el.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    return () => {
      stopInertia();
      clearLongPressTimer();
      clearSurfaceTransform();
      el.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [setZoom, setPinchState, toggleImmersiveControls]);

  const lastScrollTopRef = useRef(0);
  const lastScrollTimeRef = useRef(0);
  const fastScrollTimeoutRef = useRef<number | null>(null);

  // Sync active page in O(log N) & detect ultra-fast scroll velocity to defer crisp tiles (01 §6.3)
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el || pages.length === 0) return;

    const now = performance.now();
    const dt = Math.max(1, now - lastScrollTimeRef.current);
    const speedPxPerMs = Math.abs(el.scrollTop - lastScrollTopRef.current) / dt;
    lastScrollTopRef.current = el.scrollTop;
    lastScrollTimeRef.current = now;

    if (speedPxPerMs > 2.8) {
      setFastScrolling(true);
      if (fastScrollTimeoutRef.current !== null) window.clearTimeout(fastScrollTimeoutRef.current);
      fastScrollTimeoutRef.current = window.setTimeout(() => {
        setFastScrolling(false);
      }, 140);
    }

    const centerSurfaceY = el.scrollTop + el.clientHeight * 0.35;
    const idx = findPageIndexAtSurfaceY(pageOffsets, centerSurfaceY);
    const p = pages[idx];
    if (p && p.id !== activePageId) {
      setActivePage(p.id);
    }
  };

  useEffect(() => {
    return () => {
      if (fastScrollTimeoutRef.current !== null) window.clearTimeout(fastScrollTimeoutRef.current);
    };
  }, []);

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
    const { generateSamplePdfBytes } = await import('@/engine/samplePdf');
    const bytes = await generateSamplePdfBytes();
    await openPdfBytes('Sample-Architecture-Brief.pdf', bytes);
  };

  const handleCreateBlank = async (preset: BlankPagePreset = blankPreset) => {
    await createBlankDocument({ preset });
  };

  const activeIdx = Math.max(
    0,
    pages.findIndex((p) => p.id === activePageId),
  );

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
      style={{
        touchAction: pages.length > 0 ? 'none' : 'pan-y',
        scrollSnapType: scrollMode === 'page-snap' ? 'y mandatory' : undefined,
      }}
      className="relative flex-1 overflow-auto bg-[var(--gp-paper-backdrop)]"
    >
      {pendingSignaturePlacement && pages.length > 0 && (
        <div
          data-testid="signature-placement-banner"
          className="fixed left-1/2 top-14 z-40 flex w-fit max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-blue-500/40 bg-slate-900/95 px-3.5 py-2 text-xs font-medium text-white shadow-xl backdrop-blur"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-400" />
          <span className="truncate">İmzayı yerleştirmek istediğiniz yere dokunun</span>
          <button
            type="button"
            data-testid="banner-cancel-signature-btn"
            onClick={cancelPendingSignaturePlacement}
            className="min-h-[36px] shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-sky-200 hover:bg-white/25"
          >
            {t('action.cancel')}
          </button>
        </div>
      )}

      {pages.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-lg rounded-2xl border-2 border-dashed border-slate-300 bg-white/95 p-6 text-center shadow-xl dark:border-slate-700 dark:bg-slate-950/95 sm:p-10">
            <div className="mx-auto mb-3 flex items-center justify-center">
              <BrandLogo variant="stacked" className="h-32 w-auto sm:h-36" decorative />
            </div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              {t('app.tagline')}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              gullacpdf runs 100% locally on your device. Read PDFs instantaneously, search with
              Turkish/Unicode folding, annotate, sign, and edit documents privately.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void handleCreateBlank()}
                data-testid="welcome-blank-btn"
                className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500"
              >
                <FilePlus className="h-5 w-5" />
                {t('action.startBlank')}
              </button>
              <button
                type="button"
                onClick={() => void openPdfWithPickerFallback(fileInputRef.current)}
                data-testid="welcome-open-btn"
                className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
              >
                <FileUp className="h-5 w-5" />
                {t('action.openPdf')}
              </button>
              <button
                type="button"
                onClick={() => void handleLoadSample()}
                data-testid="welcome-sample-btn"
                className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Sparkles className="h-5 w-5 text-amber-500" />
                {t('action.loadSample')}
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Page size:</span>
              {(
                [
                  ['a4-portrait', 'A4 Portrait'],
                  ['a4-landscape', 'A4 Landscape'],
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
                    className={`min-h-[36px] rounded-lg border px-2.5 py-1 font-medium transition-colors ${
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
            const rowTop = pageOffsets.rowTops[vItem.index] ?? 0;
            const rowHeight = pageOffsets.rowHeights[vItem.index] ?? 800;
            const rowLeft = pageOffsets.rowLefts[vItem.index] ?? 0;
            const isNear = Math.abs(vItem.index - activeIdx) <= 1;
            return (
              <div
                key={page.id}
                data-index={vItem.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${surfaceMetrics.surfaceWidth}px`,
                  height: `${rowHeight}px`,
                  paddingTop: `${VIEWPORT_PAGE_GAP / 2}px`,
                  paddingLeft: `${rowLeft}px`,
                  boxSizing: 'border-box',
                  transform: `translateY(${rowTop}px)`,
                  scrollSnapAlign: scrollMode === 'page-snap' ? 'start' : undefined,
                }}
                className="flex justify-start"
              >
                <PageCanvas
                  page={page}
                  pageIndex={vItem.index}
                  zoom={zoom}
                  scrollElementRef={containerRef}
                  onJumpToPage={scrollToPage}
                  isNearActivePage={isNear}
                />
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
