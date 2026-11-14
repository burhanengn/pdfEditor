import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
  type DragEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileUp, Sparkles } from 'lucide-react';
import { getDisplayDimensions } from '@/engine/coordinates';
import {
  insertImageFileOnPage,
  mergePdfFile,
  openPdfBytes,
  openPdfFile,
} from '@/engine/documentController';
import { generateSamplePdfBytes } from '@/engine/samplePdf';
import { useEditorStore } from '@/store/useEditorStore';
import { BrandLogo } from '../BrandLogo';
import { PageCanvas } from './PageCanvas';

export interface DocumentViewportHandle {
  scrollToPage: (pageIndex: number) => void;
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchSessionRef = useRef<{
    lastDist: number;
    lastMidX: number;
    lastMidY: number;
  } | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const recalculateAutoZoom = useCallback(() => {
    const el = containerRef.current;
    if (!el || pages.length === 0 || zoomMode === 'custom') return;
    const refPage = pages.find((p) => p.id === activePageId) ?? pages[0];
    if (!refPage) return;
    const dims = getDisplayDimensions(refPage.baseWidth, refPage.baseHeight, refPage.userRotation, 1);
    const availW = Math.max(240, el.clientWidth - 72);
    const availH = Math.max(240, el.clientHeight - 72);

    if (zoomMode === 'fit-width') {
      const nextZoom = Math.min(2.5, Math.max(0.3, availW / dims.width));
      setZoom(nextZoom, 'fit-width');
    } else if (zoomMode === 'fit-page') {
      const nextZoom = Math.min(2.5, Math.max(0.25, Math.min(availW / dims.width, availH / dims.height)));
      setZoom(nextZoom, 'fit-page');
    }
  }, [pages, activePageId, zoomMode, setZoom]);

  useEffect(() => {
    recalculateAutoZoom();
  }, [recalculateAutoZoom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => recalculateAutoZoom());
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
      return dims.height + 44;
    },
    overscan: 2,
  });

  // Re-measure virtualized rows whenever zoom or page geometry changes
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, zoom, pages]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage: (pageIndex: number) => {
        if (pageIndex >= 0 && pageIndex < pages.length) {
          virtualizer.scrollToIndex(pageIndex, { align: 'start' });
        }
      },
    }),
    [virtualizer, pages.length],
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

  // Multi-touch Pinch-to-Zoom & Two-Finger Pan
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const applyPinchGeometry = (
      p1: { x: number; y: number },
      p2: { x: number; y: number },
    ) => {
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const session = pinchSessionRef.current;
      if (!session || session.lastDist < 8 || dist < 8) {
        pinchSessionRef.current = { lastDist: dist, lastMidX: midX, lastMidY: midY };
        return;
      }

      const ratio = dist / session.lastDist;
      const prevZoom = useEditorStore.getState().zoom;
      const nextZoom = Math.min(4, Math.max(0.25, Number((prevZoom * ratio).toFixed(3))));
      const scaleChange = nextZoom / prevZoom;

      const rect = el.getBoundingClientRect();
      const relX = midX - rect.left;
      const relY = midY - rect.top;
      const contentX = el.scrollLeft + relX;
      const contentY = el.scrollTop + relY;
      const panDx = midX - session.lastMidX;
      const panDy = midY - session.lastMidY;

      setZoom(nextZoom, 'custom');
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, contentX * scaleChange - relX - panDx);
        el.scrollTop = Math.max(0, contentY * scaleChange - relY - panDy);
      });

      pinchSessionRef.current = { lastDist: dist, lastMidX: midX, lastMidY: midY };
    };

    const endTouchPointer = (pointerId: number) => {
      if (!touchPointersRef.current.delete(pointerId)) return;
      const remaining = touchPointersRef.current.size;
      if (remaining < 2) {
        pinchSessionRef.current = null;
        el.style.touchAction = 'pan-x pan-y';
        setPinchState(false, remaining);
      } else {
        setPinchState(true, remaining);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const count = touchPointersRef.current.size;
      if (count >= 2) {
        el.style.touchAction = 'none';
        setPinchState(true, count);
        const pts = Array.from(touchPointersRef.current.values());
        pinchSessionRef.current = {
          lastDist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
          lastMidX: (pts[0].x + pts[1].x) / 2,
          lastMidY: (pts[0].y + pts[1].y) / 2,
        };
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
      if (e.touches.length >= 2 && touchPointersRef.current.size < 2) {
        setPinchState(true, e.touches.length);
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        pinchSessionRef.current = {
          lastDist: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
          lastMidX: (t0.clientX + t1.clientX) / 2,
          lastMidY: (t0.clientY + t1.clientY) / 2,
        };
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
        pinchSessionRef.current = null;
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
    const centerOffset = el.scrollTop + el.clientHeight * 0.35;
    const items = virtualizer.getVirtualItems();
    for (const item of items) {
      if (centerOffset >= item.start && centerOffset <= item.end) {
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

  const handleLoadSample = async () => {
    const bytes = await generateSamplePdfBytes();
    await openPdfBytes('Sample-Architecture-Brief.pdf', bytes);
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
              Drop a PDF here to start editing
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              gullacpdf (GüllaçPdf) runs 100% client-side with WebAssembly. Edit existing PDF text
              in-place, manage images, place signatures/parafs, and organize pages privately.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
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
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((vItem) => {
            const page = pages[vItem.index];
            return (
              <div
                key={page.id}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vItem.start}px)`,
                }}
                className="flex justify-center py-5"
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
