/* ==========================================================================
   On the Road · Itinerary board — model
   --------------------------------------------------------------------------
   Pure functions behind the departures board and its "now boarding" card:
   which state each stop is in, where the route has gaps or overlaps, and what
   the gate card should show. Every function takes `today` (an ISO date) so the
   Dashboard time-travel clock replays the board too. No DOM, no stores.
   ========================================================================== */

import type { Leg } from './itinerary-shared.ts';
import { legStays, daysBetween } from './itinerary-utils.ts';

export type BoardState = 'done' | 'now' | 'booked' | 'tobook';

export function isTransportBooked(leg: Leg): boolean {
  return !!leg.arrivalTransport?.confirmed;
}

/** Every stay confirmed (and at least one). */
export function isStayConfirmed(leg: Leg): boolean {
  const stays = legStays(leg);
  return stays.length > 0 && stays.every((s) => s.confirmed);
}

/** past → done, here today → now (the departure day still counts as here),
 *  otherwise booked once both the way in and the bed are sorted. */
export function boardState(leg: Leg, today: string): BoardState {
  if (today > leg.dateTo) return 'done';
  if (today >= leg.dateFrom) return 'now';
  return isTransportBooked(leg) && isStayConfirmed(leg) ? 'booked' : 'tobook';
}

/** Days between one stop's departure and the next one's arrival: >0 gap, <0 overlap. */
export function gapBetween(prev: Leg, next: Leg): number {
  return daysBetween(prev.dateTo, next.dateFrom);
}

export interface BoardSummary {
  stops: number;
  countries: number;
  nights: number;
  toBook: number;
}

export function boardSummary(legs: Leg[], today: string): BoardSummary {
  const countries = new Set(legs.map((l) => l.country)).size;
  return {
    stops: legs.length,
    countries,
    nights: legs.reduce((n, l) => n + Math.max(0, daysBetween(l.dateFrom, l.dateTo)), 0),
    toBook: legs.filter((l) => boardState(l, today) === 'tobook').length,
  };
}

/** What the card above the board shows. */
export type Gate =
  | { kind: 'now'; leg: Leg; next: Leg | null; dayNo: number; dayTotal: number }
  | { kind: 'next'; leg: Leg; daysUntil: number }
  | { kind: 'over'; nights: number; stops: number }
  | { kind: 'none' };

/** `legs` must be in route order. */
export function gateFor(legs: Leg[], today: string): Gate {
  if (!legs.length) return { kind: 'none' };
  // Back-to-back stops share a boundary day; the one being left is the earlier one,
  // so take the latest stop that has already started.
  const here = [...legs].reverse().find((l) => today >= l.dateFrom && today <= l.dateTo);
  if (here) {
    const dayTotal = Math.max(1, daysBetween(here.dateFrom, here.dateTo));
    const dayNo = Math.min(dayTotal, Math.max(1, daysBetween(here.dateFrom, today) + 1));
    const after = legs.filter((l) => l.dateFrom >= here.dateTo && l !== here);
    return { kind: 'now', leg: here, next: after[0] ?? null, dayNo, dayTotal };
  }
  const upcoming = legs.find((l) => l.dateFrom > today);
  if (upcoming) return { kind: 'next', leg: upcoming, daysUntil: daysBetween(today, upcoming.dateFrom) };
  const s = boardSummary(legs, today);
  return { kind: 'over', nights: s.nights, stops: s.stops };
}

/** Text for the flap tiles: capped so one long name can't push the row wide. */
export function tileText(s: string, max: number): string {
  const chars = [...s.trim()];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
}
