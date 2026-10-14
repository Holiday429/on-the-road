import { describe, expect, it } from 'vitest';
import { PAGE_CAP, autoPlacement, bookPages, flippedToShow, leavesFor, pageOfStamp, reachedBackCover, stampPages, type Placement } from './book.ts';
import type { PassportStamp } from '../../data/passport.ts';

const st = (iso: string, tripId: string, date: string): PassportStamp => ({
  id: `country:${iso}:${tripId}`, kind: 'country', city: '', country: iso, iso, date, nights: 3, shape: 'circle', rotation: 2,
  ink: '#000', earned: true, tripId, tripName: `Trip ${tripId}`, firstEver: true, cities: [], legIds: [],
});

const EURO = ['DK', 'DE', 'NL', 'BE', 'FR', 'ES', 'PT', 'CH', 'IT'].map((c, i) => st(c, 't1', `2026-07-0${i + 1}`));

/** Press every stamp the automatic way, one after another, like "press all". */
function pressAll(stamps: PassportStamp[]): Record<string, Placement> {
  const placements: Record<string, Placement> = {};
  for (const s of stamps) {
    const pressed = stamps.filter((x) => placements[x.id]);
    const pages = stampPages(pressed, placements, { ensureTrip: { tripId: s.tripId, tripName: s.tripName } });
    placements[s.id] = autoPlacement(s, pages, 1);
  }
  return placements;
}

describe('stampPages', () => {
  it('an empty passport still has one (empty) page', () => {
    const p = stampPages([]);
    expect(p).toHaveLength(1);
    expect(p[0].items).toEqual([]);
  });

  it('stamps nobody has pressed are not on any page', () => {
    expect(stampPages(EURO, {})[0].items).toEqual([]);
  });

  it('pages never mix trips, hold at most PAGE_CAP stamps and are named per trip', () => {
    const all = [...EURO, st('JP', 't2', '2027-03-01')];
    const pages = stampPages(all, pressAll(all));
    expect(pages.map((p) => [p.key, p.items.length])).toEqual([['t1#0', PAGE_CAP], ['t1#1', 3], ['t2#0', 1]]);
    expect(pages[2].tripName).toBe('Trip t2');
  });

  it('automatic presses keep clear of each other and inside the page', () => {
    const pages = stampPages(EURO, pressAll(EURO));
    const pts = pages[0].items.map((i) => [i.x, i.y]);
    expect(new Set(pts.map((p) => p.join())).size).toBe(pts.length);
    for (const i of pages[0].items) { expect(i.x).toBeGreaterThan(10); expect(i.x).toBeLessThan(90); expect(i.pressed).toBe(true); }
  });

  it('a stamp pressed by hand keeps its exact page, spot, angle and force', () => {
    const placements: Record<string, Placement> = {
      'country:IT:t1': { page: 't1#0', x: 50, y: 40, rot: -9, pressure: 1, at: 1 },
    };
    const pages = stampPages(EURO, placements);
    expect(pages[0].items).toHaveLength(1);
    expect(pages[0].items[0]).toMatchObject({ x: 50, y: 40, rot: -9, pressed: true, pressure: 1 });
  });

  it('later stamps avoid a hand-placed one', () => {
    const hand: Record<string, Placement> = { 'country:DK:t1': { page: 't1#0', x: 29, y: 30, rot: 0, pressure: 1, at: 1 } };
    const pages = stampPages([EURO[0]], hand, { ensureTrip: { tripId: 't1', tripName: 'Trip t1' } });
    const next = autoPlacement(EURO[1], pages, 2);
    expect(next.page).toBe('t1#0');
    expect(Math.abs(next.x - 29) > 20 || Math.abs(next.y - 30) > 15).toBe(true);
  });

  it('a placement naming another trip\'s page is ignored', () => {
    const pages = stampPages(EURO, { 'country:IT:t1': { page: 't9#0', x: 50, y: 40, rot: 0, pressure: 1, at: 1 } });
    expect(pages[0].items).toEqual([]);
  });

  it('ensureTrip adds an empty page when a trip has none, or all its pages are full', () => {
    const first = stampPages([], {}, { ensureTrip: { tripId: 't1', tripName: 'Trip t1' } });
    expect(first.map((p) => [p.key, p.items.length])).toEqual([['t1#0', 0]]);
    const six = EURO.slice(0, PAGE_CAP);
    const full = stampPages(six, pressAll(six), { ensureTrip: { tripId: 't1', tripName: 'Trip t1' } });
    expect(full.map((p) => [p.key, p.items.length])).toEqual([['t1#0', PAGE_CAP], ['t1#1', 0]]);
  });

  it('autoPlacement is deterministic', () => {
    const pages = stampPages([], {}, { ensureTrip: { tripId: 't1', tripName: 'Trip t1' } });
    expect(autoPlacement(EURO[0], pages, 5)).toEqual(autoPlacement(EURO[0], pages, 5));
  });
});

