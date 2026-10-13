import { describe, expect, it } from 'vitest';
import { buildFootprint, type FootprintLeg } from './footprint.ts';
import { passportFor, pendingStamps } from './passport.ts';
import { buildWorldModel } from '../views/map/world/world-model.ts';
import type { PlottedLeg } from '../views/map/map-stats.ts';

const leg = (id: string, city: string, country: string, from: string, to: string, tripId: string, extra: Partial<FootprintLeg> = {}): FootprintLeg =>
  ({ id, city, country, dateFrom: from, dateTo: to, tripId, ...extra });

const LEGS: FootprintLeg[] = [
  leg('a', 'Copenhagen', 'Denmark', '2026-06-25', '2026-07-05', 't1', { arrivalTransport: { type: 'flight' } }),
  leg('b', 'Berlin', 'Germany', '2026-07-05', '2026-07-09', 't1', { arrivalTransport: { type: 'train' } }),
  leg('c', 'Copenhagen', 'Denmark', '2026-07-09', '2026-07-12', 't1'),
  leg('d', 'Paris', 'France', '2026-09-01', '2026-09-05', 't1'),
  leg('e', 'Copenhagen', 'Denmark', '2027-03-01', '2027-03-04', 't2'),
];

describe('buildFootprint', () => {
  it('counts only stops whose arrival has come', () => {
    const fp = buildFootprint(LEGS, '2026-07-06');
    expect(fp.visits.map((v) => v.key)).toEqual(['t1|DK', 't1|DE']);
    expect(fp.summary.countries).toBe(2);
  });

  it('one stamp per country per trip, however often it was re-entered', () => {
    const fp = buildFootprint(LEGS, '2026-07-20');
    const dk = fp.visits.filter((v) => v.iso === 'DK');
    expect(dk).toHaveLength(1);
    expect(dk[0]).toMatchObject({ cities: ['Copenhagen'], legIds: ['a', 'c'], nights: 10 + 3, date: '2026-06-25' });
  });

  it('a second trip to the same country earns another stamp but the country counts once', () => {
    const fp = buildFootprint(LEGS, '2027-03-02');
    expect(fp.visits.filter((v) => v.iso === 'DK').map((v) => [v.tripId, v.firstEver])).toEqual([['t1', true], ['t2', false]]);
    expect(fp.summary).toMatchObject({ countries: 3, stamps: 4, trips: 2 });
  });

  it('matches the World model country count for the same legs', () => {
    for (const today of ['2026-06-20', '2026-07-06', '2026-09-02', '2027-03-02']) {
      const plotted = LEGS.map((l): PlottedLeg => ({
        id: l.id, city: l.city, country: l.country, flag: '', dateFrom: l.dateFrom, dateTo: l.dateTo, tripId: l.tripId,
        lat: 0, lng: 0, iso: buildFootprint([l], '9999-12-31').visits[0]?.iso ?? null, stops: [],
      }));
      expect(buildFootprint(LEGS, today).summary.countries).toBe(buildWorldModel(plotted, [], today).summary.countries);
    }
  });
});

describe('passportFor', () => {
  const names = new Map([['t1', 'Euro Trip'], ['t2', 'Spring']]);
  const p = passportFor(LEGS, '2027-03-02', names);

  it('stamps are chronological, named by trip and never planned', () => {
    expect(p.stamps.map((s) => s.id)).toEqual(['country:DK:t1', 'country:DE:t1', 'country:FR:t1', 'country:DK:t2']);
    expect(p.stamps[3]).toMatchObject({ tripName: 'Spring', firstEver: false });
    expect(passportFor(LEGS, '2026-06-01').stamps).toEqual([]);
  });

  it('is deterministic', () => {
    expect(passportFor(LEGS, '2027-03-02', names)).toEqual(p);
  });

  it('pendingStamps leaves out the ones already pressed', () => {
    expect(pendingStamps(p.stamps, new Set(['country:DK:t1'])).map((s) => s.id)).toEqual(['country:DE:t1', 'country:FR:t1', 'country:DK:t2']);
  });
});
