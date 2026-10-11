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
import { timezoneForHomeText } from './country-timezone.ts';
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
