/* ==========================================================================
   On the Road · Journal feed — layout planner (pure)
   --------------------------------------------------------------------------
   The feed is an editorial spread, not a column of equal cards. This decides,
   for each entry in order, what kind of block it becomes — a cover story, a
   wide postcard, a tall or square polaroid, a pull-quote, a small ticket —
   from what the entry actually holds (a photo and its shape, or only words).
   The grid then packs the blocks densely. Nothing here groups by city or date:
   places and days appear as small labels on the blocks themselves, never as
   section breaks.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { entryImages } from '../shared/utils.ts';

export type FeedKind = 'hero' | 'wide' | 'tall' | 'square' | 'quote' | 'note';
/** How the block is dressed (the paper object it looks like). */
export type FeedVariant = 'cover' | 'postcard' | 'polaroid' | 'quote' | 'ticket';

export interface FeedBlock {
  entry: StoredJournalEntry;
  kind: FeedKind;
  variant: FeedVariant;
  /** A small, stable lean in degrees (0 for the cover story). */
  tilt: number;
  hasPhoto: boolean;
  /** Grid footprint on the six-column page (see `layoutFeed`). */
  cols: number;
  rows: number;
}

/** A twelve-column page: the smallest block is 3 wide, so four fit across. */
export const GRID_COLS = 12;
/** A cover story is due after this many blocks without one — about one per screenful. */
export const HERO_EVERY = 11;
/** Text longer than this reads as a pull-quote rather than a ticket. */
export const QUOTE_MIN_CHARS = 140;
const PORTRAIT_BELOW = 0.85;
const LANDSCAPE_ABOVE = 1.25;

interface Shape { kind: FeedKind; cols: number; rows: number; /** How far this shape is from what the entry naturally wants. */ cost: number }
const sh = (kind: FeedKind, cols: number, rows: number, cost = 0): Shape => ({ kind, cols, rows, cost });

/**
 * What each entry may become, best first.
 *
 * Widths are twelfths of the page: an ordinary photo is a quarter of it, so four sit across a
 * wide screen and a dozen entries are in view at once. Heights are in the same units, and every
 * block in a band is stretched to the band's height, so a shape's rows are only a preference
 * for how tall the band should be.
 */
function shapesFor(e: StoredJournalEntry, hasPhoto: boolean, hero: boolean): Shape[] {
  if (hasPhoto) {
    if (hero) return [sh('hero', 6, 4), sh('hero', 8, 4, 1), sh('hero', 5, 4, 2), sh('wide', 4, 3, 5)];
    const o = orientation(e.imageRatio);
    if (o === 'portrait') return [sh('tall', 3, 4), sh('tall', 4, 4, 1), sh('square', 3, 3, 3), sh('tall', 5, 4, 4)];
    if (o === 'landscape') return [sh('wide', 4, 3), sh('wide', 5, 3, 1), sh('wide', 6, 3, 2), sh('wide', 7, 3, 4), sh('square', 3, 3, 7)];
    return [sh('square', 3, 3), sh('square', 4, 3, 1), sh('square', 5, 3, 3), sh('wide', 6, 3, 4)];
  }
  if (e.body.trim().length >= QUOTE_MIN_CHARS) return [sh('quote', 4, 3), sh('quote', 5, 3, 1), sh('quote', 3, 3, 2), sh('quote', 6, 3, 3)];
  return [sh('note', 3, 2), sh('note', 4, 2, 1), sh('note', 5, 2, 2), sh('note', 6, 2, 3)];
}

export function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h;
}

/** Stable tilt in [-1.4, 1.4] degrees, one decimal. */
export function tiltFor(id: string): number {
  return Math.round(((hashId(id) % 29) - 14) / 10 * 10) / 10;
}

export function orientation(ratio: number | undefined): 'portrait' | 'landscape' | 'square' {
  if (!ratio || !Number.isFinite(ratio)) return 'square';
  if (ratio < PORTRAIT_BELOW) return 'portrait';
  if (ratio > LANDSCAPE_ABOVE) return 'landscape';
  return 'square';
}

