import { describe, expect, it } from 'vitest';
import { tripWrap, wrapJournal, wrapPack, wrapRoute, wrapSpend, wrapStays, type WrapEntry, type WrapExpense, type WrapInput } from './trip-wrap.ts';
import type { PackList } from './schema.ts';
import type { StoredLeg } from './stores/route-store.ts';

const COORDS: Record<string, { lat: number; lng: number }> = {
  harbin: { lat: 45.8, lng: 126.5 },
  copenhagen: { lat: 55.676, lng: 12.568 },
  berlin: { lat: 52.52, lng: 13.405 },
  paris: { lat: 48.857, lng: 2.352 },
};
const coordOf = (p: string) => COORDS[p.trim().toLowerCase()] ?? null;

function leg(id: string, city: string, country: string, from: string, to: string, extra: Record<string, unknown> = {}): StoredLeg {
  return { id, city, country, flag: '', dateFrom: from, dateTo: to, order: 0, tripId: 't', createdAt: 1, updatedAt: 1, schemaVersion: 1, ...extra } as unknown as StoredLeg;
}

const TRIP = { name: 'Europe', startDate: '2026-06-25', endDate: '2026-07-14', homeCity: 'Harbin', returnCity: 'Harbin', totalBudget: 1000 };
const LEGS: StoredLeg[] = [
  leg('a', 'Copenhagen', 'Denmark', '2026-06-25', '2026-07-05', {
    arrivalTransport: { type: 'flight', from: 'Harbin', to: 'Copenhagen' },
    accommodations: [{ name: 'Home', platform: 'Friend' }],
  }),
  leg('b', 'Berlin', 'Germany', '2026-07-05', '2026-07-09', {
    arrivalTransport: { type: 'train', from: 'Copenhagen', to: 'Berlin' },
    accommodations: [{ name: 'Hostel', platform: 'Booking.com' }, { name: 'Loft', platform: 'Booking.com' }],
  }),
  leg('c', 'Paris', 'France', '2026-07-09', '2026-07-12', { arrivalTransport: { type: 'bus', from: 'Berlin', to: 'Paris' }, accommodation: { name: 'Studio' } }),
  leg('d', 'Copenhagen', 'Denmark', '2026-07-12', '2026-07-14'),
];

describe('wrapRoute', () => {
  const r = wrapRoute(TRIP, LEGS, coordOf);

  it('counts distinct countries and cities, and keeps the stops in order', () => {
    expect(r.countries).toBe(3);
    expect(r.cities).toBe(3);
    expect(r.stops.map((s) => s.city)).toEqual(['Copenhagen', 'Berlin', 'Paris', 'Copenhagen']);
  });
  it('adds the home flight out and back to the hops', () => {
    expect(r.hops.map((h) => `${h.kind}:${h.from}>${h.to}`)).toEqual([
      'out:Harbin>Copenhagen', 'leg:Copenhagen>Berlin', 'leg:Berlin>Paris', 'leg:Paris>Copenhagen', 'back:Copenhagen>Harbin',
    ]);
    expect(r.distanceKm).toBe(r.hops.reduce((s, h) => s + (h.km ?? 0), 0));
    expect(r.distanceKm).toBeGreaterThan(15000);
  });
  it('splits the hops by transport mode, most used first', () => {
    expect(r.modes.map((m) => [m.mode, m.count])).toEqual([['flight', 2], ['bus', 1], ['train', 1]]);
  });
  it('the longest hop is the long-haul flight', () => {
    expect(r.longest?.kind === 'out' || r.longest?.kind === 'back').toBe(true);
    expect(r.longest?.km).toBeGreaterThan(7000);
  });
  it('a hop with an unlocatable end has no distance and never wins "longest"', () => {
    const r2 = wrapRoute({ ...TRIP, homeCity: 'Nowhere', returnCity: '' }, LEGS, coordOf);
    expect(r2.hops[0]).toMatchObject({ kind: 'out', km: null });
    expect(r2.longest?.km).not.toBeNull();
  });
  it('falls back to the first leg\'s transport origin when no home city is set', () => {
    const r2 = wrapRoute({ ...TRIP, homeCity: undefined, returnCity: undefined }, LEGS, coordOf);
    expect(r2.hops[0]).toMatchObject({ kind: 'out', from: 'Harbin' });
    expect(r2.hops.some((h) => h.kind === 'back')).toBe(false);
  });
  it('uses the coordinates saved on a leg before the lookup', () => {
    const r2 = wrapRoute(TRIP, [leg('x', 'Unknownville', 'Denmark', '2026-06-25', '2026-06-27', { lat: 1, lng: 2 })], coordOf);
    expect(r2.stops[0]).toMatchObject({ lat: 1, lng: 2 });
  });
  it('is empty-safe', () => {
    const r2 = wrapRoute({ ...TRIP, homeCity: '', returnCity: '' }, [], coordOf);
    expect(r2).toMatchObject({ countries: 0, cities: 0, distanceKm: 0, hops: [], longest: null });
  });
});

