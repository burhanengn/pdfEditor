import { describe, expect, it } from 'vitest';
import {
  computeCappedCanvasDpr,
  computePdfLibDrawPlacement,
  MAX_PDF_CANVAS_PIXELS,
  computeRotatedResizeCursor,
  computeRotatedResizeRect,
  computeViewportSurfaceMetrics,
  decomposeImageCtm,
  deltaDisplayToBase,
  findAnchorPageIndex,
  getDisplayDimensions,
  getPageOffsetInSurface,
  getRotatedBoundingBox,
  pointBaseToDisplay,
  pointBaseVisualToPdfUserSpace,
  pointDisplayToBase,
  pointInRotatedRect,
  rectBaseVisualToPdfUserSpace,
  resolveSmartHitAtPoint,
  VIEWPORT_PAGE_GAP,
} from '../coordinates';
import type {
  DetectedImageObject,
  DetectedTextBlock,
  DetectedVectorShape,
  RotationAngle,
} from '@/types/pdf';
import type { CanvasElement } from '@/types/elements';

describe('coordinates engine', () => {
  const baseWidth = 612;
  const baseHeight = 792;
  const rotations: RotationAngle[] = [0, 90, 180, 270];

  it.each(rotations)('round-trips pointBaseToDisplay <-> pointDisplayToBase at %i deg', (rot) => {
    const zoom = 1.75;
    const pts = [
      { x: 0, y: 0 },
      { x: 120.5, y: 340.25 },
      { x: baseWidth, y: baseHeight },
    ];
    for (const pt of pts) {
      const disp = pointBaseToDisplay(pt.x, pt.y, baseWidth, baseHeight, rot, zoom);
      const back = pointDisplayToBase(disp.x, disp.y, baseWidth, baseHeight, rot, zoom);
      expect(back.x).toBeCloseTo(pt.x, 6);
      expect(back.y).toBeCloseTo(pt.y, 6);
    }
  });

  it('swaps display dimensions on 90 and 270 degree rotations', () => {
    expect(getDisplayDimensions(612, 792, 0, 1)).toEqual({ width: 612, height: 792 });
    expect(getDisplayDimensions(612, 792, 90, 1)).toEqual({ width: 792, height: 612 });
    expect(getDisplayDimensions(612, 792, 180, 1)).toEqual({ width: 612, height: 792 });
    expect(getDisplayDimensions(612, 792, 270, 1)).toEqual({ width: 792, height: 612 });
  });

  it.each(rotations)('maps screen delta consistently at %i deg', (rot) => {
    const zoom = 2;
    const originDisp = pointBaseToDisplay(200, 300, baseWidth, baseHeight, rot, zoom);
    const movedDisp = { x: originDisp.x + 40, y: originDisp.y + 20 };
    const originBase = pointDisplayToBase(originDisp.x, originDisp.y, baseWidth, baseHeight, rot, zoom);
    const movedBase = pointDisplayToBase(movedDisp.x, movedDisp.y, baseWidth, baseHeight, rot, zoom);
    const delta = deltaDisplayToBase(40, 20, rot, zoom);
    expect(originBase.x + delta.x).toBeCloseTo(movedBase.x, 6);
    expect(originBase.y + delta.y).toBeCloseTo(movedBase.y, 6);
  });

  it('maps visual coordinates to raw PDF user space with CropBox offset', () => {
    const cropBox: [number, number, number, number] = [10, 20, 622, 812];
    expect(pointBaseVisualToPdfUserSpace(0, 0, cropBox, 0)).toEqual({ x: 10, y: 812 });
    expect(pointBaseVisualToPdfUserSpace(100, 50, cropBox, 0)).toEqual({ x: 110, y: 762 });
    expect(rectBaseVisualToPdfUserSpace({ x: 10, y: 20, width: 100, height: 40 }, cropBox, 0)).toEqual([
      20, 752, 120, 792,
    ]);
  });

  it('computes pdf-lib placement cleanly across intrinsic rotations', () => {
    const cropBox: [number, number, number, number] = [0, 0, 612, 792];
    const p0 = computePdfLibDrawPlacement(
      { x: 50, y: 100, width: 200, height: 60 },
      0,
      { cropBox, intrinsicRotation: 0 },
    );
    expect(p0.x).toBeCloseTo(50, 5);
    expect(p0.y).toBeCloseTo(792 - 160, 5);
    expect(p0.rotateDegCCW).toBeCloseTo(0, 5);

    const p90 = computePdfLibDrawPlacement(
      { x: 50, y: 100, width: 200, height: 60 },
      0,
      { cropBox, intrinsicRotation: 90 },
    );
    expect(p90.rotateDegCCW).toBeCloseTo(90, 5);
  });

  it('computes rotated bounding box accurately', () => {
    const box = getRotatedBoundingBox({ x: 100, y: 100, width: 80, height: 40 }, 90);
    expect(box.width).toBeCloseTo(40, 5);
    expect(box.height).toBeCloseTo(80, 5);
    expect(box.x).toBeCloseTo(120, 5);
    expect(box.y).toBeCloseTo(80, 5);
  });

  it('computes dynamic resize cursors snapped to 45 deg for rotated handles', () => {
    expect(computeRotatedResizeCursor('nw', 0)).toBe('nw-resize');
    expect(computeRotatedResizeCursor('nw', 90)).toBe('ne-resize');
    expect(computeRotatedResizeCursor('e', 90)).toBe('s-resize');
    expect(computeRotatedResizeCursor('s', 180)).toBe('n-resize');
    expect(computeRotatedResizeCursor('n', 45)).toBe('ne-resize');
  });

  it('resizes rotated boxes in local space while anchoring the opposite edge', () => {
    // Box rotated 90 deg CW: dragging screen 'down' (dyPx = 20)
    // extends local 'e' right edge along +localX (+20) while shifting center by +10 down.
    const resized = computeRotatedResizeRect({
      startRect: { x: 100, y: 100, width: 80, height: 40 },
      handle: 'e',
      dxPx: 0,
      dyPx: 20,
      frameRotationDeg: 90,
      userRotation: 0,
      zoom: 1,
      aspectLocked: false,
    });
    expect(resized.width).toBeCloseTo(100, 4);
    expect(resized.height).toBeCloseTo(40, 4);
  });

  it('decomposes PDF.js viewport image CTM negative scales into flipX/flipY', () => {
    // Normal upright image in PDF.js viewport (Y-down): [w, 0, 0, -h, x, bottom]
    const upright = decomposeImageCtm([120, 0, 0, -80, 100, 180]);
    expect(upright.flipX).toBe(false);
    expect(upright.flipY).toBe(false);
    expect(upright.rotation).toBeCloseTo(0, 4);

    // Horizontally mirrored image in PDF.js viewport: a = -120, d = -80
    const fx = decomposeImageCtm([-120, 0, 0, -80, 220, 180]);
    expect(fx.flipX).toBe(true);
    expect(fx.flipY).toBe(false);
    expect(fx.rotation).toBeCloseTo(0, 4);
    expect(fx.width).toBeCloseTo(120, 5);
    expect(fx.height).toBeCloseTo(80, 5);

    // Vertically mirrored image in PDF.js viewport: a = 120, d = +80
    const fy = decomposeImageCtm([120, 0, 0, 80, 100, 100]);
    expect(fy.flipX).toBe(false);
    expect(fy.flipY).toBe(true);
    expect(fy.rotation).toBeCloseTo(0, 4);
    expect(pointInRotatedRect(140, 120, { x: 100, y: 100, width: 80, height: 40 }, 45)).toBe(true);
  });

  it('guarantees non-negative 4-edge overscroll surface bounds at 300%-500% zoom on mobile viewports', () => {
    const pages = [
      { baseWidth: 595, baseHeight: 842, userRotation: 0 as RotationAngle },
      { baseWidth: 595, baseHeight: 842, userRotation: 0 as RotationAngle },
    ];
    for (const vp of [
      { w: 375, h: 812 },
      { w: 390, h: 844 },
    ]) {
      for (const z of [3.0, 5.0]) {
        const metrics = computeViewportSurfaceMetrics(pages, vp.w, vp.h, z, true);
        expect(metrics.viewportMarginX).toBeGreaterThanOrEqual(48);
        expect(metrics.viewportMarginY).toBeGreaterThanOrEqual(140);
        expect(metrics.surfaceWidth).toBeGreaterThanOrEqual(595 * z + metrics.viewportMarginX * 2);

        const p0 = getPageOffsetInSurface(pages, 0, z, metrics);
        expect(p0.left).toBeGreaterThanOrEqual(metrics.viewportMarginX);
        expect(p0.top).toBe(metrics.viewportMarginY + VIEWPORT_PAGE_GAP / 2);
        // Panning to scrollLeft=0 keeps left margin visible, panning to maxScrollLeft keeps right margin visible
        const maxScrollLeft = metrics.surfaceWidth - vp.w;
        expect(p0.left + p0.width - maxScrollLeft).toBeLessThanOrEqual(vp.w - metrics.viewportMarginX);
      }
    }
  });

  it('maintains sub-pixel pinch focal-point invariance across multi-page zoom transitions', () => {
    const pages = [
      { baseWidth: 612, baseHeight: 792, userRotation: 0 as RotationAngle },
      { baseWidth: 612, baseHeight: 792, userRotation: 90 as RotationAngle },
    ];
    const vpW = 390;
    const vpH = 740;
    const z0 = 1.0;
    const m0 = computeViewportSurfaceMetrics(pages, vpW, vpH, z0, true);
    const initialScrollLeft = 80;
    const initialScrollTop = 920;
    const relX = 195;
    const relY = 380;

    const anchorIdx = findAnchorPageIndex(pages, initialScrollTop, relY, z0, m0, 0);
    expect(anchorIdx).toBe(1);

    const o0 = getPageOffsetInSurface(pages, anchorIdx, z0, m0);
    const pdfLocalX = (initialScrollLeft + relX - o0.left) / z0;
    const pdfLocalY = (initialScrollTop + relY - o0.top) / z0;

    for (const z1 of [1.85, 3.0, 5.0, 0.75]) {
      const m1 = computeViewportSurfaceMetrics(pages, vpW, vpH, z1, true);
      const o1 = getPageOffsetInSurface(pages, anchorIdx, z1, m1);
      const scrollLeft1 = Math.max(0, o1.left + pdfLocalX * z1 - relX);
      const scrollTop1 = Math.max(0, o1.top + pdfLocalY * z1 - relY);

      const recomputedLocalX = (scrollLeft1 + relX - o1.left) / z1;
      const recomputedLocalY = (scrollTop1 + relY - o1.top) / z1;
      expect(Math.abs((recomputedLocalX - pdfLocalX) * z1)).toBeLessThan(0.01);
      expect(Math.abs((recomputedLocalY - pdfLocalY) * z1)).toBeLessThan(0.01);
    }
  });

  it('prioritizes foreground text within coarse tolerance and isolates background images via resolveSmartHitAtPoint', () => {
    const bgDetected: DetectedImageObject = {
      id: 'bg_scan',
      pageId: 'p1',
      resourceName: '/Im0',
      operatorIndex: 1,
      x: 0,
      y: 0,
      width: 595,
      height: 842,
      rotation: 0,
      pixelWidth: 595,
      pixelHeight: 842,
      previewUrl: 'blob:scan',
      pngBytes: new Uint8Array([1]),
      isBackgroundLayer: true,
    };
    const textBlock: DetectedTextBlock = {
      id: 'tb_1',
      pageId: 'p1',
      text: 'Selectable Text Over Scan',
      x: 100,
      y: 200,
      width: 180,
      height: 16,
      fontSize: 12,
      fontFamily: 'Helvetica',
      rawFontName: 'Helvetica',
      bold: false,
      italic: false,
      color: '#000000',
      lineHeight: 1.2,
      baselineOffset: 10,
    };

    // Tap 4px above the text block on coarse touch at 1x zoom -> Tier 3 text wins over full-page scan
    const coarseHit = resolveSmartHitAtPoint({
      point: { x: 150, y: 196 },
      zoom: 1,
      isCoarsePointer: true,
      selectBackgroundMode: false,
      elements: [],
      detectedTextBlocks: [textBlock],
      detectedImages: [bgDetected],
      replacedBlockIds: new Set(),
      replacedImageIds: new Set(),
    });
    expect(coarseHit?.kind).toBe('detected-text');

    // Promoted background image element with bgGuardPt (8px) proximity guard still yields to foreground text
    const bgPromoted: CanvasElement = {
      id: 'el_bg',
      pageId: 'p1',
      kind: 'image-replacement',
      originalImageId: 'bg_scan',
      resourceName: '/Im0',
      originalRect: { x: 0, y: 0, width: 595, height: 842 },
      name: 'Scan',
      mimeType: 'image/png',
      bytes: new Uint8Array([1]),
      previewUrl: 'blob:scan',
      x: 0,
      y: 0,
      width: 595,
      height: 842,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      naturalWidth: 595,
      naturalHeight: 842,
      aspectLocked: true,
      behindContent: true,
      isBackgroundLayer: true,
    };
    const guardedHit = resolveSmartHitAtPoint({
      point: { x: 150, y: 193 }, // 7px away -> inside 8px bgGuardPt
      zoom: 1,
      isCoarsePointer: true,
      selectBackgroundMode: false,
      elements: [bgPromoted],
      detectedTextBlocks: [textBlock],
      detectedImages: [bgDetected],
      replacedBlockIds: new Set(),
      replacedImageIds: new Set(['bg_scan']),
    });
    expect(guardedHit?.kind).toBe('detected-text');

    // Open area far from text selects promoted background element unless locked
    const openBgHit = resolveSmartHitAtPoint({
      point: { x: 450, y: 600 },
      zoom: 1,
      isCoarsePointer: false,
      selectBackgroundMode: false,
      elements: [bgPromoted],
      detectedTextBlocks: [textBlock],
      detectedImages: [bgDetected],
      replacedBlockIds: new Set(),
      replacedImageIds: new Set(['bg_scan']),
    });
    expect(openBgHit?.kind).toBe('background-element');

    // Explicit selectBackgroundMode=true or altKey targets background immediately
    const explicitHit = resolveSmartHitAtPoint({
      point: { x: 150, y: 205 },
      zoom: 1,
      isCoarsePointer: false,
      selectBackgroundMode: true,
      elements: [bgPromoted],
      detectedTextBlocks: [textBlock],
      detectedImages: [bgDetected],
      replacedBlockIds: new Set(),
      replacedImageIds: new Set(['bg_scan']),
    });
    expect(explicitHit?.kind).toBe('background-element');
  });

  it('caps high-DPI canvas pixel area <= 12.5M pixels at 500% zoom on Retina displays', () => {
    // A4 portrait at 500% zoom with devicePixelRatio=3
    const cssWidth = 595 * 5;
    const cssHeight = 842 * 5;
    const safeDpr = computeCappedCanvasDpr(cssWidth, cssHeight, 3);
    const totalPixels = Math.round(cssWidth * safeDpr) * Math.round(cssHeight * safeDpr);
    expect(safeDpr).toBeGreaterThanOrEqual(1);
    expect(safeDpr).toBeLessThan(3);
    expect(totalPixels).toBeLessThanOrEqual(MAX_PDF_CANVAS_PIXELS + 50_000);
    expect(totalPixels).toBeLessThan(16_777_216);

    // Normal 100% zoom retains full Retina dpr=3
    expect(computeCappedCanvasDpr(595, 842, 3)).toBe(3);
  });

  it('keeps foreground text priority over behind-content vector banners while allowing open-area & explicit selection', () => {
    const bannerShape: DetectedVectorShape = {
      id: 'shp_banner',
      pageId: 'p1',
      operatorIndex: 7,
      x: 48,
      y: 38,
      width: 516,
      height: 54,
      fillColor: '#142447',
      strokeColor: null,
      strokeWidth: 0,
      opacity: 1,
      behindContent: true,
      isHeaderOrBackground: true,
      isBackgroundLayer: true,
    };
    const titleBlock: DetectedTextBlock = {
      id: 'txt_title',
      pageId: 'p1',
      text: 'Q4 Product Architecture Brief',
      x: 64,
      y: 50,
      width: 280,
      height: 26,
      fontSize: 22,
      fontFamily: 'Helvetica',
      rawFontName: 'Helvetica-Bold',
      bold: true,
      italic: false,
      color: '#ffffff',
      lineHeight: 1.2,
      baselineOffset: 20,
    };

    // Clicking text over banner must select text
    const onText = resolveSmartHitAtPoint({
      point: { x: 140, y: 63 },
      zoom: 1,
      isCoarsePointer: true,
      selectBackgroundMode: false,
      elements: [],
      detectedTextBlocks: [titleBlock],
      detectedImages: [],
      detectedShapes: [bannerShape],
      replacedBlockIds: new Set(),
      replacedImageIds: new Set(),
      replacedShapeIds: new Set(),
    });
    expect(onText?.kind).toBe('detected-text');

    // Coarse tap within 6px of title text edge still prefers text due to proximity guard
    const nearText = resolveSmartHitAtPoint({
      point: { x: 350, y: 63 },
      zoom: 1,
      isCoarsePointer: true,
      selectBackgroundMode: false,
      elements: [],
      detectedTextBlocks: [titleBlock],
      detectedImages: [],
      detectedShapes: [bannerShape],
      replacedBlockIds: new Set(),
      replacedImageIds: new Set(),
      replacedShapeIds: new Set(),
    });
    expect(nearText?.kind).toBe('detected-text');

    // Tapping open navy area far from title selects the background vector shape
    const openBanner = resolveSmartHitAtPoint({
      point: { x: 500, y: 63 },
      zoom: 1,
      isCoarsePointer: true,
      selectBackgroundMode: false,
      elements: [],
      detectedTextBlocks: [titleBlock],
      detectedImages: [],
      detectedShapes: [bannerShape],
      replacedBlockIds: new Set(),
      replacedImageIds: new Set(),
      replacedShapeIds: new Set(),
    });
    expect(openBanner?.kind).toBe('background-detected-shape');

    // Explicit selectBackgroundMode selects background shape even directly over text
    const bgModeHit = resolveSmartHitAtPoint({
      point: { x: 140, y: 63 },
      zoom: 1,
      isCoarsePointer: false,
      selectBackgroundMode: true,
      elements: [],
      detectedTextBlocks: [titleBlock],
      detectedImages: [],
      detectedShapes: [bannerShape],
      replacedBlockIds: new Set(),
      replacedImageIds: new Set(),
      replacedShapeIds: new Set(),
    });
    expect(bgModeHit?.kind).toBe('background-detected-shape');
  });
});
