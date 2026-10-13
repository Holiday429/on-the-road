/* ==========================================================================
   On the Road · Itinerary-card postmarks
   --------------------------------------------------------------------------
   Every stop on the route wears up to two ink postmarks on its card: one when
   you arrive (its dateFrom) and one when you leave (its dateTo). Nothing is
   stored — they follow the route and today's date, so the Dashboard
   time-travel clock replays them too.

   These are NOT the passport's country stamps (data/passport.ts): postmarks
   are per city, automatic, and only describe the current trip's progress.
   ========================================================================== */

import type { StampShape, StampSpec } from '../core/paper/stamp.ts';
import { isoFor, type StampLeg } from './stamps.ts';
import { countryInk } from './country-ink.ts';
import { hashStr } from './palette.ts';

/** Arrival marks are round; departure marks are boxy, so the pair never looks like one repeated stamp. */
const ARRIVE_SHAPES: StampShape[] = ['circle', 'double', 'octagon'];
const DEPART_SHAPES: StampShape[] = ['rounded', 'oval', 'hex'];

export interface CardPostmarks {
  arrive?: StampSpec;
  depart?: StampSpec;
}

function nightsOf(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

/** −12…+12 degrees, stable for a seed. */
function tilt(seed: string): number {
  return (hashStr(seed) % 25) - 12;
}

function byDate(a: StampLeg, b: StampLeg): number {
  return a.dateFrom.localeCompare(b.dateFrom) || (a.order ?? 0) - (b.order ?? 0);
}

/** Postmarks per leg id. A mark is present only once its date has been reached (`today` is an ISO date). */
export function postmarksFor(legs: StampLeg[], today: string): Map<string, CardPostmarks> {
  const sorted = [...legs].sort(byDate);
  const out = new Map<string, CardPostmarks>();

  sorted.forEach((leg, i) => {
    const iso = isoFor(leg.country, leg.flag);
    const ink = countryInk(iso, leg.country);
    const nights = nightsOf(leg.dateFrom, leg.dateTo);
    const cityKey = leg.city.trim().toLowerCase();
    const base = { kind: 'city' as const, city: leg.city, country: leg.country, iso, nights, ink, earned: true };
    const marks: CardPostmarks = {};

    if (leg.dateFrom <= today) {
      marks.arrive = {
        ...base, id: `arrive:${leg.id}`, phase: 'arrive', date: leg.dateFrom, mode: leg.arrivalTransport?.type,
        shape: ARRIVE_SHAPES[hashStr(cityKey) % ARRIVE_SHAPES.length], rotation: tilt(`a${leg.id}${leg.dateFrom}`),
      };
    }
    if (leg.dateTo <= today) {
      // You leave on whatever carries you to the next stop; the last stop has no onward leg to name.
      const next = sorted[i + 1];
      marks.depart = {
        ...base, id: `depart:${leg.id}`, phase: 'depart', date: leg.dateTo, mode: next?.arrivalTransport?.type,
        shape: DEPART_SHAPES[hashStr(`${cityKey}d`) % DEPART_SHAPES.length], rotation: tilt(`d${leg.id}${leg.dateTo}`),
      };
    }
    if (marks.arrive || marks.depart) out.set(leg.id, marks);
  });
  return out;
}
