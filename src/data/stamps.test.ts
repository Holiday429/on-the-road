import { describe, expect, it } from 'vitest';
import { passportSummary, stampForLeg, stampsFor, isoFor, type StampLeg } from './stamps.ts';
import { countryInk } from './country-ink.ts';

const leg = (id: string, city: string, country: string, from: string, to: string, extra: Partial<StampLeg> = {}): StampLeg =>
  ({ id, city, country, dateFrom: from, dateTo: to, ...extra });

const ROUTE: StampLeg[] = [
  leg('a', 'Copenhagen', 'Denmark', '2026-06-25', '2026-07-05', { arrivalTransport: { type: 'flight' } }),
  leg('b', 'Berlin', 'Germany', '2026-07-05', '2026-07-09', { arrivalTransport: { type: 'train' } }),
  leg('c', 'Hamburg', 'Germany', '2026-07-09', '2026-07-11'),
  leg('d', 'Copenhagen', 'Denmark', '2026-08-20', '2026-09-06'),
];

describe('stampsFor', () => {
  const stamps = stampsFor(ROUTE, '2026-07-06');

  it('one city stamp per stop, plus one entry stamp for the first stop in each country', () => {
    expect(stamps.filter((s) => s.kind === 'city')).toHaveLength(4);
    expect(stamps.filter((s) => s.kind === 'country').map((s) => s.country)).toEqual(['Denmark', 'Germany']);
  });

  it('is earned from the arrival date on; later stops are still to come', () => {
    expect(stamps.filter((s) => s.earned).map((s) => s.id)).toEqual(['country:DK', 'city:a', 'country:DE', 'city:b']);
  });

  it('a stamp is dated by arrival and counts nights', () => {
    const berlin = stampForLeg(stamps, 'b')!;
    expect(berlin).toMatchObject({ date: '2026-07-05', nights: 4, mode: 'train', city: 'Berlin' });
  });

  it('is deterministic: same route, same shapes, rotations and inks', () => {
    expect(stampsFor(ROUTE, '2026-07-06')).toEqual(stamps);
  });

  it('the same city keeps its shape across visits but not its rotation seed', () => {
    const cph = stamps.filter((s) => s.kind === 'city' && s.city === 'Copenhagen');
    expect(cph).toHaveLength(2);
    expect(cph[0].shape).toBe(cph[1].shape);
  });

  it('rotation stays small', () => {
    for (const s of stamps) expect(Math.abs(s.rotation)).toBeLessThanOrEqual(10);
  });

  it('time-travel: before the trip nothing is earned, after it everything is', () => {
    expect(stampsFor(ROUTE, '2026-06-01').some((s) => s.earned)).toBe(false);
    expect(stampsFor(ROUTE, '2026-12-01').every((s) => s.earned)).toBe(true);
  });

  it('input order does not matter and an empty route has no stamps', () => {
    expect(stampsFor([...ROUTE].reverse(), '2026-07-06').map((s) => s.id)).toEqual(stamps.map((s) => s.id));
    expect(stampsFor([], '2026-07-06')).toEqual([]);
  });
});

describe('passportSummary', () => {
  it('counts earned stamps, countries and cities', () => {
    expect(passportSummary(stampsFor(ROUTE, '2026-07-06'))).toEqual({ earned: 4, total: 6, countries: 2, cities: 2 });
  });
});

describe('isoFor / countryInk', () => {
  it('maps a name or flag to ISO-2, empty when unknown', () => {
    expect(isoFor('Denmark')).toBe('DK');
    expect(isoFor('germany')).toBe('DE');
    expect(isoFor('Atlantis', '🇩🇰')).toBe('DK');
    expect(isoFor('Atlantis')).toBe('');
  });
  it('a country always gets the same ink, listed or not', () => {
    expect(countryInk('DK')).toBe(countryInk('dk'));
    expect(countryInk('ZZ')).toBe(countryInk('ZZ'));
    expect(countryInk('ZZ')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
