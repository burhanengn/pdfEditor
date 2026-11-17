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

class GpViewportController extends ChangeNotifier {
  double zoom = 1.0;
  double fitWidthZoom = 1.0;
  Offset scrollOffset = Offset.zero;
  Size viewportSize = Size.zero;

  List<Offset> _liveDraftStrokeScreen = const [];
  double _liveStrokeWidth = 2.5;
  Color _liveStrokeColor = const Color(0xFF1D4ED8);

  void setTransform({required double nextZoom, required Offset nextScroll, required double maxScrollX, required double maxScrollY}) {
    zoom = nextZoom.clamp(GpGestureConstants.minZoom, GpGestureConstants.maxZoom);
    scrollOffset = Offset(
      nextScroll.dx.clamp(0.0, math.max(0.0, maxScrollX)),
      nextScroll.dy.clamp(0.0, math.max(0.0, maxScrollY)),
    );
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
    final layouts = computePageRects(pages, zoom, viewportSize.width);
    final target = layouts[idx];
    final nextY = target.rectSurface.top + anchor.pageOffsetRatioY * target.rectSurface.height;
    final nextX = anchor.scrollXRatio * target.rectSurface.width;
    scrollOffset = Offset(math.max(0.0, nextX), math.max(0.0, nextY));
    notifyListeners();
  }

  void scrollToPage(int pageIndex, List<GpPageMeta> pages) {
    if (pages.isEmpty) return;
    final idx = pageIndex.clamp(0, pages.length - 1);
    final layouts = computePageRects(pages, zoom, viewportSize.width);
    scrollOffset = Offset(scrollOffset.dx, math.max(0.0, layouts[idx].rectSurface.top - gpViewportPageGap));
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

  @override
  State<PdfViewport> createState() => _PdfViewportState();
}

class _PdfViewportState extends State<PdfViewport>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  final GpGestureController _gestures = GpGestureController();
  late final Ticker _inertiaTicker;
  Duration _lastTick = Duration.zero;
  Offset _inertiaVel = Offset.zero;

