import { useEffect, useRef } from 'react';
import type { PageMeta } from '@/types/pdf';
import { getDisplayDimensions } from '@/engine/coordinates';
import {
  buildTileCacheKey,
  getScaleBucket,
  pdfiumScheduler,
  RenderPriority,
} from '@/engine/pdfium/renderScheduler';
import { viewerTileCache } from '@/engine/pdfium/tileCache';
import { perfMetrics } from '@/engine/perfMetrics';
import { useEditorStore } from '@/store/useEditorStore';
import { useViewerStore } from '@/store/useViewerStore';

const TILE_CSS_PX = 512;
const PREVIEW_MAX_SCALE = 0.38;

interface TileLayerProps {
  page: PageMeta;
  pageIndex: number;
  zoom: number;
  activeDocId: string;
  activeDocPageIndex: number;
  stripKey: string;
  transparentBg: boolean;
  scrollElementRef?: React.RefObject<HTMLElement | null>;
  onFirstPaint?: () => void;
}

export function TileLayer({
  page,
  pageIndex,
  zoom,
  activeDocId,
  activeDocPageIndex,
  stripKey,
  transparentBg,
  scrollElementRef,
  onFirstPaint,
}: TileLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceByteLength = useEditorStore((s) => s.sourceDocs[page.sourceDocId]?.byteLength ?? 0);
  const isPinching = useEditorStore((s) => s.isPinching);
  const readingTheme = useViewerStore((s) => s.readingTheme);
  const darkPaperInvert = useViewerStore((s) => s.darkPaperInvert);
  const fastScrolling = useViewerStore((s) => s.fastScrolling);
  const docRevision = useViewerStore((s) => s.docRevision);
  const pageRevision = useViewerStore((s) => s.pageRevisions[page.id] ?? 0);

  const appMode = useEditorStore((s) => s.appMode);
  // Paper always stays true-color in Editor mode (02 §2.2)
  const effectiveTheme = appMode === 'edit' ? 'light' : readingTheme;
  const effectiveDarkInvert = appMode === 'edit' ? false : darkPaperInvert;

  const dims = getDisplayDimensions(page.baseWidth, page.baseHeight, page.userRotation, zoom);
  const rawDpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
  const cssW = Math.max(1, Math.round(dims.width));
  const cssH = Math.max(1, Math.round(dims.height));
  const MAX_CANVAS_PIXELS = 12_800_000;
  const rawPixels = cssW * rawDpr * cssH * rawDpr;
  const clamped = rawPixels > MAX_CANVAS_PIXELS;
  const dpr = clamped
    ? Math.max(0.25, rawDpr * Math.sqrt(MAX_CANVAS_PIXELS / rawPixels))
    : rawDpr;
  const targetPxW = Math.max(1, clamped ? Math.floor(cssW * dpr) : Math.round(cssW * dpr));
  const targetPxH = Math.max(1, clamped ? Math.floor(cssH * dpr) : Math.round(cssH * dpr));

  const lastSurfaceKeyRef = useRef<string>('');
  const activeHandlesRef = useRef<Array<{ cancel: () => void }>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceByteLength) return;

    // Resize canvas only when target pixel buffer dims actually change (prevents flicker & wipes)
    if (canvas.width !== targetPxW || canvas.height !== targetPxH) {
      canvas.width = targetPxW;
      canvas.height = targetPxH;
    }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const surfaceKey = `${activeDocId}:${activeDocPageIndex}:${stripKey}:${page.userRotation}:${effectiveTheme}:${effectiveDarkInvert ? 1 : 0}`;
    const isContentSwap = lastSurfaceKeyRef.current !== surfaceKey;
    lastSurfaceKeyRef.current = surfaceKey;

    const scaleBucket = getScaleBucket(zoom, dpr);
    viewerTileCache.setActiveContext(pageIndex, scaleBucket);

    // 1. Draw cached preview immediately if available while crisp tiles stream in
    const prevScale = Math.min(PREVIEW_MAX_SCALE, Math.max(0.2, zoom * 0.5));
    const previewBucket = getScaleBucket(prevScale, 1);
    const previewKey = buildTileCacheKey({
      docRev: docRevision,
      pageId: page.id,
      pageRev: pageRevision,
      scaleBucket: previewBucket,
      tx: 0,
      ty: 0,
      theme: effectiveTheme,
      darkInvert: effectiveDarkInvert,
      rotation: page.userRotation,
      isPreview: true,
    }) + (stripKey ? `:${stripKey}` : '');

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const cachedPreview = viewerTileCache.get(previewKey);
    if (cachedPreview && (isContentSwap || true)) {
      ctx.clearRect(0, 0, targetPxW, targetPxH);
      ctx.drawImage(cachedPreview.bitmap, 0, 0, targetPxW, targetPxH);
    }

    const cancelPending = () => {
      for (const h of activeHandlesRef.current) {
        h.cancel();
      }
      activeHandlesRef.current = [];
    };

    if (!cachedPreview) {
      const baseDims = getDisplayDimensions(
        page.baseWidth,
        page.baseHeight,
        page.userRotation,
        prevScale,
      );
      const pw = Math.max(1, Math.round(baseDims.width));
      const ph = Math.max(1, Math.round(baseDims.height));

      const prevHandle = pdfiumScheduler.scheduleTileRender({
        key: previewKey,
        priority: RenderPriority.VISIBLE_PREVIEW,
        pageId: page.id,
        pageIndex,
        scaleBucket: previewBucket,
        isPreview: true,
        request: {
          sourceDocId: activeDocId,
          pageIndex: activeDocPageIndex,
          tileX: 0,
          tileY: 0,
          tileWidthPx: pw,
          tileHeightPx: ph,
          scale: prevScale,
          userRotation: page.userRotation,
          transparentBg,
          theme: effectiveTheme,
          darkPaperInvert: effectiveDarkInvert,
        },
      });
      activeHandlesRef.current.push(prevHandle);

      prevHandle.promise
        .then((bitmap) => {
          const c = canvasRef.current;
          const cCtx = c?.getContext('2d', { alpha: true });
          if (!c || !cCtx) return;
          // Draw preview softly only if crisp tiles haven't filled yet
          cCtx.drawImage(bitmap, 0, 0, targetPxW, targetPxH);
          if (pageIndex === 0) {
            perfMetrics.recordFirstPagePainted();
          }
          onFirstPaint?.();
        })
        .catch(() => {});
    }

    // Defer crisp tile requests during active pinch or ultra-fast scroll (01 §6.3)
    if (isPinching || fastScrolling) {
      return cancelPending;
    }

    const renderVisibleTiles = () => {
      const c = canvasRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const vpRect = scrollElementRef?.current?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
        right: typeof window !== 'undefined' ? window.innerWidth : 1440,
        bottom: typeof window !== 'undefined' ? window.innerHeight : 900,
      };

      const visLeft = Math.max(0, vpRect.left - rect.left - 128);
      const visTop = Math.max(0, vpRect.top - rect.top - 128);
      const visRight = Math.min(cssW, vpRect.right - rect.left + 128);
      const visBottom = Math.min(cssH, vpRect.bottom - rect.top + 128);

      if (visRight <= visLeft || visBottom <= visTop) {
        return;
      }

      const startTx = Math.max(0, Math.floor(visLeft / TILE_CSS_PX));
      const endTx = Math.min(Math.ceil(cssW / TILE_CSS_PX) - 1, Math.floor(visRight / TILE_CSS_PX));
      const startTy = Math.max(0, Math.floor(visTop / TILE_CSS_PX));
      const endTy = Math.min(Math.ceil(cssH / TILE_CSS_PX) - 1, Math.floor(visBottom / TILE_CSS_PX));

      for (let ty = startTy; ty <= endTy; ty++) {
        for (let tx = startTx; tx <= endTx; tx++) {
          const tileCssX = tx * TILE_CSS_PX;
          const tileCssY = ty * TILE_CSS_PX;
          const tileCssW = Math.min(TILE_CSS_PX, cssW - tileCssX);
          const tileCssH = Math.min(TILE_CSS_PX, cssH - tileCssY);
          const tilePxX = Math.round(tileCssX * dpr);
          const tilePxY = Math.round(tileCssY * dpr);
          const tilePxW = Math.max(1, Math.round(tileCssW * dpr));
          const tilePxH = Math.max(1, Math.round(tileCssH * dpr));

          const tileKey =
            buildTileCacheKey({
              docRev: docRevision,
              pageId: page.id,
              pageRev: pageRevision,
              scaleBucket,
              tx,
              ty,
              theme: effectiveTheme,
              darkInvert: effectiveDarkInvert,
              rotation: page.userRotation,
              isPreview: false,
            }) + (stripKey ? `:${stripKey}` : '');

          const cachedTile = viewerTileCache.get(tileKey);
          if (cachedTile) {
            ctx.clearRect(tilePxX, tilePxY, tilePxW, tilePxH);
            ctx.drawImage(cachedTile.bitmap, tilePxX, tilePxY, tilePxW, tilePxH);
            if (pageIndex === 0) {
              perfMetrics.recordFirstPagePainted();
            }
            onFirstPaint?.();
            continue;
          }

          const handle = pdfiumScheduler.scheduleTileRender({
            key: tileKey,
            priority: RenderPriority.VISIBLE_TILE,
            pageId: page.id,
            pageIndex,
            scaleBucket,
            isPreview: false,
            request: {
              sourceDocId: activeDocId,
              pageIndex: activeDocPageIndex,
              tileX: tilePxX,
              tileY: tilePxY,
              tileWidthPx: tilePxW,
              tileHeightPx: tilePxH,
              scale: zoom * dpr,
              userRotation: page.userRotation,
              transparentBg,
              theme: effectiveTheme,
              darkPaperInvert: effectiveDarkInvert,
            },
          });
          activeHandlesRef.current.push(handle);

          handle.promise
            .then((bitmap) => {
              const targetCanvas = canvasRef.current;
              const targetCtx = targetCanvas?.getContext('2d', { alpha: true });
              if (!targetCanvas || !targetCtx) return;
              targetCtx.clearRect(tilePxX, tilePxY, tilePxW, tilePxH);
              targetCtx.drawImage(bitmap, tilePxX, tilePxY, tilePxW, tilePxH);
              if (pageIndex === 0) {
                perfMetrics.recordFirstPagePainted();
              }
              onFirstPaint?.();
            })
            .catch(() => {});
        }
      }
    };

    const rafId = requestAnimationFrame(renderVisibleTiles);
    const scroller = scrollElementRef?.current;
    let scrollTimer: number | null = null;
    const onScrollUpdate = () => {
      if (scrollTimer !== null) return;
      scrollTimer = window.setTimeout(() => {
        scrollTimer = null;
        renderVisibleTiles();
      }, 32);
    };
    scroller?.addEventListener('scroll', onScrollUpdate, { passive: true });

    return () => {
      cancelAnimationFrame(rafId);
      if (scrollTimer !== null) window.clearTimeout(scrollTimer);
      scroller?.removeEventListener('scroll', onScrollUpdate);
      cancelPending();
    };
  }, [
    page.id,
    page.baseWidth,
    page.baseHeight,
    page.userRotation,
    pageIndex,
    activeDocId,
    activeDocPageIndex,
    stripKey,
    transparentBg,
    zoom,
    dpr,
    cssW,
    cssH,
    targetPxW,
    targetPxH,
    sourceByteLength,
    isPinching,
    fastScrolling,
    effectiveTheme,
    effectiveDarkInvert,
    docRevision,
    pageRevision,
    scrollElementRef,
    onFirstPaint,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none block"
      style={{ width: `${cssW}px`, height: `${cssH}px` }}
    />
  );
}
