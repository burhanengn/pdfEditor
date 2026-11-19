import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../app/session_state.dart';
import 'pdf_viewport.dart';

/// Bounded LRU GPU [ui.Image] cache for inserted images & rasterized signatures.
class GpElementImageCache {
  final Map<String, ui.Image> _cache = {};
  final Set<String> _decoding = {};

  static String cacheKeyFor(GpOverlayElement el) {
    final b = el.imageBytes;
    if (b == null) return '';
    final head = b.length >= 4 ? b[0] ^ (b[1] << 8) ^ (b[2] << 16) : 0;
    return '${el.id}:${b.length}:$head';
  }

  ui.Image? getOrDecode(GpOverlayElement el, VoidCallback onReady) {
    final bytes = el.imageBytes;
    if (bytes == null || bytes.isEmpty) return null;
    final k = cacheKeyFor(el);
    final hit = _cache[k];
    if (hit != null) return hit;
    if (!_decoding.contains(k)) {
      _decoding.add(k);
      unawaited(_decode(k, bytes, onReady));
    }
    return null;
  }

  Future<void> _decode(String key, Uint8List bytes, VoidCallback onReady) async {
    try {
      final img = await decodeImageFromList(bytes);
      if (_cache.length >= 24) {
        final oldest = _cache.keys.first;
        _cache.remove(oldest)?.dispose();
      }
      _cache[key] = img;
      onReady();
    } catch (_) {
      // Ignore corrupt image buffers gracefully.
    } finally {
      _decoding.remove(key);
    }
  }

  void dispose() {
    for (final img in _cache.values) {
      img.dispose();
    }
    _cache.clear();
  }
}

class GpSnapGuideLines {
  const GpSnapGuideLines({
    this.verticalPdfX,
    this.horizontalPdfY,
    this.pageIndex = -1,
  });

  final double? verticalPdfX;
  final double? horizontalPdfY;
  final int pageIndex;
}

class GpDraftShapePreview {
  const GpDraftShapePreview({
    required this.pageIndex,
    required this.rectPdf,
    required this.shapeType,
    required this.isLine,
    required this.startPdf,
    required this.endPdf,
    required this.strokeColorValue,
    required this.fillColorValue,
    required this.strokeWidth,
  });

  final int pageIndex;
  final Rect rectPdf;
  final String shapeType;
  final bool isLine;
  final Offset startPdf;
  final Offset endPdf;
  final int strokeColorValue;
  final int fillColorValue;
  final double strokeWidth;
}

class GpOverlayLayerPainter extends CustomPainter {
  GpOverlayLayerPainter({
    required this.controller,
    required this.appState,
    required this.imageCache,
  }) : super(repaint: controller);

  final GpViewportController controller;
  final GpAppState appState;
  final GpElementImageCache imageCache;

