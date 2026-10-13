/* ==========================================================================
   On the Road · World — model (pure)
   --------------------------------------------------------------------------
   Everything the World view knows, derived from plotted legs of every trip plus
   today's date: which countries were visited (and how many times) or are only
   planned, per-trip summaries, lifetime totals, and where the camera should
   start. No DOM, no amCharts — the view and the panel just render this.

   Rules (owner decisions):
   · A stop counts as visited once its arrival date has come; later stops are
     only *planned* and never counted.
   · A "visit" to a country is a run of consecutive stops in it within one trip
     (Copenhagen → Berlin → Copenhagen is two visits to Denmark).
   ========================================================================== */

import { continentFor, haversineKm, EUROPE_CENTER } from '../../data/geo-index.ts';
import { nights } from '../map/map-geo.ts';
import { legVisitState, type VisitState } from '../map/map-status.ts';
import type { PlottedLeg } from '../map/map-stats.ts';

export interface WorldTripInput {
  id: string;
  name: string;
  /** CSS colour; '' = none chosen (the UI falls back to the accent). */
  color: string;
  startDate: string;
  endDate: string;
}

export type TripPhase = 'past' | 'current' | 'future';

export interface CountryRecord {
  iso: string;
  /** Display name and flag, taken from the country's first stop. */
  name: string;
  flag: string;
  /** Visited if any stop in it has started; otherwise planned. */
  state: VisitState;
  /** Runs of consecutive visited stops (0 for a planned-only country). */
  visits: number;
  /** Nights spent so far (the current stop counts up to today). */
  nights: number;
  /** Distinct visited city names, in order of first visit. */
  cities: string[];
  /** Trips that have any stop here (visited or planned), oldest first. */
  tripIds: string[];
  /** The trip of this country's latest stop — what "colour by trip" uses. */
  latestTripId: string | null;
  firstDate: string;
  lastDate: string;
}

export interface TripRecord extends WorldTripInput {
  phase: TripPhase;
  legCount: number;
  /** ISOs in route order, de-duplicated. */
  countries: string[];
  nights: number;
}

export interface WorldSummary {
  countries: number;
  cities: number;
  nights: number;
  km: number;
  continents: number;
  trips: number;
}

export interface WorldModel {
  countries: Map<string, CountryRecord>;
  trips: TripRecord[];
  summary: WorldSummary;
  /** Where the camera should start: the current (else latest, else first) trip. */
  focus: { longitude: number; latitude: number };
}

const cmpLeg = (a: PlottedLeg, b: PlottedLeg) => a.dateFrom.localeCompare(b.dateFrom) || a.id.localeCompare(b.id);

/** Nights actually spent in a stop as of `today` (the current stop counts up to today). */
export function spentNights(leg: Pick<PlottedLeg, 'dateFrom' | 'dateTo'>, today: string): number {
  if (leg.dateFrom > today) return 0;
  return nights(leg.dateFrom, leg.dateTo < today ? leg.dateTo : today);
}

export function tripPhase(trip: Pick<WorldTripInput, 'startDate' | 'endDate'>, today: string): TripPhase {
  if (trip.endDate < today) return 'past';
  if (trip.startDate > today) return 'future';
  return 'current';
}

/** Centre of a set of legs' footprint (longitude averaged naively — fine off the antimeridian). */
function footprintCentre(legs: PlottedLeg[]): { longitude: number; latitude: number } {
  if (legs.length === 0) return { ...EUROPE_CENTER };
  let n = -90, s = 90, e = -180, w = 180;
  for (const l of legs) { n = Math.max(n, l.lat); s = Math.min(s, l.lat); e = Math.max(e, l.lng); w = Math.min(w, l.lng); }
  return { longitude: (e + w) / 2, latitude: (n + s) / 2 };
}

/**
 * Build the World model. `onlyTripId` narrows everything to one trip (the trip
 * chips in the panel); `trips` is always the full list so the chips stay put.
 */
