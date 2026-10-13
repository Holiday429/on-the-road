/* ==========================================================================
   On the Road · Passport stamps (pure)
   --------------------------------------------------------------------------
   The passport belongs to the traveller, not to a trip. Every trip visit to a
   country (data/footprint.ts) earns one country stamp; the same country on a
   second trip earns a fresh stamp but does not raise the country count.
   Which stamps exist is derived; how the traveller pressed them (position,
   force) is the only thing stored (data/stores/passport-store.ts).
   ========================================================================== */

import type { StampSpec } from '../core/paper/stamp.ts';
import { COUNTRY_SHAPES } from '../core/paper/stamp-country.ts';
import { buildFootprint, type FootprintLeg, type TripVisit } from './footprint.ts';
import { countryInk } from './country-ink.ts';
import { hashStr } from './palette.ts';

export interface PassportStamp extends StampSpec {
  /** Trip the stamp was earned on ('_' when the leg had none). */
  tripId: string;
  tripName: string;
  /** First ever stamp for this country: gets the "new country" effect. */
  firstEver: boolean;
  cities: string[];
  legIds: string[];
}

/** Stamp id: one per country per trip, `country:{iso}:{tripId}`. */
export const stampKey = (iso: string, country: string, tripId: string): string =>
  `country:${iso || country.trim().toLowerCase()}:${tripId}`;

/** −14…+14 degrees, stable for a seed. */
function tilt(seed: string): number {
  return (hashStr(seed) % 29) - 14;
}

function toStamp(v: TripVisit, tripNames: ReadonlyMap<string, string>): PassportStamp {
  const id = stampKey(v.iso, v.country, v.tripId);
  return {
    id, kind: 'country', city: v.cities[0] ?? '', country: v.country, iso: v.iso, date: v.date,
    nights: Math.max(1, v.nights), mode: v.mode, shape: COUNTRY_SHAPES[hashStr(v.iso || v.country.toLowerCase()) % COUNTRY_SHAPES.length], rotation: tilt(id), ink: countryInk(v.iso, v.country),
    earned: true, tripId: v.tripId, tripName: tripNames.get(v.tripId) ?? '', firstEver: v.firstEver,
    cities: v.cities, legIds: v.legIds,
  };
}

export interface PassportData {
  /** Oldest first. */
  stamps: PassportStamp[];
  countries: number;
  cities: number;
  nights: number;
  trips: number;
}

/** Everything the passport shows, from the legs of every trip. Only visited countries — never planned ones. */
export function passportFor(legs: FootprintLeg[], today: string, tripNames: ReadonlyMap<string, string> = new Map()): PassportData {
  const fp = buildFootprint(legs, today);
  return {
    stamps: fp.visits.map((v) => toStamp(v, tripNames)),
    countries: fp.summary.countries,
    cities: fp.summary.cities,
    nights: fp.summary.nights,
    trips: fp.summary.trips,
  };
}

/** Stamps not yet pressed by the traveller, oldest first. */
export function pendingStamps(stamps: PassportStamp[], pressedIds: ReadonlySet<string>): PassportStamp[] {
  return stamps.filter((s) => !pressedIds.has(s.id));
}