  @override
  void paint(Canvas canvas, Size size) {
    final layouts = controller.computePageRects(appState.pages, controller.zoom, size.width);
    final z = controller.zoom;

    for (final layout in layouts) {
      final pageOrigin = layout.rectSurface.topLeft - controller.scrollOffset;
      final pageEls = appState.elements
          .where((e) => e.pageId == layout.page.id && !e.deleted)
          .toList()
        ..sort((a, b) {
          final bt = (a.behindContent ? 0 : 1).compareTo(b.behindContent ? 0 : 1);
          return bt != 0 ? bt : a.zIndex.compareTo(b.zIndex);
        });

      for (final el in pageEls) {
        final rect = Rect.fromLTWH(
          pageOrigin.dx + el.x * z,
          pageOrigin.dy + el.y * z,
          el.width * z,
          el.height * z,
        );

        canvas.save();
        if (el.rotationDeg.abs() > 0.01) {
          final c = rect.center;
          canvas.translate(c.dx, c.dy);
          canvas.rotate(el.rotationDeg * math.pi / 180.0);
          canvas.translate(-c.dx, -c.dy);
        }

        _paintElement(canvas, el, rect, pageOrigin, z);

        if (el.id == appState.selectedElementId && appState.mode == GpAppMode.edit) {
          _paintSelectionChrome(canvas, el, rect);
        }
        canvas.restore();
      }

      // Live dynamic page numbering preview
      final pn = appState.pageNumbering;
      if (pn.enabled && (layout.pageIndex + 1) >= pn.startFromPage) {
        _paintPageNumberPreview(canvas, layout, pageOrigin, z, pn);
      }

      // Snap guide alignment lines while dragging
      final guides = controller.snapGuides;
      if (guides != null && guides.pageIndex == layout.pageIndex) {
        final gPaint = Paint()
          ..color = const Color(0xFF06B6D4)
          ..strokeWidth = 1.2;
        if (guides.verticalPdfX != null) {
          final sx = pageOrigin.dx + guides.verticalPdfX! * z;
          canvas.drawLine(
            Offset(sx, pageOrigin.dy),
            Offset(sx, pageOrigin.dy + layout.rectSurface.height),
            gPaint,
          );
        }
        if (guides.horizontalPdfY != null) {
          final sy = pageOrigin.dy + guides.horizontalPdfY! * z;
          canvas.drawLine(
            Offset(pageOrigin.dx, sy),
            Offset(pageOrigin.dx + layout.rectSurface.width, sy),
            gPaint,
          );
        }
      }

      // Live drag-to-create shape / line preview
      final draft = controller.draftShapePreview;
      if (draft != null && draft.pageIndex == layout.pageIndex) {
        if (draft.isLine) {
          canvas.drawLine(
            pageOrigin + draft.startPdf * z,
            pageOrigin + draft.endPdf * z,
            Paint()
              ..color = Color(draft.strokeColorValue)
              ..strokeCap = StrokeCap.round
              ..strokeWidth = draft.strokeWidth * z,
          );
        } else {
          final r = Rect.fromLTWH(
            pageOrigin.dx + draft.rectPdf.left * z,
            pageOrigin.dy + draft.rectPdf.top * z,
            draft.rectPdf.width * z,
            draft.rectPdf.height * z,
          );
          final p = _buildShapePath(draft.shapeType, r, 0.0);
          if ((draft.fillColorValue >>> 24) > 0) {
            canvas.drawPath(p, Paint()..color = Color(draft.fillColorValue));
          }
          canvas.drawPath(
            p,
            Paint()
              ..color = Color(draft.strokeColorValue)
              ..style = PaintingStyle.stroke
              ..strokeWidth = draft.strokeWidth * z,
          );
        }
      }
    }

    // Ghost signature placement preview
    final ghost = appState.ghostSignature;
    if (ghost != null &&
        appState.pages.isNotEmpty &&
        appState.activePageIndex < layouts.length) {
      final activeLayout = layouts[appState.activePageIndex];
      final pageOrigin = activeLayout.rectSurface.topLeft - controller.scrollOffset;
      final gRect = Rect.fromCenter(
        center: pageOrigin + ghost.centerPdf * z,
        width: ghost.sizePdf.width * z,
        height: ghost.sizePdf.height * z,
      );
      canvas.drawRect(gRect, Paint()..color = const Color(0x222563EB));
      canvas.drawRect(
        gRect,
        Paint()
          ..color = const Color(0xFF2563EB)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5,
      );
      final sigPaint = Paint()
        ..color = Color(ghost.colorValue)
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..strokeWidth = 2.0 * z;
      for (final stroke in ghost.strokes) {
        if (stroke.isEmpty) continue;
        final p = Path()
          ..moveTo(
            gRect.left + (stroke.first.dx / ghost.viewBoxSize.width) * gRect.width,
            gRect.top + (stroke.first.dy / ghost.viewBoxSize.height) * gRect.height,
          );
        for (var i = 1; i < stroke.length; i++) {
          p.lineTo(
            gRect.left + (stroke[i].dx / ghost.viewBoxSize.width) * gRect.width,
            gRect.top + (stroke[i].dy / ghost.viewBoxSize.height) * gRect.height,
          );
        }
        canvas.drawPath(p, sigPaint);
      }
    }

    // Live freehand / highlight / redact stroke preview
    if (controller.liveDraftStrokeScreen.isNotEmpty) {
      final pts = controller.liveDraftStrokeScreen;
      final path = Path()..moveTo(pts.first.dx, pts.first.dy);
      for (var i = 1; i < pts.length; i++) {
        path.lineTo(pts[i].dx, pts[i].dy);
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = controller.liveStrokeColor
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..strokeWidth = controller.liveStrokeWidth,
      );
    }
  }

