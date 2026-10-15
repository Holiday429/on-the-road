import { describe, expect, it } from 'vitest';
import { countryMemory } from './country-memory.ts';
import { passportFor } from './passport.ts';
import type { FootprintLeg } from './footprint.ts';

const LEGS: FootprintLeg[] = [
  { id: 'a', city: 'Copenhagen', country: 'Denmark', dateFrom: '2026-06-25', dateTo: '2026-07-05', tripId: 't1' },
  { id: 'b', city: 'Odense', country: 'Denmark', dateFrom: '2026-07-05', dateTo: '2026-07-07', tripId: 't1' },
  { id: 'c', city: 'Berlin', country: 'Germany', dateFrom: '2026-07-07', dateTo: '2026-07-10', tripId: 't1' },
  { id: 'd', city: 'Copenhagen', country: 'Denmark', dateFrom: '2027-03-01', dateTo: '2027-03-04', tripId: 't2' },
];
const { stamps } = passportFor(LEGS, '2027-03-02', new Map([['t1', 'Euro'], ['t2', 'Spring']]));
const dk1 = stamps.find((s) => s.id === 'country:DK:t1')!;

const data = {
  journal: [
    { destination: 'Odense', happenedOn: '2026-07-06', tripId: 't1', images: ['https://x/1.jpg', 'https://x/2.jpg'] },
    { destination: 'Berlin', happenedOn: '2026-07-08', tripId: 't1', images: ['https://x/b.jpg'] },
    { destination: '', happenedOn: '2027-03-02', tripId: 't2', images: [] },
  ],
  expenses: [
    { country: 'Denmark', baseAmount: 100, baseCurrency: 'EUR', tripId: 't1', category: 'accommodation' },
    { country: 'Denmark', baseAmount: 40, baseCurrency: 'EUR', tripId: 't1', category: 'food' },
    { country: 'Denmark', baseAmount: 900, baseCurrency: 'DKK', tripId: 't2', category: 'accommodation' },
    { country: 'Germany', baseAmount: 5, baseCurrency: 'EUR', tripId: 't1', category: 'food' },
  ],
  nomad: [], intel: [],
};

describe('countryMemory', () => {
  const m = countryMemory(dk1, stamps, LEGS, data);

  it('this trip: its cities, nights and dates in the country', () => {
    expect(m.trip).toEqual({ cities: ['Copenhagen', 'Odense'], nights: 12, dateFrom: '2026-06-25', dateTo: '2026-07-07' });
  });

  it('the country over every trip', () => {
    expect(m.total).toEqual({ nights: 12 + 1, trips: 2, cities: 2 });
  });

  it('journal entries and photos are the Map panel\'s numbers for the country', () => {
    expect(m.journalCount).toBe(2);   // Odense (t1) + the unlabelled 2027 entry falling on the Copenhagen stay
    expect(m.covers).toContain('https://x/1.jpg');
  });

  it('spend: this trip only, in its own currency', () => {
    expect(m.spend).toEqual([{ tripId: 't1', currency: 'EUR', total: 140, count: 2 }]);
  });

  it('spendByCategory: this trip only, broken down the same way the Expenses receipt would show it', () => {
    expect(m.spendByCategory).toEqual([
      { tripId: 't1', currency: 'EUR', category: 'accommodation', total: 100, count: 1 },
      { tripId: 't1', currency: 'EUR', category: 'food', total: 40, count: 1 },
    ]);
  });

  describe('the picture at the head of the card and the polaroids', () => {
    it('is the itinerary cover of the first stop of the stay that has one, with its crop focus', () => {
      const legs = LEGS.map((l) => (l.id === 'b' ? { ...l, coverImageUrl: 'https://x/odense.jpg', coverFocalY: 0.3 } : l.id === 'a' ? { ...l, coverImageUrl: 'https://x/cph.jpg' } : l));
      expect(countryMemory(dk1, stamps, legs, data).hero).toEqual({ url: 'https://x/cph.jpg', focalY: undefined, city: 'Copenhagen' });
      const only = LEGS.map((l) => (l.id === 'b' ? { ...l, coverImageUrl: 'https://x/odense.jpg', coverFocalY: 0.3 } : l));
      expect(countryMemory(dk1, stamps, only, data).hero).toEqual({ url: 'https://x/odense.jpg', focalY: 0.3, city: 'Odense' });
    });

    it('without a cover, the newest journal photo heads the card and is not taped in again', () => {
      const m2 = countryMemory(dk1, stamps, LEGS, data);
      expect(m2.hero?.url).toBe('https://x/1.jpg');
      expect(m2.photos.map((p) => p.url)).toEqual(['https://x/2.jpg']);
    });

    it('with a cover, every journal photo of the country is a polaroid', () => {
      const legs = LEGS.map((l) => (l.id === 'a' ? { ...l, coverImageUrl: 'https://x/cph.jpg' } : l));
      expect(countryMemory(dk1, stamps, legs, data).photos.map((p) => p.url)).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);
    });

    it('no cover and no photo: no picture, no polaroids', () => {
      const none = countryMemory(dk1, stamps, LEGS, { ...data, journal: [] });
      expect(none.hero).toBeNull();
      expect(none.photos).toEqual([]);
    });
  });
});
