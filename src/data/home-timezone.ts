/* ==========================================================================
   On the Road · Home time zone
   --------------------------------------------------------------------------
   Which zone "home" is, for the banner's second clock and the first flight's
   departure time. The browser zone is deliberately NOT used — it follows the
   traveller abroad, which is exactly what "home" must not do.

   Order: the Profile setting → the trip's home city → where the first
   transport departs from. null when none of those resolve.
   ========================================================================== */

import type { StoredLeg } from './stores/route-store.ts';
import { timezoneForHomeText, timezoneForPlace } from './country-timezone.ts';
import { isValidTimezone } from './tz-math.ts';

export function resolveHomeTimezone(
  prefTz: string | null | undefined,
  homeCity: string | null | undefined,
  legs: StoredLeg[],
): string | null {
  const pref = prefTz?.trim();
  if (pref && isValidTimezone(pref)) return pref;
  const fromCity = timezoneForHomeText(homeCity);
  if (fromCity) return fromCity;
  const first = [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))[0];
  return timezoneForHomeText(first?.arrivalTransport?.from);
}

/* ── The "here" clock ─────────────────────────────────────────────────────── */
// A stop's zone is guessed from its country/city. When the guess is wrong (a
// multi-zone country, an unknown town) the traveller can correct it; the fix is
// remembered per stop on this device, so it doesn't leak onto the next city.

const hereKey = (legId: string) => `otr:hereTz:${legId}`;

export function hereTimezoneOverride(legId: string): string | null {
  try {
    const v = localStorage.getItem(hereKey(legId));
    return v && isValidTimezone(v) ? v : null;
  } catch { return null; }
}

export function setHereTimezoneOverride(legId: string, tz: string | null): void {
  try {
    if (tz && isValidTimezone(tz)) localStorage.setItem(hereKey(legId), tz);
    else localStorage.removeItem(hereKey(legId));
  } catch { /* best-effort */ }
}

/** The zone to show for a stop: the traveller's correction, else the guess. */
export function resolveHereTimezone(leg: Pick<StoredLeg, 'id' | 'city' | 'country'>): string | null {
  return hereTimezoneOverride(leg.id) ?? timezoneForPlace(leg.city, leg.country);
}
