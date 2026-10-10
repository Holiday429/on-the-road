import { describe, it, expect, vi } from 'vitest';

vi.mock('../../data/trip-context.ts', () => ({ baseCurrency: () => 'CNY' }));
vi.mock('../../data/stores/expense-store.ts', () => ({ expenseStore: {} }));

import { suggestedCurrency } from './expense-defaults.ts';

const leg = (country: string, from: string, to: string) => ({ id: country, country, dateFrom: from, dateTo: to }) as any;
const exp = (date: string, currency: string, country: string) => ({ date, currency, country, createdAt: 1 }) as any;

describe('suggestedCurrency', () => {
  const legs = [leg('Denmark', '2026-07-01', '2026-07-10')];
  it('geography sets the candidate', () => {
    expect(suggestedCurrency(legs, [], '2026-07-05')).toBe('DKK');
  });
  it('recent dominant spend currency wins (≥3 in 3 days)', () => {
    const ex = [exp('2026-07-04', 'EUR', 'Denmark'), exp('2026-07-05', 'EUR', 'Denmark'), exp('2026-07-05', 'EUR', 'Denmark')];
    expect(suggestedCurrency(legs, ex, '2026-07-05')).toBe('EUR');
  });
  it('too few spends do not override geography', () => {
    const ex = [exp('2026-07-05', 'EUR', 'Denmark'), exp('2026-07-05', 'EUR', 'Denmark')];
    expect(suggestedCurrency(legs, ex, '2026-07-05')).toBe('DKK');
  });
  it('spends in another country are ignored', () => {
    const ex = [1, 2, 3].map(() => exp('2026-07-05', 'USD', 'Germany'));
    expect(suggestedCurrency(legs, ex, '2026-07-05')).toBe('DKK');
  });
  it('unknown country falls back to last spend, then EUR', () => {
    const odd = [leg('Atlantis', '2026-07-01', '2026-07-10')];
    expect(suggestedCurrency(odd, [exp('2026-07-02', 'USD', 'x')], '2026-07-05')).toBe('USD');
    expect(suggestedCurrency(odd, [], '2026-07-05')).toBe('EUR');
  });
});
