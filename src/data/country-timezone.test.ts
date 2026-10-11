import { describe, expect, it } from 'vitest';
import { timezoneForHomeText, timezoneForPlace, TIMEZONE_CHOICES } from './country-timezone.ts';
import { isValidTimezone } from './tz-math.ts';

describe('timezoneForPlace', () => {
  it('uses the country default, tolerant of aliases and extra words', () => {
    expect(timezoneForPlace('Rome', 'Italy')).toBe('Europe/Rome');
    expect(timezoneForPlace('London', 'UK')).toBe('Europe/London');
    expect(timezoneForPlace('Belgrade', 'Serbia (Belgrade)')).toBe('Europe/Belgrade');
  });
  it('lets a known city override a multi-zone country', () => {
    expect(timezoneForPlace('Los Angeles', 'United States')).toBe('America/Los_Angeles');
    expect(timezoneForPlace('Perth', 'Australia')).toBe('Australia/Perth');
    expect(timezoneForPlace('Springfield', 'United States')).toBe('America/New_York');
  });
  it('does not match short city keys inside other words', () => {
    expect(timezoneForPlace('Darwinia', 'Atlantis')).toBeNull();
  });
  it('returns null for unknown places', () => {
    expect(timezoneForPlace('Nowhere', 'Narnia')).toBeNull();
    expect(timezoneForPlace('', '')).toBeNull();
  });
});

describe('timezoneForHomeText', () => {
  it('infers Beijing time for Harbin, in English or Chinese', () => {
    expect(timezoneForHomeText('Harbin')).toBe('Asia/Shanghai');
    expect(timezoneForHomeText('哈尔滨')).toBe('Asia/Shanghai');
    expect(timezoneForHomeText('Harbin, China')).toBe('Asia/Shanghai');
  });
  it('falls back to a country name in the text', () => {
    expect(timezoneForHomeText('Somewhere, Japan')).toBe('Asia/Tokyo');
  });
  it('is null for blank/unknown', () => {
    expect(timezoneForHomeText('')).toBeNull();
    expect(timezoneForHomeText(undefined)).toBeNull();
    expect(timezoneForHomeText('Xyzzy')).toBeNull();
  });
});

describe('tables', () => {
  it('every picker choice is a valid IANA zone', () => {
    for (const c of TIMEZONE_CHOICES) expect(isValidTimezone(c.tz), c.tz).toBe(true);
  });
});
