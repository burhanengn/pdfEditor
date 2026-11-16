import { GESTURE_CONSTANTS } from './gestureTypes';

interface VelocitySample {
  x: number;
  y: number;
  t: number;
}

/**
 * Sliding-window weighted velocity estimator for inertial pan (03 §5.5).
 * Returns zero velocity if pointer paused >= 40 ms before lift.
 */
export class VelocityTracker {
  private samples: VelocitySample[] = [];

  reset(): void {
    this.samples = [];
  }

  addSample(x: number, y: number, t: number): void {
    this.samples.push({ x, y, t });
    const cutoff = t - GESTURE_CONSTANTS.INERTIA_WINDOW_MS;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) {
      this.samples.shift();
    }
  }

  getVelocityPxPerMs(releaseTime: number): { vx: number; vy: number } {
    if (this.samples.length < 2) return { vx: 0, vy: 0 };
    const last = this.samples[this.samples.length - 1];
    if (releaseTime - last.t >= GESTURE_CONSTANTS.INERTIA_PAUSE_CUTOFF_MS) {
      return { vx: 0, vy: 0 };
    }

    const cutoff = releaseTime - GESTURE_CONSTANTS.INERTIA_WINDOW_MS;
    const recent = this.samples.filter((s) => s.t >= cutoff);
    if (recent.length < 2) return { vx: 0, vy: 0 };

    let totalWeight = 0;
    let sumVx = 0;
    let sumVy = 0;
    for (let i = 1; i < recent.length; i++) {
      const a = recent[i - 1];
      const b = recent[i];
      const dt = b.t - a.t;
      if (dt <= 0.5) continue;
      const w = i; // More recent samples carry higher weight
      sumVx += ((b.x - a.x) / dt) * w;
      sumVy += ((b.y - a.y) / dt) * w;
      totalWeight += w;
    }

    if (totalWeight === 0) return { vx: 0, vy: 0 };
    return {
      vx: sumVx / totalWeight,
      vy: sumVy / totalWeight,
    };
  }
}

/**
 * Exponential friction step independent of display refresh rate (60/120 Hz).
 */
export function stepInertialVelocity(
  vx: number,
  vy: number,
  dtMs: number,
): { vx: number; vy: number; dx: number; dy: number; active: boolean } {
  const decay = Math.exp(-Math.max(0, dtMs) / GESTURE_CONSTANTS.INERTIA_TAU_MS);
  const nextVx = vx * decay;
  const nextVy = vy * decay;
  const dx = ((vx + nextVx) * 0.5) * dtMs;
  const dy = ((vy + nextVy) * 0.5) * dtMs;
  const speed = Math.hypot(nextVx, nextVy);
  return {
    vx: nextVx,
    vy: nextVy,
    dx,
    dy,
    active: speed > 0.02,
  };
}

/**
 * Axis-lock filter during initial pan movement (03 §5.5):
 * Locks orthogonal axis if dominant axis >= 80% within first 10px.
 */
export function resolveAxisLock(
  totalDx: number,
  totalDy: number,
  canScrollX: boolean,
): 'none' | 'x' | 'y' {
  if (!canScrollX) return 'y';
  const dist = Math.hypot(totalDx, totalDy);
  if (dist < GESTURE_CONSTANTS.AXIS_LOCK_THRESHOLD_PX) return 'none';
  const absX = Math.abs(totalDx);
  const absY = Math.abs(totalDy);
  const sum = absX + absY;
  if (sum <= 0) return 'none';
  if (absY / sum >= GESTURE_CONSTANTS.AXIS_LOCK_RATIO) return 'y';
  if (absX / sum >= GESTURE_CONSTANTS.AXIS_LOCK_RATIO) return 'x';
  return 'none';
}

/**
 * Pinch scale with 1/3 rubber-band resistance beyond bounds and ±4% fit-width magnet snap (03 §5.4).
 */
export function applyPinchRubberBandAndSnap(params: {
  rawZoom: number;
  minZoom: number;
  maxZoom: number;
  fitWidthZoom?: number;
  isLive: boolean;
}): { zoom: number; snappedToFitWidth: boolean } {
  const { rawZoom, minZoom, maxZoom, fitWidthZoom, isLive } = params;

  if (isLive) {
    if (rawZoom < minZoom) {
      const over = minZoom - rawZoom;
      return { zoom: Math.max(minZoom * 0.55, minZoom - over / 3), snappedToFitWidth: false };
    }
    if (rawZoom > maxZoom) {
      const over = rawZoom - maxZoom;
      return { zoom: Math.min(maxZoom * 1.4, maxZoom + over / 3), snappedToFitWidth: false };
    }
    return { zoom: rawZoom, snappedToFitWidth: false };
  }

  let clamped = Math.min(maxZoom, Math.max(minZoom, rawZoom));
  let snappedToFitWidth = false;
  if (fitWidthZoom && fitWidthZoom > 0) {
    const relDiff = Math.abs(clamped - fitWidthZoom) / fitWidthZoom;
    if (relDiff <= GESTURE_CONSTANTS.FIT_WIDTH_SNAP_TOLERANCE) {
      clamped = fitWidthZoom;
      snappedToFitWidth = true;
    }
  }
  return { zoom: clamped, snappedToFitWidth };
}
