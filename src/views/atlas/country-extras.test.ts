import { describe, expect, it } from 'vitest';
import { buildCountryExtras, journalIso, type ExtrasData } from './country-extras.ts';
import type { PlottedLeg } from '../map/map-stats.ts';

const leg = (id: string, city: string, iso: string, from: string, to: string, tripId: string, extra: string[] = []): PlottedLeg => ({
  id, city, country: iso, flag: '', dateFrom: from, dateTo: to, lat: 0, lng: 0, iso, tripId,
  stops: [city, ...extra].map((n) => ({ key: n.toLowerCase(), name: n, lat: 0, lng: 0 })),
});
const legs = [
  leg('1', 'Copenhagen', 'DK', '2026-06-01', '2026-06-05', 'a', ['Roskilde']),
  leg('2', 'Berlin', 'DE', '2026-06-05', '2026-06-09', 'a'),
];

const empty: ExtrasData = { journal: [], expenses: [], nomad: [], intel: [] };

describe('journalIso', () => {
  it('uses the stop the destination names, including secondary stops', () => {
    expect(journalIso({ destination: 'Copenhagen', happenedOn: '2026-01-01' }, legs)).toBe('DK');
    expect(journalIso({ destination: 'roskilde', happenedOn: '2026-01-01' }, legs)).toBe('DK');
  });
  it('accepts a country name', () => {
    expect(journalIso({ destination: 'Germany', happenedOn: '2026-01-01' }, legs)).toBe('DE');
  });
  it('falls back to the stop covering the day (within the entry\'s own trip)', () => {
    expect(journalIso({ happenedOn: '2026-06-07', tripId: 'a' }, legs)).toBe('DE');
    expect(journalIso({ happenedOn: '2026-06-07', tripId: 'other' }, legs)).toBe('');
  });
  it('is empty when nothing matches', () => {
    expect(journalIso({ destination: 'Atlantis', happenedOn: '2030-01-01' }, legs)).toBe('');
  });
});

describe('buildCountryExtras', () => {
  const data: ExtrasData = {
    journal: [
      { destination: 'Copenhagen', happenedOn: '2026-06-02', images: ['u1', 'u2'] },
      { destination: 'Copenhagen', happenedOn: '2026-06-04', coverImage: 'u3' },
      { destination: 'Roskilde', happenedOn: '2026-06-03', images: ['u4', 'u5'] },
      { destination: 'Berlin', happenedOn: '2026-06-06', images: ['x'] },
    ],
    expenses: [
      { country: 'Denmark', baseAmount: 100, baseCurrency: 'EUR', tripId: 'a' },
      { country: 'Denmark', baseAmount: 50, baseCurrency: 'EUR', tripId: 'a' },
      { country: 'Denmark', baseAmount: 900, baseCurrency: 'CNY', tripId: 'b' },
      { country: 'Germany', baseAmount: 7, baseCurrency: 'EUR', tripId: 'a' },
      { country: 'Narnia', baseAmount: 1, baseCurrency: 'EUR', tripId: 'a' },
    ],
    nomad: [{ country: 'Denmark' }, { country: 'Denmark' }, { country: 'Germany' }, {}],
    intel: [
      { country: 'Denmark', attractions: [1, 2], restaurants: [1], cafes: [1], experiences: [1], cityWalks: [] },
      { country: 'Germany', attractions: [1] },
    ],
  };
  const dk = buildCountryExtras('DK', legs, data);

  it('counts the country\'s journal entries and picks the newest three photos', () => {
    expect(dk.journalCount).toBe(3);
    expect(dk.covers).toEqual(['u3', 'u4', 'u5']);          // Jun 4, then Jun 3's photos
  });
  it('sums spend per trip in each trip\'s own currency', () => {
    expect(dk.spend).toEqual([
      { tripId: 'a', currency: 'EUR', total: 150, count: 2 },
      { tripId: 'b', currency: 'CNY', total: 900, count: 1 },
    ]);
  });
  it('never adds different currencies: no grand total when they differ', () => {
    expect(dk.spendTotal).toBeNull();
  });
  it('gives a total when every line shares one currency', () => {
    const de = buildCountryExtras('DE', legs, data);
    expect(de.spendTotal).toEqual({ currency: 'EUR', total: 7 });
  });
  it('counts saved work spots and guide ideas for the country', () => {
    expect(dk.nomadCount).toBe(2);
    expect(dk.guideCount).toBe(5);
  });
  it('is all zeros for a country with nothing recorded', () => {
    expect(buildCountryExtras('JP', legs, empty)).toEqual({ journalCount: 0, entries: [], covers: [], spend: [], spendTotal: null, nomadCount: 0, guideCount: 0 });
  });
});
