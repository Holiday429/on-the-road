import { describe, expect, it, vi } from 'vitest';
import type { StoredLeg } from '../../data/stores/route-store.ts';

vi.mock('../../data/trip-context.ts', () => ({ currentTrip: () => null }));
vi.mock('../../data/stores/route-store.ts', () => ({ routeStore: { peek: () => [] } }));
const { simJumps } = await import('./dashboard-simclock.ts');

const leg = (id: string, city: string, from: string, to: string) => ({ id, city, flag: '', country: '', dateFrom: from, dateTo: to }) as StoredLeg;

describe('simJumps', () => {
  const legs = [leg('b', 'Rome', '2026-08-05', '2026-08-12'), leg('a', 'Lisbon', '2026-08-01', '2026-08-05')];
  it('goes before → each stop in order → last day → after, using the trip dates', () => {
    const j = simJumps({ startDate: '2026-07-30', endDate: '2026-08-20' }, legs);
    expect(j.map((x) => [x.kind, x.iso])).toEqual([
      ['before', '2026-07-23'], ['leg', '2026-08-01'], ['leg', '2026-08-05'], ['last', '2026-08-20'], ['after', '2026-08-21'],
    ]);
    expect(j[1]).toMatchObject({ index: 1 });
    expect((j[1] as { leg: StoredLeg }).leg.city).toBe('Lisbon');
  });
  it('falls back to the legs span without a trip, and is empty with nothing', () => {
    expect(simJumps(null, legs).map((x) => x.iso)).toEqual(['2026-07-25', '2026-08-01', '2026-08-05', '2026-08-12', '2026-08-13']);
    expect(simJumps(null, [])).toEqual([]);
  });
});
