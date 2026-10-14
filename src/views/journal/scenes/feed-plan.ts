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

export const GRID_COLS = 6;
/** A cover story is due after this many blocks without one. */
export const HERO_EVERY = 8;
/** Text longer than this reads as a pull-quote rather than a ticket. */
export const QUOTE_MIN_CHARS = 140;
const PORTRAIT_BELOW = 0.85;
const LANDSCAPE_ABOVE = 1.25;

interface Shape { kind: FeedKind; cols: number; rows: number; /** How far this shape is from what the entry naturally wants. */ cost: number }
const sh = (kind: FeedKind, cols: number, rows: number, cost = 0): Shape => ({ kind, cols, rows, cost });

/** What each entry may become, best first. The layout picks the one that fills the page. */
function shapesFor(e: StoredJournalEntry, hasPhoto: boolean, hero: boolean): Shape[] {
  if (hasPhoto) {
    if (hero) return [sh('hero', 4, 3), sh('wide', 4, 2, 3), sh('wide', 3, 2, 5)];
    const o = orientation(e.imageRatio);
    if (o === 'portrait') return [sh('tall', 2, 3), sh('square', 2, 2, 3), sh('wide', 3, 2, 8)];
    if (o === 'landscape') return [sh('wide', 3, 2), sh('wide', 4, 2, 1), sh('square', 2, 2, 4), sh('tall', 2, 3, 9)];
    return [sh('square', 2, 2), sh('wide', 3, 2, 3), sh('tall', 2, 3, 4), sh('wide', 4, 2, 5)];
  }
  if (e.body.trim().length >= QUOTE_MIN_CHARS) return [sh('quote', 3, 2), sh('quote', 4, 2, 2), sh('quote', 2, 2, 3), sh('note', 3, 1, 8)];
  return [sh('note', 2, 1), sh('note', 3, 1, 1), sh('note', 4, 1, 3), sh('square', 2, 2, 6)];
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

type Cell = boolean[][];
const free = (g: Cell, r: number, c: number) => !g[r]?.[c];
function canPlace(g: Cell, r: number, c: number, cols: number, rows: number): boolean {
  if (c + cols > GRID_COLS) return false;
  for (let y = r; y < r + rows; y++) for (let x = c; x < c + cols; x++) if (!free(g, y, x)) return false;
  return true;
}
function stamp(g: Cell, r: number, c: number, cols: number, rows: number): void {
  for (let y = r; y < r + rows; y++) { g[y] ??= Array<boolean>(GRID_COLS).fill(false); for (let x = c; x < c + cols; x++) g[y][x] = true; }
}

/** The first empty cell reading left to right, top to bottom, and how wide the empty run there is. */
function firstGap(g: Cell): { r: number; c: number; w: number } {
  for (let r = 0; ; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (!free(g, r, c)) continue;
      let w = 0;
      while (c + w < GRID_COLS && free(g, r, c + w)) w++;
      return { r, c, w };
    }
  }
}

export function planFeed(entries: StoredJournalEntry[]): FeedBlock[] {
  const out: FeedBlock[] = [];
  const grid: Cell = [];
  let sinceHero = HERO_EVERY;   // the very first photo entry can lead

  for (const entry of entries) {
    const hasPhoto = entryImages(entry).length > 0;
    const shape = orientation(entry.imageRatio);
    const heroDue = hasPhoto && sinceHero >= HERO_EVERY && (shape === 'landscape' || entry.favorite || out.length === 0);
    const shapes = shapesFor(entry, hasPhoto, heroDue);

    // Fill the first empty slot as exactly as the entry's shapes allow — never leave a one-column sliver.
    const gap = firstGap(grid);
    let best: Shape | null = null;
    let bestScore = Infinity;
    for (const [i, s] of shapes.entries()) {
      if (s.cols > gap.w || !canPlace(grid, gap.r, gap.c, s.cols, s.rows)) continue;
      const left = gap.w - s.cols;
      const score = s.cost + i * 0.5 + (left === 0 ? 0 : left === 1 ? 100 : left * 1.5);
      if (score < bestScore) { bestScore = score; best = s; }
    }
    // nothing fits the slot (a narrow gap): take the smallest shape and let the page close it later
    const chosen = best ?? [...shapes].sort((a, b) => a.cols - b.cols)[0];
    let r = gap.r, c = gap.c;
    if (!best) {
      // find the first place the smallest shape does fit
      outer: for (r = 0; ; r++) for (c = 0; c + chosen.cols <= GRID_COLS; c++) if (canPlace(grid, r, c, chosen.cols, chosen.rows)) break outer;
    }
    stamp(grid, r, c, chosen.cols, chosen.rows);
    sinceHero = chosen.kind === 'hero' ? 0 : sinceHero + 1;

    const kind = chosen.kind;
    const variant: FeedVariant =
      kind === 'hero' ? 'cover'
      : kind === 'wide' ? 'postcard'
      : kind === 'quote' ? 'quote'
      : kind === 'note' ? 'ticket'
      : entry.template === 'place' ? 'postcard' : 'polaroid';
    out.push({ entry, kind, variant, tilt: kind === 'hero' ? 0 : tiltFor(entry.id), hasPhoto, cols: chosen.cols, rows: chosen.rows });
  }
  return closeGaps(out, grid);
}

const MAX_COLS = GRID_COLS;

/** Last pass: widen a block into a leftover run (or deepen one into a leftover pocket) so the page has no holes. */
function closeGaps(blocks: FeedBlock[], grid: Cell): FeedBlock[] {
  // positions are re-derived the way a dense grid places them
  const g: Cell = [];
  const placed: { block: FeedBlock; r: number; c: number }[] = [];
  for (const b of blocks) {
    let done = false;
    for (let r = 0; !done; r++) for (let c = 0; c + b.cols <= GRID_COLS; c++) {
      if (canPlace(g, r, c, b.cols, b.rows)) { stamp(g, r, c, b.cols, b.rows); placed.push({ block: b, r, c }); done = true; break; }
    }
  }
  void grid;
  const rowsUsed = g.length;
  let grew = true;
  while (grew) {
    grew = false;
    for (let r = 0; r < rowsUsed; r++) {
      let c = 0;
      while (c < GRID_COLS) {
        if (!free(g, r, c)) { c++; continue; }
        let end = c;
        while (end < GRID_COLS && free(g, r, end)) end++;
        const run = end - c;
        const left = placed.find((p) => p.c + p.block.cols === c && p.r <= r && r < p.r + p.block.rows);
        const right = placed.find((p) => p.c === end && p.r <= r && r < p.r + p.block.rows);
        const above = placed.find((p) => p.c === c && p.block.cols === run && p.r + p.block.rows === r);
        if (left && left.block.cols + run <= MAX_COLS && canPlace(g, left.r, c, run, left.block.rows)) {
          stamp(g, left.r, c, run, left.block.rows); left.block.cols += run; grew = true;
        } else if (right && right.block.cols + run <= MAX_COLS && canPlace(g, right.r, c, run, right.block.rows)) {
          stamp(g, right.r, c, run, right.block.rows); right.block.cols += run; right.c = c; grew = true;
        } else if (above && above.block.rows < 4) {
          let h = 0;
          while (r + h < rowsUsed && canPlace(g, r + h, c, run, 1)) h++;
          if (h > 0) { stamp(g, r, c, run, h); above.block.rows += h; grew = true; }
        }
        c = end;
      }
    }
  }
  return blocks;
}
