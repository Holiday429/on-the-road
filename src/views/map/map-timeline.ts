/* ==========================================================================
   On the Road · Map — timeline scrubber math (pure)
   --------------------------------------------------------------------------
   The date-scrubber's numeric core, split out of map.ts so the fraction↔ms
   conversions and range computation can be unit-tested without the DOM. The
   scrubber's rendering, pointer wiring, and lighting stay in map.ts.
   ========================================================================== */

/** Inclusive epoch-ms span the scrubber maps [0,1] onto. */
export interface TimeRange { minMs: number; maxMs: number; }

/** Epoch ms for a leg's start date (local midnight). */
export function legStartMs(l: { dateFrom: string }): number {
  return +new Date(`${l.dateFrom}T00:00:00`);
}

/** Epoch ms for a leg's end date (local midnight). */
export function legEndMs(l: { dateTo: string }): number {
  return +new Date(`${l.dateTo}T00:00:00`);
}

/** "Jan 2026"-style label for a scrubber cursor. */
export function fmtScrubDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * The [min,max] epoch-ms span across a set of legs, or null if a usable range
 * can't be formed (fewer than 2 legs, or non-finite / collapsed bounds). A
 * null result is the scrubber's "don't show" signal.
 */
export function timelineRange(legs: { dateFrom: string; dateTo: string }[]): TimeRange | null {
  if (legs.length < 2) return null;
  const minMs = Math.min(...legs.map(legStartMs));
  const maxMs = Math.max(...legs.map(legEndMs));
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || maxMs <= minMs) return null;
  return { minMs, maxMs };
}

/** Clamp a fraction to [0,1]. */
export function clampFraction(f: number): number {
  return Math.min(1, Math.max(0, f));
}

/** Position of `ms` within the range as a [0,1] fraction (clamped). */
export function msToFraction(ms: number, range: TimeRange | null): number {
  if (!range) return 1;
  return clampFraction((ms - range.minMs) / (range.maxMs - range.minMs));
}

/** The epoch ms at fraction `f` of the range (f is clamped first). */
export function fractionToMs(f: number, range: TimeRange | null): number {
  if (!range) return 0;
  return range.minMs + clampFraction(f) * (range.maxMs - range.minMs);
}
