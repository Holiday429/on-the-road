import { describe, it, expect } from 'vitest';
import { buildPlaceGroups, journalTiles } from './journal-places.ts';

const e = (id: string, happenedOn: string, destination: string, images: string[] = ['x.jpg'], createdAt = 1): any => ({ id, happenedOn, destination, images, createdAt });
const legs: any[] = [
  { city: 'Copenhagen', flag: '🇩🇰', dateFrom: '2026-09-01', dateTo: '2026-09-06' },
  { city: 'Rome', flag: '🇮🇹', dateFrom: '2026-08-12', dateTo: '2026-08-16' },
];

describe('buildPlaceGroups', () => {
  it('is empty without photos', () => {
    expect(buildPlaceGroups([], legs)).toEqual([]);
    expect(buildPlaceGroups([e('a', '2026-09-02', 'Copenhagen', [])], legs)).toEqual([]);
  });
  it('one group per place, newest place first, with every photo newest-first', () => {
    const g = buildPlaceGroups([
      e('1', '2026-08-13', 'Rome', ['r1.jpg']), e('2', '2026-08-14', 'Rome', ['r2.jpg', 'r3.jpg']),
      e('3', '2026-09-05', 'Copenhagen', ['c1.jpg']),
    ], legs);
    expect(g.map((x) => x.city)).toEqual(['Copenhagen', 'Rome']);
    expect(g[1]).toMatchObject({ cover: 'r2.jpg', images: ['r2.jpg', 'r3.jpg', 'r1.jpg'], flag: '🇮🇹', latest: '2026-08-14' });
    expect(g[1].entries.map((x) => x.id)).toEqual(['2', '1']);
  });
  it('falls back to the leg covering the date when destination is blank', () => {
    const g = buildPlaceGroups([e('1', '2026-08-13', '', ['r.jpg']), e('2', '2026-09-02', '', ['c.jpg'])], legs);
    expect(g.map((x) => x.city)).toEqual(['Copenhagen', 'Rome']);
  });
  it('groups places case-insensitively', () => {
    const g = buildPlaceGroups([e('1', '2026-08-13', 'rome'), e('2', '2026-08-14', 'Rome')], legs);
    expect(g).toHaveLength(1);
    expect(g[0].entries).toHaveLength(2);
  });
});

describe('journalTiles', () => {
  const group = (city: string, n = 1) => ({ city, flag: '', entries: [], images: Array.from({ length: n }, (_, i) => `${city}${i}.jpg`), cover: `${city}0.jpg`, latest: '' });
  it('one tile per place, with +N for places beyond three', () => {
    const r = journalTiles([group('a'), group('b'), group('c'), group('d'), group('e')]);
    expect(r.tiles.map((t) => t.group.city)).toEqual(['a', 'b', 'c']);
    expect(r.more).toBe(2);
  });
  it('shows fewer tiles for fewer places, no +N', () => {
    expect(journalTiles([group('a'), group('b')])).toMatchObject({ more: 0 });
    expect(journalTiles([group('a'), group('b')]).tiles).toHaveLength(2);
    expect(journalTiles([group('a'), group('b'), group('c')]).more).toBe(0);
  });
  it('a single place becomes its first three photos', () => {
    const r = journalTiles([group('a', 5)]);
    expect(r.tiles.map((t) => t.image)).toEqual(['a0.jpg', 'a1.jpg', 'a2.jpg']);
    expect(r.more).toBe(0);
  });
  it('is empty with no places', () => {
    expect(journalTiles([])).toEqual({ tiles: [], more: 0 });
  });
});
