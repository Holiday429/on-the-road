import { describe, expect, it, vi } from 'vitest';

vi.mock('./trip-context.ts', () => ({ currentTrip: () => null }));
vi.mock('./stores/route-store.ts', () => ({ routeStore: { peek: () => [] } }));
const { planDaysFor, pickPlanDay, legForDate } = await import('./plan-days.ts');

describe('planDaysFor', () => {
  it('makes one day per night and reuses stored days', () => {
    const days = planDaysFor({ dateFrom: '2026-08-05', dateTo: '2026-08-08', planDays: [{ id: 'keep', date: '2026-08-06', order: 9, label: 'x', notes: '' }] });
    expect(days.map((d) => d.date)).toEqual(['2026-08-05', '2026-08-06', '2026-08-07']);
    expect(days[1].id).toBe('keep');
    expect(days[0].id).toBe('day-2026-08-05');
  });
  it('is empty for a same-day leg', () => {
    expect(planDaysFor({ dateFrom: '2026-08-05', dateTo: '2026-08-05' })).toEqual([]);
  });
});

describe('pickPlanDay', () => {
  const days = planDaysFor({ dateFrom: '2026-08-05', dateTo: '2026-08-08' });
  it('finds the exact day, else snaps to the nearest end', () => {
    expect(pickPlanDay(days, '2026-08-06')!.date).toBe('2026-08-06');
    expect(pickPlanDay(days, '2026-08-08')!.date).toBe('2026-08-07'); // check-out day
    expect(pickPlanDay(days, '2026-07-01')!.date).toBe('2026-08-05');
  });
  it('is null with no days', () => { expect(pickPlanDay([], '2026-08-06')).toBeNull(); });
});

describe('legForDate', () => {
  const legs = [{ id: 'b', dateFrom: '2026-08-05', dateTo: '2026-08-12' }, { id: 'a', dateFrom: '2026-08-01', dateTo: '2026-08-05' }];
  it('prefers the arriving leg on a change-of-city day', () => {
    expect(legForDate(legs, '2026-08-05')!.id).toBe('b');
    expect(legForDate(legs, '2026-08-03')!.id).toBe('a');
  });
  it('falls back to the nearest end outside the trip', () => {
    expect(legForDate(legs, '2026-07-01')!.id).toBe('a');
    expect(legForDate(legs, '2026-09-01')!.id).toBe('b');
    expect(legForDate([], '2026-09-01')).toBeNull();
  });
});
