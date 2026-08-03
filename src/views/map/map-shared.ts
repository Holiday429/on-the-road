/* Shared constants between map.ts and landing-map.ts */

import { MAP_PALETTE, MAP_PALETTE_DARK, hashStr } from '../../data/palette.ts';

const MAP_COLORS_LIGHT = {
  land:        '#f0ead6',
  landStroke:  '#d6c9a8',
  route:       '#c0392b',
  ink:         '#3a1d6e',
  hover:       '#e07b54',
  miniLand:    '#f7f5f0',
  miniStroke:  '#d8d0c0',
  flightArc:   '#7b9bbf',
};

const MAP_COLORS_DARK = {
  land:        '#3a352a',
  landStroke:  '#524a38',
  route:       '#e0685a',
  ink:         '#c9b8f5',
  hover:       '#f0947e',
  miniLand:    '#26241f',
  miniStroke:  '#3c372c',
  flightArc:   '#5f7a99',
};

const COUNTRY_COLORS_LIGHT: Record<string, string> = {
  DK: '#d4a5a5',
  DE: '#9fc5b8',
  NL: '#e8c99a',
  BE: '#c4b7d4',
  FR: '#8fb8d4',
  ES: '#d4b8a8',
  PT: '#b8d49c',
  CH: '#e8d4a0',
  IT: '#c4aad4',
};

const COUNTRY_COLORS_DARK: Record<string, string> = {
  DK: '#5a3a3a', DE: '#33473f', NL: '#5a4a2c', BE: '#3f3650',
  FR: '#2c3f50', ES: '#4a3a2c', PT: '#33472c', CH: '#4a3f22', IT: '#3f2c50',
};

function isDark(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

/** Current-theme palette. Call at chart-build time (charts don't self-update). */
export function mapColors() {
  return isDark() ? MAP_COLORS_DARK : MAP_COLORS_LIGHT;
}

export const EUROPE_ROUTE = ['DK', 'DE', 'NL', 'BE', 'FR', 'ES', 'PT', 'CH', 'IT'];

export function countryColor(iso: string): string {
  const table = isDark() ? COUNTRY_COLORS_DARK : COUNTRY_COLORS_LIGHT;
  const palette = isDark() ? MAP_PALETTE_DARK : MAP_PALETTE;
  return table[iso] ?? palette[hashStr(iso) % palette.length];
}