export function buildWorldModel(
  allLegs: PlottedLeg[],
  allTrips: WorldTripInput[],
  today: string,
  onlyTripId: string | null = null,
): WorldModel {
  const legs = (onlyTripId ? allLegs.filter((l) => l.tripId === onlyTripId) : allLegs).slice().sort(cmpLeg);
  const byTrip = new Map<string, PlottedLeg[]>();
  for (const l of legs) {
    const k = l.tripId ?? '';
    (byTrip.get(k) ?? byTrip.set(k, []).get(k)!).push(l);
  }

  /* Countries */
  const countries = new Map<string, CountryRecord>();
  for (const l of legs) {
    if (!l.iso) continue;
    let rec = countries.get(l.iso);
    if (!rec) {
      rec = {
        iso: l.iso, name: l.country, flag: l.flag, state: 'planned', visits: 0, nights: 0,
        cities: [], tripIds: [], latestTripId: null, firstDate: l.dateFrom, lastDate: l.dateTo,
      };
      countries.set(l.iso, rec);
    }
    const visited = legVisitState(l, today) === 'visited';
    if (visited) {
      rec.state = 'visited';
      rec.nights += spentNights(l, today);
      for (const s of l.stops.length ? l.stops : [{ name: l.city }]) {
        if (!rec.cities.includes(s.name)) rec.cities.push(s.name);
      }
    }
    if (visited) rec.latestTripId = l.tripId ?? rec.latestTripId;
    else if (rec.latestTripId === null) rec.latestTripId = l.tripId ?? null;
    if (l.tripId && !rec.tripIds.includes(l.tripId)) rec.tripIds.push(l.tripId);
    if (l.dateFrom < rec.firstDate) rec.firstDate = l.dateFrom;
    if (l.dateTo > rec.lastDate) rec.lastDate = l.dateTo;
  }
  // Visits: runs of consecutive visited stops in the same country, per trip.
  for (const tripLegs of byTrip.values()) {
    let prev: string | null = null;
    for (const l of tripLegs) {
      const visited = l.iso && legVisitState(l, today) === 'visited';
      if (visited && l.iso !== prev) countries.get(l.iso!)!.visits += 1;
      prev = visited ? l.iso : null;
    }
  }

  /* Trips — plus any trip that has stops but isn't in the list (not loaded yet, or
     no longer shared): synthesised from its stops so its countries still resolve. */
  const known = new Set(allTrips.map((tr) => tr.id));
  const synthesised: WorldTripInput[] = [];
  for (const l of allLegs) {
    if (!l.tripId || known.has(l.tripId)) continue;
    known.add(l.tripId);
    const own = allLegs.filter((x) => x.tripId === l.tripId);
    synthesised.push({
      id: l.tripId, name: l.tripName ?? l.tripId, color: '',
      startDate: own.reduce((m, x) => (x.dateFrom < m ? x.dateFrom : m), own[0].dateFrom),
      endDate: own.reduce((m, x) => (x.dateTo > m ? x.dateTo : m), own[0].dateTo),
    });
  }
  const trips: TripRecord[] = [...allTrips, ...synthesised]
    .map((t): TripRecord => {
      const tl = allLegs.filter((l) => l.tripId === t.id).sort(cmpLeg);
      const isos: string[] = [];
      for (const l of tl) if (l.iso && !isos.includes(l.iso)) isos.push(l.iso);
      return {
        ...t, phase: tripPhase(t, today), legCount: tl.length, countries: isos,
        nights: tl.reduce((n, l) => n + spentNights(l, today), 0),
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  /* Summary — visited stops only; distance within each trip, never between trips */
  const visitedLegs = legs.filter((l) => legVisitState(l, today) === 'visited');
  const cities = new Set<string>();
  let km = 0;
  for (const tripLegs of byTrip.values()) {
    const v = tripLegs.filter((l) => legVisitState(l, today) === 'visited');
    for (let i = 1; i < v.length; i++) km += haversineKm(v[i - 1], v[i]);
  }
  for (const l of visitedLegs) {
    for (const s of l.stops.length ? l.stops : [{ key: l.city.toLowerCase() }]) cities.add(`${l.iso ?? l.country}:${s.key}`);
  }
  const visitedIsos = [...countries.values()].filter((c) => c.state === 'visited');
  const summary: WorldSummary = {
    countries: visitedIsos.length,
    cities: cities.size,
    nights: visitedLegs.reduce((n, l) => n + spentNights(l, today), 0),
    km: Math.round(km),
    continents: new Set(visitedIsos.map((c) => continentFor(c.iso)).filter(Boolean)).size,
    trips: new Set(visitedLegs.map((l) => l.tripId)).size,
  };

  /* Camera focus: the current trip, else the most recent past one, else the first future one */
  const pool = onlyTripId ? trips.filter((t) => t.id === onlyTripId) : trips;
  const pick = pool.find((t) => t.phase === 'current')
    ?? [...pool].reverse().find((t) => t.phase === 'past')
    ?? pool.find((t) => t.phase === 'future');
  const focusLegs = pick ? legs.filter((l) => l.tripId === pick.id) : legs;
  return { countries, trips, summary, focus: footprintCentre(focusLegs.length ? focusLegs : legs) };
}

/* ── Colouring (data only — the view turns tones into colours) ───────────────── */

export type ColorMode = 'count' | 'trip';

export type CountryTone =
  | { kind: 'none' }
  | { kind: 'planned' }
  | { kind: 'visited'; level: 1 | 2 | 3 | 4 }
  | { kind: 'trip'; tripId: string | null };

/** How a country should be painted. Planned countries are never counted as visited. */
export function countryTone(rec: CountryRecord | undefined, mode: ColorMode): CountryTone {
  if (!rec) return { kind: 'none' };
  if (rec.state === 'planned') return { kind: 'planned' };
  if (mode === 'trip') return { kind: 'trip', tripId: rec.latestTripId };
  return { kind: 'visited', level: Math.min(4, Math.max(1, rec.visits)) as 1 | 2 | 3 | 4 };
}
