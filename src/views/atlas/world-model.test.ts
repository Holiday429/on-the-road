import { describe, expect, it } from 'vitest';
import { buildWorldModel, countryTone, spentNights, tripPhase, yearLevel, type WorldTripInput } from './world-model.ts';
import type { PlottedLeg } from '../map/map-stats.ts';

let n = 0;
function leg(over: Partial<PlottedLeg> & { iso: string; city: string; dateFrom: string; dateTo: string; tripId: string }): PlottedLeg {
  n += 1;
  return {
    id: over.id ?? `l${n}`, country: over.country ?? over.iso, flag: over.flag ?? '', lat: over.lat ?? 50, lng: over.lng ?? 10,
    stops: over.stops ?? [{ key: over.city.toLowerCase(), name: over.city, lat: over.lat ?? 50, lng: over.lng ?? 10 }],
    ...over,
  };
}
const trip = (id: string, startDate: string, endDate: string): WorldTripInput => ({ id, name: id, color: 'rgb(1,2,3)', startDate, endDate });

const TODAY = '2026-07-10';

describe('buildWorldModel — visited vs planned', () => {
  const legs = [
    leg({ iso: 'DK', city: 'Copenhagen', dateFrom: '2026-06-25', dateTo: '2026-07-05', tripId: 'a' }),
    leg({ iso: 'DE', city: 'Berlin', dateFrom: '2026-07-05', dateTo: '2026-07-12', tripId: 'a' }),
    leg({ iso: 'IT', city: 'Rome', dateFrom: '2026-08-08', dateTo: '2026-08-20', tripId: 'a' }),
  ];
  const m = buildWorldModel(legs, [trip('a', '2026-06-25', '2026-08-20')], TODAY);

  it('marks a country visited once its stop has started, planned before', () => {
    expect(m.countries.get('DK')!.state).toBe('visited');
    expect(m.countries.get('DE')!.state).toBe('visited');   // in progress counts
    expect(m.countries.get('IT')!.state).toBe('planned');
  });
  it('never counts planned countries in the totals', () => {
    expect(m.summary.countries).toBe(2);
    expect(m.summary.cities).toBe(2);
    expect(m.countries.get('IT')!.visits).toBe(0);
    expect(m.countries.get('IT')!.nights).toBe(0);
    expect(m.countries.get('IT')!.cities).toEqual([]);
  });
  it('counts nights spent so far, the current stop up to today', () => {
    expect(m.countries.get('DK')!.nights).toBe(10);
    expect(m.countries.get('DE')!.nights).toBe(5);          // Jul 5 → Jul 10
    expect(m.summary.nights).toBe(15);
  });
});

describe('visits', () => {
  it('counts a run of consecutive stops in one country as one visit', () => {
    const legs = [
      leg({ iso: 'FR', city: 'Paris', dateFrom: '2026-01-01', dateTo: '2026-01-04', tripId: 'a' }),
      leg({ iso: 'FR', city: 'Lyon', dateFrom: '2026-01-04', dateTo: '2026-01-06', tripId: 'a' }),
    ];
    expect(buildWorldModel(legs, [trip('a', '2026-01-01', '2026-01-06')], TODAY).countries.get('FR')!.visits).toBe(1);
  });
  it('counts a return after another country as a second visit', () => {
    const legs = [
      leg({ iso: 'DK', city: 'Copenhagen', dateFrom: '2026-01-01', dateTo: '2026-01-04', tripId: 'a' }),
      leg({ iso: 'DE', city: 'Berlin', dateFrom: '2026-01-04', dateTo: '2026-01-06', tripId: 'a' }),
      leg({ iso: 'DK', city: 'Copenhagen', dateFrom: '2026-01-06', dateTo: '2026-01-09', tripId: 'a' }),
    ];
    const m = buildWorldModel(legs, [trip('a', '2026-01-01', '2026-01-09')], TODAY);
    expect(m.countries.get('DK')!.visits).toBe(2);
    expect(m.countries.get('DK')!.cities).toEqual(['Copenhagen']);   // distinct cities
  });
  it('counts the same country on two trips as two visits', () => {
    const legs = [
      leg({ iso: 'DK', city: 'Copenhagen', dateFrom: '2026-01-01', dateTo: '2026-01-04', tripId: 'a' }),
      leg({ iso: 'DK', city: 'Aarhus', dateFrom: '2026-03-01', dateTo: '2026-03-04', tripId: 'b' }),
    ];
    const m = buildWorldModel(legs, [trip('a', '2026-01-01', '2026-01-04'), trip('b', '2026-03-01', '2026-03-04')], TODAY);
    const dk = m.countries.get('DK')!;
    expect(dk.visits).toBe(2);
    expect(dk.tripIds).toEqual(['a', 'b']);
    expect(dk.latestTripId).toBe('b');
  });
});