  void _paintElement(
    Canvas canvas,
    GpOverlayElement el,
    Rect rect,
    Offset pageOrigin,
    double z,
  ) {
    if (el.isTextKind) {
      if ((el.backgroundColorValue >>> 24) > 0) {
        canvas.drawRect(
          rect,
          Paint()..color = Color(el.backgroundColorValue).withValues(alpha: el.opacity),
        );
      }
      final align = switch (el.align) {
        'center' => TextAlign.center,
        'right' => TextAlign.right,
        'justify' => TextAlign.justify,
        _ => TextAlign.left,
      };
      final fam = switch (el.fontFamily.toLowerCase()) {
        'serif' || 'times' => 'serif',
        'mono' || 'courier' => 'monospace',
        _ => null,
      };
      final tp = TextPainter(
        text: TextSpan(
          text: el.text,
          style: TextStyle(
            color: Color(el.colorValue).withValues(alpha: el.opacity),
            fontSize: el.fontSize * z,
            fontFamily: fam,
            fontWeight: el.bold ? FontWeight.w700 : FontWeight.w400,
            fontStyle: el.italic ? FontStyle.italic : FontStyle.normal,
            height: el.lineHeight,
          ),
        ),
        textAlign: align,
        textDirection: TextDirection.ltr,
      )..layout(minWidth: math.max(12.0, rect.width), maxWidth: math.max(24.0, rect.width));
      tp.paint(canvas, rect.topLeft);
      return;
    }

    if (el.kind == 'highlight' || el.isRedact) {
      canvas.drawRect(
        rect,
        Paint()
          ..color = el.isRedact
              ? const Color(0xFF000000)
              : Color(el.fillColorValue).withValues(alpha: el.opacity),
      );
      return;
    }

    if (el.kind == 'shape' || el.kind == 'shapeReplacement') {
      final path = (el.kind == 'shapeReplacement' && el.svgPath.isNotEmpty)
          ? _parseSvgPathToCanvasPath(el.svgPath, rect, rect.width, rect.height)
          : _buildShapePath(el.shapeType, rect, el.borderRadius * z);
      if ((el.fillColorValue >>> 24) > 0) {
        canvas.drawPath(
          path,
          Paint()..color = Color(el.fillColorValue).withValues(alpha: el.opacity),
        );
      }
      if ((el.colorValue >>> 24) > 0 && el.strokeWidth > 0) {
        final stroked = _applyDashToPath(path, el.strokeDash, el.strokeWidth * z);
        canvas.drawPath(
          stroked,
          Paint()
            ..color = Color(el.colorValue).withValues(alpha: el.opacity)
            ..style = PaintingStyle.stroke
            ..strokeCap = StrokeCap.round
            ..strokeJoin = StrokeJoin.round
            ..strokeWidth = el.strokeWidth * z,
        );
      }
      return;
    }

    if ((el.kind == 'path' || el.kind == 'ink') && el.points.isNotEmpty) {
      final screenPts = el.points.map((p) => pageOrigin + p * z).toList();
      final path = _buildSmoothPointPath(
        screenPts,
        smooth: el.smooth,
        closed: el.closed,
        pointSmooth: el.pointSmooth,
      );
      if (el.closed && (el.fillColorValue >>> 24) > 0) {
        canvas.drawPath(
          path,
          Paint()..color = Color(el.fillColorValue).withValues(alpha: el.opacity),
        );
      }
      final stroked = _applyDashToPath(path, el.strokeDash, el.strokeWidth * z);
      canvas.drawPath(
        stroked,
        Paint()
          ..color = Color(el.colorValue).withValues(alpha: el.opacity)
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..strokeWidth = el.strokeWidth * z,
      );
      return;
    }

    if (el.kind == 'image' || el.kind == 'imageReplacement') {
      final img = imageCache.getOrDecode(el, controller.markTilesDirty);
      if (img != null) {
        final crop = el.cropRect ?? const Rect.fromLTRB(0, 0, 1, 1);
        final srcRect = Rect.fromLTWH(
          crop.left * img.width,
          crop.top * img.height,
          math.max(1.0, crop.width * img.width),
          math.max(1.0, crop.height * img.height),
        );
        canvas.save();
        if (el.flipX || el.flipY) {
          canvas.translate(rect.center.dx, rect.center.dy);
          canvas.scale(el.flipX ? -1.0 : 1.0, el.flipY ? -1.0 : 1.0);
          canvas.translate(-rect.center.dx, -rect.center.dy);
        }
        canvas.drawImageRect(
          img,
          srcRect,
          rect,
          Paint()
            ..filterQuality = FilterQuality.medium
            ..color = Color.fromRGBO(255, 255, 255, el.opacity.clamp(0.0, 1.0)),
        );
        canvas.restore();
      } else {
        canvas.drawRect(rect, Paint()..color = const Color(0x223B82F6));
      }
      return;
    }

    if (el.kind == 'signature') {
      final img = imageCache.getOrDecode(el, controller.markTilesDirty);
      if (img != null) {
        canvas.drawImageRect(
          img,
          Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble()),
          rect,
          Paint()
            ..filterQuality = FilterQuality.medium
            ..color = Color.fromRGBO(255, 255, 255, el.opacity.clamp(0.0, 1.0)),
        );
        return;
      }
      for (final sp in el.svgPaths) {
        final path = _parseSvgPathToCanvasPath(
          sp.d,
          rect,
          el.viewBoxWidth,
          el.viewBoxHeight,
        );
        if (sp.fill != null && sp.fill != 'none' && sp.fill != 'transparent') {
          canvas.drawPath(
            path,
            Paint()..color = _parseCssHex(sp.fill!, el.colorValue).withValues(alpha: el.opacity),
          );
        }
        if (sp.stroke != null && sp.stroke != 'none' && sp.stroke != 'transparent') {
          canvas.drawPath(
            path,
            Paint()
              ..color = _parseCssHex(sp.stroke!, el.colorValue).withValues(alpha: el.opacity)
              ..style = PaintingStyle.stroke
              ..strokeCap = StrokeCap.round
              ..strokeJoin = StrokeJoin.round
              ..strokeWidth = (sp.strokeWidth ?? 2.0) * (rect.width / math.max(1.0, el.viewBoxWidth)),
          );
        }
      }
    }
  }

  void _paintSelectionChrome(Canvas canvas, GpOverlayElement el, Rect rect) {
    final borderColor = el.locked ? const Color(0xFFF59E0B) : const Color(0xFF2563EB);
    canvas.drawRect(
      rect,
      Paint()
        ..color = borderColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.75,
    );
    if (el.locked) return;

    // Rotation stem & knob above top-center
    final topCenter = Offset(rect.center.dx, rect.top);
    final rotKnob = Offset(rect.center.dx, rect.top - 24);
    canvas.drawLine(
      topCenter,
      rotKnob,
      Paint()
        ..color = borderColor
        ..strokeWidth = 1.5,
    );
    canvas.drawCircle(rotKnob, 6.5, Paint()..color = Colors.white);
    canvas.drawCircle(
      rotKnob,
      6.5,
      Paint()
        ..color = borderColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.0,
    );

    final handles = [
      rect.topLeft,
      Offset(rect.center.dx, rect.top),
      rect.topRight,
      Offset(rect.right, rect.center.dy),
      rect.bottomRight,
      Offset(rect.center.dx, rect.bottom),
      rect.bottomLeft,
      Offset(rect.left, rect.center.dy),
    ];
    for (final h in handles) {
      canvas.drawCircle(h, 6.0, Paint()..color = Colors.white);
      canvas.drawCircle(
        h,
        6.0,
        Paint()
          ..color = borderColor
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.0,
      );
    }
  }

  void _paintPageNumberPreview(
    Canvas canvas,
    GpPageLayoutRect layout,
    Offset pageOrigin,
    double z,
    GpPageNumberingConfig pn,
  ) {
    final oneBased = layout.pageIndex + 1;
    final numVal = pn.startNumber + (oneBased - pn.startFromPage);
    final total = math.max(numVal, appState.pages.length - (pn.startFromPage - 1) + (pn.startNumber - 1));
    final text = switch (pn.format) {
      'number-of-total' => '$numVal / $total',
      'page-number' => 'Sayfa $numVal',
      'page-number-of-total' => 'Sayfa $numVal / $total',
      'roman-lower' => _toRoman(numVal).toLowerCase(),
      'roman-upper' => _toRoman(numVal),
      _ => '$numVal',
    };
    final align = pn.position.endsWith('left')
        ? TextAlign.left
        : (pn.position.endsWith('right') ? TextAlign.right : TextAlign.center);
    final isTop = pn.position.startsWith('top');
    final mx = pn.marginX.clamp(8.0, layout.page.displayWidth * 0.35);
    final my = pn.marginY.clamp(6.0, layout.page.displayHeight * 0.35);
    final boxW = math.max(40.0, layout.page.displayWidth - mx * 2) * z;
    final yPdf = isTop ? (my - pn.fontSize * 0.25) : (layout.page.displayHeight - my - pn.fontSize);

    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: Color(pn.colorValue).withValues(alpha: pn.opacity),
          fontSize: pn.fontSize * z,
        ),
      ),
      textAlign: align,
      textDirection: TextDirection.ltr,
    )..layout(minWidth: boxW, maxWidth: boxW);
    tp.paint(canvas, Offset(pageOrigin.dx + mx * z, pageOrigin.dy + yPdf * z));
  }

  @override
  bool shouldRepaint(covariant GpOverlayLayerPainter oldDelegate) =>
      oldDelegate.appState.elements != appState.elements ||
      oldDelegate.appState.selectedElementId != appState.selectedElementId ||
      oldDelegate.appState.mode != appState.mode ||
      oldDelegate.appState.ghostSignature != appState.ghostSignature ||
      oldDelegate.appState.pageNumbering != appState.pageNumbering;
}

