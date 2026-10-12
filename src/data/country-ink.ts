/* ==========================================================================
   On the Road · Country ink
   --------------------------------------------------------------------------
   One muted stamp-pad colour per country, loosely taken from its flag but
   pushed toward real ink (no signal reds / greens). Anything not listed gets
   a stable colour from a small ink palette, so a country always looks the same.
   ========================================================================== */

import { hashStr } from './palette.ts';

const INK: Record<string, string> = {
  DK: '#a5463f', DE: '#46433f', NL: '#c0762c', BE: '#8a7226', FR: '#3f5a96', ES: '#b25a34', PT: '#3f7656',
  CH: '#b0413f', IT: '#4a7a5c', GB: '#35477a', IE: '#3f7656', AT: '#a8453f', SE: '#3f6694', NO: '#a8453f',
  FI: '#3f5f94', IS: '#3f5f94', CZ: '#3a5a96', PL: '#a84a50', HU: '#4a7a5c', GR: '#3f6aa0', HR: '#a8453f',
  SI: '#3f5f94', SK: '#3a5a96', RO: '#8a7226', BG: '#4a7a5c', TR: '#a8453f', MA: '#a8453f', EG: '#8a7226',
  JP: '#a8453f', CN: '#a8403f', KR: '#3f5f94', TH: '#3f5f94', VN: '#a8403f', SG: '#a8453f', ID: '#a8453f',
  US: '#35477a', CA: '#a8453f', MX: '#3f7656', AU: '#35477a', NZ: '#35477a',
};

/** Stable fallbacks: classic stamp-pad inks. */
const FALLBACK = ['#a5463f', '#3f5a96', '#3f7656', '#7a4f94', '#46433f', '#b0702c'];

export function countryInk(iso: string, countryName = ''): string {
  const k = iso.toUpperCase();
  return INK[k] ?? FALLBACK[hashStr(k || countryName.toLowerCase()) % FALLBACK.length];
}
