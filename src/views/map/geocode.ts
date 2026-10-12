/* ==========================================================================
   On the Road · Geocoding
   --------------------------------------------------------------------------
   Resolve a free-text place ("Kyoto", "Paris, France", "Grindelwald") to
   { lat, lng, iso }. Three tiers, fastest first:

     1. Bundled WORLD_CITIES table        — instant, offline, common cities
     2. localStorage cache                — instant, offline, anything resolved before
     3. OpenStreetMap Nominatim (online)  — anything else, one-time, then cached

   Cache keys carry the country hint (see geocodeKey) so same-named cities in
   different countries don't collide.

   Nominatim is free but rate-limited (≤1 req/s) and asks for a descriptive
   User-Agent / Referer (the browser sends Referer automatically). We serialize
   requests through a small queue to stay polite.
   ========================================================================== */

import { WORLD_CITIES, type CityRecord } from './world-cities.ts';
import { geocodeKey } from '../../data/geo-index.ts';

export type GeoHit = CityRecord;

const CACHE_KEY = 'otr:geocode:v2';
const LEGACY_CACHE_KEY = 'otr:geocode:v1';

function readJson(key: string): Record<string, GeoHit> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {
    return {};
  }
}

/** v2 cache; if none yet, seed it from v1 (keyed by bare name). A v1 entry is
 *  valid for a no-hint lookup as before, and — since it records its own ISO —
 *  for a lookup hinted with that same country. */
function loadCache(): Record<string, GeoHit> {
  const v2 = readJson(CACHE_KEY);
  if (Object.keys(v2).length) return v2;
  const seeded: Record<string, GeoHit> = {};
  for (const [name, hit] of Object.entries(readJson(LEGACY_CACHE_KEY))) {
    seeded[name] = hit;
    if (hit?.iso) seeded[`${name}|${hit.iso}`] = hit;
  }
  return seeded;
}
function saveCache(cache: Record<string, GeoHit>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota / private mode — best-effort */ }
}

const _cache = loadCache();
const _inflight = new Map<string, Promise<GeoHit | null>>();

const bareKey = (name: string) => geocodeKey(name);

/** Synchronous bundled/cache lookup — returns null if it needs the network. */
export function geocodeLocal(name: string, countryHint?: string): GeoHit | null {
  const bare = bareKey(name);
  if (!bare) return null;
  return WORLD_CITIES[bare] ?? _cache[geocodeKey(name, countryHint)] ?? null;
}

/* ── Online (Nominatim) with a 1-req/s polite queue ───────────────────────── */
let _chain: Promise<unknown> = Promise.resolve();
const MIN_GAP_MS = 1100;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = _chain.then(() => task());
  // Space out the *next* task regardless of this one's outcome.
  _chain = run.then(
    () => new Promise((r) => setTimeout(r, MIN_GAP_MS)),
    () => new Promise((r) => setTimeout(r, MIN_GAP_MS)),
  );
  return run;
}

async function fetchNominatim(query: string): Promise<GeoHit | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  const res = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const rows = await res.json();
  const hit = Array.isArray(rows) ? rows[0] : null;
  if (!hit) return null;
  const lat = parseFloat(hit.lat), lng = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const iso = String(hit.address?.country_code ?? '').toUpperCase();
  return { lat, lng, iso };
}

/**
 * Resolve a place to coordinates. Tries bundled table + cache synchronously,
 * else queues an online lookup. Returns null only if everything fails.
 * `countryHint` is appended to the online query to disambiguate ("Bern, CH").
 */
export async function geocode(name: string, countryHint?: string): Promise<GeoHit | null> {
  if (!bareKey(name)) return null;
  const key = geocodeKey(name, countryHint);

  const local = geocodeLocal(name, countryHint);
  if (local) return local;

  if (_inflight.has(key)) return _inflight.get(key)!;

  const query = countryHint ? `${name}, ${countryHint}` : name;
  const p = enqueue(() => fetchNominatim(query))
    .then((hit) => {
      if (hit) { _cache[key] = hit; saveCache(_cache); }
      return hit;
    })
    .catch((err) => { console.warn('geocode failed for', name, err); return null; })
    .finally(() => { _inflight.delete(key); });

  _inflight.set(key, p);
  return p;
}