  final Set<GpTileKey> _inFlight = {};
  final List<Offset> _draftPointsPdf = [];
  int? _draftPageIndex;
  double _draftPressureSum = 0;
  bool _draftIsEraser = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _inertiaTicker = createTicker(_onInertiaTick);
  }

  @override
  void dispose() {
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
      _scheduleVisibleTiles();
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

  void _syncActivePage() {
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
    widget.onPositionChanged(bestIdx, widget.controller.zoom);
  }

  void _scheduleVisibleTiles() {
    final docId = widget.appState.docId;
    final pages = widget.appState.pages;
    if (docId == null || pages.isEmpty || widget.controller.viewportSize.isEmpty) return;

    final dpr = MediaQuery.devicePixelRatioOf(context).clamp(1.0, 3.0);
    final zoom = widget.controller.zoom;
    final scaleBucket = zoom.toStringAsFixed(2);
    final themeKey = widget.appState.theme.name;
    final layouts = widget.controller.computePageRects(
      pages,
      zoom,
      widget.controller.viewportSize.width,
    );
    final visibleRect = widget.controller.scrollOffset & widget.controller.viewportSize;

    for (final layout in layouts) {
      if (!layout.rectSurface.overlaps(visibleRect)) continue;
      final page = layout.page;

      // Always ensure a 0.35x quick page preview exists immediately.
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
          priorityTier: 1,
          scope: 'preview:$docId',
        );
      }

      // Request sharp 256×256 logical px tiles covering only visible viewport intersections.
      final totalPageWpx = math.max(1, (page.displayWidth * zoom * dpr).round());
      final totalPageHpx = math.max(1, (page.displayHeight * zoom * dpr).round());
      final tileStepPx = (gpTileLogicalSize * dpr).round();
      final renderScale = totalPageWpx / page.displayWidth;

      final visLeft = math.max(0.0, visibleRect.left - layout.rectSurface.left);
      final visTop = math.max(0.0, visibleRect.top - layout.rectSurface.top);
      final visRight = math.min(layout.rectSurface.width, visibleRect.right - layout.rectSurface.left);
      final visBottom = math.min(layout.rectSurface.height, visibleRect.bottom - layout.rectSurface.top);

      final colStart = ((visLeft * dpr) / tileStepPx).floor();
      final colEnd = ((visRight * dpr) / tileStepPx).floor();
      final rowStart = ((visTop * dpr) / tileStepPx).floor();
      final rowEnd = ((visBottom * dpr) / tileStepPx).floor();

      for (var r = rowStart; r <= rowEnd; r++) {
        for (var c = colStart; c <= colEnd; c++) {
          final tx = c * tileStepPx;
          final ty = r * tileStepPx;
          final tw = math.min(tileStepPx, totalPageWpx - tx);
          final th = math.min(tileStepPx, totalPageHpx - ty);
          if (tw <= 0 || th <= 0) continue;

          final key = GpTileKey(
            docId: docId,
            pageIndex: page.sourcePageIndex,
            tileX: tx,
            tileY: ty,
            scaleBucket: scaleBucket,
            rotation: page.userRotation,
            themeKey: themeKey,
          );
          if (!widget.tileCache.contains(key) && !_inFlight.contains(key)) {
            _fetchTile(
              key: key,
              scale: renderScale,
              tileWidthPx: tw,
              tileHeightPx: th,
              priorityTier: 0,
              scope: 'zoom:$scaleBucket',
            );
          }
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
      widget.controller.markTilesDirty();
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

  void _handleTapAt(Offset localPos) {
    final hit = _hitPagePdfPoint(localPos);
    if (hit == null) {
      widget.onSelectElement(null);
      if (widget.appState.mode == GpAppMode.view) widget.onToggleImmersive();
      return;
    }

    if (widget.appState.mode == GpAppMode.view) {
      widget.onToggleImmersive();
      return;
    }

    final page = widget.appState.pages[hit.pageIndex];
    if (widget.appState.tool == GpEditorTool.text) {
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
          x: hit.pdfPt.dx - 45,
          y: hit.pdfPt.dy - 25,
          width: 90,
          height: 50,
          colorValue: 0xFF2563EB,
          strokeWidth: 2.0,
        ),
      );
      return;
    }

    // Select existing overlay element if tapped inside bounds.
    final candidates = widget.appState.elements.where((e) => e.pageId == page.id).toList().reversed;
    for (final el in candidates) {
      final box = Rect.fromLTWH(el.x, el.y, el.width, el.height).inflate(8);
      if (box.contains(hit.pdfPt)) {
        widget.onSelectElement(el.id);
        return;
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
        if (widget.controller.viewportSize != nextSize && widget.appState.pages.isNotEmpty) {
          widget.controller.viewportSize = nextSize;
          final firstW = widget.appState.pages.first.displayWidth;
          final fitZoom = ((nextSize.width - gpViewportPageGap * 2) / math.max(100.0, firstW))
              .clamp(0.4, 3.0);
          widget.controller.fitWidthZoom = fitZoom;
          WidgetsBinding.instance.addPostFrameCallback((_) => _scheduleVisibleTiles());
        } else {
          widget.controller.viewportSize = nextSize;
          WidgetsBinding.instance.addPostFrameCallback((_) => _scheduleVisibleTiles());
        }

        final activePage = widget.appState.activePageIndex + 1;
        final totalPages = widget.appState.pages.length;

        return Semantics(
          label: 'PDF document viewport, page $activePage of $totalPages',
          child: Listener(
            behavior: HitTestBehavior.opaque,
            onPointerDown: (e) {
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
            },
            onPointerMove: (e) {
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
              _gestures.handlePointerUpOrCancel(
                event: e,
                cancelled: false,
                currentZoom: widget.controller.zoom,
                fitWidthZoom: widget.controller.fitWidthZoom,
                onStartInertia: _startInertia,
                onPinchCommit: (finalZoom) {
                  final bounds = _computeScrollBounds(finalZoom);
                  widget.controller.setTransform(
                    nextZoom: finalZoom,
                    nextScroll: widget.controller.scrollOffset,
                    maxScrollX: bounds.dx,
                    maxScrollY: bounds.dy,
                  );
                  _syncActivePage();
                  _scheduleVisibleTiles();
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
                  _scheduleVisibleTiles();
                  _handleTapAt(pos);
                },
              );
            },
            onPointerCancel: (e) {
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
                      painter: _OverlayLayerPainter(
                        controller: widget.controller,
                        appState: widget.appState,
                      ),
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
    final scaleBucket = controller.zoom.toStringAsFixed(2);
    final themeKey = appState.theme.name;
    final docId = appState.docId;

    final paperColor = appState.theme == GpReadingTheme.dark && appState.darkPaperInvert
        ? const Color(0xFF1E293B)
        : (appState.theme == GpReadingTheme.sepia
            ? const Color(0xFFF6ECD9)
            : Colors.white);
    final paperPaint = Paint()..color = paperColor;
    final shadowPaint = Paint()..color = const Color(0x33000000);
    final imgPaint = Paint()..filterQuality = FilterQuality.low;

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

      // 2) Low-res preview fallback
      final previewKey = GpTileKey(
        docId: docId,
        pageIndex: layout.page.sourcePageIndex,
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
          imgPaint,
        );
      }

      // 3) Sharp 256×256 logical px tiles matching active scale bucket
      final totalPageWpx = math.max(1, (layout.page.displayWidth * controller.zoom * dpr).round());
      final totalPageHpx = math.max(1, (layout.page.displayHeight * controller.zoom * dpr).round());
      final tileStepPx = (gpTileLogicalSize * dpr).round();
      final cols = (totalPageWpx / tileStepPx).ceil();
      final rows = (totalPageHpx / tileStepPx).ceil();

      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          final tx = c * tileStepPx;
          final ty = r * tileStepPx;
          final tileKey = GpTileKey(
            docId: docId,
            pageIndex: layout.page.sourcePageIndex,
            tileX: tx,
            tileY: ty,
            scaleBucket: scaleBucket,
            rotation: layout.page.userRotation,
            themeKey: themeKey,
          );
          final cached = tileCache.get(tileKey);
          if (cached == null) continue;
          final tileRect = Rect.fromLTWH(
            destPage.left + tx / dpr,
            destPage.top + ty / dpr,
            cached.width / dpr,
            cached.height / dpr,
          );
          canvas.drawImageRect(
            cached.image,
            Rect.fromLTWH(0, 0, cached.width.toDouble(), cached.height.toDouble()),
            tileRect,
            imgPaint,
          );
        }
      }

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

  @override
  bool shouldRepaint(covariant _TilesLayerPainter oldDelegate) =>
      oldDelegate.appState.pages != appState.pages ||
      oldDelegate.appState.theme != appState.theme ||
      oldDelegate.appState.darkPaperInvert != appState.darkPaperInvert ||
      oldDelegate.appState.searchHits != appState.searchHits ||
      oldDelegate.appState.activeSearchIdx != appState.activeSearchIdx;
}

class _OverlayLayerPainter extends CustomPainter {
  _OverlayLayerPainter({
    required this.controller,
    required this.appState,
  }) : super(repaint: controller);

  final GpViewportController controller;
  final GpAppState appState;

  @override
  void paint(Canvas canvas, Size size) {
    final layouts = controller.computePageRects(appState.pages, controller.zoom, size.width);

    for (final layout in layouts) {
      final pageOrigin = layout.rectSurface.topLeft - controller.scrollOffset;
      final pageEls = appState.elements.where((e) => e.pageId == layout.page.id);

      for (final el in pageEls) {
        final rect = Rect.fromLTWH(
          pageOrigin.dx + el.x * controller.zoom,
          pageOrigin.dy + el.y * controller.zoom,
          el.width * controller.zoom,
          el.height * controller.zoom,
        );

        if (el.kind == 'textAdd') {
          final tp = TextPainter(
            text: TextSpan(
              text: el.text,
              style: TextStyle(
                color: Color(el.colorValue),
                fontSize: el.fontSize * controller.zoom,
                height: 1.2,
              ),
            ),
            textDirection: TextDirection.ltr,
          )..layout(maxWidth: math.max(40.0, rect.width));
          tp.paint(canvas, rect.topLeft);
        } else if (el.kind == 'highlight') {
          canvas.drawRect(
            rect,
            Paint()
              ..color = el.isRedact
                  ? const Color(0xFF000000)
                  : Color(el.fillColorValue).withValues(alpha: el.opacity),
          );
        } else if (el.kind == 'shape') {
          canvas.drawRect(
            rect,
            Paint()
              ..color = Color(el.colorValue)
              ..style = PaintingStyle.stroke
              ..strokeWidth = el.strokeWidth * controller.zoom,
          );
        } else if (el.kind == 'ink' && el.points.isNotEmpty) {
          final path = Path()
            ..moveTo(
              pageOrigin.dx + el.points.first.dx * controller.zoom,
              pageOrigin.dy + el.points.first.dy * controller.zoom,
            );
          for (var i = 1; i < el.points.length; i++) {
            path.lineTo(
              pageOrigin.dx + el.points[i].dx * controller.zoom,
              pageOrigin.dy + el.points[i].dy * controller.zoom,
            );
          }
          canvas.drawPath(
            path,
            Paint()
              ..color = Color(el.colorValue)
              ..style = PaintingStyle.stroke
              ..strokeCap = StrokeCap.round
              ..strokeJoin = StrokeJoin.round
              ..strokeWidth = el.strokeWidth * controller.zoom,
          );
        }

        if (el.id == appState.selectedElementId && appState.mode == GpAppMode.edit) {
          canvas.drawRect(
            rect,
            Paint()
              ..color = const Color(0xFF2563EB)
              ..style = PaintingStyle.stroke
              ..strokeWidth = 1.75,
          );
          final handlePaint = Paint()..color = const Color(0xFF2563EB);
          for (final corner in [rect.topLeft, rect.topRight, rect.bottomLeft, rect.bottomRight]) {
            canvas.drawCircle(corner, 6.0, handlePaint);
          }
        }
      }
    }

    // Ghost signature placement preview on active page (03 §5.7)
    final ghost = appState.ghostSignature;
    if (ghost != null &&
        appState.pages.isNotEmpty &&
        appState.activePageIndex < layouts.length) {
      final activeLayout = layouts[appState.activePageIndex];
      final pageOrigin = activeLayout.rectSurface.topLeft - controller.scrollOffset;
      final gRect = Rect.fromCenter(
        center: pageOrigin + ghost.centerPdf * controller.zoom,
        width: ghost.sizePdf.width * controller.zoom,
        height: ghost.sizePdf.height * controller.zoom,
      );
      canvas.drawRect(
        gRect,
        Paint()..color = const Color(0x222563EB),
      );
      canvas.drawRect(
        gRect,
        Paint()
          ..color = const Color(0xFF2563EB)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5,
      );
      final sigPaint = Paint()
        ..color = const Color(0xFF1D4ED8)
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..strokeWidth = 2.0 * controller.zoom;
      for (final stroke in ghost.strokes) {
        if (stroke.isEmpty) continue;
        final p = Path()
          ..moveTo(
            gRect.left + (stroke.first.dx / 300.0) * gRect.width,
            gRect.top + (stroke.first.dy / 180.0) * gRect.height,
          );
        for (var i = 1; i < stroke.length; i++) {
          p.lineTo(
            gRect.left + (stroke[i].dx / 300.0) * gRect.width,
            gRect.top + (stroke[i].dy / 180.0) * gRect.height,
          );
        }
        canvas.drawPath(p, sigPaint);
      }
    }

    // Live stylus/finger ink preview
    if (controller._liveDraftStrokeScreen.isNotEmpty) {
      final pts = controller._liveDraftStrokeScreen;
      final path = Path()..moveTo(pts.first.dx, pts.first.dy);
      for (var i = 1; i < pts.length; i++) {
        path.lineTo(pts[i].dx, pts[i].dy);
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = controller._liveStrokeColor
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..strokeWidth = controller._liveStrokeWidth,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _OverlayLayerPainter oldDelegate) =>
      oldDelegate.appState.elements != appState.elements ||
      oldDelegate.appState.selectedElementId != appState.selectedElementId ||
      oldDelegate.appState.mode != appState.mode ||
      oldDelegate.appState.ghostSignature != appState.ghostSignature;
}