Path _buildShapePath(String shapeType, Rect r, double radius) {
  final path = Path();
  switch (shapeType) {
    case 'ellipse':
      path.addOval(r);
      break;
    case 'triangle':
      path.moveTo(r.center.dx, r.top);
      path.lineTo(r.right, r.bottom);
      path.lineTo(r.left, r.bottom);
      path.close();
      break;
    case 'diamond':
      path.moveTo(r.center.dx, r.top);
      path.lineTo(r.right, r.center.dy);
      path.lineTo(r.center.dx, r.bottom);
      path.lineTo(r.left, r.center.dy);
      path.close();
      break;
    case 'arrow':
      final w = r.width;
      final h = r.height;
      path.moveTo(r.left, r.top + h * 0.3);
      path.lineTo(r.left + w * 0.62, r.top + h * 0.3);
      path.lineTo(r.left + w * 0.62, r.top);
      path.lineTo(r.right, r.top + h * 0.5);
      path.lineTo(r.left + w * 0.62, r.bottom);
      path.lineTo(r.left + w * 0.62, r.top + h * 0.7);
      path.lineTo(r.left, r.top + h * 0.7);
      path.close();
      break;
    default:
      if (radius > 0.25) {
        path.addRRect(RRect.fromRectAndRadius(r, Radius.circular(radius)));
      } else {
        path.addRect(r);
      }
      break;
  }
  return path;
}

