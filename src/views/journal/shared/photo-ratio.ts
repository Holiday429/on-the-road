/* ==========================================================================
   On the Road · Journal — photo shapes (pure)
   --------------------------------------------------------------------------
   The traveller's photos come in a handful of shapes: 3:4 and 2:3 upright,
   4:3, 3:2 and 16:9 wide. A postcard (and later a magazine slot) is laid out
   for one of those, not for whatever the file measured — a 1.52 reading and a
   1.5 reading are the same photograph, and snapping them to one value is what
   lets neighbouring pictures line up.

   9:16 (phone screenshots) and 1:1 are the fallbacks, not the main cases.
   ========================================================================== */

export type RatioClass = '3:4' | '4:3' | '2:3' | '3:2' | '16:9' | '9:16' | '1:1';
export type Orientation = 'portrait' | 'landscape' | 'square';

const VALUES: Record<RatioClass, number> = {
  '3:4': 3 / 4,
  '4:3': 4 / 3,
  '2:3': 2 / 3,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
};
const CLASSES = Object.keys(VALUES) as RatioClass[];

/** Within this factor of 1 a photo reads as square rather than slightly wide or tall. */
const SQUARE_TOLERANCE = 1.08;

const usable = (r: number) => typeof r === 'number' && Number.isFinite(r) && r > 0;

/**
 * The nearest common shape to a measured width / height.
 *
 * Distance is taken on the log scale, so "twice as wide" and "half as wide" are
 * equally far from 1 and a ratio isn't pulled toward the larger candidates. A
 * ratio that isn't a number (0, NaN, negative) is square — the shape that takes
 * no side, so a photo we failed to measure never looks cropped the wrong way.
 */
export function snapRatio(r: number): RatioClass {
  if (!usable(r)) return '1:1';
  const at = Math.log(r);
  let best: RatioClass = '1:1';
  let bestGap = Infinity;
  for (const c of CLASSES) {
    const gap = Math.abs(Math.log(VALUES[c]) - at);
    if (gap < bestGap) { best = c; bestGap = gap; }
  }
  return best;
}

export function orientationOf(r: number): Orientation {
  if (!usable(r)) return 'square';
  if (Math.abs(Math.log(r)) < Math.log(SQUARE_TOLERANCE)) return 'square';
  return r > 1 ? 'landscape' : 'portrait';
}

/** The exact number for a class, e.g. '3:2' → 1.5. Frames are sized from this alone. */
export function ratioValue(c: RatioClass): number {
  return VALUES[c];
}
