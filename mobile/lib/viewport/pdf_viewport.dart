import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../app/session_state.dart';
import '../engine/session_bridge.dart';
import '../engine/tile_cache.dart';
import '../gestures/pdf_gesture_arena.dart';
import '../theme/gp_tokens.g.dart';
import 'overlay_painter.dart';

const double gpViewportPageGap = 16.0;
const int gpTileLogicalSize = 256;

@immutable
class GpViewportAnchor {
  const GpViewportAnchor({
    required this.pageIndex,
    required this.pageOffsetRatioY,
    required this.scrollXRatio,
    required this.zoom,
  });

  final int pageIndex;
  final double pageOffsetRatioY;
  final double scrollXRatio;
  final double zoom;
}

class GpPageLayoutRect {
  const GpPageLayoutRect({
    required this.pageIndex,
    required this.page,
    required this.rectSurface,
  });

  final int pageIndex;
  final GpPageMeta page;
  final Rect rectSurface;
}

class GpRenderedBucket {
  const GpRenderedBucket({
    required this.scaleBucket,
    required this.tileZoom,
    required this.totalPageWpx,
    required this.totalPageHpx,
  });

  final String scaleBucket;
  final double tileZoom;
  final int totalPageWpx;
  final int totalPageHpx;
}

class GpViewportController extends ChangeNotifier {
  double zoom = 1.0;
  double fitWidthZoom = 1.0;
  Offset scrollOffset = Offset.zero;
  Size viewportSize = Size.zero;

  final ValueNotifier<int> activePageNotifier = ValueNotifier<int>(0);
  final ValueNotifier<double> zoomNotifier = ValueNotifier<double>(1.0);
  final Map<String, List<GpRenderedBucket>> readyBucketsByPage = {};

  String? fittedDocId;
  bool isPinching = false;
  String? activeRenderBucket;
  int scheduleEpoch = 0;

  List<Offset> _liveDraftStrokeScreen = const [];
  double _liveStrokeWidth = 2.5;
  Color _liveStrokeColor = const Color(0xFF1D4ED8);
  GpSnapGuideLines? snapGuides;
  GpDraftShapePreview? draftShapePreview;

  List<Offset> get liveDraftStrokeScreen => _liveDraftStrokeScreen;
  double get liveStrokeWidth => _liveStrokeWidth;
  Color get liveStrokeColor => _liveStrokeColor;

  void setSnapGuides(GpSnapGuideLines? guides) {
    snapGuides = guides;
    notifyListeners();
  }

  void setDraftShapePreview(GpDraftShapePreview? preview) {
    draftShapePreview = preview;
    notifyListeners();
  }

  static double quantizeTileZoom(double rawZoom, double fitWidth) {
    if (fitWidth > 0 && (rawZoom - fitWidth).abs() <= 0.03) {
      return fitWidth;
    }
    final q = (rawZoom * 4.0).round() / 4.0;
    return q.clamp(GpGestureConstants.minZoom, GpGestureConstants.maxZoom);
  }

  static String bucketForScale(double tileZoom) => tileZoom.toStringAsFixed(3);

  static String pageBucketKey(String docId, GpPageMeta page, String themeKey) =>
      '$docId:${page.sourcePageIndex}:${page.userRotation}:$themeKey';

  void recordReadyBucket(String pageKey, GpRenderedBucket bucket) {
    final list = readyBucketsByPage.putIfAbsent(pageKey, () => <GpRenderedBucket>[]);
    list.removeWhere((b) => b.scaleBucket == bucket.scaleBucket);
    list.insert(0, bucket);
    if (list.length > 3) {
      list.removeRange(3, list.length);
    }
    notifyListeners();
  }

  void setTransform({required double nextZoom, required Offset nextScroll, required double maxScrollX, required double maxScrollY}) {
    zoom = nextZoom.clamp(GpGestureConstants.minZoom, GpGestureConstants.maxZoom);
    scrollOffset = Offset(
      nextScroll.dx.clamp(0.0, math.max(0.0, maxScrollX)),
      nextScroll.dy.clamp(0.0, math.max(0.0, maxScrollY)),
    );
    zoomNotifier.value = zoom;
    notifyListeners();
  }

  void setDraftStroke(List<Offset> pts, {double width = 2.5, Color color = const Color(0xFF1D4ED8)}) {
    _liveDraftStrokeScreen = pts;
    _liveStrokeWidth = width;
    _liveStrokeColor = color;
    notifyListeners();
  }

  void clearDraftStroke() {
    if (_liveDraftStrokeScreen.isEmpty) return;
    _liveDraftStrokeScreen = const [];
    notifyListeners();
  }

  void markTilesDirty() => notifyListeners();

  @override
  void dispose() {
    activePageNotifier.dispose();
    zoomNotifier.dispose();
    super.dispose();
  }

  List<GpPageLayoutRect> computePageRects(List<GpPageMeta> pages, double targetZoom, double viewWidth) {
    final rects = <GpPageLayoutRect>[];
    var curY = gpViewportPageGap;
    for (var i = 0; i < pages.length; i++) {
      final p = pages[i];
      final w = p.displayWidth * targetZoom;
      final h = p.displayHeight * targetZoom;
      final x = math.max(gpViewportPageGap, (viewWidth - w) * 0.5);
      rects.add(GpPageLayoutRect(pageIndex: i, page: p, rectSurface: Rect.fromLTWH(x, curY, w, h)));
      curY += h + gpViewportPageGap;
    }
    return rects;
  }

  GpViewportAnchor? captureAnchor(List<GpPageMeta> pages) {
    if (pages.isEmpty) return null;
    final layouts = computePageRects(pages, zoom, viewportSize.width);
    final centerY = scrollOffset.dy + viewportSize.height * 0.35;
    var best = layouts.first;
    var bestDist = double.infinity;
    for (final l in layouts) {
      final dist = (centerY - l.rectSurface.center.dy).abs();
      if (dist < bestDist) {
        bestDist = dist;
        best = l;
      }
    }
    final relY = ((scrollOffset.dy - best.rectSurface.top) / best.rectSurface.height).clamp(-0.5, 1.5);
    final relX = (scrollOffset.dx / math.max(1.0, best.rectSurface.width)).clamp(0.0, 1.0);
    return GpViewportAnchor(
      pageIndex: best.pageIndex,
      pageOffsetRatioY: relY,
      scrollXRatio: relX,
      zoom: zoom,
    );
  }

  void restoreAnchor(GpViewportAnchor anchor, List<GpPageMeta> pages) {
    if (pages.isEmpty) return;
    final idx = anchor.pageIndex.clamp(0, pages.length - 1);
    zoom = anchor.zoom;
    zoomNotifier.value = zoom;
    activePageNotifier.value = idx;
    final layouts = computePageRects(pages, zoom, viewportSize.width);
    final target = layouts[idx];
    final nextY = target.rectSurface.top + anchor.pageOffsetRatioY * target.rectSurface.height;
    final nextX = anchor.scrollXRatio * target.rectSurface.width;
    scrollOffset = Offset(math.max(0.0, nextX), math.max(0.0, nextY));
    scheduleEpoch++;
    notifyListeners();
  }

  void scrollToPage(int pageIndex, List<GpPageMeta> pages) {
    if (pages.isEmpty) return;
    final idx = pageIndex.clamp(0, pages.length - 1);
    final layouts = computePageRects(pages, zoom, viewportSize.width);
    final totalH = layouts.last.rectSurface.bottom + gpViewportPageGap;
    final maxY = math.max(0.0, totalH - viewportSize.height);
    final targetY = (layouts[idx].rectSurface.top - gpViewportPageGap).clamp(0.0, maxY);
    scrollOffset = Offset(scrollOffset.dx, targetY);
    activePageNotifier.value = idx;
    scheduleEpoch++;
    notifyListeners();
  }
}

