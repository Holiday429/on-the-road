import { describe, it, expect } from 'vitest';
import { currencyForCountry, knownCurrencyForCountry } from './country-currency.ts';

describe('currencyForCountry', () => {
  it('resolves exact, aliased and noisy names', () => {
    expect(currencyForCountry('Denmark')).toBe('DKK');
    expect(currencyForCountry('uk')).toBe('GBP');
    expect(currencyForCountry('Czech')).toBe('CZK');
    expect(currencyForCountry('Republic of Serbia')).toBe('RSD');
  });
  it('covers every country on the Europe 2026 trip', () => {
    for (const c of ['Denmark', 'Germany', 'Netherlands', 'Belgium', 'France', 'Spain', 'Portugal', 'Switzerland', 'Italy']) {
      expect(currencyForCountry(c)).toBeTruthy();
    }
  });
  it('returns null for unknown / blank', () => {
    expect(currencyForCountry('Atlantis')).toBeNull();
    expect(currencyForCountry('')).toBeNull();
  });
  it('knownCurrencyForCountry drops codes the app cannot price', () => {
    expect(knownCurrencyForCountry('Serbia')).toBe('RSD');   // built-in approximate
    expect(knownCurrencyForCountry('Laos')).toBeNull();      // LAK: needs a custom currency
  });
});
