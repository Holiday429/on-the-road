/* ==========================================================================
   On the Road · Country memory (pure)
   --------------------------------------------------------------------------
   What is on the back of a stamp: what the traveller did in that country on
   that trip, and what the country adds up to over every trip. Journal and
   spend rows carry a free-text place rather than a country, so the existing
   per-country rules of the Map's country panel (views/map/world/country-extras)
   do the matching — a stamp card and the map panel can never disagree.
   ========================================================================== */

import type { PassportStamp } from './passport.ts';
import type { FootprintLeg } from './footprint.ts';
import { legIso } from './footprint.ts';
import { buildCountryExtras, type ExtrasData, type SpendLine } from '../views/map/world/country-extras.ts';
import type { PlottedLeg } from '../views/map/map-stats.ts';

export interface CountryMemory {
  stamp: PassportStamp;
  /** This trip's stay. */
  trip: { cities: string[]; nights: number; dateFrom: string; dateTo: string };
  /** The country over every trip. */
  total: { nights: number; trips: number; cities: number };
  /** Entries this country's days produced (all trips) and up to three of their newest photos. */
  journalCount: number;
  covers: string[];
  /** Spend on this trip in this country, in the trip's own currency (never mixed across currencies). */
  spend: SpendLine[];
}

/** Legs as the Map's per-country rules want them (no coordinates needed for matching). */
function asPlotted(legs: FootprintLeg[]): PlottedLeg[] {
  return legs.map((l) => ({
    id: l.id, city: l.city, country: l.country, flag: l.flag ?? '', dateFrom: l.dateFrom, dateTo: l.dateTo,
    tripId: l.tripId, lat: 0, lng: 0, iso: legIso(l) || null, stops: [],
  }));
}

export function countryMemory(
  stamp: PassportStamp,
  all: PassportStamp[],
  legs: FootprintLeg[],
  data: ExtrasData,
): CountryMemory {
  const same = all.filter((s) => (s.iso || s.country) === (stamp.iso || stamp.country));
  const cities = new Set(same.flatMap((s) => s.cities.map((c) => c.trim().toLowerCase())));
  const mine = legs.filter((l) => stamp.legIds.includes(l.id));
  const extras = buildCountryExtras(stamp.iso, asPlotted(legs), data);
  return {
    stamp,
    trip: {
      cities: stamp.cities,
      nights: stamp.nights,
      dateFrom: mine.length ? mine.map((l) => l.dateFrom).sort()[0] : stamp.date,
      dateTo: mine.length ? mine.map((l) => l.dateTo).sort().reverse()[0] : stamp.date,
    },
    total: { nights: same.reduce((n, s) => n + s.nights, 0), trips: same.length, cities: cities.size },
    journalCount: extras.journalCount,
    covers: extras.covers,
    spend: extras.spend.filter((l) => l.tripId === (stamp.tripId === '_' ? '' : stamp.tripId)),
  };
}