Path _buildSmoothPointPath(
  List<Offset> pts, {
  bool smooth = true,
  bool closed = false,
  List<bool?> pointSmooth = const [],
}) {
  final p = Path();
  final n = pts.length;
  if (n == 0) return p;
  if (n == 1) {
    p.moveTo(pts.first.dx, pts.first.dy);
    p.lineTo(pts.first.dx + 0.5, pts.first.dy + 0.5);
    return p;
  }
  bool isSmoothAt(int i) => i < pointSmooth.length && pointSmooth[i] != null ? pointSmooth[i]! : smooth;
  final hasAnySmoothCorner = closed
      ? List.generate(n, (i) => i).any(isSmoothAt)
      : List.generate((n - 2).clamp(0, n), (i) => i + 1).any(isSmoothAt);
  if (!hasAnySmoothCorner || n < 3) {
    p.moveTo(pts.first.dx, pts.first.dy);
    for (var i = 1; i < n; i++) {
      p.lineTo(pts[i].dx, pts[i].dy);
    }
    if (closed) p.close();
    return p;
  }
  Offset mid(Offset a, Offset b) => Offset((a.dx + b.dx) * 0.5, (a.dy + b.dy) * 0.5);
  bool differs(Offset a, Offset b) => (a.dx - b.dx).abs() > 1e-4 || (a.dy - b.dy).abs() > 1e-4;

  if (!closed) {
    p.moveTo(pts.first.dx, pts.first.dy);
    var cursor = pts.first;
    for (var i = 1; i < n - 1; i++) {
      final curr = pts[i];
      if (isSmoothAt(i)) {
        final enter = (i == 1 && isSmoothAt(0)) ? pts[0] : mid(pts[i - 1], curr);
        final exit = mid(curr, pts[i + 1]);
        if (differs(cursor, enter)) p.lineTo(enter.dx, enter.dy);
        p.quadraticBezierTo(curr.dx, curr.dy, exit.dx, exit.dy);
        cursor = exit;
      } else {
        if (differs(cursor, curr)) p.lineTo(curr.dx, curr.dy);
        cursor = curr;
      }
    }
    final last = pts.last;
    if (differs(cursor, last)) p.lineTo(last.dx, last.dy);
    return p;
  }

  final enters = List<Offset>.generate(
    n,
    (i) => isSmoothAt(i) ? mid(pts[(i - 1 + n) % n], pts[i]) : pts[i],
  );
  final exits = List<Offset>.generate(
    n,
    (i) => isSmoothAt(i) ? mid(pts[i], pts[(i + 1) % n]) : pts[i],
  );
  p.moveTo(enters[0].dx, enters[0].dy);
  for (var i = 0; i < n; i++) {
    if (isSmoothAt(i)) {
      p.quadraticBezierTo(pts[i].dx, pts[i].dy, exits[i].dx, exits[i].dy);
    }
    final nextEnter = enters[(i + 1) % n];
    if (differs(exits[i], nextEnter)) {
      p.lineTo(nextEnter.dx, nextEnter.dy);
    }
  }
  p.close();
  return p;
}

