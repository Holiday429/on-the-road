/* ==========================================================================
   On the Road · Geo lookup
   --------------------------------------------------------------------------
   City coordinates (lng/lat) for the route's stops, and a mapping from
   country name → ISO2 so we can highlight visited countries and decide which
   ones support province-level drilldown. amCharts handles projection, so we
   pass geo points (longitude/latitude) directly.
   ========================================================================== */

import { WORLD_CITIES } from './world-cities.ts';
import { COUNTRIES } from '../../data/destinations.ts';
import { geocode } from './geocode.ts';

export interface LatLng { lat: number; lng: number; }
export interface CityLocation extends LatLng { key: string; name: string; }

// City coordinates come from the bundled WORLD_CITIES table (city name → coords
// + ISO). Anything missing is resolved at runtime via geocode.ts (online, then
// cached). CITY_COORDS keeps the old shape for back-compat callers that only
// want lat/lng.
export const CITY_COORDS: Record<string, LatLng> = Object.fromEntries(
  Object.entries(WORLD_CITIES).map(([k, v]) => [k, { lat: v.lat, lng: v.lng }]),
);

// Country display name (as used in route data) → ISO2 (amCharts polygon id).
// Built from the full destinations list so any country the user can pick
// resolves, plus a few common aliases.
export const COUNTRY_ISO: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const c of COUNTRIES) map[c.label] = c.country;
  // Aliases that may appear in stored leg data.
  map['Czechia']        = 'CZ';
  map['UK']             = 'GB';
  map['Britain']        = 'GB';
  map['England']        = 'GB';
  map['USA']            = 'US';
  map['America']        = 'US';
  map['UAE']            = 'AE';
  map['Holland']        = 'NL';
  map['South Korea']    = 'KR';
  map['Korea']          = 'KR';
  return map;
})();

const CITY_SPLIT_RE = /\s*(?:\/|\+|→|->|,)\s*/;

function cityTokens(cityField: string): string[] {
  return cityField.split(CITY_SPLIT_RE).map((token) => token.trim()).filter(Boolean);
}

/** Pull the first recognizable city name out of a leg's city string. */
export function primaryCity(cityField: string): string {
  return cityTokens(cityField)[0] ?? cityField.trim();
}

export function cityLocationsFor(cityField: string): CityLocation[] {
  const seen = new Set<string>();
  const locations: CityLocation[] = [];
  for (const token of cityTokens(cityField)) {
    const key = token.toLowerCase();
    const coords = CITY_COORDS[key];
    if (!coords || seen.has(key)) continue;
    seen.add(key);
    locations.push({ ...coords, key, name: token });
  }
  return locations;
}

export function coordsFor(cityField: string): LatLng | null {
  const first = cityLocationsFor(cityField)[0];
  return first ? { lat: first.lat, lng: first.lng } : null;
}

export function isoFor(country: string): string | null {
  return COUNTRY_ISO[country] ?? null;
}

export { cityTokens };

/**
 * Resolve every city token in a leg's `city` field to coordinates, using the
 * bundled table first and the online geocoder for anything missing. Returns the
 * located stops plus the best ISO guess (preferred order: explicit country
 * name → first stop's geocoded ISO). Used by the map to plot arbitrary cities.
 */
export async function resolveCityLocations(
  cityField: string,
  countryHint?: string,
): Promise<{ stops: CityLocation[]; iso: string | null }> {
  const seen = new Set<string>();
  const stops: CityLocation[] = [];
  let firstIso: string | null = null;

  for (const token of cityTokens(cityField)) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = await geocode(token, countryHint);
    if (!hit) continue;
    stops.push({ lat: hit.lat, lng: hit.lng, key, name: token });
    if (!firstIso && hit.iso) firstIso = hit.iso;
  }

  const iso = (countryHint && isoFor(countryHint)) || firstIso;
  return { stops, iso };
}

// Geographic centre of the trip's footprint — used to centre the Europe view.
export const EUROPE_CENTER = { longitude: 6, latitude: 48 };
