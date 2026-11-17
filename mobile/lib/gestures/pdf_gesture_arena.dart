import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

/// Platform-parity gesture constants matching 03 §5.3 & web gestureArena.
abstract final class GpGestureConstants {
  static const double touchSlop = 10.0;
  static const double mouseSlop = 4.0;
  static const double penSlop = 6.0;
  static const Duration longPressDelay = Duration(milliseconds: 400);
  static const Duration doubleTapTimeout = Duration(milliseconds: 300);
  static const double doubleTapSlop = 24.0;
  static const double minZoom = 0.25;
  static const double maxZoom = 5.0;
  static const double fitWidthSnapTolerance = 0.04;
  static const double inertiaDecayTauMs = 325.0;

  static double slopForKind(PointerDeviceKind kind) {
    switch (kind) {
      case PointerDeviceKind.mouse:
      case PointerDeviceKind.trackpad:
        return mouseSlop;
      case PointerDeviceKind.stylus:
      case PointerDeviceKind.invertedStylus:
        return penSlop;
      default:
        return touchSlop;
    }
  }
}

enum GpActiveGestureKind { none, pan, pinch, drawStroke }

class GpVelocitySample {
  const GpVelocitySample(this.timeMs, this.pos);
  final double timeMs;
  final Offset pos;
}

/// Evaluates pointer events with strict 2nd-finger pinch interruption, focal-anchored zoom,
/// palm/stylus rejection, and exponential velocity decay (03 §5, 04 §4.2).
class GpGestureController {
  final Map<int, Offset> activePointers = {};
  final List<GpVelocitySample> _samples = [];

  GpActiveGestureKind activeKind = GpActiveGestureKind.none;
  int? primaryPointerId;
  Offset? primaryStartPos;
  Offset? lastPrimaryPos;
  bool slopExceeded = false;

  // Pinch tracking
  double _pinchStartDist = 0;
  double _pinchStartZoom = 1.0;
  Offset _pinchStartFocalLocal = Offset.zero;
  Offset _pinchStartSurfaceAnchor = Offset.zero;
  Offset _pinchLastMidpoint = Offset.zero;

  // Palm rejection & stylus detection
  bool stylusActive = false;
  DateTime? _lastPinchEndTime;

  // Inertial velocity in px/sec
  Offset inertiaVelocity = Offset.zero;

  static double computeFocalDrift({
    required Offset prevAnchorSurface,
    required Offset nextFocalSurface,
  }) =>
      (prevAnchorSurface - nextFocalSurface).distance;

  bool isWithinPostPinchCooldown() {
    final end = _lastPinchEndTime;
    if (end == null) return false;
    return DateTime.now().difference(end).inMilliseconds < 150;
  }

  void handlePointerDown({
    required PointerDownEvent event,
    required double currentZoom,
    required Offset currentScroll,
    required bool drawingToolActive,
    required VoidCallback onCancelActiveToolStroke,
    required void Function(Offset pos, double pressure, bool isEraser) onBeginToolStroke,
    required VoidCallback onStopInertia,
  }) {
    onStopInertia();
    inertiaVelocity = Offset.zero;
    activePointers[event.pointer] = event.localPosition;

    final isStylus = event.kind == PointerDeviceKind.stylus ||
        event.kind == PointerDeviceKind.invertedStylus;
    if (isStylus) stylusActive = true;

    // 2nd finger down ALWAYS wins and cancels any single-finger drag or drawing draft (03 §5.3).
    if (activePointers.length == 2) {
      if (activeKind == GpActiveGestureKind.drawStroke) {
        onCancelActiveToolStroke();
      }
      _beginPinch(currentZoom: currentZoom, currentScroll: currentScroll);
      return;
    }

    if (activePointers.length == 1) {
      primaryPointerId = event.pointer;
      primaryStartPos = event.localPosition;
      lastPrimaryPos = event.localPosition;
      slopExceeded = false;
      _samples.clear();
      _pushSample(event.localPosition);

      // Palm rejection: touch input does not draw while stylus is active (03 §5.3).
      final allowDraw = drawingToolActive &&
          (!stylusActive || isStylus) &&
          !isWithinPostPinchCooldown();

      if (allowDraw) {
        activeKind = GpActiveGestureKind.drawStroke;
        final isEraser = event.kind == PointerDeviceKind.invertedStylus ||
            (event.buttons & kSecondaryStylusButton) != 0;
        final pressure = (event.pressureMax > event.pressureMin)
            ? ((event.pressure - event.pressureMin) /
                    (event.pressureMax - event.pressureMin))
                .clamp(0.15, 1.0)
            : 0.65;
        onBeginToolStroke(event.localPosition, pressure, isEraser);
      } else {
        activeKind = GpActiveGestureKind.none;
      }
    }
  }

