import { describe, expect, it } from 'vitest';
import { GestureArena } from '../gestureArena';
import {
  applyPinchRubberBandAndSnap,
  resolveAxisLock,
  stepInertialVelocity,
  VelocityTracker,
} from '../inertialScroller';

describe('Touch Gesture Engine: Arena arbitration & Inertial physics', () => {
  it('cancels 1-finger element drag immediately when 2nd finger lands for pinch (03 §5.3)', () => {
    const arena = new GestureArena();

    // Touch down on selected element in Edit mode
    arena.onPointerDown({
      pointerId: 1,
      pointerType: 'touch',
      x: 100,
      y: 100,
      timeMs: 1000,
      hitKind: 'selected-element',
      appMode: 'edit',
    });
    const moveRes = arena.onPointerMove({ pointerId: 1, x: 120, y: 100, timeMs: 1016 });
    expect(moveRes.some((e) => e.type === 'start' && e.kind === 'element-drag')).toBe(true);

    // 2nd finger lands -> cancels element-drag and starts pinch
    const pinchRes = arena.onPointerDown({
      pointerId: 2,
      pointerType: 'touch',
      x: 200,
      y: 200,
      timeMs: 1032,
      hitKind: 'empty',
      appMode: 'edit',
    });
    expect(pinchRes[0]).toEqual({ type: 'cancel', previousKind: 'element-drag' });
    expect(pinchRes[1].type).toBe('pinch-start');

    // Lift one finger -> seamless transition to pan without jump
    const liftOne = arena.onPointerUp({ pointerId: 2, x: 200, y: 200, timeMs: 1100 });
    expect(liftOne.some((e) => e.type === 'pinch-end')).toBe(true);
    expect(liftOne.some((e) => e.type === 'start' && e.kind === 'pan')).toBe(true);
  });

  it('enforces "select first, then drag" on unselected elements while promoting after 400ms long-press', () => {
    const arena = new GestureArena();

    // Case A: drag movement on unselected element -> pans instead of moving object
    arena.onPointerDown({
      pointerId: 1,
      pointerType: 'touch',
      x: 50,
      y: 50,
      timeMs: 100,
      hitKind: 'unselected-element',
      appMode: 'edit',
    });
    const dragRes = arena.onPointerMove({ pointerId: 1, x: 75, y: 50, timeMs: 120 });
    expect(dragRes[0]).toMatchObject({ type: 'start', kind: 'pan' });
    arena.onPointerUp({ pointerId: 1, x: 75, y: 50, timeMs: 140 });

    // Case B: hold still >= 400ms -> long-press selects & enters element-drag
    arena.onPointerDown({
      pointerId: 2,
      pointerType: 'touch',
      x: 50,
      y: 50,
      timeMs: 500,
      hitKind: 'unselected-element',
      appMode: 'edit',
    });
    const lp = arena.tickTimer(910);
    expect(lp.some((e) => e.type === 'long-press')).toBe(true);
    expect(lp.some((e) => e.type === 'start' && e.kind === 'element-drag')).toBe(true);
  });

  it('detects tap and double-tap within 300ms/24px and cancels on pointercancel', () => {
    const arena = new GestureArena();

    arena.onPointerDown({
      pointerId: 1,
      pointerType: 'touch',
      x: 150,
      y: 250,
      timeMs: 100,
      hitKind: 'empty',
    });
    const tap1 = arena.onPointerUp({ pointerId: 1, x: 152, y: 251, timeMs: 160 });
    expect(tap1[0].type).toBe('tap');

    arena.onPointerDown({
      pointerId: 1,
      pointerType: 'touch',
      x: 155,
      y: 253,
      timeMs: 260,
      hitKind: 'empty',
    });
    const tap2 = arena.onPointerUp({ pointerId: 1, x: 155, y: 253, timeMs: 310 });
    expect(tap2[0].type).toBe('double-tap');

    // Handle drag cancels cleanly on pointercancel
    arena.onPointerDown({
      pointerId: 3,
      pointerType: 'touch',
      x: 20,
      y: 20,
      timeMs: 500,
      hitKind: 'handle',
      appMode: 'edit',
    });
    const cancelRes = arena.onPointerCancel(3);
    expect(cancelRes[0]).toEqual({ type: 'cancel', previousKind: 'handle-drag' });
  });

  it('computes inertial velocity, pause cutoff, axis lock, and pinch fit-width snap', () => {
    const tracker = new VelocityTracker();
    tracker.addSample(0, 0, 100);
    tracker.addSample(0, -30, 116);
    tracker.addSample(0, -60, 132);

    const vel = tracker.getVelocityPxPerMs(140);
    expect(vel.vy).toBeLessThan(-1.5);
    const step = stepInertialVelocity(vel.vx, vel.vy, 16);
    expect(step.active).toBe(true);
    expect(step.dy).toBeLessThan(0);

    // Pause >= 40ms drops inertia
    const paused = tracker.getVelocityPxPerMs(190);
    expect(paused).toEqual({ vx: 0, vy: 0 });

    expect(resolveAxisLock(1, 20, true)).toBe('y');
    expect(resolveAxisLock(20, 1, true)).toBe('x');

    const snapped = applyPinchRubberBandAndSnap({
      rawZoom: 1.02,
      minZoom: 0.25,
      maxZoom: 5,
      fitWidthZoom: 1.0,
      isLive: false,
    });
    expect(snapped.snappedToFitWidth).toBe(true);
    expect(snapped.zoom).toBe(1.0);
  });
});
