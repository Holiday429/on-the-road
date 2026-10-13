/* ==========================================================================
   On the Road · World — country detail model (pure)
   --------------------------------------------------------------------------
   What the country panel shows once a country is picked: its totals, the ink
   stamps earned there, and one entry per trip that touched it. Built from the
   same plotted legs and WorldModel as the map itself, so the numbers on the
   panel and on the map can never disagree.
   ========================================================================== */

import { passportFor, type PassportStamp } from '../../../data/passport.ts';
import type { FootprintLeg } from '../../../data/footprint.ts';
import { spentNights, type CountryRecord, type TripPhase, type WorldModel } from './world-model.ts';
import type { PlottedLeg } from '../map-stats.ts';

export interface CountryTrip {
  id: string;
  name: string;
  color: string;
  phase: TripPhase;
  dateFrom: string;
  dateTo: string;
  /** Distinct city names of this trip's stops in the country, in order. */
  cities: string[];
  nights: number;
}

export interface CountryDetail {
  iso: string;
  name: string;
  flag: string;
  state: CountryRecord['state'];
  visits: number;
  nights: number;
  cities: string[];
  /** The passport's country stamps for this country: one per trip that has reached it. */
  stamps: PassportStamp[];
  trips: CountryTrip[];
}

/** Detail for `iso`, or null if the model has no such country. */
export function buildCountryDetail(
  iso: string,
  legs: PlottedLeg[],
  model: WorldModel,
  today: string,
): CountryDetail | null {
  const rec = model.countries.get(iso);
  if (!rec) return null;

  const inCountry = legs.filter((l) => l.iso === iso);
  const stamps = passportFor(legs as unknown as FootprintLeg[], today).stamps.filter((s) => s.iso === iso);

  const trips: CountryTrip[] = [];
  for (const trip of model.trips) {
    const tl = inCountry.filter((l) => l.tripId === trip.id).sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
    if (tl.length === 0) continue;
    const cities: string[] = [];
    for (const l of tl) for (const s of l.stops.length ? l.stops : [{ name: l.city }]) if (!cities.includes(s.name)) cities.push(s.name);
    trips.push({
      id: trip.id, name: trip.name, color: trip.color, phase: trip.phase,
      dateFrom: tl[0].dateFrom, dateTo: tl[tl.length - 1].dateTo,
      cities, nights: tl.reduce((n, l) => n + spentNights(l, today), 0),
    });
  }

  return {
    iso, name: rec.name, flag: rec.flag, state: rec.state, visits: rec.visits,
    nights: rec.nights, cities: rec.cities, stamps, trips,
  };
}