  void handlePointerMove({
    required PointerMoveEvent event,
    required double currentZoom,
    required Offset currentScroll,
    required void Function(double nextZoom, Offset nextScroll) onViewportTransform,
    required void Function(Offset pos, double pressure) onUpdateToolStroke,
  }) {
    if (!activePointers.containsKey(event.pointer)) return;
    activePointers[event.pointer] = event.localPosition;

    if (activeKind == GpActiveGestureKind.pinch && activePointers.length >= 2) {
      final pts = activePointers.values.take(2).toList();
      final p0 = pts[0];
      final p1 = pts[1];
      final dist = math.max(8.0, (p1 - p0).distance);
      final mid = (p0 + p1) * 0.5;
      _pinchLastMidpoint = mid;

      final rawNextZoom =
          (_pinchStartZoom * (dist / math.max(8.0, _pinchStartDist)))
              .clamp(GpGestureConstants.minZoom * 0.85, GpGestureConstants.maxZoom * 1.1);

      // Zero focal drift transform (03 §5.4): keep document anchor point directly under midpoint.
      final ratio = rawNextZoom / _pinchStartZoom;
      final nextScroll = Offset(
        _pinchStartSurfaceAnchor.dx * ratio - mid.dx,
        _pinchStartSurfaceAnchor.dy * ratio - mid.dy,
      );
      onViewportTransform(
        rawNextZoom.clamp(GpGestureConstants.minZoom, GpGestureConstants.maxZoom),
        Offset(math.max(0.0, nextScroll.dx), math.max(0.0, nextScroll.dy)),
      );
      return;
    }

    if (event.pointer != primaryPointerId) return;

    if (activeKind == GpActiveGestureKind.drawStroke) {
      final pressure = (event.pressureMax > event.pressureMin)
          ? ((event.pressure - event.pressureMin) /
                  (event.pressureMax - event.pressureMin))
              .clamp(0.15, 1.0)
          : 0.65;
      onUpdateToolStroke(event.localPosition, pressure);
      lastPrimaryPos = event.localPosition;
      return;
    }

    final start = primaryStartPos ?? event.localPosition;
    if (!slopExceeded) {
      final dist = (event.localPosition - start).distance;
      if (dist < GpGestureConstants.slopForKind(event.kind)) {
        return;
      }
      slopExceeded = true;
      activeKind = GpActiveGestureKind.pan;
    }

    if (activeKind == GpActiveGestureKind.pan) {
      final delta = event.localPosition - (lastPrimaryPos ?? event.localPosition);
      lastPrimaryPos = event.localPosition;
      _pushSample(event.localPosition);
      onViewportTransform(
        currentZoom,
        Offset(
          math.max(0.0, currentScroll.dx - delta.dx),
          math.max(0.0, currentScroll.dy - delta.dy),
        ),
      );
    }
  }

