/* ==========================================================================
   On the Road · World — routes, city dots and "you are here" (pure)
   --------------------------------------------------------------------------
   The geometry drawn on top of the countries, derived from the same plotted
   legs as the WorldModel:

   · one line per trip, stop to stop — and never between two trips, so the old
     "all footprints" view's invented flight from one trip's end to the next
     trip's start cannot appear;
   · a dot per city (hollow while it is still ahead);
   · the single spot the traveller is at right now.

   Two-point lines are enough: the map draws each as a great-circle arc, and
   handles the date line, so Asia ↔ Americas stays one unbroken curve.
   ========================================================================== */

import { legVisitState } from '../map/map-status.ts';
import { nights } from '../map/map-geo.ts';
import type { PlottedLeg } from '../map/map-stats.ts';
import type { TripRecord } from './world-model.ts';

export interface LineSeg {
  tripId: string;
  /** The trip's own colour, '' if it has none (the view picks a default). */
  color: string;
  from: [number, number];   // [lng, lat]
  to: [number, number];
  /** True when the destination stop is still ahead. */
  planned: boolean;
}

export interface CityPoint {
  id: string;
  iso: string | null;
  name: string;
  lng: number;
  lat: number;
  planned: boolean;
}

export interface CurrentSpot {
  lng: number;
  lat: number;
  city: string;
  legId: string;
  tripId: string | null;
}

const cmpLeg = (a: PlottedLeg, b: PlottedLeg) => a.dateFrom.localeCompare(b.dateFrom) || a.id.localeCompare(b.id);
const scope = (legs: PlottedLeg[], onlyTripId: string | null) => (onlyTripId ? legs.filter((l) => l.tripId === onlyTripId) : legs);

/** Stop-to-stop segments, trip by trip. */
export function buildTripLines(
  allLegs: PlottedLeg[],
  today: string,
  onlyTripId: string | null,
  colors: ReadonlyMap<string, string>,
): LineSeg[] {
  const byTrip = new Map<string, PlottedLeg[]>();
  for (const l of scope(allLegs, onlyTripId).slice().sort(cmpLeg)) {
    const k = l.tripId ?? '';
    (byTrip.get(k) ?? byTrip.set(k, []).get(k)!).push(l);
  }
  const out: LineSeg[] = [];
  for (const [tripId, legs] of byTrip) {
    for (let i = 1; i < legs.length; i++) {
      const a = legs[i - 1], b = legs[i];
      if (Math.abs(a.lng - b.lng) < 0.01 && Math.abs(a.lat - b.lat) < 0.01) continue;   // same place
      out.push({
        tripId, color: colors.get(tripId) ?? '',
        from: [a.lng, a.lat], to: [b.lng, b.lat],
        planned: legVisitState(b, today) === 'planned',
      });
    }
  }
  return out;
}

/** One dot per city, visited if any stop there has started. */
export function buildCityPoints(allLegs: PlottedLeg[], today: string, onlyTripId: string | null): CityPoint[] {
  const points = new Map<string, CityPoint>();
  for (const l of scope(allLegs, onlyTripId).slice().sort(cmpLeg)) {
    const planned = legVisitState(l, today) === 'planned';
    for (const s of l.stops.length ? l.stops : [{ key: l.city.toLowerCase(), name: l.city, lat: l.lat, lng: l.lng }]) {
      const id = `${l.iso ?? l.country}:${s.key}`;
      const prev = points.get(id);
      if (prev) { if (!planned) prev.planned = false; continue; }
      points.set(id, { id, iso: l.iso, name: s.name, lng: s.lng, lat: s.lat, planned });
    }
  }
  return [...points.values()];
}

/**
 * Where the traveller is `today`: the stop whose dates contain today; failing
 * that (a travel day between stops) the last stop of a trip that is under way.
 */
export function currentSpot(allLegs: PlottedLeg[], trips: TripRecord[], today: string, onlyTripId: string | null): CurrentSpot | null {
  const legs = scope(allLegs, onlyTripId).slice().sort(cmpLeg);
  const spot = (l: PlottedLeg): CurrentSpot => ({ lng: l.lng, lat: l.lat, city: l.city, legId: l.id, tripId: l.tripId ?? null });
  const here = legs.find((l) => l.dateFrom <= today && today <= l.dateTo);
  if (here) return spot(here);
  for (const trip of trips) {
    if (trip.phase !== 'current') continue;
    const done = legs.filter((l) => l.tripId === trip.id && l.dateFrom <= today);
    if (done.length) return spot(done[done.length - 1]);
  }
  return null;
}

export interface NextStop {
  city: string;
  country: string;
  flag: string;
  iso: string | null;
  /** Whole days from today to arrival (0 = today). */
  inDays: number;
  legId: string;
}

/** The next stop still ahead: the first stop whose arrival date is after today. */
export function nextStop(allLegs: PlottedLeg[], today: string, onlyTripId: string | null): NextStop | null {
  const ahead = scope(allLegs, onlyTripId).filter((l) => l.dateFrom > today).sort(cmpLeg)[0];
  if (!ahead) return null;
  return {
    city: ahead.city, country: ahead.country, flag: ahead.flag, iso: ahead.iso, legId: ahead.id,
    inDays: nights(today, ahead.dateFrom),
  };
}

export interface YearEntry {
  year: number;
  /** Trips with a stop that starts in this year. */
  trips: number;
  /** True when every stop of the year is still ahead. */
  planned: boolean;
}

/** The years that have stops, oldest first — the Atlas's year ribbon. */
export function yearsOf(allLegs: PlottedLeg[], today: string): YearEntry[] {
  const byYear = new Map<number, { trips: Set<string>; visited: boolean }>();
  for (const l of allLegs) {
    const y = Number(l.dateFrom.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    const e = byYear.get(y) ?? byYear.set(y, { trips: new Set(), visited: false }).get(y)!;
    e.trips.add(l.tripId ?? '');
    if (legVisitState(l, today) === 'visited') e.visited = true;
  }
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, e]) => ({ year, trips: e.trips.size, planned: !e.visited }));
}