/// High-performance tiled `CustomPainter` PDF viewport with 3-layer fallback (skeleton -> preview -> 256x256 tiles),
/// separate `RepaintBoundary` overlay layer, custom gesture arena + inertia Ticker, & OS memory trim hook (04 §4.3-4.4).
class PdfViewport extends StatefulWidget {
  const PdfViewport({
    super.key,
    required this.appState,
    required this.bridge,
    required this.tileCache,
    required this.controller,
    required this.onPositionChanged,
    required this.onToggleImmersive,
    required this.onAddOverlayElement,
    required this.onSelectElement,
    required this.onEraseStrokeAt,
    this.onUpdateOverlayElement,
    this.onRequestEditPdfTextBlock,
    this.onPlaceGhostAt,
    this.onTapLink,
  });

  final GpAppState appState;
  final GpSessionBridge bridge;
  final GpTileCache tileCache;
  final GpViewportController controller;
  final void Function(int activePageIndex, double zoom) onPositionChanged;
  final VoidCallback onToggleImmersive;
  final void Function(GpOverlayElement el) onAddOverlayElement;
  final void Function(String? elementId) onSelectElement;
  final void Function(Offset surfacePt, int pageIndex) onEraseStrokeAt;
  final void Function(GpOverlayElement updated, {bool recordHistory})? onUpdateOverlayElement;
  final void Function(int pageIndex, GpDetectedTextBlock block)? onRequestEditPdfTextBlock;
  final void Function(int pageIndex, Offset pdfPt)? onPlaceGhostAt;
  final void Function(GpPageLink link)? onTapLink;

  @override
  State<PdfViewport> createState() => _PdfViewportState();
}

enum _ManipMode { none, move, resize, rotate, createShape, createLine }

