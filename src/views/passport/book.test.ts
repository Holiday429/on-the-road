import { describe, expect, it } from 'vitest';
import { PAGE_CAP, bookPages, flippedToShow, leavesFor, pageOfStamp, stampPages, type Placement } from './book.ts';
import type { PassportStamp } from '../../data/passport.ts';

const st = (iso: string, tripId: string, date: string): PassportStamp => ({
  id: `country:${iso}:${tripId}`, kind: 'country', city: '', country: iso, iso, date, nights: 3, shape: 'circle', rotation: 2,
  ink: '#000', earned: true, tripId, tripName: `Trip ${tripId}`, firstEver: true, cities: [], legIds: [],
});

const EURO = ['DK', 'DE', 'NL', 'BE', 'FR', 'ES', 'PT', 'CH', 'IT'].map((c, i) => st(c, 't1', `2026-07-0${i + 1}`));

describe('stampPages', () => {
  it('an empty passport still has one (empty) page', () => {
    const p = stampPages([]);
    expect(p).toHaveLength(1);
    expect(p[0].items).toEqual([]);
  });

  it('pages never mix trips, hold at most PAGE_CAP stamps and are named per trip', () => {
    const pages = stampPages([...EURO, st('JP', 't2', '2027-03-01')]);
    expect(pages.map((p) => [p.key, p.items.length])).toEqual([['t1#0', PAGE_CAP], ['t1#1', 3], ['t2#0', 1]]);
    expect(pages[2].tripName).toBe('Trip t2');
  });

  it('is deterministic and keeps unpressed stamps clear of each other', () => {
    const a = stampPages(EURO);
    expect(stampPages(EURO)).toEqual(a);
    const pts = a[0].items.map((i) => [i.x, i.y]);
    expect(new Set(pts.map((p) => p.join())).size).toBe(pts.length);
    for (const i of a[0].items) { expect(i.x).toBeGreaterThan(10); expect(i.x).toBeLessThan(90); expect(i.pressed).toBe(false); }
  });

  it('a pressed stamp keeps its page and spot; the others settle around it', () => {
    const placements: Record<string, Placement> = {
      'country:IT:t1': { page: 't1#0', x: 50, y: 40, rot: -9, pressure: 1, at: 1 },
    };
    const pages = stampPages(EURO, placements);
    const it = pages[0].items.find((i) => i.stamp.iso === 'IT')!;
    expect(it).toMatchObject({ x: 50, y: 40, rot: -9, pressed: true, pressure: 1 });
    expect(pages[0].items.length).toBeLessThanOrEqual(PAGE_CAP);
    expect(pages.flatMap((p) => p.items)).toHaveLength(EURO.length);
  });

  it('a placement naming another trip\'s page is ignored', () => {
    const pages = stampPages(EURO, { 'country:IT:t1': { page: 't9#0', x: 50, y: 40, rot: 0, pressure: 1, at: 1 } });
    expect(pages.flatMap((p) => p.items).find((i) => i.stamp.iso === 'IT')!.pressed).toBe(false);
  });
});

describe('leaves', () => {
  const pages = bookPages(stampPages(EURO)); // inside, bio, visas, stamps×2, back  → 6 pages
  it('spread: the cover backs onto the inside page; each sheet pairs a right page with the next left one', () => {
    const l = leavesFor(pages, false);
    expect(l.map((x) => [x.front.kind, x.back?.kind ?? null])).toEqual([
      ['cover', 'inside'], ['bio', 'visas'], ['stamps', 'stamps'], ['back', null],
    ]);
  });

  it('single: one page per sheet, blank backs', () => {
    const l = leavesFor(pages, true);
    expect(l).toHaveLength(pages.length + 1);
    expect(l.every((x) => x.back === null)).toBe(true);
    expect(l[1].front.kind).toBe('inside');
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
