import {
  GESTURE_CONSTANTS,
  getSlopForPointer,
  type GestureActiveKind,
  type GestureEventOutcome,
  type GestureHitKind,
  type PointerKind,
} from './gestureTypes';

export interface ArenaPointerInput {
  pointerId: number;
  pointerType: PointerKind;
  x: number;
  y: number;
  timeMs: number;
  hitKind?: GestureHitKind;
  activeToolIsStroke?: boolean;
  appMode?: 'view' | 'edit';
}

interface TrackedPointer {
  id: number;
  pointerType: PointerKind;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startTimeMs: number;
}

/**
 * Pure DOM-free Gesture Arena implementing the exact arbitration table from 03 §5.3:
 * - 2nd finger down ALWAYS cancels active 1-finger gesture and enters pinch.
 * - Handle drag starts immediately without slop.
 * - Selected element drags after slop; unselected element pans on drag ("select first, then drag")
 *   or promotes via 400ms long-press.
 * - Pen palm rejection & 150ms post-pinch cooldown.
 */
export class GestureArena {
  private pointers = new Map<number, TrackedPointer>();
  private activeKind: GestureActiveKind = 'idle';
  private primaryPointerId: number | null = null;
  private primaryHitKind: GestureHitKind = 'empty';
  private primaryToolStroke = false;
  private primaryAppMode: 'view' | 'edit' = 'view';
  private lastTap: { x: number; y: number; timeMs: number } | null = null;
  private lastPenTimeMs = -Infinity;
  private postPinchUntilMs = -Infinity;
  private longPressFired = false;

  getState(): GestureActiveKind {
    return this.activeKind;
  }

  getPointerCount(): number {
    return this.pointers.size;
  }

  reset(): void {
    this.pointers.clear();
    this.activeKind = 'idle';
    this.primaryPointerId = null;
    this.longPressFired = false;
  }