class _PdfViewportState extends State<PdfViewport>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  final GpGestureController _gestures = GpGestureController();
  final GpElementImageCache _elementImageCache = GpElementImageCache();
  late final Ticker _inertiaTicker;
  Duration _lastTick = Duration.zero;
  Offset _inertiaVel = Offset.zero;

  final Set<GpTileKey> _inFlight = {};
  final List<Offset> _draftPointsPdf = [];
  int? _draftPageIndex;
  double _draftPressureSum = 0;
  bool _draftIsEraser = false;

  _ManipMode _manipMode = _ManipMode.none;
  int? _manipPointerId;
  Offset _manipStartScreen = Offset.zero;
  Offset _manipStartPdf = Offset.zero;
  int _manipPageIndex = -1;
  String _manipHandle = '';
  GpOverlayElement? _manipOriginEl;
  GpOverlayElement? _manipLatestEl;
  bool _manipDraggedPastSlop = false;

  Timer? _tileScheduleTimer;
  Timer? _parentSyncTimer;
  Timer? _singleTapTimer;
  int _lastObservedEpoch = -1;
  int _lastReportedPage = -1;
  double _lastReportedZoom = -1.0;
  DateTime? _lastTapTime;
  Offset? _lastTapPos;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _inertiaTicker = createTicker(_onInertiaTick);
    _lastObservedEpoch = widget.controller.scheduleEpoch;
    widget.controller.addListener(_onControllerTick);
  }

  @override
  void didUpdateWidget(covariant PdfViewport oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_onControllerTick);
      _lastObservedEpoch = widget.controller.scheduleEpoch;
      widget.controller.addListener(_onControllerTick);
    }
    if (oldWidget.appState.docId != widget.appState.docId ||
        oldWidget.appState.theme != widget.appState.theme ||
        oldWidget.appState.darkPaperInvert != widget.appState.darkPaperInvert ||
        oldWidget.appState.pages != widget.appState.pages) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _requestVisibleTilesThrottled(immediate: true);
      });
    }
  }

  void _onControllerTick() {
    if (_lastObservedEpoch != widget.controller.scheduleEpoch) {
      _lastObservedEpoch = widget.controller.scheduleEpoch;
      _syncActivePage(forceNotify: true);
      _requestVisibleTilesThrottled(immediate: true);
    }
  }

  @override
  void dispose() {
    _tileScheduleTimer?.cancel();
    _parentSyncTimer?.cancel();
    _singleTapTimer?.cancel();
    _elementImageCache.dispose();
    widget.controller.removeListener(_onControllerTick);
    WidgetsBinding.instance.removeObserver(this);
    _inertiaTicker.dispose();
    super.dispose();
  }

  @override
  void didHaveMemoryPressure() {
    // 04 §4.4: trim Dart GPU ui.Image cache AND Rust PDFium tile cache immediately under OS pressure
    widget.tileCache.trim(critical: true);
    unawaited(widget.bridge.trimEngineMemory(8 * 1024 * 1024));
    if (mounted) setState(() {});
  }

  void _onInertiaTick(Duration elapsed) {
    if (_lastTick == Duration.zero) {
      _lastTick = elapsed;
      return;
    }
    final dtMs = (elapsed - _lastTick).inMicroseconds / 1000.0;
    _lastTick = elapsed;
    if (dtMs <= 0) return;

    final decay = math.exp(-dtMs / GpGestureConstants.inertiaDecayTauMs);
    _inertiaVel = Offset(_inertiaVel.dx * decay, _inertiaVel.dy * decay);
    if (_inertiaVel.distance < 15.0) {
      _stopInertia();
      _syncActivePage(forceNotify: true);
      _requestVisibleTilesThrottled(immediate: true);
      return;
    }

    final dtSec = dtMs / 1000.0;
    final bounds = _computeScrollBounds(widget.controller.zoom);
    final nextScroll = widget.controller.scrollOffset + _inertiaVel * dtSec;
    widget.controller.setTransform(
      nextZoom: widget.controller.zoom,
      nextScroll: nextScroll,
      maxScrollX: bounds.dx,
      maxScrollY: bounds.dy,
    );
    _syncActivePage();
    _requestVisibleTilesThrottled();
  }

  void _stopInertia() {
    if (_inertiaTicker.isActive) _inertiaTicker.stop();
    _lastTick = Duration.zero;
    _inertiaVel = Offset.zero;
  }

  void _startInertia(Offset vel) {
    _stopInertia();
    _inertiaVel = vel;
    _inertiaTicker.start();
  }

  Offset _computeScrollBounds(double targetZoom) {
    final layouts = widget.controller.computePageRects(
      widget.appState.pages,
      targetZoom,
      widget.controller.viewportSize.width,
    );
    if (layouts.isEmpty) return Offset.zero;
    final totalH = layouts.last.rectSurface.bottom + gpViewportPageGap;
    var maxW = 0.0;
    for (final l in layouts) {
      maxW = math.max(maxW, l.rectSurface.right + gpViewportPageGap);
    }
    return Offset(
      math.max(0.0, maxW - widget.controller.viewportSize.width),
      math.max(0.0, totalH - widget.controller.viewportSize.height),
    );
  }

  void _syncActivePage({bool forceNotify = false}) {
    final pages = widget.appState.pages;
    if (pages.isEmpty) return;
    final layouts = widget.controller.computePageRects(
      pages,
      widget.controller.zoom,
      widget.controller.viewportSize.width,
    );
    final centerY = widget.controller.scrollOffset.dy + widget.controller.viewportSize.height * 0.4;
    var bestIdx = 0;
    var bestDist = double.infinity;
    for (final l in layouts) {
      final d = (l.rectSurface.center.dy - centerY).abs();
      if (d < bestDist) {
        bestDist = d;
        bestIdx = l.pageIndex;
      }
    }
    widget.tileCache.activePageIndex = bestIdx;
    widget.controller.activePageNotifier.value = bestIdx;
    widget.controller.zoomNotifier.value = widget.controller.zoom;

    if (forceNotify || bestIdx != _lastReportedPage) {
      _parentSyncTimer?.cancel();
      _lastReportedPage = bestIdx;
      _lastReportedZoom = widget.controller.zoom;
      widget.onPositionChanged(bestIdx, widget.controller.zoom);
    } else if ((widget.controller.zoom - _lastReportedZoom).abs() > 0.01) {
      _parentSyncTimer?.cancel();
      _parentSyncTimer = Timer(const Duration(milliseconds: 180), () {
        if (!mounted) return;
        _lastReportedPage = bestIdx;
        _lastReportedZoom = widget.controller.zoom;
        widget.onPositionChanged(bestIdx, widget.controller.zoom);
      });
    }
  }

  void _requestVisibleTilesThrottled({bool immediate = false}) {
    if (immediate) {
      _tileScheduleTimer?.cancel();
      _tileScheduleTimer = null;
      _scheduleVisibleTiles();
      return;
    }
    if (_tileScheduleTimer != null && _tileScheduleTimer!.isActive) return;
    _tileScheduleTimer = Timer(const Duration(milliseconds: 48), () {
      _tileScheduleTimer = null;
      if (mounted) _scheduleVisibleTiles();
    });
  }

  void _scheduleVisibleTiles() {
    final docId = widget.appState.docId;
    final pages = widget.appState.pages;
    if (docId == null || pages.isEmpty || widget.controller.viewportSize.isEmpty) return;

    final dpr = MediaQuery.devicePixelRatioOf(context).clamp(1.0, 3.0);
    final zoom = widget.controller.zoom;
    final tileZoom = GpViewportController.quantizeTileZoom(
      zoom,
      widget.controller.fitWidthZoom,
    );
    final scaleBucket = GpViewportController.bucketForScale(tileZoom);
    final themeKey = widget.appState.theme.name;
    final layouts = widget.controller.computePageRects(
      pages,
      zoom,
      widget.controller.viewportSize.width,
    );
    final visibleRect = widget.controller.scrollOffset & widget.controller.viewportSize;

    // Cancel stale sharp-zoom render queue items when bucket changed outside pinch.
    if (!widget.controller.isPinching &&
        widget.controller.activeRenderBucket != null &&
        widget.controller.activeRenderBucket != scaleBucket) {
      unawaited(widget.bridge.cancelRenderScope('zoom:${widget.controller.activeRenderBucket}'));
    }
    if (!widget.controller.isPinching) {
      widget.controller.activeRenderBucket = scaleBucket;
    }

    int? firstVisibleIdx;
    int? lastVisibleIdx;

    for (final layout in layouts) {
      if (!layout.rectSurface.overlaps(visibleRect)) continue;
      firstVisibleIdx ??= layout.pageIndex;
      lastVisibleIdx = layout.pageIndex;
      final page = layout.page;
      final cleanDocId = widget.appState.cleanPreviewDocIds[page.id];
      final effectiveDocId = cleanDocId ?? docId;
      final effectivePageIdx = cleanDocId != null ? 0 : page.sourcePageIndex;

      // Always ensure a 0.35x quick page preview exists immediately.
      final previewKey = GpTileKey(
        docId: effectiveDocId,
        pageIndex: effectivePageIdx,
        tileX: 0,
        tileY: 0,
        scaleBucket: 'preview',
        rotation: page.userRotation,
        themeKey: themeKey,
        isPreview: true,
      );
      if (!widget.tileCache.contains(previewKey) && !_inFlight.contains(previewKey)) {
        final pw = math.max(120, (page.displayWidth * 0.35).round());
        final ph = math.max(160, (page.displayHeight * 0.35).round());
        _fetchTile(
          key: previewKey,
          scale: 0.35,
          tileWidthPx: pw,
          tileHeightPx: ph,
          priorityTier: 1,
          scope: 'preview:$docId',
        );
      }

      // During active pinch-zoom, hold new sharp tile allocation and let GPU stretch cached tiles at 60fps.
      if (widget.controller.isPinching) continue;

      // Request sharp 256×256 logical px tiles covering only visible viewport intersections at quantized bucket.
      final totalPageWpx = math.max(1, (page.displayWidth * tileZoom * dpr).round());
      final totalPageHpx = math.max(1, (page.displayHeight * tileZoom * dpr).round());
      final tileStepPx = (gpTileLogicalSize * dpr).round();
      final renderScale = totalPageWpx / page.displayWidth;
      final bucketMeta = GpRenderedBucket(
        scaleBucket: scaleBucket,
        tileZoom: tileZoom,
        totalPageWpx: totalPageWpx,
        totalPageHpx: totalPageHpx,
      );
      final pageBucketKey = '$effectiveDocId:$effectivePageIdx:${page.userRotation}:$themeKey';

      final visLeftRatio = ((visibleRect.left - layout.rectSurface.left) / math.max(1.0, layout.rectSurface.width))
          .clamp(0.0, 1.0);
      final visTopRatio = ((visibleRect.top - layout.rectSurface.top) / math.max(1.0, layout.rectSurface.height))
          .clamp(0.0, 1.0);
      final visRightRatio = ((visibleRect.right - layout.rectSurface.left) / math.max(1.0, layout.rectSurface.width))
          .clamp(0.0, 1.0);
      final visBottomRatio = ((visibleRect.bottom - layout.rectSurface.top) / math.max(1.0, layout.rectSurface.height))
          .clamp(0.0, 1.0);

      final colStart = ((visLeftRatio * totalPageWpx) / tileStepPx).floor();
      final colEnd = math.max(colStart, ((visRightRatio * totalPageWpx) / tileStepPx).floor());
      final rowStart = ((visTopRatio * totalPageHpx) / tileStepPx).floor();
      final rowEnd = math.max(rowStart, ((visBottomRatio * totalPageHpx) / tileStepPx).floor());

      for (var r = rowStart; r <= rowEnd; r++) {
        for (var c = colStart; c <= colEnd; c++) {
          final tx = c * tileStepPx;
          final ty = r * tileStepPx;
          final tw = math.min(tileStepPx, totalPageWpx - tx);
          final th = math.min(tileStepPx, totalPageHpx - ty);
          if (tw <= 0 || th <= 0) continue;

          final key = GpTileKey(
            docId: effectiveDocId,
            pageIndex: effectivePageIdx,
            tileX: tx,
            tileY: ty,
            scaleBucket: scaleBucket,
            rotation: page.userRotation,
            themeKey: themeKey,
          );
          if (widget.tileCache.contains(key)) {
            widget.controller.recordReadyBucket(pageBucketKey, bucketMeta);
          } else if (!_inFlight.contains(key)) {
            _fetchTile(
              key: key,
              scale: renderScale,
              tileWidthPx: tw,
              tileHeightPx: th,
              priorityTier: 0,
              scope: 'zoom:$scaleBucket',
              pageBucketKey: pageBucketKey,
              bucketMeta: bucketMeta,
            );
          }
        }
      }
    }

    // Pre-warm +-1 adjacent page previews at low priority so fast scrolling never hits a blank card.
    if (!widget.controller.isPinching && firstVisibleIdx != null && lastVisibleIdx != null) {
      for (final adjIdx in [firstVisibleIdx - 1, lastVisibleIdx + 1]) {
        if (adjIdx < 0 || adjIdx >= pages.length) continue;
        final page = pages[adjIdx];
        final previewKey = GpTileKey(
          docId: docId,
          pageIndex: page.sourcePageIndex,
          tileX: 0,
          tileY: 0,
          scaleBucket: 'preview',
          rotation: page.userRotation,
          themeKey: themeKey,
          isPreview: true,
        );
        if (!widget.tileCache.contains(previewKey) && !_inFlight.contains(previewKey)) {
          final pw = math.max(120, (page.displayWidth * 0.35).round());
          final ph = math.max(160, (page.displayHeight * 0.35).round());
          _fetchTile(
            key: previewKey,
            scale: 0.35,
            tileWidthPx: pw,
            tileHeightPx: ph,
            priorityTier: 2,
            scope: 'prefetch:$docId',
          );
        }
      }
    }
  }

  Future<void> _fetchTile({
    required GpTileKey key,
    required double scale,
    required int tileWidthPx,
    required int tileHeightPx,
    required int priorityTier,
    required String scope,
    String? pageBucketKey,
    GpRenderedBucket? bucketMeta,
  }) async {
    _inFlight.add(key);
    try {
      final pixels = await widget.bridge.renderTile(
        docId: key.docId,
        pageIndex: key.pageIndex,
        tileX: key.tileX,
        tileY: key.tileY,
        tileWidthPx: tileWidthPx,
        tileHeightPx: tileHeightPx,
        scale: scale,
        userRotation: key.rotation,
        theme: widget.appState.theme.name,
        darkPaperInvert: widget.appState.darkPaperInvert,
        priorityTier: priorityTier,
        scope: scope,
      );
      if (!mounted) return;
      final img = await decodePremultipliedRgbaImage(
        rgba: pixels.rgba,
        width: pixels.width,
        height: pixels.height,
      );
      if (!mounted) {
        img.dispose();
        return;
      }
      widget.tileCache.put(key, img, width: pixels.width, height: pixels.height);
      if (pageBucketKey != null && bucketMeta != null) {
        widget.controller.recordReadyBucket(pageBucketKey, bucketMeta);
      } else {
        widget.controller.markTilesDirty();
      }
    } catch (_) {
      // Cancelled / document closed gracefully
    } finally {
      _inFlight.remove(key);
    }
  }

  bool get _isDrawingToolActive =>
      widget.appState.mode == GpAppMode.edit &&
      (widget.appState.tool == GpEditorTool.draw ||
          widget.appState.tool == GpEditorTool.eraser ||
          widget.appState.tool == GpEditorTool.highlight ||
          widget.appState.tool == GpEditorTool.redact);

  ({int pageIndex, Offset pdfPt})? _hitPagePdfPoint(Offset localPos) {
    final layouts = widget.controller.computePageRects(
      widget.appState.pages,
      widget.controller.zoom,
      widget.controller.viewportSize.width,
    );
    final surfacePt = localPos + widget.controller.scrollOffset;
    for (final l in layouts) {
      if (l.rectSurface.contains(surfacePt)) {
        final pdfPt = (surfacePt - l.rectSurface.topLeft) / widget.controller.zoom;
        return (pageIndex: l.pageIndex, pdfPt: pdfPt);
      }
    }
    return null;
  }

  void _zoomFocusedAt(Offset localPos, double targetZoom) {
    final clamped = targetZoom.clamp(GpGestureConstants.minZoom, GpGestureConstants.maxZoom);
    final oldZoom = widget.controller.zoom;
    if ((clamped - oldZoom).abs() < 0.005) return;
    final ratio = clamped / math.max(0.1, oldZoom);
    final docAnchor = widget.controller.scrollOffset + localPos;
    final nextScroll = docAnchor * ratio - localPos;
    final bounds = _computeScrollBounds(clamped);
    widget.controller.setTransform(
      nextZoom: clamped,
      nextScroll: nextScroll,
      maxScrollX: bounds.dx,
      maxScrollY: bounds.dy,
    );
    _syncActivePage(forceNotify: true);
    _requestVisibleTilesThrottled(immediate: true);
  }

  void _handleTapOrDoubleTap(Offset localPos) {
    if (widget.appState.mode == GpAppMode.view) {
      final now = DateTime.now();
      final lastTime = _lastTapTime;
      final lastPos = _lastTapPos;
      if (lastTime != null &&
          lastPos != null &&
          now.difference(lastTime) <= GpGestureConstants.doubleTapTimeout &&
          (localPos - lastPos).distance <= GpGestureConstants.doubleTapSlop) {
        _singleTapTimer?.cancel();
        _singleTapTimer = null;
        _lastTapTime = null;
        _lastTapPos = null;
        final fit = widget.controller.fitWidthZoom;
        final zoomedIn = widget.controller.zoom > fit * 1.15;
        final target = zoomedIn ? fit : (fit * 2.0).clamp(1.6, 3.0);
        _zoomFocusedAt(localPos, target);
        return;
      }
      _lastTapTime = now;
      _lastTapPos = localPos;
      _singleTapTimer?.cancel();
      _singleTapTimer = Timer(const Duration(milliseconds: 230), () {
        if (mounted) widget.onToggleImmersive();
      });
      return;
    }
    _handleTapAt(localPos);
  }

  bool _tryBeginManip(PointerDownEvent e) {
    if (widget.appState.mode != GpAppMode.edit || widget.appState.ghostSignature != null) {
      return false;
    }
    final z = widget.controller.zoom;
    final selId = widget.appState.selectedElementId;
    if (selId != null) {
      final sel = widget.appState.elements.where((x) => x.id == selId && !x.deleted).firstOrNull;
      if (sel != null && !sel.locked) {
        final layouts = widget.controller.computePageRects(
          widget.appState.pages,
          z,
          widget.controller.viewportSize.width,
        );
        final pageLayout = layouts.where((l) => l.page.id == sel.pageId).firstOrNull;
        if (pageLayout != null) {
          final pageOrigin = pageLayout.rectSurface.topLeft - widget.controller.scrollOffset;
          final screenRect = Rect.fromLTWH(
            pageOrigin.dx + sel.x * z,
            pageOrigin.dy + sel.y * z,
            sel.width * z,
            sel.height * z,
          );
          final center = screenRect.center;
          final rad = -sel.rotationDeg * math.pi / 180.0;
          final dx = e.localPosition.dx - center.dx;
          final dy = e.localPosition.dy - center.dy;
          final unrotPos = sel.rotationDeg.abs() > 0.01
              ? Offset(
                  center.dx + dx * math.cos(rad) - dy * math.sin(rad),
                  center.dy + dx * math.sin(rad) + dy * math.cos(rad),
                )
              : e.localPosition;

          // 1) Top rotation stem handle
          final rotKnob = Offset(screenRect.center.dx, screenRect.top - 24);
          if ((unrotPos - rotKnob).distance <= 22.0) {
            _manipMode = _ManipMode.rotate;
            _manipPointerId = e.pointer;
            _manipStartScreen = e.localPosition;
            _manipPageIndex = pageLayout.pageIndex;
            _manipOriginEl = sel;
            _manipLatestEl = sel;
            _manipDraggedPastSlop = false;
            return true;
          }

          // 2) 36dp corner/edge resize handles
          final handleMap = {
            'nw': screenRect.topLeft,
            'n': Offset(screenRect.center.dx, screenRect.top),
            'ne': screenRect.topRight,
            'e': Offset(screenRect.right, screenRect.center.dy),
            'se': screenRect.bottomRight,
            's': Offset(screenRect.center.dx, screenRect.bottom),
            'sw': screenRect.bottomLeft,
            'w': Offset(screenRect.left, screenRect.center.dy),
          };
          for (final entry in handleMap.entries) {
            if ((unrotPos - entry.value).distance <= 18.0) {
              _manipMode = _ManipMode.resize;
              _manipHandle = entry.key;
              _manipPointerId = e.pointer;
              _manipStartScreen = e.localPosition;
              _manipPageIndex = pageLayout.pageIndex;
              _manipOriginEl = sel;
              _manipLatestEl = sel;
              _manipDraggedPastSlop = false;
              return true;
            }
          }

          // 3) Body drag-move of selected element
          if (widget.appState.tool != GpEditorTool.draw &&
              widget.appState.tool != GpEditorTool.eraser &&
              widget.appState.tool != GpEditorTool.highlight &&
              widget.appState.tool != GpEditorTool.redact &&
              widget.appState.tool != GpEditorTool.line &&
              screenRect.inflate(6).contains(unrotPos)) {
            _manipMode = _ManipMode.move;
            _manipPointerId = e.pointer;
            _manipStartScreen = e.localPosition;
            _manipPageIndex = pageLayout.pageIndex;
            _manipOriginEl = sel;
            _manipLatestEl = sel;
            _manipDraggedPastSlop = false;
            return true;
          }
        }
      }
    }

    // Drag-to-create Shape or Line tools
    if (widget.appState.tool == GpEditorTool.shape ||
        widget.appState.tool == GpEditorTool.line) {
      final hit = _hitPagePdfPoint(e.localPosition);
      if (hit != null) {
        _manipMode = widget.appState.tool == GpEditorTool.line
            ? _ManipMode.createLine
            : _ManipMode.createShape;
        _manipPointerId = e.pointer;
        _manipStartScreen = e.localPosition;
        _manipStartPdf = hit.pdfPt;
        _manipPageIndex = hit.pageIndex;
        _manipDraggedPastSlop = false;
        return true;
      }
    }
    return false;
  }

  void _updateManip(Offset localPos) {
    final z = widget.controller.zoom;
    if ((localPos - _manipStartScreen).distance >= 6.0) {
      _manipDraggedPastSlop = true;
    }
    if (!_manipDraggedPastSlop) return;

    if (_manipMode == _ManipMode.createShape || _manipMode == _ManipMode.createLine) {
      final layouts = widget.controller.computePageRects(
        widget.appState.pages,
        z,
        widget.controller.viewportSize.width,
      );
      if (_manipPageIndex < 0 || _manipPageIndex >= layouts.length) return;
      final pageLayout = layouts[_manipPageIndex];
      final surfacePt = localPos + widget.controller.scrollOffset;
      final endPdf = (surfacePt - pageLayout.rectSurface.topLeft) / z;
      final minX = math.min(_manipStartPdf.dx, endPdf.dx);
      final minY = math.min(_manipStartPdf.dy, endPdf.dy);
      final maxX = math.max(_manipStartPdf.dx, endPdf.dx);
      final maxY = math.max(_manipStartPdf.dy, endPdf.dy);
      widget.controller.setDraftShapePreview(GpDraftShapePreview(
        pageIndex: _manipPageIndex,
        rectPdf: Rect.fromLTRB(minX, minY, maxX, maxY),
        shapeType: widget.appState.activeShapeType,
        isLine: _manipMode == _ManipMode.createLine,
        startPdf: _manipStartPdf,
        endPdf: endPdf,
        strokeColorValue: widget.appState.activeStrokeColorValue,
        fillColorValue: widget.appState.activeFillColorValue,
        strokeWidth: widget.appState.activeStrokeWidth,
      ));
      return;
    }

    final origin = _manipOriginEl;
    if (origin == null) return;

    if (_manipMode == _ManipMode.move) {
      final dxPdf = (localPos.dx - _manipStartScreen.dx) / z;
      final dyPdf = (localPos.dy - _manipStartScreen.dy) / z;
      var nx = origin.x + dxPdf;
      var ny = origin.y + dyPdf;
      if (_manipPageIndex >= 0 && _manipPageIndex < widget.appState.pages.length) {
        final page = widget.appState.pages[_manipPageIndex];
        final sibs = widget.appState.elements
            .where((s) => s.pageId == page.id && s.id != origin.id && !s.deleted)
            .map((s) => Rect.fromLTWH(s.x, s.y, s.width, s.height))
            .toList();
        final snapped = widget.bridge.computeSnapGuidePosition(
          x: nx,
          y: ny,
          width: origin.width,
          height: origin.height,
          pageW: page.displayWidth,
          pageH: page.displayHeight,
          siblings: sibs,
        );
        nx = snapped.x;
        ny = snapped.y;
        final cx = nx + origin.width * 0.5;
        final cy = ny + origin.height * 0.5;
        final vGuide = (cx - page.displayWidth * 0.5).abs() < 2.0 ? page.displayWidth * 0.5 : null;
        final hGuide = (cy - page.displayHeight * 0.5).abs() < 2.0 ? page.displayHeight * 0.5 : null;
        widget.controller.setSnapGuides(
          snapped.snapped || vGuide != null || hGuide != null
              ? GpSnapGuideLines(
                  pageIndex: _manipPageIndex,
                  verticalPdfX: vGuide ?? (snapped.snapped ? nx : null),
                  horizontalPdfY: hGuide ?? (snapped.snapped ? ny : null),
                )
              : null,
        );
      }
      final next = origin.copyWith(x: nx, y: ny);
      _manipLatestEl = next;
      widget.onUpdateOverlayElement?.call(next, recordHistory: false);
      return;
    }

    if (_manipMode == _ManipMode.resize) {
      final dxPdf = (localPos.dx - _manipStartScreen.dx) / z;
      final dyPdf = (localPos.dy - _manipStartScreen.dy) / z;
      final lockAspect = origin.kind == 'image' ||
          origin.kind == 'imageReplacement' ||
          origin.kind == 'signature';
      var r = widget.bridge.computeRotatedResizeRect(
        x: origin.x,
        y: origin.y,
        width: origin.width,
        height: origin.height,
        rotationDeg: origin.rotationDeg,
        handle: _manipHandle,
        dxPx: dxPdf,
        dyPx: dyPdf,
        aspectLocked: lockAspect,
      );
      if (r.x == origin.x && r.y == origin.y && r.width == origin.width && r.height == origin.height) {
        var left = origin.x;
        var top = origin.y;
        var right = origin.x + origin.width;
        var bottom = origin.y + origin.height;
        if (_manipHandle.contains('w')) left = math.min(right - 16, left + dxPdf);
        if (_manipHandle.contains('e')) right = math.max(left + 16, right + dxPdf);
        if (_manipHandle.contains('n')) top = math.min(bottom - 16, top + dyPdf);
        if (_manipHandle.contains('s')) bottom = math.max(top + 16, bottom + dyPdf);
        r = (x: left, y: top, width: right - left, height: bottom - top);
      }
      final next = origin.copyWith(x: r.x, y: r.y, width: r.width, height: r.height);
      _manipLatestEl = next;
      widget.onUpdateOverlayElement?.call(next, recordHistory: false);
      return;
    }

    if (_manipMode == _ManipMode.rotate) {
      final layouts = widget.controller.computePageRects(
        widget.appState.pages,
        z,
        widget.controller.viewportSize.width,
      );
      if (_manipPageIndex < 0 || _manipPageIndex >= layouts.length) return;
      final pageOrigin = layouts[_manipPageIndex].rectSurface.topLeft - widget.controller.scrollOffset;
      final center = Offset(
        pageOrigin.dx + (origin.x + origin.width * 0.5) * z,
        pageOrigin.dy + (origin.y + origin.height * 0.5) * z,
      );
      var angleDeg = math.atan2(localPos.dx - center.dx, -(localPos.dy - center.dy)) * 180.0 / math.pi;
      for (final snap in const [0.0, 90.0, 180.0, 270.0, -90.0, -180.0]) {
        if ((angleDeg - snap).abs() < 4.0) {
          angleDeg = snap;
          break;
        }
      }
      final next = origin.copyWith(rotationDeg: angleDeg);
      _manipLatestEl = next;
      widget.onUpdateOverlayElement?.call(next, recordHistory: false);
    }
  }

  void _finishManip({required bool cancelled, Offset? upPos}) {
    final mode = _manipMode;
    final origin = _manipOriginEl;
    final latest = _manipLatestEl;
    final preview = widget.controller.draftShapePreview;
    final dragged = _manipDraggedPastSlop;

    _manipMode = _ManipMode.none;
    _manipPointerId = null;
    _manipOriginEl = null;
    _manipLatestEl = null;
    _manipDraggedPastSlop = false;
    widget.controller.setSnapGuides(null);
    widget.controller.setDraftShapePreview(null);

    if (cancelled) {
      if (origin != null && dragged) {
        widget.onUpdateOverlayElement?.call(origin, recordHistory: false);
      }
      return;
    }

    if (mode == _ManipMode.createShape) {
      if (_manipPageIndex >= 0 && _manipPageIndex < widget.appState.pages.length) {
        final page = widget.appState.pages[_manipPageIndex];
        final r = dragged && preview != null && preview.rectPdf.width >= 10 && preview.rectPdf.height >= 10
            ? preview.rectPdf
            : Rect.fromCenter(center: _manipStartPdf, width: 110, height: 70);
        widget.onAddOverlayElement(
          GpOverlayElement(
            id: 'shp_${DateTime.now().microsecondsSinceEpoch}',
            pageId: page.id,
            kind: 'shape',
            shapeType: widget.appState.activeShapeType,
            x: r.left,
            y: r.top,
            width: r.width,
            height: r.height,
            colorValue: widget.appState.activeStrokeColorValue,
            fillColorValue: widget.appState.activeFillColorValue,
            strokeWidth: widget.appState.activeStrokeWidth,
          ),
        );
      }
      return;
    }

    if (mode == _ManipMode.createLine) {
      if (_manipPageIndex >= 0 && _manipPageIndex < widget.appState.pages.length) {
        final page = widget.appState.pages[_manipPageIndex];
        final s = _manipStartPdf;
        final e = (dragged && preview != null) ? preview.endPdf : Offset(s.dx + 120, s.dy);
        final minX = math.min(s.dx, e.dx);
        final minY = math.min(s.dy, e.dy);
        final w = math.max(12.0, (e.dx - s.dx).abs());
        final h = math.max(12.0, (e.dy - s.dy).abs());
        widget.onAddOverlayElement(
          GpOverlayElement(
            id: 'line_${DateTime.now().microsecondsSinceEpoch}',
            pageId: page.id,
            kind: 'path',
            x: minX,
            y: minY,
            width: w,
            height: h,
            colorValue: widget.appState.activeStrokeColorValue,
            strokeWidth: widget.appState.activeStrokeWidth,
            smooth: false,
            closed: false,
            points: [s, e],
          ),
        );
      }
      return;
    }

    if (!dragged && upPos != null) {
      _handleTapAt(upPos);
      return;
    }

    if (dragged && origin != null && latest != null) {
      // Restore origin transiently before recording final command step
      widget.onUpdateOverlayElement?.call(origin, recordHistory: false);
      widget.onUpdateOverlayElement?.call(latest, recordHistory: true);
    }
  }

  void _handleTapAt(Offset localPos) {
    final hit = _hitPagePdfPoint(localPos);
    if (hit == null) {
      widget.onSelectElement(null);
      return;
    }

    final page = widget.appState.pages[hit.pageIndex];

    if (widget.appState.mode == GpAppMode.view) {
      final links = widget.appState.pageLinks[page.sourcePageIndex] ?? const [];
      for (final link in links) {
        if (link.rect.inflate(4).contains(hit.pdfPt)) {
          widget.onTapLink?.call(link);
          return;
        }
      }
      return;
    }

    if (widget.appState.ghostSignature != null) {
      widget.onPlaceGhostAt?.call(hit.pageIndex, hit.pdfPt);
      return;
    }

    if (widget.appState.tool == GpEditorTool.text) {
      // Check if user tapped an existing edited text element first
      final existingText = widget.appState.elements
          .where((e) =>
              e.pageId == page.id &&
              !e.deleted &&
              e.isTextKind &&
              Rect.fromLTWH(e.x, e.y, e.width, e.height).inflate(8).contains(hit.pdfPt))
          .firstOrNull;
      if (existingText != null) {
        widget.onSelectElement(existingText.id);
        return;
      }

      // Check analyzed PDF text blocks for seamless in-place editing
      final analysis = widget.appState.pageAnalyses[page.id];
      if (analysis != null) {
        for (final blk in analysis.textBlocks) {
          if (blk.rect.inflate(4).contains(hit.pdfPt)) {
            widget.onRequestEditPdfTextBlock?.call(hit.pageIndex, blk);
            return;
          }
        }
      }

      widget.onAddOverlayElement(
        GpOverlayElement(
          id: 'el_${DateTime.now().microsecondsSinceEpoch}',
          pageId: page.id,
          kind: 'textAdd',
          x: hit.pdfPt.dx,
          y: hit.pdfPt.dy,
          width: 180,
          height: 28,
          text: 'Text',
          fontSize: 14,
          colorValue: 0xFF0F172A,
        ),
      );
      return;
    }

    if (widget.appState.tool == GpEditorTool.shape) {
      widget.onAddOverlayElement(
        GpOverlayElement(
          id: 'shp_${DateTime.now().microsecondsSinceEpoch}',
          pageId: page.id,
          kind: 'shape',
          shapeType: widget.appState.activeShapeType,
          x: hit.pdfPt.dx - 55,
          y: hit.pdfPt.dy - 35,
          width: 110,
          height: 70,
          colorValue: widget.appState.activeStrokeColorValue,
          fillColorValue: widget.appState.activeFillColorValue,
          strokeWidth: widget.appState.activeStrokeWidth,
        ),
      );
      return;
    }

    // Select existing overlay element if tapped inside bounds.
    final candidates = widget.appState.elements
        .where((e) => e.pageId == page.id && !e.deleted)
        .toList()
        .reversed;
    for (final el in candidates) {
      final box = Rect.fromLTWH(el.x, el.y, el.width, el.height).inflate(8);
      if (box.contains(hit.pdfPt)) {
        widget.onSelectElement(el.id);
        return;
      }
    }

    // In Select mode, tapping detected PDF text block starts in-place TextEdit cleanly!
    if (widget.appState.tool == GpEditorTool.select) {
      final analysis = widget.appState.pageAnalyses[page.id];
      if (analysis != null) {
        for (final blk in analysis.textBlocks) {
          if (blk.rect.inflate(4).contains(hit.pdfPt)) {
            widget.onRequestEditPdfTextBlock?.call(hit.pageIndex, blk);
            return;
          }
        }
      }
    }

    widget.onSelectElement(null);
  }

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;

    return LayoutBuilder(
      builder: (context, constraints) {
        final nextSize = Size(constraints.maxWidth, constraints.maxHeight);
        final sizeChanged = widget.controller.viewportSize != nextSize;
        final docId = widget.appState.docId;
        final needsInitialFit =
            docId != null && widget.appState.pages.isNotEmpty && widget.controller.fittedDocId != docId;
        widget.controller.viewportSize = nextSize;
        if ((sizeChanged || needsInitialFit) && widget.appState.pages.isNotEmpty) {
          final firstW = widget.appState.pages.first.displayWidth;
          final fitZoom = ((nextSize.width - gpViewportPageGap * 2) / math.max(100.0, firstW))
              .clamp(0.4, 3.0);
          widget.controller.fitWidthZoom = fitZoom;
          if (needsInitialFit) {
            widget.controller.fittedDocId = docId;
            widget.controller.zoom = fitZoom;
            widget.controller.scrollOffset = Offset.zero;
            widget.controller.zoomNotifier.value = fitZoom;
            widget.controller.activePageNotifier.value = 0;
          }
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            if (needsInitialFit) {
              _syncActivePage(forceNotify: true);
            }
            _requestVisibleTilesThrottled(immediate: true);
          });
        }

        final activePage = widget.appState.activePageIndex + 1;
        final totalPages = widget.appState.pages.length;

        return Semantics(
          label: 'PDF document viewport, page $activePage of $totalPages',
          child: Listener(
            behavior: HitTestBehavior.opaque,
            onPointerDown: (e) {
              // 2nd finger down cancels any active single-finger manipulation and enters pinch cleanly.
              if (_manipMode != _ManipMode.none && _gestures.activePointers.isNotEmpty) {
                _finishManip(cancelled: true);
              }
              if (_gestures.activePointers.isEmpty && _tryBeginManip(e)) {
                _gestures.activePointers[e.pointer] = e.localPosition;
                return;
              }
              final prevPinching = widget.controller.isPinching;
              _gestures.handlePointerDown(
                event: e,
                currentZoom: widget.controller.zoom,
                currentScroll: widget.controller.scrollOffset,
                drawingToolActive: _isDrawingToolActive,
                onStopInertia: _stopInertia,
                onCancelActiveToolStroke: () {
                  _draftPointsPdf.clear();
                  _draftPageIndex = null;
                  widget.controller.clearDraftStroke();
                },
                onBeginToolStroke: (pos, pressure, isEraser) {
                  final hit = _hitPagePdfPoint(pos);
                  if (hit == null) return;
                  if (isEraser || widget.appState.tool == GpEditorTool.eraser) {
                    _draftIsEraser = true;
                    widget.onEraseStrokeAt(hit.pdfPt, hit.pageIndex);
                    return;
                  }
                  _draftIsEraser = false;
                  _draftPageIndex = hit.pageIndex;
                  _draftPointsPdf
                    ..clear()
                    ..add(hit.pdfPt);
                  _draftPressureSum = pressure;
                  widget.controller.setDraftStroke(
                    [pos],
                    width: widget.appState.tool == GpEditorTool.draw ? (1.2 + pressure * 3.2) : 14.0,
                    color: widget.appState.tool == GpEditorTool.redact
                        ? const Color(0xFF000000)
                        : (widget.appState.tool == GpEditorTool.highlight
                            ? const Color(0x66FACC15)
                            : const Color(0xFF1D4ED8)),
                  );
                },
              );
              widget.controller.isPinching = _gestures.activeKind == GpActiveGestureKind.pinch;
              if (!prevPinching && widget.controller.isPinching && widget.controller.activeRenderBucket != null) {
                unawaited(widget.bridge.cancelRenderScope('zoom:${widget.controller.activeRenderBucket}'));
              }
            },
            onPointerMove: (e) {
              if (_manipMode != _ManipMode.none && e.pointer == _manipPointerId) {
                _gestures.activePointers[e.pointer] = e.localPosition;
                _updateManip(e.localPosition);
                return;
              }
              _gestures.handlePointerMove(
                event: e,
                currentZoom: widget.controller.zoom,
                currentScroll: widget.controller.scrollOffset,
                onViewportTransform: (nextZ, nextScroll) {
                  final bounds = _computeScrollBounds(nextZ);
                  widget.controller.setTransform(
                    nextZoom: nextZ,
                    nextScroll: nextScroll,
                    maxScrollX: bounds.dx,
                    maxScrollY: bounds.dy,
                  );
                  _syncActivePage();
                  if (!widget.controller.isPinching) {
                    _requestVisibleTilesThrottled();
                  }
                },
                onUpdateToolStroke: (pos, pressure) {
                  final hit = _hitPagePdfPoint(pos);
                  if (hit == null) return;
                  if (_draftIsEraser) {
                    widget.onEraseStrokeAt(hit.pdfPt, hit.pageIndex);
                    return;
                  }
                  if (_draftPageIndex != hit.pageIndex) return;
                  _draftPointsPdf.add(hit.pdfPt);
                  _draftPressureSum = (_draftPressureSum + pressure) * 0.5;
                  widget.controller.setDraftStroke(
                    [...widget.controller._liveDraftStrokeScreen, pos],
                    width: widget.appState.tool == GpEditorTool.draw ? (1.2 + _draftPressureSum * 3.2) : 14.0,
                    color: widget.appState.tool == GpEditorTool.redact
                        ? const Color(0xFF000000)
                        : (widget.appState.tool == GpEditorTool.highlight
                            ? const Color(0x66FACC15)
                            : const Color(0xFF1D4ED8)),
                  );
                },
              );
            },
            onPointerUp: (e) {
              if (_manipMode != _ManipMode.none && e.pointer == _manipPointerId) {
                _gestures.activePointers.remove(e.pointer);
                _finishManip(cancelled: false, upPos: e.localPosition);
                return;
              }
              _gestures.handlePointerUpOrCancel(
                event: e,
                cancelled: false,
                currentZoom: widget.controller.zoom,
                fitWidthZoom: widget.controller.fitWidthZoom,
                onStartInertia: _startInertia,
                onPinchCommit: (finalZoom) {
                  widget.controller.isPinching = false;
                  final bounds = _computeScrollBounds(finalZoom);
                  widget.controller.setTransform(
                    nextZoom: finalZoom,
                    nextScroll: widget.controller.scrollOffset,
                    maxScrollX: bounds.dx,
                    maxScrollY: bounds.dy,
                  );
                  _syncActivePage(forceNotify: true);
                  _requestVisibleTilesThrottled(immediate: true);
                },
                onCancelToolStroke: () {
                  _draftPointsPdf.clear();
                  _draftPageIndex = null;
                  widget.controller.clearDraftStroke();
                },
                onCommitToolStroke: () {
                  widget.controller.clearDraftStroke();
                  final idx = _draftPageIndex;
                  if (idx != null && _draftPointsPdf.isNotEmpty) {
                    final page = widget.appState.pages[idx];
                    var minX = double.infinity;
                    var minY = double.infinity;
                    var maxX = double.negativeInfinity;
                    var maxY = double.negativeInfinity;
                    for (final pt in _draftPointsPdf) {
                      minX = math.min(minX, pt.dx);
                      minY = math.min(minY, pt.dy);
                      maxX = math.max(maxX, pt.dx);
                      maxY = math.max(maxY, pt.dy);
                    }
                    final w = math.max(12.0, maxX - minX);
                    final h = math.max(12.0, maxY - minY);
                    if (widget.appState.tool == GpEditorTool.redact) {
                      widget.onAddOverlayElement(
                        GpOverlayElement(
                          id: 'red_${DateTime.now().microsecondsSinceEpoch}',
                          pageId: page.id,
                          kind: 'highlight',
                          x: minX,
                          y: minY,
                          width: w,
                          height: h,
                          colorValue: 0xFF000000,
                          fillColorValue: 0xFF000000,
                          isRedact: true,
                        ),
                      );
                    } else if (widget.appState.tool == GpEditorTool.highlight) {
                      widget.onAddOverlayElement(
                        GpOverlayElement(
                          id: 'hl_${DateTime.now().microsecondsSinceEpoch}',
                          pageId: page.id,
                          kind: 'highlight',
                          x: minX,
                          y: minY,
                          width: w,
                          height: math.max(14.0, h),
                          fillColorValue: 0xFFFACC15,
                          opacity: 0.42,
                        ),
                      );
                    } else {
                      widget.onAddOverlayElement(
                        GpOverlayElement(
                          id: 'ink_${DateTime.now().microsecondsSinceEpoch}',
                          pageId: page.id,
                          kind: 'ink',
                          x: minX,
                          y: minY,
                          width: w,
                          height: h,
                          colorValue: 0xFF1D4ED8,
                          strokeWidth: 1.5 + _draftPressureSum * 2.8,
                          points: List.unmodifiable(_draftPointsPdf),
                        ),
                      );
                    }
                  }
                  _draftPointsPdf.clear();
                  _draftPageIndex = null;
                },
                onTap: (pos) {
                  widget.controller.isPinching = false;
                  _handleTapOrDoubleTap(pos);
                  _requestVisibleTilesThrottled(immediate: true);
                },
              );
              widget.controller.isPinching = _gestures.activeKind == GpActiveGestureKind.pinch;
            },
            onPointerCancel: (e) {
              if (_manipMode != _ManipMode.none && e.pointer == _manipPointerId) {
                _gestures.activePointers.remove(e.pointer);
                _finishManip(cancelled: true);
                return;
              }
              widget.controller.isPinching = false;
              _gestures.handlePointerUpOrCancel(
                event: e,
                cancelled: true,
                currentZoom: widget.controller.zoom,
                fitWidthZoom: widget.controller.fitWidthZoom,
                onCommitToolStroke: () {},
                onCancelToolStroke: () {
                  _draftPointsPdf.clear();
                  _draftPageIndex = null;
                  widget.controller.clearDraftStroke();
                },
                onPinchCommit: (_) {},
                onStartInertia: (_) {},
                onTap: (_) {},
              );
            },
            onPointerSignal: (sig) {
              if (sig is PointerScrollEvent) {
                _stopInertia();
                final bounds = _computeScrollBounds(widget.controller.zoom);
                widget.controller.setTransform(
                  nextZoom: widget.controller.zoom,
                  nextScroll: widget.controller.scrollOffset + sig.scrollDelta,
                  maxScrollX: bounds.dx,
                  maxScrollY: bounds.dy,
                );
                _syncActivePage();
                _scheduleVisibleTiles();
              }
            },
            child: Container(
              color: palette.paperBackdrop,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  RepaintBoundary(
                    child: CustomPaint(
                      painter: _TilesLayerPainter(
                        controller: widget.controller,
                        appState: widget.appState,
                        tileCache: widget.tileCache,
                        dpr: MediaQuery.devicePixelRatioOf(context).clamp(1.0, 3.0),
                      ),
                    ),
                  ),
                  RepaintBoundary(
                    child: CustomPaint(
                      painter: GpOverlayLayerPainter(
                        controller: widget.controller,
                        appState: widget.appState,
                        imageCache: _elementImageCache,
                      ),
                    ),
                  ),
                  if (widget.appState.pages.isNotEmpty)
                    Positioned(
                      bottom: GpSpacing.s4 + MediaQuery.paddingOf(context).bottom,
                      left: widget.appState.leftHanded ? null : GpSpacing.s4,
                      right: widget.appState.leftHanded ? GpSpacing.s4 : null,
                      child: ValueListenableBuilder<int>(
                        valueListenable: widget.controller.activePageNotifier,
                        builder: (context, activeIdx, _) {
                          return ValueListenableBuilder<double>(
                            valueListenable: widget.controller.zoomNotifier,
                            builder: (context, z, _) {
                              final fit = math.max(0.1, widget.controller.fitWidthZoom);
                              final isFit = (z - fit).abs() <= 0.04;
                              final pct = (z * 100).round();
                              return Material(
                                key: const Key('viewport-status-pill'),
                                color: palette.surfaceOverlay.withValues(alpha: 0.90),
                                borderRadius: BorderRadius.circular(20),
                                elevation: 2,
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(20),
                                  onTap: isFit
                                      ? null
                                      : () => _zoomFocusedAt(
                                            Offset(
                                              widget.controller.viewportSize.width * 0.5,
                                              widget.controller.viewportSize.height * 0.4,
                                            ),
                                            fit,
                                          ),
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 7,
                                    ),
                                    child: Text(
                                      '${activeIdx + 1}/${widget.appState.pages.length}  •  ${isFit ? "Fit" : "$pct%"}',
                                      style: GpTypography.numeric.copyWith(
                                        color: palette.textPrimary,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ),
                                ),
                              );
                            },
                          );
                        },
                      ),
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _TilesLayerPainter extends CustomPainter {
  _TilesLayerPainter({
    required this.controller,
    required this.appState,
    required this.tileCache,
    required this.dpr,
  }) : super(repaint: controller);

  final GpViewportController controller;
  final GpAppState appState;
  final GpTileCache tileCache;
  final double dpr;

  @override
  void paint(Canvas canvas, Size size) {
    final layouts = controller.computePageRects(appState.pages, controller.zoom, size.width);
    final visible = controller.scrollOffset & size;
    final tileZoom = GpViewportController.quantizeTileZoom(
      controller.zoom,
      controller.fitWidthZoom,
    );
    final scaleBucket = GpViewportController.bucketForScale(tileZoom);
    final themeKey = appState.theme.name;
    final docId = appState.docId;

    final paperColor = appState.theme == GpReadingTheme.dark && appState.darkPaperInvert
        ? const Color(0xFF1E293B)
        : (appState.theme == GpReadingTheme.sepia
            ? const Color(0xFFF6ECD9)
            : Colors.white);
    final paperPaint = Paint()..color = paperColor;
    final shadowPaint = Paint()..color = const Color(0x33000000);
    final previewPaint = Paint()..filterQuality = FilterQuality.low;
    final sharpPaint = Paint()
      ..filterQuality = (controller.isPinching || (controller.zoom - tileZoom).abs() > 0.02)
          ? FilterQuality.medium
          : FilterQuality.low;

    for (final layout in layouts) {
      if (!layout.rectSurface.overlaps(visible)) continue;
      final destPage = layout.rectSurface.shift(-controller.scrollOffset);

      // 1) Skeleton card shadow + paper background (zero blank frames)
      canvas.drawRRect(
        RRect.fromRectAndRadius(destPage.translate(0, 3), const Radius.circular(3)),
        shadowPaint,
      );
      canvas.drawRect(destPage, paperPaint);

      if (docId == null) continue;
      final cleanDocId = appState.cleanPreviewDocIds[layout.page.id];
      final effectiveDocId = cleanDocId ?? docId;
      final effectivePageIdx = cleanDocId != null ? 0 : layout.page.sourcePageIndex;

      // 2) Low-res preview fallback
      final previewKey = GpTileKey(
        docId: effectiveDocId,
        pageIndex: effectivePageIdx,
        tileX: 0,
        tileY: 0,
        scaleBucket: 'preview',
        rotation: layout.page.userRotation,
        themeKey: themeKey,
        isPreview: true,
      );
      final preview = tileCache.get(previewKey);
      if (preview != null) {
        canvas.drawImageRect(
          preview.image,
          Rect.fromLTWH(0, 0, preview.width.toDouble(), preview.height.toDouble()),
          destPage,
          previewPaint,
        );
      }

      // 3) Fallback recent sharp bucket (smoothly scaled on GPU during pinch/zoom transition)
      final pageBucketKey = '$effectiveDocId:$effectivePageIdx:${layout.page.userRotation}:$themeKey';
      final recentBuckets = controller.readyBucketsByPage[pageBucketKey] ?? const [];
      for (final fb in recentBuckets.reversed) {
        if (fb.scaleBucket == scaleBucket) continue;
        _paintBucketTiles(
          canvas: canvas,
          docId: effectiveDocId,
          pageIndex: effectivePageIdx,
          page: layout.page,
          destPage: destPage,
          visibleViewport: size,
          themeKey: themeKey,
          scaleBucket: fb.scaleBucket,
          totalPageWpx: fb.totalPageWpx,
          totalPageHpx: fb.totalPageHpx,
          paint: sharpPaint,
        );
      }

      // 4) Target quantized bucket sharp tiles at exact proportional coordinates
      final targetWpx = math.max(1, (layout.page.displayWidth * tileZoom * dpr).round());
      final targetHpx = math.max(1, (layout.page.displayHeight * tileZoom * dpr).round());
      _paintBucketTiles(
        canvas: canvas,
        docId: effectiveDocId,
        pageIndex: effectivePageIdx,
        page: layout.page,
        destPage: destPage,
        visibleViewport: size,
        themeKey: themeKey,
        scaleBucket: scaleBucket,
        totalPageWpx: targetWpx,
        totalPageHpx: targetHpx,
        paint: sharpPaint,
      );

      // Search match highlights
      if (appState.searchHits.isNotEmpty) {
        for (var i = 0; i < appState.searchHits.length; i++) {
          final hit = appState.searchHits[i];
          if (hit.pageIndex != layout.pageIndex) continue;
          final active = i == appState.activeSearchIdx;
          final hlPaint = Paint()
            ..color = active ? const Color(0x882563EB) : const Color(0x66FACC15);
          for (final r in hit.rects) {
            final scaled = Rect.fromLTWH(
              destPage.left + r.left * controller.zoom,
              destPage.top + r.top * controller.zoom,
              r.width * controller.zoom,
              r.height * controller.zoom,
            );
            canvas.drawRect(scaled, hlPaint);
          }
        }
      }
    }
  }

  void _paintBucketTiles({
    required Canvas canvas,
    required String docId,
    required int pageIndex,
    required GpPageMeta page,
    required Rect destPage,
    required Size visibleViewport,
    required String themeKey,
    required String scaleBucket,
    required int totalPageWpx,
    required int totalPageHpx,
    required Paint paint,
  }) {
    final tileStepPx = (gpTileLogicalSize * dpr).round();
    final cols = (totalPageWpx / tileStepPx).ceil();
    final rows = (totalPageHpx / tileStepPx).ceil();
    final scaleX = destPage.width / totalPageWpx;
    final scaleY = destPage.height / totalPageHpx;

    for (var r = 0; r < rows; r++) {
      final ty = r * tileStepPx;
      final approxTop = destPage.top + ty * scaleY;
      final approxBottom = approxTop + tileStepPx * scaleY;
      if (approxBottom < 0 || approxTop > visibleViewport.height) continue;

      for (var c = 0; c < cols; c++) {
        final tx = c * tileStepPx;
        final approxLeft = destPage.left + tx * scaleX;
        final approxRight = approxLeft + tileStepPx * scaleX;
        if (approxRight < 0 || approxLeft > visibleViewport.width) continue;

        final tileKey = GpTileKey(
          docId: docId,
          pageIndex: pageIndex,
          tileX: tx,
          tileY: ty,
          scaleBucket: scaleBucket,
          rotation: page.userRotation,
          themeKey: themeKey,
        );
        final cached = tileCache.get(tileKey);
        if (cached == null) continue;
        final tileRect = Rect.fromLTWH(
          destPage.left + tx * scaleX,
          destPage.top + ty * scaleY,
          cached.width * scaleX,
          cached.height * scaleY,
        );
        canvas.drawImageRect(
          cached.image,
          Rect.fromLTWH(0, 0, cached.width.toDouble(), cached.height.toDouble()),
          tileRect,
          paint,
        );
      }
    }
  }

  @override
  bool shouldRepaint(covariant _TilesLayerPainter oldDelegate) =>
      oldDelegate.appState.pages != appState.pages ||
      oldDelegate.appState.theme != appState.theme ||
      oldDelegate.appState.darkPaperInvert != appState.darkPaperInvert ||
      oldDelegate.appState.searchHits != appState.searchHits ||
      oldDelegate.appState.activeSearchIdx != appState.activeSearchIdx ||
      oldDelegate.appState.cleanPreviewDocIds != appState.cleanPreviewDocIds;
}
