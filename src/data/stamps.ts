/* ==========================================================================
   On the Road · Passport stamps
   --------------------------------------------------------------------------
   Every stop on the route earns a stamp; the first stop in each country also
   earns a country-entry stamp. Nothing is stored — they are derived from the
   legs, so editing the itinerary edits the passport. A stamp is "earned" once
   its arrival date has been reached (so the Dashboard time-travel clock can
   replay the trip). The only thing remembered is which stamps the traveller has
   already watched get pressed (stamp-seen.ts).
   ========================================================================== */

import type { StampShape, StampSpec } from '../core/paper/stamp.ts';
import { COUNTRIES } from './destinations.ts';
import { countryInk } from './country-ink.ts';
import { hashStr } from './palette.ts';

export interface StampLeg {
  id: string;
  city: string;
  country: string;
  flag?: string;
  dateFrom: string;
  dateTo: string;
  order?: number;
  arrivalTransport?: { type?: string } | null;
}

const CITY_SHAPES: StampShape[] = ['circle', 'double', 'rounded', 'hex', 'oval', 'octagon'];

/** ISO-3166 alpha-2 for a country name or flag emoji; '' when unknown. */
export function isoFor(country: string, flag = ''): string {
  const name = country.trim().toLowerCase();
  const hit = COUNTRIES.find((c) => c.label.toLowerCase() === name) ?? (flag ? COUNTRIES.find((c) => c.flag === flag) : undefined);
  return hit?.country ?? '';
}

function nightsOf(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

/** −10…+10 degrees, stable for a given seed string. */
function rotationFor(seed: string): number {
  return (hashStr(seed) % 21) - 10;
}

/** All stamps for a route, oldest first. `today` is an ISO date. */
export function stampsFor(legs: StampLeg[], today: string): StampSpec[] {
  const sorted = [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom) || (a.order ?? 0) - (b.order ?? 0));
  const out: StampSpec[] = [];
  const seenCountries = new Set<string>();

  for (const leg of sorted) {
    const iso = isoFor(leg.country, leg.flag);
    const key = iso || leg.country.trim().toLowerCase();
    const ink = countryInk(iso, leg.country);
    const earned = leg.dateFrom <= today;
    const mode = leg.arrivalTransport?.type;
    const nights = nightsOf(leg.dateFrom, leg.dateTo);

    if (key && !seenCountries.has(key)) {
      seenCountries.add(key);
      out.push({
        id: `country:${key}`, kind: 'country', city: leg.city, country: leg.country, iso, date: leg.dateFrom,
        nights, mode, shape: 'entry', rotation: rotationFor(`c${key}${leg.dateFrom}`), ink, earned,
      });
    }
    out.push({
      id: `city:${leg.id}`, kind: 'city', city: leg.city, country: leg.country, iso, date: leg.dateFrom,
      nights, mode, shape: CITY_SHAPES[hashStr(leg.city.trim().toLowerCase()) % CITY_SHAPES.length],
      rotation: rotationFor(`${leg.city}${leg.dateFrom}`), ink, earned,
    });
  }
  return out;
}

export interface PassportSummary {
  earned: number;
  total: number;
  countries: number;
  cities: number;
}

export function passportSummary(stamps: StampSpec[]): PassportSummary {
  const got = stamps.filter((s) => s.earned);
  return {
    earned: got.length,
    total: stamps.length,
    countries: got.filter((s) => s.kind === 'country').length,
    cities: got.filter((s) => s.kind === 'city').length,
  };
}

/** The stamp for a given leg (city stamp), if any. */
export function stampForLeg(stamps: StampSpec[], legId: string): StampSpec | undefined {
  return stamps.find((s) => s.id === `city:${legId}`);
}
