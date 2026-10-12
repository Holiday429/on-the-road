/* ==========================================================================
   On the Road · Geo lookup
   --------------------------------------------------------------------------
   City coordinates (lng/lat) for the route's stops. Country names → ISO2, the
   continent table and the Europe centre live in data/geo-index.ts. amCharts
   handles projection, so we pass geo points (longitude/latitude) directly.
   ========================================================================== */

import { WORLD_CITIES } from './world-cities.ts';
import { geocode, geocodeLocal } from './geocode.ts';
import { isoForCountry, pickAnchor, type LatLng } from '../../data/geo-index.ts';

export type { LatLng };
export interface CityLocation extends LatLng { key: string; name: string; }

// City coordinates come from the bundled WORLD_CITIES table (city name → coords
// + ISO). Anything missing is resolved at runtime via geocode.ts (online, then
// cached). CITY_COORDS keeps the old shape for back-compat callers that only
// want lat/lng.
export const CITY_COORDS: Record<string, LatLng> = Object.fromEntries(
  Object.entries(WORLD_CITIES).map(([k, v]) => [k, { lat: v.lat, lng: v.lng }]),
);

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

export { cityTokens };

/**
 * Resolve every city token in a leg's `city` field to coordinates, using the
 * bundled table first and the online geocoder for anything missing. Returns the
 * located stops, the best ISO guess (explicit country name → first stop's
 * geocoded ISO) and the tokens that could not be located at all, so the map can
 * tell the user instead of silently dropping them.
 *
 * `saved` is the lat/lng persisted on the leg: it anchors the first stop without
 * a lookup, unless the city name now resolves somewhere clearly different.
 */
export async function resolveCityLocations(
  cityField: string,
  countryHint?: string,
  saved?: Partial<LatLng>,
): Promise<{ stops: CityLocation[]; iso: string | null; missing: string[] }> {
  const seen = new Set<string>();
  const stops: CityLocation[] = [];
  const missing: string[] = [];
  let firstIso: string | null = null;

  for (const [i, token] of cityTokens(cityField).entries()) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (i === 0 && saved?.lat != null && saved?.lng != null) {
      const local = geocodeLocal(token, countryHint);
      const anchor = pickAnchor(saved, local);
      if (anchor) {
        stops.push({ lat: anchor.lat, lng: anchor.lng, key, name: token });
        if (!firstIso && local?.iso) firstIso = local.iso;
        continue;
      }
    }
    const hit = await geocode(token, countryHint);
    if (!hit) { missing.push(token); continue; }
    stops.push({ lat: hit.lat, lng: hit.lng, key, name: token });
    if (!firstIso && hit.iso) firstIso = hit.iso;
  }

  const iso = (countryHint && isoForCountry(countryHint)) || firstIso;
  return { stops, iso, missing };
}
