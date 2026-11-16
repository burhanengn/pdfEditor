export type PointerKind = 'mouse' | 'touch' | 'pen';

export type GestureHitKind =
  | 'empty'
  | 'handle'
  | 'selected-element'
  | 'unselected-element'
  | 'viewer-text';

export type GestureActiveKind =
  | 'idle'
  | 'pending'
  | 'pinch'
  | 'pan'
  | 'element-drag'
  | 'handle-drag'
  | 'tool-stroke'
  | 'text-selection';

export type GestureEventOutcome =
  | { type: 'none' }
  | { type: 'start'; kind: GestureActiveKind; pointerId: number; x: number; y: number }
  | { type: 'move'; kind: GestureActiveKind; x: number; y: number; dx: number; dy: number }
  | {
      type: 'pinch-start';
      cx: number;
      cy: number;
      dist: number;
      angleRad: number;
    }
  | {
      type: 'pinch-move';
      cx: number;
      cy: number;
      dist: number;
      angleRad: number;
    }
  | { type: 'pinch-end' }
  | { type: 'end'; kind: GestureActiveKind; x: number; y: number }
  | { type: 'cancel'; previousKind: GestureActiveKind }
  | { type: 'tap'; x: number; y: number; hitKind: GestureHitKind; pointerType: PointerKind }
  | { type: 'double-tap'; x: number; y: number; pointerType: PointerKind }
  | { type: 'long-press'; x: number; y: number; hitKind: GestureHitKind; pointerType: PointerKind };

export const GESTURE_CONSTANTS = {
  SLOP_TOUCH_PX: 10,
  SLOP_PEN_PX: 6,
  SLOP_MOUSE_PX: 4,
  LONG_PRESS_MS: 400,
  DOUBLE_TAP_MS: 300,
  DOUBLE_TAP_DIST_PX: 24,
  POST_PINCH_COOLDOWN_MS: 150,
  AXIS_LOCK_THRESHOLD_PX: 10,
  AXIS_LOCK_RATIO: 0.8,
  INERTIA_TAU_MS: 325,
  INERTIA_PAUSE_CUTOFF_MS: 40,
  INERTIA_WINDOW_MS: 100,
  FIT_WIDTH_SNAP_TOLERANCE: 0.04,
} as const;

export function getSlopForPointer(pointerType: PointerKind): number {
  if (pointerType === 'mouse') return GESTURE_CONSTANTS.SLOP_MOUSE_PX;
  if (pointerType === 'pen') return GESTURE_CONSTANTS.SLOP_PEN_PX;
  return GESTURE_CONSTANTS.SLOP_TOUCH_PX;
}

export function triggerHaptic(durationMs = 9): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(durationMs);
    }
  } catch {
    // Ignore unsupported environments
  }
}
