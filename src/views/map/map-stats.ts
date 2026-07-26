/* ==========================================================================
   On the Road · Map — route statistics (pure)
   --------------------------------------------------------------------------
   Pure aggregation/formatting split out of map.ts so it can be unit-tested
   without amCharts, Leaflet, or the DOM. Nothing here touches module state or
   the map instance — callers pass everything in and apply the result.
   ========================================================================== */

import type { GeoPt } from './map-geo.ts';
import { nights } from './map-geo.ts';
import { continentFor, isoFor } from './geo.ts';

/** A leg after geocoding + iso resolution — the shape the map plots and sums. */
export interface PlottedLeg {
  id: string; city: string; country: string; flag: string;
  dateFrom: string; dateTo: string; notes?: string;
  tripId?: string | null;
  tripName?: string;
  lat: number;
  lng: number;
  iso: string | null;
  stops: Array<{ key: string; name: string; lat: number; lng: number }>;
}

/** A derived home flight: an ordered chain of city waypoints. */
export interface FlightChain {
  label: string;
  sub: string;
  waypoints: GeoPt[];
}

export interface CountryStop {
  key: string;
  name: string;
  lat: number;
  lng: number;
}

export interface RouteSummary {
  cityCount: number;
  countryCount: number;
  continentCount: number;
  nightCount: number;
  distanceKm: number;
  legCount: number;
}

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: GeoPt, b: GeoPt): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad, lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Summarize a plotted route: unique cities/countries/continents, total nights,
 * and total great-circle distance (legs + optional home flights).
 * The home-flight chains are passed in so this stays pure (map.ts holds them
 * in module state and forwards them here).
 */
export function summarizeRoute(
  legs: PlottedLeg[],
  outboundChain?: FlightChain | null,
  returnChain?: FlightChain | null,
): RouteSummary {
  const uniqueCountries = new Set<string>();
  const uniqueCities = new Set<string>();
  const continents = new Set<string>();
  let nightCount = 0;
  let distanceKm = 0;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    uniqueCountries.add(leg.iso ?? leg.country);
    const cont = leg.iso ? continentFor(leg.iso) : null;
    if (cont) continents.add(cont);
    nightCount += nights(leg.dateFrom, leg.dateTo);
    for (const stop of leg.stops) {
      uniqueCities.add(`${leg.iso ?? leg.country}:${stop.key}`);
    }
    if (i > 0) distanceKm += haversineKm(legs[i - 1], leg);
  }
  // Include the home flights in the distance when they exist (trip scope).
  if (outboundChain?.waypoints.length) {
    const w = outboundChain.waypoints;
    distanceKm += haversineKm(w[0], w[w.length - 1]);
  }
  if (returnChain?.waypoints.length) {
    const w = returnChain.waypoints;
    distanceKm += haversineKm(w[0], w[w.length - 1]);
  }

  return {
    cityCount: uniqueCities.size,
    countryCount: uniqueCountries.size,
    continentCount: continents.size,
    nightCount,
    distanceKm: Math.round(distanceKm),
    legCount: legs.length,
  };
}

/** Distinct, ordered city stops within one country of a plotted route. */
export function buildCountryStops(legs: PlottedLeg[], code: string): CountryStop[] {
  const stops = new Map<string, CountryStop>();
  for (const leg of legs) {
    if (leg.iso !== code) continue;
    for (const stop of leg.stops) {
      if (!stops.has(stop.key)) {
        stops.set(stop.key, { key: stop.key, name: stop.name, lat: stop.lat, lng: stop.lng });
      }
    }
  }
  return [...stops.values()];
}

/**
 * Sum expenses by ISO country code (via the country→ISO lookup). Rows whose
 * country doesn't resolve to an ISO are skipped. Uses each row's `baseAmount`
 * (already normalized to the trip's base currency).
 */
export function aggregateExpensesByIso(
  rows: { country: string; baseAmount?: number }[],
): Map<string, number> {
  const byIso = new Map<string, number>();
  for (const e of rows) {
    const iso = isoFor(e.country);
    if (!iso) continue;
    byIso.set(iso, (byIso.get(iso) ?? 0) + (e.baseAmount || 0));
  }
  return byIso;
}

/** Compact km formatter: 8420 → "8,420", 12500 → "12.5k". */
export function fmtKm(km: number): string {
  if (km >= 10000) return `${(km / 1000).toFixed(1)}k`;
  return km.toLocaleString('en-US');
}

/** Format a spend total as currency (no decimals). Falls back to a rounded
 *  integer string if the currency code is invalid for Intl. */
export function fmtSpend(n: number, currency = 'EUR'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currency || 'EUR',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)}`;
  }
}