describe('distance never links separate trips', () => {
  it('sums within each trip only', () => {
    const near = (id: string, lng: number) => leg({ iso: 'DE', city: id, dateFrom: '2026-01-0' + (id === 'x2' ? 3 : 1), dateTo: '2026-01-0' + (id === 'x2' ? 4 : 2), tripId: id.startsWith('x') ? 'a' : 'b', lat: 50, lng });
    // trip a: two stops 10° apart; trip b: one stop far away. No leg between a and b.
    const legs = [near('x1', 0), near('x2', 10), near('far', 150)];
    const m = buildWorldModel(legs, [trip('a', '2026-01-01', '2026-01-04'), trip('b', '2026-01-01', '2026-01-02')], TODAY);
    expect(m.summary.km).toBeGreaterThan(600);
    expect(m.summary.km).toBeLessThan(800);   // ≈ 10° of longitude at 50°N, not a trip to 150°E
  });
});

describe('trips, filter and focus', () => {
  const legs = [
    leg({ iso: 'JP', city: 'Tokyo', dateFrom: '2025-04-01', dateTo: '2025-04-08', tripId: 'old', lng: 139.7, lat: 35.7 }),
    leg({ iso: 'DK', city: 'Copenhagen', dateFrom: '2026-07-01', dateTo: '2026-07-20', tripId: 'now', lng: 12.5, lat: 55.7 }),
  ];
  const trips = [trip('old', '2025-04-01', '2025-04-08'), trip('now', '2026-07-01', '2026-07-20')];

  it('classifies trip phases and sorts trips chronologically', () => {
    const m = buildWorldModel(legs, trips, TODAY);
    expect(m.trips.map((t) => [t.id, t.phase])).toEqual([['old', 'past'], ['now', 'current']]);
    expect(tripPhase(trips[0], TODAY)).toBe('past');
  });
  it('faces the current trip first', () => {
    expect(buildWorldModel(legs, trips, TODAY).focus.longitude).toBeCloseTo(12.5);
  });
  it('falls back to the most recent past trip, then a future one', () => {
    expect(buildWorldModel(legs, trips, '2027-01-01').focus.longitude).toBeCloseTo(12.5);
    expect(buildWorldModel(legs, trips, '2024-01-01').focus.longitude).toBeCloseTo(139.7);
  });
  it('narrows to one trip but keeps every trip chip', () => {
    const m = buildWorldModel(legs, trips, TODAY, 'old');
    expect([...m.countries.keys()]).toEqual(['JP']);
    expect(m.trips).toHaveLength(2);
  });
  it('copes with no data', () => {
    const m = buildWorldModel([], [], TODAY);
    expect(m.countries.size).toBe(0);
    expect(m.summary.countries).toBe(0);
    expect(Number.isFinite(m.focus.longitude)).toBe(true);
  });
});

