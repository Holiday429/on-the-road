import { describe, it, expect } from 'vitest';
import { buildPlaceSlides } from './journal-places.ts';

const e = (id: string, happenedOn: string, destination: string, images: string[] = ['x.jpg'], createdAt = 1): any => ({ id, happenedOn, destination, images, createdAt });
const legs: any[] = [
  { city: 'Copenhagen', flag: '🇩🇰', dateFrom: '2026-09-01', dateTo: '2026-09-06' },
  { city: 'Rome', flag: '🇮🇹', dateFrom: '2026-08-12', dateTo: '2026-08-16' },
];

describe('buildPlaceSlides', () => {
  it('is empty without photos', () => {
    expect(buildPlaceSlides([], legs)).toEqual([]);
    expect(buildPlaceSlides([e('a', '2026-09-02', 'Copenhagen', [])], legs)).toEqual([]);
  });
  it('one slide per place, newest place first, with count and date range', () => {
    const s = buildPlaceSlides([
      e('1', '2026-08-13', 'Rome', ['r1.jpg']), e('2', '2026-08-14', 'Rome', ['r2.jpg']),
      e('3', '2026-09-05', 'Copenhagen', ['c1.jpg']),
    ], legs);
    expect(s.map((x) => x.city)).toEqual(['Copenhagen', 'Rome']);
    expect(s[1]).toMatchObject({ image: 'r2.jpg', count: 2, from: '2026-08-13', to: '2026-08-14', flag: '🇮🇹' });
  });
  it('falls back to the leg covering the date when destination is blank', () => {
    const s = buildPlaceSlides([e('1', '2026-08-13', '', ['r.jpg']), e('2', '2026-09-02', '', ['c.jpg'])], legs);
    expect(s.map((x) => x.city)).toEqual(['Copenhagen', 'Rome']);
  });
  it('groups places case-insensitively', () => {
    const s = buildPlaceSlides([e('1', '2026-08-13', 'rome'), e('2', '2026-08-14', 'Rome')], legs);
    expect(s).toHaveLength(2);                 // single place → per-photo slides
    expect(new Set(s.map((x) => x.city.toLowerCase()))).toEqual(new Set(['rome']));
  });
  it('a single place becomes one slide per photo, capped', () => {
    const many = e('1', '2026-08-13', 'Rome', Array.from({ length: 12 }, (_, i) => `p${i}.jpg`));
    const s = buildPlaceSlides([many], legs);
    expect(s).toHaveLength(8);
    expect(s[0]).toMatchObject({ city: 'Rome', count: 1 });
  });
});
