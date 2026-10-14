/* ==========================================================================
   On the Road · Journal albums — paginating a magazine (pure)
   --------------------------------------------------------------------------
   The book is where an entry is *read*, not previewed, so an entry gets as much
   of the magazine as it needs: a short note with one photo takes a whole spread
   with the picture run large, while a long piece is broken over as many spreads
   as its words and photos require, the photos laid out inside the columns.

   The unit is a "slot" — roughly a quarter of one page. A spread holds eight.
   Pagination is pure arithmetic over the entry, so the book can be re-rendered
   at any point without losing its place.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { entryImages } from '../shared/utils.ts';

/** Quarter-page units in one page, and in one spread. */
export const SLOTS_PER_PAGE = 4;
export const SLOTS_PER_SPREAD = SLOTS_PER_PAGE * 2;
/** Characters of body text that fill one slot. */
export const CHARS_PER_SLOT = 260;

export type Layout =
  /** One photo run as large as the page allows, the words beneath it. */
  | 'plate'
  /** Photos in a block beside/above the words — the ordinary magazine page. */
  | 'feature'
  /** Nothing but words: a reading column. */
  | 'column'
  /** The album's own opening page. */
  | 'title';

export interface Leaf {
  layout: Layout;
  entry?: StoredJournalEntry;
  /** Which photos of the entry this leaf shows. */
  photos: string[];
  /** The slice of the body this leaf carries. */
  text: string;
  /** True when the entry continues on the next leaf. */
  continues: boolean;
  /** True when this leaf continues one before it (so it omits the title). */
  continued: boolean;
  /** How many quarter-pages this leaf wants. */
  slots: number;
}

export type Side = Leaf | null;
export type Spread = [Side, Side];

function textSlots(chars: number): number {
  return Math.max(1, Math.ceil(chars / CHARS_PER_SLOT));
}

/**
 * Cut one entry into leaves.
 *
 * A short entry stays whole, and is given the biggest layout its photos justify. A long one is
 * split at a slot boundary: the first leaf carries the photos and the opening of the text, and
 * the rest run on as reading columns.
 */
export function leavesFor(entry: StoredJournalEntry): Leaf[] {
  const photos = entryImages(entry);
  const body = entry.body.trim();
  const words = textSlots(body.length);

  // Everything fits on one page: the whole entry is a single leaf.
  if (words + Math.min(photos.length, 2) <= SLOTS_PER_PAGE) {
    return [{
      layout: photos.length === 1 && body.length <= CHARS_PER_SLOT ? 'plate' : photos.length ? 'feature' : 'column',
      entry, photos, text: body, continues: false, continued: false,
      slots: Math.max(words + (photos.length ? 2 : 0), photos.length ? 3 : words),
    }];
  }

  // Too big for a page: the opening leaf takes the photos and as much text as fits beside them.
  const out: Leaf[] = [];
  const openingText = Math.max(CHARS_PER_SLOT, CHARS_PER_SLOT * (SLOTS_PER_PAGE - 2));
  out.push({
    layout: photos.length ? 'feature' : 'column',
    entry, photos, text: body.slice(0, openingText),
    continues: true, continued: false, slots: SLOTS_PER_PAGE,
  });

  // The rest runs on as full reading columns.
  let at = openingText;
  while (at < body.length) {
    const take = CHARS_PER_SLOT * SLOTS_PER_PAGE;
    const text = body.slice(at, at + take);
    at += take;
    out.push({
      layout: 'column', entry, photos: [], text,
      continues: at < body.length, continued: true, slots: SLOTS_PER_PAGE,
    });
  }
  return out;
}

/**
 * Lay the album out as spreads.
 *
 * Leaves are placed left page then right page. A leaf that wants more than half a page is given a
 * page of its own rather than squeezed, so a full-bleed plate never shares with a reading column.
 */
export function paginate(entries: StoredJournalEntry[]): Spread[] {
  const title: Leaf = { layout: 'title', photos: [], text: '', continues: false, continued: false, slots: SLOTS_PER_PAGE };
  const leaves: Leaf[] = [title, ...entries.flatMap(leavesFor)];

  const spreads: Spread[] = [];
  let pending: Leaf | null = null;
  for (const leaf of leaves) {
    if (!pending) { pending = leaf; continue; }
    spreads.push([pending, leaf]);
    pending = null;
  }
  if (pending) spreads.push([pending, null]);
  return spreads.length ? spreads : [[title, null]];
}

export function clampSpread(spread: number, total: number): number {
  return Math.max(0, Math.min(total - 1, Math.floor(spread) || 0));
}
