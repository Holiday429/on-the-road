// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { countryColor, countryMark } from './map-theme.ts';

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

describe('country tones', () => {
  afterEach(() => { delete document.documentElement.dataset.theme; });

  it('gives a valid hex fill and rim in both themes, for listed and unlisted countries', () => {
    for (const theme of ['light', 'dark']) {
      document.documentElement.dataset.theme = theme;
      for (const iso of ['FR', 'IT', 'TR', 'JP']) {
        expect(countryColor(iso)).toMatch(/^#[0-9a-f]{6}$/);
        expect(countryMark(iso)).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('sinks the fill in dark mode and lifts the rim above it', () => {
    document.documentElement.dataset.theme = 'light';
    const light = countryColor('FR');
    document.documentElement.dataset.theme = 'dark';
    expect(lum(countryColor('FR'))).toBeLessThan(lum(light));
    expect(lum(countryMark('FR'))).toBeGreaterThan(lum(countryColor('FR')));
  });

  it('draws the light-mode rim deeper than the pastel fill', () => {
    document.documentElement.dataset.theme = 'light';
    expect(lum(countryMark('DE'))).toBeLessThan(lum(countryColor('DE')));
  });
});
