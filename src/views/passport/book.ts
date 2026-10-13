/* ==========================================================================
   On the Road · Passport — book layout (pure)
   --------------------------------------------------------------------------
   Turns the passport's stamps into pages and the pages into leaves.

   · Stamp pages never mix trips: each page carries its trip's name in the
     header, and a trip's pages are named `${tripId}#${n}` — a name that does
     not move when other trips gain stamps, so a stamp the traveller pressed
     stays on its page (Placement.page).
   · Stamps nobody has pressed yet are scattered over the free spots with a
     little jitter; pressed ones keep the exact spot, angle and force they
     were given.
   · A leaf is one sheet: its front is a right-hand page, its back the
     left-hand page of the next spread. On a narrow screen a leaf carries one
     page and its back is blank — the same flip, one page at a time.
   ========================================================================== */

import type { PassportStamp } from '../../data/passport.ts';
import { hashStr } from '../../data/palette.ts';

/** Stamps one page holds. */
export const PAGE_CAP = 6;

/** Where the traveller pressed a stamp. x / y are the stamp's centre in % of the page. */
export interface Placement {
  page: string;
  x: number;
  y: number;
  rot: number;
  /** 0–1: how hard it was pressed. */
  pressure: number;
  at: number;
}

export interface PlacedStamp {
  stamp: PassportStamp;
  x: number;
  y: number;
  rot: number;
  pressure?: number;
  /** True once the traveller has pressed it themselves (or let it auto-press). */
  pressed: boolean;
}

export interface StampPage {
  kind: 'stamps';
  /** `${tripId}#${n}`; '' for the placeholder page of an empty passport. */
  key: string;
  tripId: string;
  tripName: string;
  items: PlacedStamp[];
}

export type BookPage = { kind: 'cover' } | { kind: 'inside' } | { kind: 'bio' } | { kind: 'visas' } | StampPage | { kind: 'back' };

/** Spots the unpressed stamps settle into (x, y in % of the page, below the page header). Taken in this order, so a half-empty page is spread down the sheet instead of crowding the top. */
const SPOTS: ReadonlyArray<readonly [number, number]> = [
  [29, 30], [72, 55], [31, 79], [71, 34], [28, 55], [69, 82],
];

const tripOrder = (stamps: PassportStamp[]): string[] => {
  const ids: string[] = [];
  for (const s of stamps) if (!ids.includes(s.tripId)) ids.push(s.tripId);
  return ids;
};

/** −1…1, stable for a seed. */
function wobble(seed: string): number {
  return ((hashStr(seed) % 2001) / 1000) - 1;
}

/** Stamp pages, oldest trip first. An empty passport gets one empty page. */
export function stampPages(stamps: PassportStamp[], placements: Readonly<Record<string, Placement>> = {}): StampPage[] {
  if (stamps.length === 0) return [{ kind: 'stamps', key: '', tripId: '', tripName: '', items: [] }];
  const pages: StampPage[] = [];

  for (const tripId of tripOrder(stamps)) {
    const mine = stamps.filter((s) => s.tripId === tripId);
    const name = mine[0].tripName;
    const own: StampPage[] = [];
    const page = (n: number): StampPage => {
      while (own.length <= n) own.push({ kind: 'stamps', key: `${tripId}#${own.length}`, tripId, tripName: name, items: [] });
      return own[n];
    };
    const free: PassportStamp[] = [];

    for (const s of mine) {
      const p = placements[s.id];
      const m = p && /^(.*)#(\d+)$/.exec(p.page);
      if (p && m && m[1] === tripId) {
        page(Number(m[2])).items.push({ stamp: s, x: p.x, y: p.y, rot: p.rot, pressure: p.pressure, pressed: true });
      } else free.push(s);
    }

    // Unpressed stamps fill the free spots page by page.
    let n = 0;
    for (const s of free) {
      for (;;) {
        const pg = page(n);
        const auto = pg.items.filter((i) => !i.pressed).length;
        if (pg.items.length < PAGE_CAP && auto < SPOTS.length) {
          const [x, y] = SPOTS[auto];
          pg.items.push({
            stamp: s, x: x + wobble(`${s.id}x`) * 4, y: y + wobble(`${s.id}y`) * 3, rot: s.rotation, pressed: false,
          });
          break;
        }
        n += 1;
      }
    }
    // A page's stamps in earning order; pages left empty by the numbering are dropped.
    for (const pg of own) pg.items.sort((a, b) => a.stamp.date.localeCompare(b.stamp.date) || a.stamp.id.localeCompare(b.stamp.id));
    pages.push(...own.filter((pg) => pg.items.length > 0));
  }
  return pages;
}

/** The pages of the whole book after the cover, in reading order. */
export function bookPages(stamps: StampPage[]): BookPage[] {
  return [{ kind: 'inside' }, { kind: 'bio' }, { kind: 'visas' }, ...stamps, { kind: 'back' }];
}

export interface Leaf { front: BookPage; back: BookPage | null }

/** Sheets of the book. `single` = one page per sheet (narrow screens). */
export function leavesFor(pages: BookPage[], single: boolean): Leaf[] {
  const leaves: Leaf[] = [{ front: { kind: 'cover' }, back: single ? null : pages[0] ?? null }];
  if (single) {
    for (const p of pages) leaves.push({ front: p, back: null });
    return leaves;
  }
  for (let k = 1; 2 * k - 1 < pages.length; k++) leaves.push({ front: pages[2 * k - 1], back: pages[2 * k] ?? null });
  return leaves;
}

/**
 * How many sheets must be turned so that pages[index] is showing
 * (0 = the closed book). `index` is a position in the list passed to leavesFor.
 */
export function flippedToShow(index: number, single: boolean): number {
  if (index < 0) return 0;
  if (single) return index + 1;
  // Page 0 is the back of the cover; pages 1, 2 sit on sheet 1; and so on.
  return index === 0 ? 1 : index % 2 === 1 ? Math.ceil(index / 2) : index / 2 + 1;
}

/** Index in the page list of the stamp page that holds this stamp; -1 when none. */
export function pageOfStamp(pages: BookPage[], stampId: string): number {
  return pages.findIndex((p) => p.kind === 'stamps' && p.items.some((i) => i.stamp.id === stampId));
}
