import { describe, expect, it } from 'vitest';
import { buildTripLines, buildCityPoints, currentSpot, nextStop } from './world-geo.ts';
import { buildWorldModel } from './world-model.ts';
import type { PlottedLeg } from '../map/map-stats.ts';

const mk = (id: string, city: string, iso: string, from: string, to: string, tripId: string, lng: number, lat: number, extraStops: string[] = []): PlottedLeg => ({
  id, city, country: iso, flag: '', dateFrom: from, dateTo: to, lat, lng, iso, tripId,
  stops: [city, ...extraStops].map((n) => ({ key: n.toLowerCase(), name: n, lat, lng })),
});
const TODAY = '2026-07-10';
const colors = new Map([['a', 'rgb(1,2,3)']]);

describe('buildTripLines', () => {
  const legs = [
    mk('1', 'Tokyo', 'JP', '2026-06-01', '2026-06-05', 'a', 139.7, 35.7),
    mk('2', 'Los Angeles', 'US', '2026-06-05', '2026-06-12', 'a', -118.2, 34.0),
    mk('3', 'Mexico City', 'MX', '2026-08-01', '2026-08-05', 'a', -99.1, 19.4),
    mk('4', 'Paris', 'FR', '2026-01-01', '2026-01-04', 'b', 2.35, 48.85),
    mk('5', 'Rome', 'IT', '2026-01-04', '2026-01-08', 'b', 12.5, 41.9),
  ];
  const lines = buildTripLines(legs, TODAY, null, colors);

  it('joins stops within a trip only — never one trip to the next', () => {
    expect(lines).toHaveLength(3);                         // a: 1→2, 2→3 ; b: 4→5
    const a = lines.filter((l) => l.tripId === 'a');
    expect(a.map((l) => [l.from[0], l.to[0]])).toEqual([[139.7, -118.2], [-118.2, -99.1]]);
    // no segment runs from trip b's end (Rome) to trip a's start (Tokyo) or vice versa
    expect(lines.some((l) => l.from[0] === 12.5 && l.to[0] === 139.7)).toBe(false);
    expect(lines.some((l) => l.from[0] === -99.1 && l.to[0] === 2.35)).toBe(false);
  });
  it('keeps the date-line crossing as ONE two-point segment (the map draws the great circle)', () => {
    const cross = lines.find((l) => l.from[0] === 139.7)!;
    expect(cross.to).toEqual([-118.2, 34.0]);
  });
  it('marks a segment planned when its destination is still ahead', () => {
    expect(lines.filter((l) => l.tripId === 'a').map((l) => l.planned)).toEqual([false, true]);
  });
  it('uses the trip colour, empty when the trip has none', () => {
    expect(lines.find((l) => l.tripId === 'a')!.color).toBe('rgb(1,2,3)');
    expect(lines.find((l) => l.tripId === 'b')!.color).toBe('');
  });
  it('skips a segment that goes nowhere and honours the trip filter', () => {
    const same = [mk('1', 'A', 'DK', '2026-01-01', '2026-01-02', 'a', 12, 55), mk('2', 'A', 'DK', '2026-01-02', '2026-01-03', 'a', 12, 55)];
    expect(buildTripLines(same, TODAY, null, colors)).toHaveLength(0);
    expect(buildTripLines(legs, TODAY, 'b', colors)).toHaveLength(1);
  });
});

describe('buildCityPoints', () => {
  it('has one dot per city, visited if any stop there has started', () => {
    const legs = [
      mk('1', 'Copenhagen', 'DK', '2026-06-01', '2026-06-05', 'a', 12.5, 55.7),
      mk('2', 'Berlin', 'DE', '2026-06-05', '2026-06-09', 'a', 13.4, 52.5, ['Potsdam']),
      mk('3', 'Copenhagen', 'DK', '2026-09-01', '2026-09-05', 'a', 12.5, 55.7),
      mk('4', 'Rome', 'IT', '2026-12-01', '2026-12-05', 'a', 12.5, 41.9),
    ];
    const pts = buildCityPoints(legs, TODAY, null);
    expect(pts.map((p) => p.name)).toEqual(['Copenhagen', 'Berlin', 'Potsdam', 'Rome']);
    expect(pts.find((p) => p.name === 'Copenhagen')!.planned).toBe(false);   // visited once already
    expect(pts.find((p) => p.name === 'Rome')!.planned).toBe(true);
  });
});

describe('currentSpot', () => {
  const legs = [
    mk('1', 'Copenhagen', 'DK', '2026-07-01', '2026-07-05', 'a', 12.5, 55.7),
    mk('2', 'Berlin', 'DE', '2026-07-05', '2026-07-09', 'a', 13.4, 52.5),
    mk('3', 'Rome', 'IT', '2026-07-12', '2026-07-15', 'a', 12.5, 41.9),
  ];
  const trips = (today: string) => buildWorldModel(legs, [{ id: 'a', name: 'A', color: '', startDate: '2026-07-01', endDate: '2026-07-15' }], today).trips;

  it('is the stop whose dates contain today', () => {
    expect(currentSpot(legs, trips('2026-07-03'), '2026-07-03', null)!.city).toBe('Copenhagen');
    expect(currentSpot(legs, trips('2026-07-13'), '2026-07-13', null)!.city).toBe('Rome');
  });
  it('moves when the clock moves (Dashboard time travel)', () => {
    const at = (d: string) => currentSpot(legs, trips(d), d, null)?.city;
    expect([at('2026-07-02'), at('2026-07-07'), at('2026-07-14')]).toEqual(['Copenhagen', 'Berlin', 'Rome']);
  });
  it('on a travel day between stops stays at the last stop reached', () => {
    expect(currentSpot(legs, trips('2026-07-10'), '2026-07-10', null)!.city).toBe('Berlin');
  });
  it('is null before and after the trip', () => {
    expect(currentSpot(legs, trips('2026-06-01'), '2026-06-01', null)).toBeNull();
    expect(currentSpot(legs, trips('2026-08-01'), '2026-08-01', null)).toBeNull();
  });
});

describe('nextStop', () => {
  const legs = [
    mk('1', 'Copenhagen', 'DK', '2026-07-01', '2026-07-05', 'a', 12.5, 55.7),
    mk('2', 'Berlin', 'DE', '2026-07-12', '2026-07-15', 'a', 13.4, 52.5),
    mk('3', 'Rome', 'IT', '2026-08-01', '2026-08-04', 'a', 12.5, 41.9),
    mk('4', 'Lisbon', 'PT', '2026-02-01', '2026-02-04', 'b', -9.1, 38.7),
  ];
  it('is the first stop that has not started, with the days to go', () => {
    const n = nextStop(legs, '2026-07-10', null)!;
    expect(n).toMatchObject({ city: 'Berlin', iso: 'DE', inDays: 2, legId: '2' });
    expect(nextStop(legs, '2026-07-11', null)!.inDays).toBe(1);
  });
  it('a stop that starts today is not "next" any more (you are there)', () => {
    expect(nextStop(legs, '2026-07-12', null)!.city).toBe('Rome');
  });
  it('is null when nothing is ahead, and honours the trip filter', () => {
    expect(nextStop(legs, '2026-09-01', null)).toBeNull();
    expect(nextStop(legs, '2026-07-10', 'b')).toBeNull();
  });
});
