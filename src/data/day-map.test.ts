import { describe, expect, it, vi } from 'vitest';
import type { StoredLeg } from './stores/route-store.ts';

vi.mock('./trip-context.ts', () => ({ currentTrip: () => null }));
vi.mock('./stores/route-store.ts', () => ({ routeStore: { peek: () => [] } }));
const { dayMapModel } = await import('./day-map.ts');

const GEO: Record<string, { lat: number; lng: number }> = {
  rome: { lat: 41.9, lng: 12.5 }, lisbon: { lat: 38.7, lng: -9.1 },
  'via dei fori 12': { lat: 41.89, lng: 12.49 },
};
const geo = (q: string) => GEO[q.toLowerCase()] ?? null;

const leg = (id: string, city: string, from: string, to: string, extra: Partial<StoredLeg> = {}) =>
  ({ id, city, country: 'Italy', flag: '', dateFrom: from, dateTo: to, ...extra }) as StoredLeg;
const ROME = leg('b', 'Rome', '2026-08-05', '2026-08-12', {
  accommodations: [{ id: 's1', name: 'Room in Rome', address: 'Via dei Fori 12', checkIn: '2026-08-05', checkOut: '2026-08-12', confirmed: true }] as never,
  planDays: [{ id: 'd7', date: '2026-08-07', order: 2, label: '', notes: '' }] as never,
  plans: [
    { id: 'p2', dayId: 'd7', title: 'Trattoria', order: 1, lat: 41.88, lng: 12.47 },
    { id: 'p1', dayId: 'd7', title: 'Colosseum', order: 0, lat: 41.89, lng: 12.49 },
    { id: 'p3', dayId: 'd7', title: 'Mystery bar', order: 2 },
    { id: 'px', dayId: 'other', title: 'Elsewhere', order: 0, lat: 1, lng: 1 },
  ] as never,
});
const src = (legs: StoredLeg[]) => ({ legs, journal: [], todos: [], expenses: [] });

describe('dayMapModel', () => {
  it("lists the stay then the day's plan items in order, numbering only the items", () => {
    const m = dayMapModel('2026-08-07', src([ROME]), geo);
    expect(m.points.map((p) => [p.kind, p.label, p.n])).toEqual([
      ['stay', 'Room in Rome', 0], ['plan', 'Colosseum', 1], ['plan', 'Trattoria', 2],
    ]);
    expect(m.points[0]).toMatchObject({ lat: 41.89, lng: 12.49 });   // geocoded from the address
  });
  it('reports what it could not place as pending', () => {
    const m = dayMapModel('2026-08-07', src([ROME]), geo);
    expect(m.pending).toEqual([{ id: 'plan-p3', query: 'Mystery bar, Rome', hint: 'Italy' }]);
  });
  it('starts a change-of-city day at the city just left', () => {
    const lisbon = leg('a', 'Lisbon', '2026-08-01', '2026-08-05');
    const m = dayMapModel('2026-08-05', src([lisbon, ROME]), geo);
    expect(m.points[0]).toMatchObject({ kind: 'city', label: 'Lisbon' });
    expect(m.points[1]).toMatchObject({ kind: 'stay' });
  });
  it("skips a stay that doesn't cover the date, and falls back to the city centre", () => {
    const m = dayMapModel('2026-08-06', src([ROME]), geo);
    expect(m.points.map((p) => p.kind)).toEqual(['stay']);          // day 6 has the stay but no plans
    const before = dayMapModel('2026-08-01', src([ROME]), geo);
    expect(before.points).toEqual([]);
    expect(before.center).toEqual(GEO.rome);                         // nearest stop is Rome
  });
  it('has no center with no legs', () => {
    expect(dayMapModel('2026-08-01', src([]), geo)).toMatchObject({ points: [], center: null });
  });
  it('signature changes with the points and is stable otherwise', () => {
    const a = dayMapModel('2026-08-07', src([ROME]), geo).sig;
    expect(dayMapModel('2026-08-07', src([ROME]), geo).sig).toBe(a);
    expect(dayMapModel('2026-08-06', src([ROME]), geo).sig).not.toBe(a);
  });
});
