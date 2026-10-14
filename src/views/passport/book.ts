/* ==========================================================================
   On the Road · Passport — book layout (pure)
   --------------------------------------------------------------------------
   Turns the passport's stamps into pages and the pages into leaves.

   · Stamp pages never mix trips: each page carries its trip's name in the
     header, and a trip's pages are named `${tripId}#${n}` — a name that does
     not move when other trips gain stamps, so a stamp the traveller pressed
     stays on its page (Placement.page).
   · Only pressed stamps are on a page, each at the exact spot, angle and
     force the traveller gave it. A stamp let to press itself goes on the
     first free spot (autoPlacement).
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
  /** Always true on a page: only pressed stamps are laid out. */
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

/** Visas a page holds. */
export const VISAS_PER_PAGE = 2;

export type BookPage =
  | { kind: 'cover' } | { kind: 'inside' } | { kind: 'bio' } | { kind: 'visas'; index: number } | StampPage
  | { kind: 'back' } | { kind: 'notes' } | { kind: 'backcover' };

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

export interface PageOpts {
  /** Make sure this trip has a page with room for one more stamp (an empty one is added if all are full) — the page a stamp is about to be pressed on. */
  ensureTrip?: { tripId: string; tripName: string };
}

/** Stamp pages, oldest trip first. Only pressed stamps (those with a placement on their own trip's page) are on a page. */
export function stampPages(pressed: PassportStamp[], placements: Readonly<Record<string, Placement>> = {}, opts: PageOpts = {}): StampPage[] {
  const pages: StampPage[] = [];
  const trips = tripOrder(pressed);
  if (opts.ensureTrip && !trips.includes(opts.ensureTrip.tripId)) trips.push(opts.ensureTrip.tripId);

  for (const tripId of trips) {
    const mine = pressed.filter((s) => s.tripId === tripId);
    const name = mine[0]?.tripName ?? opts.ensureTrip?.tripName ?? '';
    const own: StampPage[] = [];
    const page = (n: number): StampPage => {
      while (own.length <= n) own.push({ kind: 'stamps', key: `${tripId}#${own.length}`, tripId, tripName: name, items: [] });
      return own[n];
    };
    for (const s of mine) {
      const p = placements[s.id];
      const m = p && /^(.*)#(\d+)$/.exec(p.page);
      if (p && m && m[1] === tripId) {
        page(Number(m[2])).items.push({ stamp: s, x: p.x, y: p.y, rot: p.rot, pressure: p.pressure, pressed: true });
      }
    }
    // A page's stamps in earning order; pages left empty by the numbering are dropped.
    for (const pg of own) pg.items.sort((a, b) => a.stamp.date.localeCompare(b.stamp.date) || a.stamp.id.localeCompare(b.stamp.id));
    let kept = own.filter((pg) => pg.items.length > 0);
    if (opts.ensureTrip?.tripId === tripId && !kept.some((pg) => pg.items.length < PAGE_CAP)) {
      const n = own.length ? Math.max(...own.map((pg) => Number(pg.key.split('#')[1]))) + 1 : 0;
      kept = [...kept, { kind: 'stamps', key: `${tripId}#${n}`, tripId, tripName: name, items: [] }];
    }
    pages.push(...kept);
  }
  if (pages.length === 0) return [{ kind: 'stamps', key: '', tripId: '', tripName: '', items: [] }];
  return pages;
}

/** True when two stamps centred at these spots would sit on top of each other. */
const overlaps = (a: readonly [number, number], b: readonly [number, number]): boolean => Math.abs(a[0] - b[0]) < 30 && Math.abs(a[1] - b[1]) < 20;

/**
 * Where a stamp goes when the traveller lets it press itself: the trip's first page with room, on the first
 * spot that does not cover a stamp already there. `pages` must be laid out with `ensureTrip` for this stamp's trip.
 */
export function autoPlacement(stamp: PassportStamp, pages: StampPage[], now = Date.now()): Placement {
  const page = pages.find((p) => p.tripId === stamp.tripId && p.items.length < PAGE_CAP)
    ?? { key: `${stamp.tripId}#${pages.filter((p) => p.tripId === stamp.tripId).length}`, items: [] as PlacedStamp[] };
  const taken = page.items.map((i) => [i.x, i.y] as const);
  const spot = SPOTS.find((s) => !taken.some((t) => overlaps(s, t))) ?? SPOTS[page.items.length % SPOTS.length];
  return {
    page: page.key,
    x: spot[0] + wobble(`${stamp.id}x`) * 4,
    y: spot[1] + wobble(`${stamp.id}y`) * 3,
    rot: stamp.rotation,
    pressure: 0.75,
    at: now,
  };
}

/**
 * The pages of the whole book after the cover, in reading order, ending on the back cover. On a spread the
 * back cover must be the back of a sheet (an even position), so a ruled notes page is added when it would not be.
 */
export function bookPages(stamps: StampPage[], visaCount = 0, single = false): BookPage[] {
  const visaPages = Math.max(1, Math.ceil(visaCount / VISAS_PER_PAGE));
  const pages: BookPage[] = [
    { kind: 'inside' }, { kind: 'bio' },
    ...Array.from({ length: visaPages }, (_, index): BookPage => ({ kind: 'visas', index })),
    ...stamps, { kind: 'back' },
  ];
  if (!single && pages.length % 2 === 1) pages.push({ kind: 'notes' });
  pages.push({ kind: 'backcover' });
  return pages;
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