  onPointerDown(input: ArenaPointerInput): GestureEventOutcome[] {
    const outcomes: GestureEventOutcome[] = [];

    if (input.pointerType === 'pen') {
      this.lastPenTimeMs = input.timeMs;
    }

    // Palm rejection: touch input while pen is active/recent never initiates drawing strokes (03 §5.3)
    const penActive =
      input.pointerType === 'touch' && input.timeMs - this.lastPenTimeMs < 600;

    // Ignore 3rd+ finger beyond 2-finger pinch (03 §5.4)
    if (this.pointers.size >= 2) {
      return outcomes;
    }

    this.pointers.set(input.pointerId, {
      id: input.pointerId,
      pointerType: input.pointerType,
      startX: input.x,
      startY: input.y,
      x: input.x,
      y: input.y,
      startTimeMs: input.timeMs,
    });

    if (this.pointers.size === 2) {
      // Rule 1: 2nd finger ALWAYS cancels any in-flight 1-finger gesture and switches to pinch
      if (this.activeKind !== 'idle' && this.activeKind !== 'pending') {
        outcomes.push({ type: 'cancel', previousKind: this.activeKind });
      }
      this.activeKind = 'pinch';
      this.primaryPointerId = null;
      const [p1, p2] = [...this.pointers.values()];
      outcomes.push({
        type: 'pinch-start',
        cx: (p1.x + p2.x) * 0.5,
        cy: (p1.y + p2.y) * 0.5,
        dist: Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y)),
        angleRad: Math.atan2(p2.y - p1.y, p2.x - p1.x),
      });
      return outcomes;
    }

    // First finger down
    if (input.timeMs < this.postPinchUntilMs) {
      // Suppress accidental gesture starts within 150ms after pinch lift
      this.activeKind = 'pending';
      this.primaryPointerId = input.pointerId;
      this.primaryHitKind = 'empty';
      this.primaryToolStroke = false;
      this.longPressFired = false;
      return outcomes;
    }

    this.primaryPointerId = input.pointerId;
    this.primaryHitKind = input.hitKind ?? 'empty';
    this.primaryToolStroke = Boolean(input.activeToolIsStroke) && !penActive;
    this.primaryAppMode = input.appMode ?? 'view';
    this.longPressFired = false;

    if (this.primaryHitKind === 'handle') {
      this.activeKind = 'handle-drag';
      outcomes.push({
        type: 'start',
        kind: 'handle-drag',
        pointerId: input.pointerId,
        x: input.x,
        y: input.y,
      });
    } else if (this.primaryToolStroke) {
      this.activeKind = 'tool-stroke';
      outcomes.push({
        type: 'start',
        kind: 'tool-stroke',
        pointerId: input.pointerId,
        x: input.x,
        y: input.y,
      });
    } else {
      this.activeKind = 'pending';
    }

    return outcomes;
  }

  onPointerMove(input: {
    pointerId: number;
    x: number;
    y: number;
    timeMs: number;
  }): GestureEventOutcome[] {
    const outcomes: GestureEventOutcome[] = [];
    const ptr = this.pointers.get(input.pointerId);
    if (!ptr) return outcomes;

    const dx = input.x - ptr.x;
    const dy = input.y - ptr.y;
    ptr.x = input.x;
    ptr.y = input.y;

    if (this.activeKind === 'pinch' && this.pointers.size === 2) {
      const [p1, p2] = [...this.pointers.values()];
      outcomes.push({
        type: 'pinch-move',
        cx: (p1.x + p2.x) * 0.5,
        cy: (p1.y + p2.y) * 0.5,
        dist: Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y)),
        angleRad: Math.atan2(p2.y - p1.y, p2.x - p1.x),
      });
      return outcomes;
    }

    if (input.pointerId !== this.primaryPointerId) return outcomes;

    if (this.activeKind === 'pending') {
      if (input.timeMs < this.postPinchUntilMs) return outcomes;

      const slop = getSlopForPointer(ptr.pointerType);
      const totalDist = Math.hypot(ptr.x - ptr.startX, ptr.y - ptr.startY);
      if (totalDist < slop) {
        return outcomes;
      }

      // Slop exceeded -> arbitrate winner per 03 §5.3
      let winner: GestureActiveKind = 'pan';
      if (this.primaryHitKind === 'selected-element' && this.primaryAppMode === 'edit') {
        winner = 'element-drag';
      } else {
        // Unselected element, viewer-text, or empty space -> pan
        winner = 'pan';
      }

      this.activeKind = winner;
      outcomes.push({
        type: 'start',
        kind: winner,
        pointerId: ptr.id,
        x: ptr.x,
        y: ptr.y,
      });
      outcomes.push({
        type: 'move',
        kind: winner,
        x: ptr.x,
        y: ptr.y,
        dx: ptr.x - ptr.startX,
        dy: ptr.y - ptr.startY,
      });
      return outcomes;
    }

    if (this.activeKind !== 'idle') {
      outcomes.push({
        type: 'move',
        kind: this.activeKind,
        x: ptr.x,
        y: ptr.y,
        dx,
        dy,
      });
    }

    return outcomes;
  }

  /**
   * Checks 400ms long-press eligibility when pointer stays within slop.
   */
  tickTimer(nowMs: number): GestureEventOutcome[] {
    if (this.activeKind !== 'pending' || this.longPressFired || this.primaryPointerId === null) {
      return [];
    }
    const ptr = this.pointers.get(this.primaryPointerId);
    if (!ptr) return [];
    if (nowMs - ptr.startTimeMs < GESTURE_CONSTANTS.LONG_PRESS_MS) {
      return [];
    }

    this.longPressFired = true;
    const outcomes: GestureEventOutcome[] = [
      {
        type: 'long-press',
        x: ptr.x,
        y: ptr.y,
        hitKind: this.primaryHitKind,
        pointerType: ptr.pointerType,
      },
    ];

    if (this.primaryAppMode === 'edit' && this.primaryHitKind === 'unselected-element') {
      this.activeKind = 'element-drag';
      outcomes.push({
        type: 'start',
        kind: 'element-drag',
        pointerId: ptr.id,
        x: ptr.x,
        y: ptr.y,
      });
    } else if (this.primaryAppMode === 'view' && this.primaryHitKind === 'viewer-text') {
      this.activeKind = 'text-selection';
      outcomes.push({
        type: 'start',
        kind: 'text-selection',
        pointerId: ptr.id,
        x: ptr.x,
        y: ptr.y,
      });
    }

    return outcomes;
  }

  onPointerUp(input: {
    pointerId: number;
    x: number;
    y: number;
    timeMs: number;
  }): GestureEventOutcome[] {
    const outcomes: GestureEventOutcome[] = [];
    const ptr = this.pointers.get(input.pointerId);
    if (!ptr) return outcomes;

    this.pointers.delete(input.pointerId);

    if (this.activeKind === 'pinch') {
      if (this.pointers.size === 1) {
        // 2 -> 1 finger lift: pinch ends and remaining finger continues seamlessly as pan (03 §5.4)
        outcomes.push({ type: 'pinch-end' });
        const [remaining] = [...this.pointers.values()];
        remaining.startX = remaining.x;
        remaining.startY = remaining.y;
        this.primaryPointerId = remaining.id;
        this.activeKind = 'pan';
        this.postPinchUntilMs = input.timeMs + GESTURE_CONSTANTS.POST_PINCH_COOLDOWN_MS;
        outcomes.push({
          type: 'start',
          kind: 'pan',
          pointerId: remaining.id,
          x: remaining.x,
          y: remaining.y,
        });
      } else {
        outcomes.push({ type: 'pinch-end' });
        this.activeKind = 'idle';
        this.primaryPointerId = null;
        this.postPinchUntilMs = input.timeMs + GESTURE_CONSTANTS.POST_PINCH_COOLDOWN_MS;
      }
      return outcomes;
    }

    if (input.pointerId === this.primaryPointerId) {
      if (this.activeKind === 'pending' && !this.longPressFired) {
        const dist = Math.hypot(input.x - ptr.startX, input.y - ptr.startY);
        const dur = input.timeMs - ptr.startTimeMs;
        if (
          input.timeMs >= this.postPinchUntilMs &&
          dist < getSlopForPointer(ptr.pointerType) &&
          dur < GESTURE_CONSTANTS.DOUBLE_TAP_MS
        ) {
          const isDouble =
            this.lastTap !== null &&
            input.timeMs - this.lastTap.timeMs <= GESTURE_CONSTANTS.DOUBLE_TAP_MS &&
            Math.hypot(input.x - this.lastTap.x, input.y - this.lastTap.y) <=
              GESTURE_CONSTANTS.DOUBLE_TAP_DIST_PX;
          if (isDouble) {
            this.lastTap = null;
            outcomes.push({
              type: 'double-tap',
              x: input.x,
              y: input.y,
              pointerType: ptr.pointerType,
            });
          } else {
            this.lastTap = { x: input.x, y: input.y, timeMs: input.timeMs };
            outcomes.push({
              type: 'tap',
              x: input.x,
              y: input.y,
              hitKind: this.primaryHitKind,
              pointerType: ptr.pointerType,
            });
          }
        }
      } else if (this.activeKind !== 'idle' && this.activeKind !== 'pending') {
        outcomes.push({
          type: 'end',
          kind: this.activeKind,
          x: input.x,
          y: input.y,
        });
      }
      this.activeKind = 'idle';
      this.primaryPointerId = null;
      this.longPressFired = false;
    }

    return outcomes;
  }

  onPointerCancel(pointerId: number): GestureEventOutcome[] {
    const outcomes: GestureEventOutcome[] = [];
    if (!this.pointers.has(pointerId)) return outcomes;
    this.pointers.delete(pointerId);

    if (this.activeKind === 'pinch') {
      outcomes.push({ type: 'pinch-end' });
    } else if (this.activeKind !== 'idle' && this.activeKind !== 'pending') {
      outcomes.push({ type: 'cancel', previousKind: this.activeKind });
    }

    if (this.pointers.size === 0) {
      this.activeKind = 'idle';
      this.primaryPointerId = null;
      this.longPressFired = false;
    }
    return outcomes;
  }
}