/* ── Bands ────────────────────────────────────────────────────────────────
   The page is laid out a row at a time. Each band takes entries in order until
   their widths add up to exactly twelve, and every block in it is given the
   band's height. Because a band is only ever emitted when it is full, the grid
   cannot contain a hole; the one short band is the last, where the feed ends. */

const MIN_COLS = 3;

/** Choose widths for `n` entries so they total GRID_COLS, preferring each entry's best shape. */
function fitBand(choices: Shape[][]): Shape[] | null {
  const n = choices.length;
  let best: Shape[] | null = null;
  let bestCost = Infinity;

  const walk = (i: number, used: number, acc: Shape[], cost: number) => {
    if (cost >= bestCost) return;                       // already worse than a band we have
    if (i === n) {
      if (used === GRID_COLS) { best = [...acc]; bestCost = cost; }
      return;
    }
    const remaining = n - i - 1;
    for (const [rank, s] of choices[i].entries()) {
      const after = used + s.cols;
      // leave at least MIN_COLS for each entry still to come, and never overflow
      if (after + remaining * MIN_COLS > GRID_COLS) continue;
      acc.push(s);
      walk(i + 1, after, acc, cost + s.cost + rank * 0.5);
      acc.pop();
    }
  };
  walk(0, 0, [], 0);
  return best;
}

export function planFeed(entries: StoredJournalEntry[]): FeedBlock[] {
  const out: FeedBlock[] = [];
  let sinceHero = HERO_EVERY;   // the very first photo entry can lead

  /** `mayLead` is false for an entry sitting beside a cover, so a band never holds two of them. */
  const shapesOf = (e: StoredJournalEntry, mayLead: boolean) => {
    const hasPhoto = entryImages(e).length > 0;
    const o = orientation(e.imageRatio);
    const hero = mayLead && hasPhoto && sinceHero >= HERO_EVERY
      && (o === 'landscape' || e.favorite || out.length === 0);
    return { hasPhoto, hero, shapes: shapesFor(e, hasPhoto, hero) };
  };

  let i = 0;
  while (i < entries.length) {
    const left = entries.length - i;
    // Only the entry that opens a band may be the cover story; the ones beside it never are.
    const lead = shapesOf(entries[i], true);
    const companions = (from: number, to: number) => entries.slice(from, to).map((e) => shapesOf(e, false).shapes);
    let band: { shapes: Shape[]; count: number } | null = null;
    if (lead.hero && left >= 2) {
      for (const count of [3, 2]) {
        if (count > left) continue;
        const fit = fitBand([lead.shapes.filter((s) => s.kind === 'hero'), ...companions(i + 1, i + count)]);
        if (fit) { band = { shapes: fit, count }; break; }
      }
    }
    // Otherwise three across by preference, then two or four — wider blocks first, so the page
    // keeps a mixed rhythm instead of settling into one column width.
    if (!band) {
      for (const count of [3, 2, 4]) {
        if (count > left) continue;
        const fit = fitBand(companions(i, i + count));
        if (fit) { band = { shapes: fit, count }; break; }
      }
    }

    const count = band ? band.count : left;
    const slice = entries.slice(i, i + count);
    // The last entries may not divide into a full band; they keep their natural widths.
    const shapes = band ? band.shapes : slice.map((e) => shapesOf(e, false).shapes[0]);
    // One height for the whole band, taken from the tallest block that wanted one.
    const rows = Math.max(...shapes.map((s) => s.rows));

    slice.forEach((entry, k) => {
      const s = shapes[k];
      const hasPhoto = entryImages(entry).length > 0;
      const variant: FeedVariant =
        s.kind === 'hero' ? 'cover'
        : s.kind === 'wide' ? 'postcard'
        : s.kind === 'quote' ? 'quote'
        : s.kind === 'note' ? 'ticket'
        : entry.template === 'place' ? 'postcard' : 'polaroid';
      out.push({
        entry, kind: s.kind, variant, hasPhoto,
        tilt: s.kind === 'hero' ? 0 : tiltFor(entry.id),
        cols: s.cols, rows,
      });
      sinceHero = s.kind === 'hero' ? 0 : sinceHero + 1;
    });
    i += count;
  }
  return out;
}