describe('spentNights / countryTone', () => {
  it('spentNights is 0 for a stop that has not started', () => {
    expect(spentNights({ dateFrom: '2026-08-01', dateTo: '2026-08-05' }, TODAY)).toBe(0);
    expect(spentNights({ dateFrom: '2026-07-01', dateTo: '2026-07-20' }, TODAY)).toBe(9);
    expect(spentNights({ dateFrom: '2026-07-01', dateTo: '2026-07-03' }, TODAY)).toBe(2);
  });
  const rec = (visits: number, state: 'visited' | 'planned' = 'visited') => ({
    iso: 'DK', name: 'Denmark', flag: '', state, visits, nights: 0, cities: [], tripIds: ['a'], latestTripId: 'a', firstDate: '', lastDate: '', firstVisit: '2026-01-01',
  });
  it('deepens with visits, capped at level 4', () => {
    expect(countryTone(rec(1), 'count')).toEqual({ kind: 'visited', level: 1 });
    expect(countryTone(rec(3), 'count')).toEqual({ kind: 'visited', level: 3 });
    expect(countryTone(rec(9), 'count')).toEqual({ kind: 'visited', level: 4 });
  });
  it('a planned country is never a visited tone, in either mode', () => {
    expect(countryTone(rec(0, 'planned'), 'count')).toEqual({ kind: 'planned' });
    expect(countryTone(rec(0, 'planned'), 'trip')).toEqual({ kind: 'planned' });
  });
  it('colour-by-trip uses the latest trip; unknown countries have no tone', () => {
    expect(countryTone(rec(2), 'trip')).toEqual({ kind: 'trip', tripId: 'a' });
    expect(countryTone(undefined, 'count')).toEqual({ kind: 'none' });
  });
});

describe('trips missing from the trip list', () => {
  it('are synthesised from their stops so the country still has a trip', () => {
    const legs = [
      leg({ iso: 'DK', city: 'Copenhagen', dateFrom: '2026-06-01', dateTo: '2026-06-04', tripId: 'ghost', tripName: 'Ghost trip' }),
      leg({ iso: 'DE', city: 'Berlin', dateFrom: '2026-06-04', dateTo: '2026-06-08', tripId: 'ghost', tripName: 'Ghost trip' }),
    ];
    const m = buildWorldModel(legs, [], TODAY);
    expect(m.trips).toHaveLength(1);
    expect(m.trips[0]).toMatchObject({ id: 'ghost', name: 'Ghost trip', startDate: '2026-06-01', endDate: '2026-06-08', phase: 'past', countries: ['DK', 'DE'] });
    expect(m.trips[0].color).toBe('');
  });
});

describe('years lens', () => {
  const legs = [
    leg({ iso: 'JP', city: 'Tokyo', dateFrom: '2023-04-01', dateTo: '2023-04-08', tripId: 'a' }),
    leg({ iso: 'FR', city: 'Paris', dateFrom: '2025-05-01', dateTo: '2025-05-08', tripId: 'b' }),
    leg({ iso: 'DK', city: 'Copenhagen', dateFrom: '2026-06-01', dateTo: '2026-06-08', tripId: 'c' }),
    leg({ iso: 'IT', city: 'Rome', dateFrom: '2026-12-01', dateTo: '2026-12-08', tripId: 'c' }),
    leg({ iso: 'JP', city: 'Osaka', dateFrom: '2026-06-10', dateTo: '2026-06-12', tripId: 'c' }),
  ];
  const m = buildWorldModel(legs, [trip('a', '2023-04-01', '2023-04-08'), trip('b', '2025-05-01', '2025-05-08'), trip('c', '2026-06-01', '2026-12-08')], TODAY);

  it('records the first visit and lists the years, oldest first, without planned-only ones', () => {
    expect(m.countries.get('JP')!.firstVisit).toBe('2023-04-01');     // not the later Osaka stop
    expect(m.countries.get('IT')!.firstVisit).toBe('');               // only planned
    expect(m.years).toEqual([2023, 2025, 2026]);
  });
  it('shades older first visits lighter and recent ones deeper', () => {
    const level = (iso: string) => (countryTone(m.countries.get(iso), 'year', m.years) as { level: number }).level;
    expect(level('JP')).toBeLessThan(level('FR'));
    expect(level('FR')).toBeLessThan(level('DK'));
    expect(level('DK')).toBe(4);
  });
  it('a planned country stays planned in every lens', () => {
    expect(countryTone(m.countries.get('IT'), 'year', m.years)).toEqual({ kind: 'planned' });
  });
  it('yearLevel spreads many years over four shades and gives one year the deepest', () => {
    expect(yearLevel('2026-01-01', [2026])).toBe(4);
    const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
    const levels = years.map((y) => yearLevel(`${y}-01-01`, years));
    expect(levels[0]).toBe(1);
    expect(levels[years.length - 1]).toBe(4);
    expect([...levels].sort()).toEqual(levels);      // never gets lighter as the years go on
    expect(yearLevel('2001-01-01', [2020, 2021])).toBe(4);   // unknown year: harmless
  });
});
