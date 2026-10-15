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
      { country: 'Denmark', baseAmount: 100, baseCurrency: 'EUR', tripId: 'a', category: 'food' },
      { country: 'Denmark', baseAmount: 50, baseCurrency: 'EUR', tripId: 'a', category: 'food' },
      { country: 'Denmark', baseAmount: 900, baseCurrency: 'CNY', tripId: 'b', category: 'accommodation' },
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
  it('also sums spend by category, within each trip and currency — the receipt\'s own line items', () => {
    expect(dk.spendByCategory).toEqual([
      { tripId: 'a', currency: 'EUR', category: 'food', total: 150, count: 2 },
      { tripId: 'b', currency: 'CNY', category: 'accommodation', total: 900, count: 1 },
    ]);
  });
  it('an expense with no category sums under the empty-string category', () => {
    expect(buildCountryExtras('DE', legs, data).spendByCategory).toEqual([
      { tripId: 'a', currency: 'EUR', category: '', total: 7, count: 1 },
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
    expect(buildCountryExtras('JP', legs, empty)).toEqual({ journalCount: 0, entries: [], cityPhotos: [], photos: [], covers: [], spend: [], spendByCategory: [], spendTotal: null, nomadCount: 0, guideCount: 0 });
  });
});

describe('cityPhotos', () => {
  it('takes one photo per city, newest first, and names the place', () => {
    const data = {
      journal: [
        { destination: 'Copenhagen', happenedOn: '2026-06-02', tripId: 'a', images: ['https://x/cph-old.jpg'] },
        { destination: 'Copenhagen', happenedOn: '2026-06-04', tripId: 'a', images: ['https://x/cph-new.jpg', 'https://x/cph-2.jpg'] },
        { destination: 'Roskilde', happenedOn: '2026-06-05', tripId: 'a', images: ['https://x/roskilde.jpg'] },
      ],
      expenses: [], nomad: [], intel: [],
    };
    const shots = buildCountryExtras('DK', legs, data).cityPhotos;
    expect(shots.map((p) => p.city)).toEqual(['Roskilde', 'Copenhagen']);
    // One per city: the newest entry's first photo, not every photo it holds.
    expect(shots.map((p) => p.url)).toEqual(['https://x/roskilde.jpg', 'https://x/cph-new.jpg']);
  });

  it('falls back to an older entry when the newest one has no photo, and lists a city only once', () => {
    const data = {
      journal: [
        { destination: 'Copenhagen', happenedOn: '2026-06-04', tripId: 'a', images: [] },
        { destination: 'Copenhagen', happenedOn: '2026-06-02', tripId: 'a', images: ['https://x/a.jpg'] },
      ],
      expenses: [], nomad: [], intel: [],
    };
    const shots = buildCountryExtras('DK', legs, data).cityPhotos;
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ city: 'Copenhagen', url: 'https://x/a.jpg' });
  });

  it('a country with no photos at all gets no tiles', () => {
    expect(buildCountryExtras('DK', legs, empty).cityPhotos).toEqual([]);
  });
});

describe('photos', () => {
  it('lists every photo of the country, newest entry first, with where and when', () => {
    const data2: ExtrasData = { ...empty, journal: [
      { destination: 'Copenhagen', happenedOn: '2026-07-01', images: ['https://x/a.jpg'], title: 'Day one' },
      { destination: 'Copenhagen', happenedOn: '2026-07-03', images: ['https://x/b.jpg', 'https://x/c.jpg'] },
    ] };
    const shots = buildCountryExtras('DK', legs, data2).photos;
    expect(shots.map((p) => p.url)).toEqual(['https://x/b.jpg', 'https://x/c.jpg', 'https://x/a.jpg']);
    expect(shots[0].date).toBe('2026-07-03');
    expect(shots[2].title).toBe('Day one');
  });
});