describe('wrapStays', () => {
  const s = wrapStays(LEGS);

  it('folds a city visited twice into one row with both visits\' nights', () => {
    const cph = s.cities.find((c) => c.city === 'Copenhagen')!;
    expect(cph).toMatchObject({ nights: 12, visits: 2 });
    expect(s.cities.map((c) => c.city)).toEqual(['Copenhagen', 'Berlin', 'Paris']);
  });
  it('totals nights and names the longest stay', () => {
    expect(s.totalNights).toBe(19);
    expect(s.longest?.city).toBe('Copenhagen');
  });
  it('counts named stays (multi-stay and legacy single) and ranks platforms', () => {
    expect(s.stayCount).toBe(4);
    expect(s.platforms).toEqual([{ name: 'Booking.com', count: 2 }, { name: 'Friend', count: 1 }]);
  });
  it('a trip of day stops has no longest stay', () => {
    expect(wrapStays([leg('z', 'Oslo', 'Norway', '2026-07-01', '2026-07-01')]).longest).toBeNull();
  });
});

describe('wrapSpend', () => {
  const ex = (date: string, category: string, country: string, amt: number, city = ''): WrapExpense & { amt: number } =>
    ({ date, category, country, city, amt });
  const rows = [
    ex('2026-06-26', 'food', 'Denmark', 100),
    ex('2026-06-26', 'transport', 'Denmark', 400, 'Copenhagen'),
    ex('2026-07-06', 'accommodation', 'Germany', 200),
    ex('2026-07-10', 'food', '', 50),            // no country → the leg covering the date (France)
    ex('2026-07-11', '', 'France', 50),          // unclassified
  ];
  const toBase = (e: WrapExpense) => (e as WrapExpense & { amt: number }).amt;
  const s = wrapSpend(TRIP, LEGS, rows, toBase);

  it('totals, per-day average and the budget gap', () => {
    expect(s.total).toBe(800);
    expect(s.count).toBe(5);
    expect(s.perDay).toBe(800 / 20);
    expect(s.budget).toBe(1000);
    expect(s.overBy).toBe(-200);
  });
  it('categories sorted by size, with shares that add up', () => {
    expect(s.byCategory[0]).toMatchObject({ id: 'transport', amount: 400 });
    expect(s.byCategory.reduce((t, c) => t + c.share, 0)).toBeCloseTo(1);
    expect(s.byCategory.some((c) => c.id === '')).toBe(true);
  });
  it('attributes an expense without a country to the leg covering its date', () => {
    expect(s.byCountry.find((c) => c.country === 'France')?.amount).toBe(100);
  });
  it('the biggest day carries its city', () => {
    expect(s.biggestDay).toEqual({ date: '2026-06-26', amount: 500, city: 'Copenhagen' });
  });
  it('cheapest and priciest countries are by spend per night, not total', () => {
    // Denmark 500/12 nights (two visits) ≈ 41.7, Germany 200/4 = 50, France 100/3 ≈ 33.3
    expect(s.cheapestCountry?.country).toBe('France');
    expect(s.priciestCountry?.country).toBe('Germany');
  });
  it('without a budget there is no gap; with one country there is nothing to compare', () => {
    const none = wrapSpend({ ...TRIP, totalBudget: null }, LEGS, [ex('2026-06-26', 'food', 'Denmark', 10)], toBase);
    expect(none.budget).toBeNull();
    expect(none.overBy).toBeNull();
    expect(none.cheapestCountry).toBeNull();
    expect(none.priciestCountry).toBeNull();
  });
  it('over budget is positive', () => {
    expect(wrapSpend({ ...TRIP, totalBudget: 500 }, LEGS, rows, toBase).overBy).toBe(300);
  });
  it('no expenses → zeros, no biggest day', () => {
    const e = wrapSpend(TRIP, LEGS, [], toBase);
    expect(e).toMatchObject({ count: 0, total: 0, perDay: 0, biggestDay: null, byCategory: [], byCountry: [] });
  });
});