  void handlePointerUpOrCancel({
    required PointerEvent event,
    required bool cancelled,
    required double currentZoom,
    required double fitWidthZoom,
    required VoidCallback onCommitToolStroke,
    required VoidCallback onCancelToolStroke,
    required void Function(double finalZoom) onPinchCommit,
    required void Function(Offset velocity) onStartInertia,
    required void Function(Offset localPos) onTap,
  }) {
    final wasKind = activeKind;
    activePointers.remove(event.pointer);

    if (event.kind == PointerDeviceKind.stylus ||
        event.kind == PointerDeviceKind.invertedStylus) {
      if (activePointers.isEmpty) stylusActive = false;
    }

    if (wasKind == GpActiveGestureKind.pinch) {
      if (activePointers.length == 1) {
        // Remaining 1 finger transitions seamlessly to pan without anchor jump (03 §5.4).
        final remEntry = activePointers.entries.first;
        primaryPointerId = remEntry.key;
        lastPrimaryPos = remEntry.value;
        primaryStartPos = remEntry.value;
        activeKind = GpActiveGestureKind.pan;
        _lastPinchEndTime = DateTime.now();
        return;
      }
      if (activePointers.isEmpty) {
        activeKind = GpActiveGestureKind.none;
        _lastPinchEndTime = DateTime.now();
        final clamped =
            currentZoom.clamp(GpGestureConstants.minZoom, GpGestureConstants.maxZoom);
        final snapped = (fitWidthZoom > 0 &&
                (clamped - fitWidthZoom).abs() / fitWidthZoom <=
                    GpGestureConstants.fitWidthSnapTolerance)
            ? fitWidthZoom
            : clamped;
        onPinchCommit(snapped);
        return;
      }
    }

    if (wasKind == GpActiveGestureKind.drawStroke) {
      if (cancelled) {
        onCancelToolStroke();
      } else {
        onCommitToolStroke();
      }
      activeKind = GpActiveGestureKind.none;
      return;
    }

    if (activePointers.isEmpty) {
      if (wasKind == GpActiveGestureKind.pan && !cancelled) {
        final v = _computeReleaseVelocity();
        if (v.distance > 45.0) {
          inertiaVelocity = v;
          onStartInertia(v);
        }
      } else if (!slopExceeded && !cancelled && !isWithinPostPinchCooldown()) {
        onTap(event.localPosition);
      }
      activeKind = GpActiveGestureKind.none;
      primaryPointerId = null;
      _samples.clear();
    }
  }

  void _beginPinch({required double currentZoom, required Offset currentScroll}) {
    final pts = activePointers.values.take(2).toList();
    if (pts.length < 2) return;
    _pinchStartDist = math.max(8.0, (pts[1] - pts[0]).distance);
    _pinchStartZoom = currentZoom;
    _pinchStartFocalLocal = (pts[0] + pts[1]) * 0.5;
    _pinchLastMidpoint = _pinchStartFocalLocal;
    _pinchStartSurfaceAnchor = currentScroll + _pinchStartFocalLocal;
    activeKind = GpActiveGestureKind.pinch;
  }

  void _pushSample(Offset pos) {
    final now = DateTime.now().microsecondsSinceEpoch / 1000.0;
    _samples.add(GpVelocitySample(now, pos));
    if (_samples.length > 10) _samples.removeAt(0);
  }

  Offset _computeReleaseVelocity() {
    if (_samples.length < 2) return Offset.zero;
    final last = _samples.last;
    final now = DateTime.now().microsecondsSinceEpoch / 1000.0;
    // Pause >40ms before lifting => zero inertia (03 §5.5).
    if (now - last.timeMs > 40.0) return Offset.zero;
    final first = _samples.first;
    final dtSec = (last.timeMs - first.timeMs) / 1000.0;
    if (dtSec <= 0.004) return Offset.zero;
    final delta = last.pos - first.pos;
    // Flip sign because dragging finger down scrolls viewport up.
    return Offset(-delta.dx / dtSec, -delta.dy / dtSec);
  }

  double get lastPinchFocalOffsetDistance =>
      (_pinchLastMidpoint - _pinchStartFocalLocal).distance;
}
