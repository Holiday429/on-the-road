import { describe, expect, it, vi } from 'vitest';
import type { StoredLeg } from './stores/route-store.ts';
import type { PackList } from './schema.ts';

vi.mock('./trip-context.ts', () => ({ currentTrip: () => null }));
vi.mock('./stores/route-store.ts', () => ({ routeStore: { peek: () => [] } }));
const { packSummary, packChanges } = await import('./pack-summary.ts');
const { baggageLimitG } = await import('./packing-formula.ts');

const leg = (id: string, city: string, from: string, to: string, extra: Partial<StoredLeg> = {}) =>
  ({ id, city, dateFrom: from, dateTo: to, ...extra }) as StoredLeg;
const item = (id: string, name: string, kg: number, extra: Record<string, unknown> = {}) =>
  ({ id, name, qty: 1, unitWeightG: kg * 1000, acquiredLegId: null, droppedLegId: null, ...extra });
const list = (items: unknown[], bagKg = 2) =>
  ({ id: 'l', name: 'x', containers: [{ id: 'c', selfWeightG: bagKg * 1000 }], items }) as unknown as PackList;

const LEGS = [
  leg('a', 'Lisbon', '2026-08-01', '2026-08-05'),
  leg('b', 'Rome', '2026-08-05', '2026-08-12', { arrivalTransport: { type: 'flight', from: 'Lisbon', to: 'Rome', date: '2026-08-05', confirmed: true, baggageCheckedG: 20000, baggageCarryOnG: 8000 } as never }),
];

describe('baggageLimitG', () => {
  it('adds checked + carry-on, legacy counts as carry-on, none → 0', () => {
    expect(baggageLimitG({ baggageCheckedG: 23000, baggageCarryOnG: 8000 })).toBe(31000);
    expect(baggageLimitG({ baggageAllowanceG: 10000 })).toBe(10000);
    expect(baggageLimitG({ baggageCarryOnG: 8000, baggageAllowanceG: 99999 })).toBe(8000);
    expect(baggageLimitG(undefined)).toBe(0);
  });
});

describe('packSummary', () => {
  it('none without a list', () => {
    expect(packSummary(null, LEGS, '2026-08-01')).toEqual({ kind: 'none' });
  });

  it('near: weight on the flight vs limit, ≤2 days out', () => {
    const l = list([item('1', 'Jacket', 1.5), item('2', 'Scarf', 0.5, { acquiredLegId: 'b' }), item('3', 'Boots', 3)]);
    const s = packSummary(l, LEGS, '2026-08-04');
    // items at Lisbon (scarf bought later doesn't count) 4.5kg + 2kg bag = 6.5; limit 28
    expect(s).toMatchObject({ kind: 'near', days: 1, limitG: 28000, carriedG: 6500, remainG: 21500, over: false });
  });

  it('near: flags over the limit', () => {
    const s = packSummary(list([item('1', 'Anvil', 30)]), LEGS, '2026-08-05');
    expect(s).toMatchObject({ kind: 'near', over: true, pct: 100 });
    expect((s as { remainG: number }).remainG).toBeLessThan(0);
  });

  it('idle when the flight is further than 2 days away, with pieces and recent changes', () => {
    const l = list([
      item('1', 'Jacket', 1, { qty: 2 }),
      item('2', 'Scarf', 0.5, { acquiredLegId: 'a' }),
      item('3', 'Old shoes', 1, { droppedLegId: 'a' }),
    ]);
    const s = packSummary(l, LEGS, '2026-08-02');
    // present at Lisbon: jacket×2 (2kg) + scarf (0.5); shoes dropped there; + 2kg bag
    expect(s).toMatchObject({ kind: 'idle', carriedG: 4500, pieces: 3 });
    expect((s as { recent: unknown[] }).recent).toEqual([
      { name: 'Scarf', kind: 'acquired', city: 'Lisbon' },
      { name: 'Old shoes', kind: 'dropped', city: 'Lisbon' },
    ]);
  });

  it('idle after the trip (no upcoming flight)', () => {
    expect(packSummary(list([item('1', 'Jacket', 1)]), LEGS, '2026-09-30')).toMatchObject({ kind: 'idle', carriedG: 3000 });
  });

  it('idle with no legs at all', () => {
    expect(packSummary(list([item('1', 'Jacket', 1)]), [], '2026-08-01')).toMatchObject({ kind: 'idle', pieces: 1 });
  });
});

describe('packChanges', () => {
  it('lists every acquired/dropped item with its city', () => {
    const l = list([item('1', 'A', 1), item('2', 'B', 1, { acquiredLegId: 'b' })]);
    expect(packChanges(l, LEGS)).toEqual([{ name: 'B', kind: 'acquired', city: 'Rome' }]);
  });
});
