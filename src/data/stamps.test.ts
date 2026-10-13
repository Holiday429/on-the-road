import { describe, expect, it } from 'vitest';
import { isoFor } from './stamps.ts';
import { countryInk } from './country-ink.ts';

describe('isoFor / countryInk', () => {
  it('maps a name or flag to ISO-2, empty when unknown', () => {
    expect(isoFor('Denmark')).toBe('DK');
    expect(isoFor('germany')).toBe('DE');
    expect(isoFor('Atlantis', '🇩🇰')).toBe('DK');
    expect(isoFor('Atlantis')).toBe('');
  });
  it('a country always gets the same ink, listed or not', () => {
    expect(countryInk('DK')).toBe(countryInk('dk'));
    expect(countryInk('ZZ')).toBe(countryInk('ZZ'));
    expect(countryInk('ZZ')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