describe('leaves', () => {
  const pages = bookPages(stampPages(EURO, pressAll(EURO))); // inside, bio, visas, stamps×2, back, back cover  → 7 pages
  it('spread: the cover backs onto the inside page; each sheet pairs a right page with the next left one', () => {
    const l = leavesFor(pages, false);
    expect(l.map((x) => [x.front.kind, x.back?.kind ?? null])).toEqual([
      ['cover', 'inside'], ['bio', 'visas'], ['stamps', 'stamps'], ['back', 'backcover'],
    ]);
  });

  it('visas take a page for every two, and at least one', () => {
    const kinds = (n: number) => bookPages(stampPages([]), n).filter((p) => p.kind === 'visas').length;
    expect([0, 1, 2, 3, 5].map(kinds)).toEqual([1, 1, 1, 2, 3]);
  });

  it('the back cover is the back of the last sheet; a ruled page makes room when the count would put it on a front', () => {
    const odd = bookPages(stampPages(EURO.slice(0, 1), pressAll(EURO.slice(0, 1))));   // inside, bio, visas, stamps, back → 5 + notes
    expect(odd.map((p) => p.kind).slice(-3)).toEqual(['back', 'notes', 'backcover']);
    const l = leavesFor(odd, false);
    expect(l[l.length - 1].back?.kind).toBe('backcover');
    expect(pages[pages.length - 1].kind).toBe('backcover');
  });

  it('single: one page per sheet, blank backs, the back cover last, no filler page', () => {
    const one = bookPages(stampPages(EURO.slice(0, 1), pressAll(EURO.slice(0, 1))), 0, true);
    expect(one.some((p) => p.kind === 'notes')).toBe(false);
    const l = leavesFor(one, true);
    expect(l).toHaveLength(one.length + 1);
    expect(l.every((x) => x.back === null)).toBe(true);
    expect(l[1].front.kind).toBe('inside');
    expect(l[l.length - 1].front.kind).toBe('backcover');
  });

  it('flippedToShow says how many sheets to turn', () => {
    // spread: pages 0 | 1 2 | 3 4 | 5
    expect([0, 1, 2, 3, 4, 5].map((i) => flippedToShow(i, false))).toEqual([1, 1, 2, 2, 3, 3]);
    expect([0, 1, 2].map((i) => flippedToShow(i, true))).toEqual([1, 2, 3]);
    expect(flippedToShow(-1, false)).toBe(0);
  });

  it('pageOfStamp finds the page holding a stamp', () => {
    const i = pageOfStamp(pages, 'country:PT:t1');
    expect(pages[i].kind).toBe('stamps');
    expect(pageOfStamp(pages, 'country:XX:t1')).toBe(-1);
  });
});

describe('the end of the book', () => {
  it('only the last turn reaches the back cover', () => {
    expect(reachedBackCover(4, 4)).toBe(true);
    expect(reachedBackCover(3, 4)).toBe(false);
    expect(reachedBackCover(0, 4)).toBe(false);
    expect(reachedBackCover(0, 0)).toBe(false);     // an empty book has no back cover to reach
  });
});
