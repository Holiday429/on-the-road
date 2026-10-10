import { describe, it, expect, beforeEach } from 'vitest';
import { peekRateTable, registerCustomCurrencySource, allCurrencies, isApproxCurrency, currencySymbol, type CustomCurrency } from './rates.ts';

let custom: Record<string, CustomCurrency> | undefined;
beforeEach(() => { custom = undefined; registerCustomCurrencySource(() => custom); });

describe('custom currencies', () => {
  it('appear in the picker list and resolve a symbol', () => {
    custom = { LAK: { symbol: '₭', flag: '🇱🇦', manualRate: 0.00004, rateBase: 'EUR' } };
    expect(allCurrencies().some((c) => c.code === 'LAK')).toBe(true);
    expect(currencySymbol('LAK')).toBe('₭');
    expect(isApproxCurrency('LAK')).toBe(true);
    expect(isApproxCurrency('EUR')).toBe(false);
  });
  it('manual rate is expressed in the entry base and re-based', () => {
    custom = { LAK: { symbol: '₭', manualRate: 0.00004, rateBase: 'EUR' } };
    expect(peekRateTable('EUR').LAK).toBeCloseTo(0.00004);
    const inCny = peekRateTable('CNY');           // CNY per 1 EUR ≈ 1/0.128
    expect(inCny.LAK).toBeCloseTo(0.00004 * inCny.EUR);
  });
  it('built-in approximate currencies resolve without a manual rate', () => {
    expect(peekRateTable('EUR').RSD).toBeGreaterThan(0);
  });
  it('leaves an unknown code without a rate rather than faking 1:1', () => {
    expect(peekRateTable('EUR').XYZ).toBeUndefined();
  });
});
