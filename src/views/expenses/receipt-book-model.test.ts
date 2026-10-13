import { describe, expect, it } from 'vitest';
import { barHeight, bookDays, openIndex, runningTotal, stepIndex } from './receipt-book-model.ts';

const rows = [
  { date: '2026-10-12', v: 10 }, { date: '2026-10-10', v: 5 }, { date: '2026-10-12', v: 20 }, { date: '2026-10-15', v: 1 }, { date: '', v: 99 },
];
const days = bookDays(rows, (r) => r.v);

describe('bookDays', () => {
  it('one entry per day with spend, oldest first, summing the base amounts', () => {
    expect(days).toEqual([
      { iso: '2026-10-10', count: 1, total: 5 },
      { iso: '2026-10-12', count: 2, total: 30 },
      { iso: '2026-10-15', count: 1, total: 1 },
    ]);
  });
  it('no rows, no days', () => {
    expect(bookDays([], () => 0)).toEqual([]);
  });
});

describe('runningTotal', () => {
  it('everything up to and including the day', () => {
    expect(runningTotal(days, '2026-10-12')).toBe(35);
    expect(runningTotal(days, '2026-10-11')).toBe(5);
    expect(runningTotal(days, '2026-10-01')).toBe(0);
  });
});

describe('openIndex', () => {
  it('opens on the day itself, else the nearest earlier one, else the first', () => {
    expect(openIndex(days, '2026-10-12')).toBe(1);
    expect(openIndex(days, '2026-10-14')).toBe(1);
    expect(openIndex(days, '2026-10-01')).toBe(0);
    expect(openIndex(days, '2027-01-01')).toBe(2);
    expect(openIndex([], '2026-10-12')).toBe(-1);
  });
});

describe('barHeight / stepIndex', () => {
  it('bars are relative to the busiest day with a visible minimum', () => {
    expect(barHeight(30, 30)).toBe(100);
    expect(barHeight(15, 30)).toBe(50);
    expect(barHeight(0.1, 30)).toBe(12);
    expect(barHeight(5, 0)).toBe(12);
  });
  it('stepping stops at both ends', () => {
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(1, 1, 3)).toBe(2);
  });
});