describe('wrapPack', () => {
  const list = {
    name: 'Main',
    containers: [{ id: 'bag', label: 'Bag', kind: 'backpack', limitG: 0, selfWeightG: 1000 }],
    items: [
      { id: '1', name: 'Jacket', qty: 1, unitWeightG: 800, acquiredLegId: null, droppedLegId: null },
      { id: '2', name: 'Old boots', qty: 1, unitWeightG: 1200, acquiredLegId: null, droppedLegId: 'c' },
      { id: '3', name: 'Souvenir', qty: 2, unitWeightG: 300, acquiredLegId: 'b', droppedLegId: null },
    ],
  } as unknown as PackList;

  it('weighs what left home against what came back, bags included', () => {
    const p = wrapPack(list, LEGS)!;
    expect(p.departG).toBe(800 + 1200 + 1000);
    expect(p.returnG).toBe(800 + 600 + 1000);
  });
  it('lists what was bought and lost, with the stop', () => {
    const p = wrapPack(list, LEGS)!;
    expect(p.bought).toEqual([{ name: 'Souvenir', city: 'Berlin' }]);
    expect(p.lost).toEqual([{ name: 'Old boots', city: 'Paris' }]);
  });
  it('no list, or an empty one, is no chapter', () => {
    expect(wrapPack(null, LEGS)).toBeNull();
    expect(wrapPack({ name: 'x', containers: [], items: [] } as unknown as PackList, LEGS)).toBeNull();
  });
});

describe('wrapJournal', () => {
  const e = (id: string, on: string, dest: string, images: string[], favorite = false): WrapEntry => ({ id, happenedOn: on, destination: dest, favorite, images });
  const rows = [
    e('1', '2026-06-26', '', ['p1']),                       // → Copenhagen by date
    e('2', '2026-06-27', 'Copenhagen', ['p2', 'p3', 'p4']),
    e('3', '2026-07-10', '', []),                           // → Paris by date
    e('4', '2026-07-07', 'Berlin', ['p5'], true),
  ];
  const j = wrapJournal(rows, LEGS, 8);

  it('counts entries and photos', () => {
    expect(j.entries).toBe(4);
    expect(j.photos).toBe(5);
  });
  it('the city written about most, falling back to the stop that covers the date', () => {
    expect(j.topCity).toEqual({ city: 'Copenhagen', count: 2 });
  });
  it('featured photos: favourites first, then the busiest entries, one per entry', () => {
    expect(j.featured).toEqual(['p5', 'p2', 'p1']);
  });
  it('says how many entries Portrait still needs', () => {
    expect(j.portraitShort).toBe(4);
    expect(wrapJournal(rows, LEGS, 3).portraitShort).toBe(0);
  });
});

describe('tripWrap', () => {
  const input: WrapInput = {
    trip: TRIP, legs: LEGS, expenses: [], toBase: () => 0, pack: null, journal: [], portraitMin: 8, coordOf, today: '2026-07-20',
  };
  it('puts the chapters together', () => {
    const m = tripWrap(input);
    expect(m.cover).toMatchObject({ name: 'Europe', days: 20, stamps: 3, stampCountries: 3 });
    expect(m.stamps).toHaveLength(3);        // one passport stamp per country on this trip
    expect(m.hasRoute).toBe(true);
    expect(m.pack).toBeNull();
  });
  it('mid-trip, only the countries reached so far count', () => {
    const m = tripWrap({ ...input, today: '2026-07-06' });
    expect(m.cover.stamps).toBe(2);
    expect(m.stamps.map((s) => s.iso)).toEqual(['DK', 'DE']);
  });
  it('a trip with no stops has nothing to wrap', () => {
    expect(tripWrap({ ...input, legs: [] }).hasRoute).toBe(false);
  });
});
