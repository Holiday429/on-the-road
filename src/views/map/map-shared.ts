/* Shared constants between map.ts and landing-map.ts */

import { MAP_PALETTE, hashStr } from '../../data/palette.ts';

export const MAP_COLORS = {
  land:       '#f0ead6',
  landStroke: '#d6c9a8',
  route:      '#c0392b',
  ink:        '#3a1d6e',
  hover:      '#e07b54',
};

export const COUNTRY_COLORS: Record<string, string> = {
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

export const EUROPE_ROUTE = ['DK', 'DE', 'NL', 'BE', 'FR', 'ES', 'PT', 'CH', 'IT'];

export function countryColor(iso: string): string {
  return COUNTRY_COLORS[iso] ?? MAP_PALETTE[hashStr(iso) % MAP_PALETTE.length];
}
