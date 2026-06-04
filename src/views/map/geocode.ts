/* ==========================================================================
   On the Road · Geocoding
   --------------------------------------------------------------------------
   Resolve a free-text place ("Kyoto", "Paris, France", "Grindelwald") to
   { lat, lng, iso }. Three tiers, fastest first:

     1. Bundled WORLD_CITIES table        — instant, offline, common cities
     2. localStorage cache                — instant, offline, anything resolved before
     3. OpenStreetMap Nominatim (online)  — anything else, one-time, then cached

   Nominatim is free but rate-limited (≤1 req/s) and asks for a descriptive
   User-Agent / Referer (the browser sends Referer automatically). We serialize
   requests through a small queue to stay polite.
   ========================================================================== */

import { WORLD_CITIES, type CityRecord } from './world-cities.ts';

export type GeoHit = CityRecord;

const CACHE_KEY = 'otr:geocode:v1';

function loadCache(): Record<string, GeoHit> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveCache(cache: Record<string, GeoHit>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota / private mode — best-effort */ }
}

const _cache = loadCache();
const _inflight = new Map<string, Promise<GeoHit | null>>();

function normKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Synchronous bundled/cache lookup — returns null if it needs the network. */
export function geocodeLocal(name: string): GeoHit | null {
  const key = normKey(name);
  if (!key) return null;
  return WORLD_CITIES[key] ?? _cache[key] ?? null;
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
  const key = normKey(name);
  if (!key) return null;

  const local = geocodeLocal(name);
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
