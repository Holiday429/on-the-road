/* ==========================================================================
   On the Road · Footprint (pure)
   --------------------------------------------------------------------------
   Which countries the traveller has actually been to, across EVERY trip — no
   coordinates, no geocoding, so the passport can build it from raw legs
   synchronously. The Map's World view applies the same rule (a stop counts the
   day its arrival date comes; later stops are only planned, see
   views/map/map-status.ts), and `footprintSummary().countries` equals the World
   model's `summary.countries` for the same legs — the footprint test pins this.

   A "trip visit" is every visited stop one trip made in one country. The
   passport earns one stamp per trip visit (Q1: a new stamp for every trip, but
   the country count de-duplicates).
   ========================================================================== */

import { isoForCountry } from './geo-index.ts';

export interface FootprintLeg {
  id: string;
  city: string;
  country: string;
  flag?: string;
  dateFrom: string;
  dateTo: string;
  order?: number;
  tripId?: string | null;
  arrivalTransport?: { type?: string } | null;
  /** The photo the itinerary card shows for this stop, and where in it the crop is centred (0 top – 1 bottom). */
  coverImageUrl?: string;
  coverFocalY?: number;
}

export interface TripVisit {
  /** `${tripId}|${iso}` — stable while the route is unchanged. */
  key: string;
  iso: string;
  country: string;
  flag: string;
  tripId: string;
  /** First arrival in this country on this trip. */
  date: string;
  /** Leaving date of the last visited stop here. */
  dateTo: string;
  /** Nights spent here so far on this trip. */
  nights: number;
  /** Distinct visited cities, first-visit order. */
  cities: string[];
  legIds: string[];
  /** How the traveller first arrived (flight / train / …). */
  mode?: string;
  /** True for the first trip visit to this country, across all trips. */
  firstEver: boolean;
}

export interface FootprintSummary {
  /** Distinct countries visited, all trips. */
  countries: number;
  /** Distinct cities visited. */
  cities: number;
  nights: number;
  /** Trips with at least one visited stop. */
  trips: number;
  /** Trip visits = stamps earned. */
  stamps: number;
}

export interface Footprint {
  /** Chronological (by first arrival, then country). Visited stops only. */
  visits: TripVisit[];
  summary: FootprintSummary;
}

const NO_TRIP = '_';

/** The ISO a leg's country resolves to; '' when unknown. */
export function legIso(leg: Pick<FootprintLeg, 'country' | 'flag'>): string {
  return isoForCountry(leg.country, leg.flag ?? '') ?? '';
}

function daysBetween(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime();
  return Math.round(ms / 86400000);
}

/** Nights spent in a stop as of `today` (the current stop counts up to today). */
function spent(leg: FootprintLeg, today: string): number {
  return Math.max(0, daysBetween(leg.dateFrom, leg.dateTo < today ? leg.dateTo : today));
}

export function buildFootprint(legs: FootprintLeg[], today: string): Footprint {
  const sorted = [...legs]
    .filter((l) => l.dateFrom <= today)
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom) || (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));

  const byKey = new Map<string, TripVisit>();
  const cities = new Set<string>();
  let nights = 0;
  for (const leg of sorted) {
    const iso = legIso(leg);
    // Unknown countries still earn a stamp, keyed by their name.
    const id = iso || leg.country.trim().toLowerCase();
    if (!id) continue;
    const tripId = leg.tripId ?? NO_TRIP;
    const key = `${tripId}|${id}`;
    let v = byKey.get(key);
    if (!v) {
      v = {
        key, iso, country: leg.country, flag: leg.flag ?? '', tripId, date: leg.dateFrom, dateTo: leg.dateTo,
        nights: 0, cities: [], legIds: [], mode: leg.arrivalTransport?.type, firstEver: false,
      };
      byKey.set(key, v);
    }
    const n = spent(leg, today);
    v.nights += n;
    nights += n;
    if (leg.dateTo > v.dateTo) v.dateTo = leg.dateTo;
    if (!v.cities.includes(leg.city)) v.cities.push(leg.city);
    v.legIds.push(leg.id);
    cities.add(`${id}:${leg.city.trim().toLowerCase()}`);
  }

  const visits = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country));
  const seen = new Set<string>();
  for (const v of visits) {
    const id = v.iso || v.country.trim().toLowerCase();
    v.firstEver = !seen.has(id);
    seen.add(id);
  }
  return {
    visits,
    summary: {
      countries: seen.size, cities: cities.size, nights,
      trips: new Set(visits.map((v) => v.tripId)).size, stamps: visits.length,
    },
  };
}
