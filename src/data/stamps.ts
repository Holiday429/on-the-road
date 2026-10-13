/* ==========================================================================
   On the Road · Stamp legs
   --------------------------------------------------------------------------
   The leg shape the card postmarks (data/card-postmarks.ts) read, and the one
   country lookup they share. The passport's own country stamps are derived in
   data/passport.ts from data/footprint.ts.
   ========================================================================== */

import { isoForCountry } from './geo-index.ts';

export interface StampLeg {
  id: string;
  city: string;
  country: string;
  flag?: string;
  dateFrom: string;
  dateTo: string;
  order?: number;
  arrivalTransport?: { type?: string } | null;
}

/** ISO-3166 alpha-2 for a country name or flag emoji; '' when unknown. */
export function isoFor(country: string, flag = ''): string {
  return isoForCountry(country, flag) ?? '';
}
