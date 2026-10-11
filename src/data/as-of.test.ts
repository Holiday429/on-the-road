import { describe, expect, it } from 'vitest';
import { daySpend, endOfDayMs, entriesOn, expensesAsOf, todosAsOf } from './as-of.ts';

describe('expensesAsOf', () => {
  const rows = [{ date: '2026-08-04' }, { date: '2026-08-05' }, { date: '2026-08-06' }];
  it('keeps everything when not looking back', () => { expect(expensesAsOf(rows, null)).toBe(rows); });
  it('keeps the chosen day and earlier', () => {
    expect(expensesAsOf(rows, '2026-08-05').map((r) => r.date)).toEqual(['2026-08-04', '2026-08-05']);
    expect(expensesAsOf(rows, '2026-08-01')).toEqual([]);
  });
});

describe('todosAsOf', () => {
  const day = (iso: string, h = 12) => new Date(`${iso}T${String(h).padStart(2, '0')}:00:00`).getTime();
  const rows = [{ id: 'old', createdAt: day('2026-08-01') }, { id: 'same', createdAt: day('2026-08-05', 23) }, { id: 'later', createdAt: day('2026-08-06', 0) }, { id: 'nots' }];
  it('drops to-dos created after the end of the chosen day', () => {
    expect(todosAsOf(rows, '2026-08-05').map((r) => r.id)).toEqual(['old', 'same', 'nots']);
  });
  it('is untouched when not looking back', () => { expect(todosAsOf(rows, null)).toBe(rows); });
  it('endOfDayMs is the last moment of the local day', () => {
    expect(endOfDayMs('2026-08-05')).toBe(new Date(2026, 7, 5, 23, 59, 59, 999).getTime());
  });
});

describe('daySpend', () => {
  const rows = [
    { date: '2026-08-05', category: 'food', v: 12 }, { date: '2026-08-05', category: 'food', v: 8 },
    { date: '2026-08-05', category: 'transport', v: 30 }, { date: '2026-08-05', category: '', v: 1 },
    { date: '2026-08-04', category: 'food', v: 99 },
  ];
  it('counts that day only and ranks categories by amount', () => {
    const s = daySpend(rows, '2026-08-05', (e) => e.v);
    expect(s.count).toBe(4);
    expect(s.top).toEqual([{ category: 'transport', amount: 30 }, { category: 'food', amount: 20 }, { category: '', amount: 1 }]);
  });
  it('is empty for a day with nothing, and honours topN', () => {
    expect(daySpend(rows, '2026-08-09', (e) => e.v)).toEqual({ count: 0, top: [] });
    expect(daySpend(rows, '2026-08-05', (e) => e.v, 1).top).toHaveLength(1);
  });
});

describe('entriesOn', () => {
  it('returns that day oldest first', () => {
    const rows = [{ id: 'b', happenedOn: '2026-08-05', createdAt: 2 }, { id: 'x', happenedOn: '2026-08-06', createdAt: 1 }, { id: 'a', happenedOn: '2026-08-05', createdAt: 1 }];
    expect(entriesOn(rows, '2026-08-05').map((r) => r.id)).toEqual(['a', 'b']);
  });
});
