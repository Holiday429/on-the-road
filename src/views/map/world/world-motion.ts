/* ==========================================================================
   On the Road · World — motion rules (pure)
   --------------------------------------------------------------------------
   The arithmetic behind the extras that make the world feel physical, kept apart
   from amCharts so it can be tested: how far a flick should keep spinning the
   world, and which newly earned country deserves the arrival ceremony.
   ========================================================================== */

import type { StampSpec } from '../../../core/paper/stamp.ts';

/** One reading of the world's rotation while a finger / mouse was dragging it. */
export interface RotationSample { t: number; x: number; }

const WINDOW_MS = 120;     // only the last moments of the drag say how fast it was going
const STALE_MS = 80;       // let go after pausing this long and it should simply stop
const GLIDE_MS = 400;      // how long, at release speed, the world keeps going
const MAX_DEG = 120;
const MIN_DEG = 2;

/**
 * Degrees the world should keep turning after release (signed; 0 = stop dead).
 * `samples` are in time order; `upAt` is when the pointer was released.
 */
export function flingDistance(samples: RotationSample[], upAt: number): number {
  const recent = samples.filter((s) => upAt - s.t <= WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0], last = recent[recent.length - 1];
  if (upAt - last.t > STALE_MS || last.t <= first.t) return 0;
  const v = (last.x - first.x) / (last.t - first.t);          // degrees per ms
  const d = Math.max(-MAX_DEG, Math.min(MAX_DEG, v * GLIDE_MS));
  return Math.abs(d) < MIN_DEG ? 0 : d;
}

/**
 * The country to welcome with a stamp being pressed: the most recently entered
 * country whose entry stamp has been earned but not yet seen. Null if none.
 */
export function pickArrival(stamps: StampSpec[], unseenIds: readonly string[]): StampSpec | null {
  const fresh = new Set(unseenIds);
  const candidates = stamps.filter((s) => s.kind === 'country' && s.earned && s.iso && fresh.has(s.id));
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.date > a.date ? b : a));
}
