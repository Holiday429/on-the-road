import { describe, expect, it } from 'vitest';
import { buildCountryDetail } from './country-model.ts';
import { buildWorldModel, type WorldTripInput } from './world-model.ts';
import type { PlottedLeg } from '../map-stats.ts';

const mk = (id: string, city: string, country: string, iso: string, from: string, to: string, tripId: string): PlottedLeg => ({
  id, city, country, flag: '', dateFrom: from, dateTo: to, lat: 50, lng: 10, iso, tripId,
  stops: [{ key: city.toLowerCase(), name: city, lat: 50, lng: 10 }],
});
const trips: WorldTripInput[] = [
  { id: 'a', name: 'Spring', color: 'rgb(1,2,3)', startDate: '2026-04-01', endDate: '2026-04-20' },
  { id: 'b', name: 'Summer', color: 'rgb(4,5,6)', startDate: '2026-07-01', endDate: '2026-09-01' },
];
const legs = [
  mk('1', 'Copenhagen', 'Denmark', 'DK', '2026-04-01', '2026-04-05', 'a'),
  mk('2', 'Berlin', 'Germany', 'DE', '2026-04-05', '2026-04-10', 'a'),
  mk('3', 'Aarhus', 'Denmark', 'DK', '2026-07-01', '2026-07-04', 'b'),
  mk('4', 'Odense', 'Denmark', 'DK', '2026-09-01', '2026-09-03', 'b'),
];
const TODAY = '2026-07-10';
const model = buildWorldModel(legs, trips, TODAY);

describe('buildCountryDetail', () => {
  const d = buildCountryDetail('DK', legs, model, TODAY)!;

  it('carries the same totals as the map model', () => {
    expect(d.visits).toBe(model.countries.get('DK')!.visits);
    expect(d.nights).toBe(model.countries.get('DK')!.nights);
    expect(d.cities).toEqual(['Copenhagen', 'Aarhus']);          // Odense is still ahead
  });

  it('lists one entry per trip that touched the country, oldest first', () => {
    expect(d.trips.map((t) => t.id)).toEqual(['a', 'b']);
    expect(d.trips[1].cities).toEqual(['Aarhus', 'Odense']);     // planned stops shown on the trip
    expect(d.trips[0].dateFrom).toBe('2026-04-01');
    expect(d.trips[1].dateTo).toBe('2026-09-03');
  });

  it('gives only this country its passport stamps: one per trip that has reached it, none for planned stops', () => {
    expect(d.stamps.every((s) => s.iso === 'DK' && s.kind === 'country')).toBe(true);
    expect(d.stamps.map((s) => s.id)).toEqual(['country:DK:a', 'country:DK:b']);
    expect(d.stamps.map((s) => s.firstEver)).toEqual([true, false]);
  });

  it('is null for a country that is not on the map', () => {
    expect(buildCountryDetail('JP', legs, model, TODAY)).toBeNull();
  });
});
