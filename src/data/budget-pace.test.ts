import { describe, expect, it } from 'vitest';
import { budgetPace, tripSpan } from './budget-pace.ts';

const base = { startIso: '2026-06-25', endIso: '2026-07-04' };   // 10 days

describe('budgetPace', () => {
  it('before the trip: nothing spent per day, no forecast', () => {
    const p = budgetPace({ ...base, spent: 0, budget: 1000, todayIso: '2026-06-20' });
    expect(p).toMatchObject({ phase: 'before', daysTotal: 10, daysElapsed: 0, daysLeft: 10, avgPerDay: null, forecast: null, status: 'ok' });
    expect(p.allowedPerDay).toBe(100);
  });

  it('during: average so far, allowed per remaining day, forecast at that pace', () => {
    const p = budgetPace({ ...base, spent: 400, budget: 1000, todayIso: '2026-06-28' });   // day 4 of 10
    expect(p).toMatchObject({ phase: 'during', daysElapsed: 4, daysLeft: 6 });
    expect(p.avgPerDay).toBe(100);
    expect(p.allowedPerDay).toBe(100);
    expect(p.forecast).toBe(1000);
    expect(p.status).toBe('ok');
  });

  it('fast: on course to overshoot though not over yet', () => {
    const p = budgetPace({ ...base, spent: 600, budget: 1000, todayIso: '2026-06-28' });
    expect(p.forecast).toBe(1500);
    expect(p.status).toBe('fast');
  });

  it('over: already past the budget', () => {
    expect(budgetPace({ ...base, spent: 1200, budget: 1000, todayIso: '2026-06-28' }).status).toBe('over');
  });

  it('after the trip: whole span elapsed, nothing left to allow, no forecast', () => {
    const p = budgetPace({ ...base, spent: 900, budget: 1000, todayIso: '2026-07-10' });
    expect(p).toMatchObject({ phase: 'after', daysElapsed: 10, daysLeft: 0, allowedPerDay: null, forecast: null, status: 'ok' });
    expect(p.avgPerDay).toBe(90);
  });

  it('no budget: pace figures only, never fast', () => {
    const p = budgetPace({ ...base, spent: 600, budget: null, todayIso: '2026-06-28' });
    expect(p.status).toBe('ok');
    expect(p.allowedPerDay).toBeNull();
    expect(p.avgPerDay).toBe(150);
  });

  it('no trip dates: degrades to over/ok only', () => {
    const p = budgetPace({ spent: 5, budget: 1, startIso: null, endIso: null, todayIso: '2026-06-28' });
    expect(p.status).toBe('over');
    expect(p.avgPerDay).toBeNull();
  });

  it('allowed per day never goes negative', () => {
    expect(budgetPace({ ...base, spent: 1200, budget: 1000, todayIso: '2026-06-28' }).allowedPerDay).toBe(0);
  });
});

describe('tripSpan', () => {
  it('spans the earliest departure to the latest return', () => {
    expect(tripSpan([{ dateFrom: '2026-07-05', dateTo: '2026-07-09' }, { dateFrom: '2026-06-25', dateTo: '2026-07-05' }])).toEqual({ startIso: '2026-06-25', endIso: '2026-07-09' });
  });
  it('is empty without legs', () => {
    expect(tripSpan([])).toEqual({ startIso: null, endIso: null });
  });
});
