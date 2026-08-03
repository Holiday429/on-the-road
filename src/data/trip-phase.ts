/* ==========================================================================
   On the Road · Trip phase & countdown
   --------------------------------------------------------------------------
   Extracted from dashboard.ts (which had its own private tripPhase/
   daysBetween/currentLeg) so the Prepare view's phase strip (see
   views/prepare/phase-strip.ts) can share the same "what stage of the trip
   are we in" logic instead of a third independent implementation — sidebar.ts's
   trip-pill countdown (daysUntil) is a separate, simpler badge and is left
   as-is since it doesn't need the during/after distinction.
   ========================================================================== */

import { currentTrip } from './trip-context.ts';
import { routeStore, type StoredLeg } from './stores/route-store.ts';

export type Phase = 'before' | 'during' | 'after';

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days from ISO date `a` to ISO date `b` (positive if b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
}

function sortedLegs(legs: StoredLeg[]): StoredLeg[] {
  return [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
}

/** Current trip phase from the live trip/route stores. The trip's own
 *  start/end date is the source of truth; legs only fill in when there's no
 *  trip loaded yet (guest/boot), so before/during/after can't disagree with
 *  the itinerary after a user moves trip dates without re-touching legs. */
export function tripPhase(legs: StoredLeg[]): Phase {
  const trip = currentTrip();
  const today = todayIso();
  let start: string | undefined;
  let end: string | undefined;
  if (trip) {
    start = trip.startDate;
    end = trip.endDate;
  } else {
    const sorted = sortedLegs(legs);
    start = sorted[0]?.dateFrom;
    end = sorted[sorted.length - 1]?.dateTo;
  }
  if (!start) return 'before';
  if (today < start) return 'before';
  if (end && today > end) return 'after';
  return 'during';
}

/** Today's leg, or the next upcoming one, or the last leg if the trip is over. */
export function currentLeg(legs: StoredLeg[]): StoredLeg | null {
  const sorted = sortedLegs(legs);
  if (!sorted.length) return null;
  const today = todayIso();
  return sorted.find(l => l.dateFrom <= today && l.dateTo >= today)
    ?? sorted.find(l => l.dateFrom >= today)
    ?? sorted[sorted.length - 1];
}

/** Days until the trip starts (negative once it's begun), or null with no
 *  trip/legs loaded at all. Convenience wrapper the phase strip needs most. */
export function daysToGo(legs: StoredLeg[]): number | null {
  const trip = currentTrip();
  const start = trip?.startDate ?? sortedLegs(legs)[0]?.dateFrom;
  if (!start) return null;
  return daysBetween(todayIso(), start);
}

/** Fetch the current legs once (for call sites outside a store subscription,
 *  e.g. computing an initial phase before Prepare's own subscription lands). */
export function peekLegs(): StoredLeg[] {
  return routeStore.peek();
}