Path _applyDashToPath(Path src, String dashStyle, double strokeWidth) {
  if (dashStyle == 'solid') return src;
  final dash = dashStyle == 'dotted' ? math.max(1.5, strokeWidth) : math.max(4.0, strokeWidth * 3.0);
  final gap = dashStyle == 'dotted' ? math.max(3.0, strokeWidth * 2.0) : math.max(3.0, strokeWidth * 2.0);
  final out = Path();
  for (final metric in src.computeMetrics()) {
    var dist = 0.0;
    while (dist < metric.length) {
      final end = math.min(dist + dash, metric.length);
      out.addPath(metric.extractPath(dist, end), Offset.zero);
      dist += dash + gap;
    }
  }
  return out;
}

Path _parseSvgPathToCanvasPath(String d, Rect targetRect, double vbW, double vbH) {
  final path = Path();
  final sx = targetRect.width / math.max(1.0, vbW);
  final sy = targetRect.height / math.max(1.0, vbH);
  final ox = targetRect.left;
  final oy = targetRect.top;
  final matches = RegExp(r'[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?').allMatches(d);
  final tokens = matches.map((m) => m.group(0)!).toList();

  var i = 0;
  var cmd = '';
  var curX = 0.0;
  var curY = 0.0;

  double? nextNum() {
    if (i >= tokens.length) return null;
    final v = double.tryParse(tokens[i]);
    if (v != null) i++;
    return v;
  }

  while (i < tokens.length) {
    final t = tokens[i];
    if (RegExp(r'^[a-zA-Z]$').hasMatch(t)) {
      cmd = t;
      i++;
      if (cmd == 'Z' || cmd == 'z') path.close();
      continue;
    }
    switch (cmd) {
      case 'M':
      case 'm':
        final x = nextNum();
        final y = nextNum();
        if (x == null || y == null) {
          i = tokens.length;
          break;
        }
        curX = cmd == 'm' ? curX + x : x;
        curY = cmd == 'm' ? curY + y : y;
        path.moveTo(ox + curX * sx, oy + curY * sy);
        cmd = cmd == 'm' ? 'l' : 'L';
        break;
      case 'L':
      case 'l':
        final x = nextNum();
        final y = nextNum();
        if (x == null || y == null) {
          i = tokens.length;
          break;
        }
        curX = cmd == 'l' ? curX + x : x;
        curY = cmd == 'l' ? curY + y : y;
        path.lineTo(ox + curX * sx, oy + curY * sy);
        break;
      case 'H':
      case 'h':
        final x = nextNum();
        if (x == null) {
          i = tokens.length;
          break;
        }
        curX = cmd == 'h' ? curX + x : x;
        path.lineTo(ox + curX * sx, oy + curY * sy);
        break;
      case 'V':
      case 'v':
        final y = nextNum();
        if (y == null) {
          i = tokens.length;
          break;
        }
        curY = cmd == 'v' ? curY + y : y;
        path.lineTo(ox + curX * sx, oy + curY * sy);
        break;
      case 'Q':
      case 'q':
        final x1 = nextNum();
        final y1 = nextNum();
        final x = nextNum();
        final y = nextNum();
        if (x1 == null || y1 == null || x == null || y == null) {
          i = tokens.length;
          break;
        }
        final qx = cmd == 'q' ? curX + x1 : x1;
        final qy = cmd == 'q' ? curY + y1 : y1;
        curX = cmd == 'q' ? curX + x : x;
        curY = cmd == 'q' ? curY + y : y;
        path.quadraticBezierTo(ox + qx * sx, oy + qy * sy, ox + curX * sx, oy + curY * sy);
        break;
      case 'C':
      case 'c':
        final x1 = nextNum();
        final y1 = nextNum();
        final x2 = nextNum();
        final y2 = nextNum();
        final x = nextNum();
        final y = nextNum();
        if (x1 == null || y1 == null || x2 == null || y2 == null || x == null || y == null) {
          i = tokens.length;
          break;
        }
        final ax1 = cmd == 'c' ? curX + x1 : x1;
        final ay1 = cmd == 'c' ? curY + y1 : y1;
        final ax2 = cmd == 'c' ? curX + x2 : x2;
        final ay2 = cmd == 'c' ? curY + y2 : y2;
        curX = cmd == 'c' ? curX + x : x;
        curY = cmd == 'c' ? curY + y : y;
        path.cubicTo(
          ox + ax1 * sx,
          oy + ay1 * sy,
          ox + ax2 * sx,
          oy + ay2 * sy,
          ox + curX * sx,
          oy + curY * sy,
        );
        break;
      default:
        i++;
    }
  }
  return path;
}

Color _parseCssHex(String hex, int fallback) {
  final h = hex.trim().replaceFirst('#', '');
  if (h.length == 6) {
    final parsed = int.tryParse(h, radix: 16);
    if (parsed != null) return Color(0xFF000000 | parsed);
  }
  return Color(fallback);
}

String _toRoman(int num) {
  const table = [
    (1000, 'M'),
    (900, 'CM'),
    (500, 'D'),
    (400, 'CD'),
    (100, 'C'),
    (90, 'XC'),
    (50, 'L'),
    (40, 'XL'),
    (10, 'X'),
    (9, 'IX'),
    (5, 'V'),
    (4, 'IV'),
    (1, 'I'),
  ];
  var rem = num.clamp(1, 3999);
  final sb = StringBuffer();
  for (final pair in table) {
    while (rem >= pair.$1) {
      sb.write(pair.$2);
      rem -= pair.$1;
    }
  }
  return sb.toString();
}
