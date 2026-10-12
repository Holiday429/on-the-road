/* ==========================================================================
   On the Road · Geo index
   --------------------------------------------------------------------------
   The one place that knows how a country name becomes an ISO code, which
   continent an ISO belongs to, where "Europe" is centred, and how to pick a
   leg's anchor coordinates. The Map page, the Dashboard thumbnail, the passport
   stamps and the geocode cache all go through here instead of keeping their own
   copies. Pure — no DOM, no network.
   ========================================================================== */

import { COUNTRIES } from './destinations.ts';

export interface LatLng { lat: number; lng: number; }

/* ── Country name → ISO ───────────────────────────────────────────────────── */

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

// Aliases beyond the destination picker's own `keywords` (which are folded in
// below, one alias per whitespace-separated token).
const EXTRA_ALIASES: Record<string, string> = {
  'the netherlands': 'NL',
  'united states of america': 'US',
  'great britain': 'GB',
  'republic of korea': 'KR',
};

const BY_NAME: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const c of COUNTRIES) {
    map.set(norm(c.label), c.country);
    for (const kw of (c.keywords ?? '').split(/\s+/)) if (kw) map.set(norm(kw), c.country);
  }
  for (const [name, iso] of Object.entries(EXTRA_ALIASES)) map.set(name, iso);
  return map;
})();

const BY_FLAG: Map<string, string> = new Map(COUNTRIES.map((c) => [c.flag, c.country]));

// Longest names first so "Papua New Guinea" wins over "Guinea" in a loose match.
const LOOSE_NAMES: Array<{ re: RegExp; iso: string }> = [...BY_NAME.entries()]
  .filter(([name]) => name.length >= 4)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([name, iso]) => ({ re: new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u'), iso }));

const _looseCache = new Map<string, string | null>();

/**
 * ISO 3166-1 alpha-2 for a free-text country field, or null. Tries, in order:
 * the exact name or an alias (case-insensitive), the flag emoji, then a country
 * name that appears as a whole word inside the text ("Denmark (Copenhagen)").
 */
export function isoForCountry(country: string, flag = ''): string | null {
  const name = norm(country);
  const exact = BY_NAME.get(name);
  if (exact) return exact;
  if (flag && BY_FLAG.has(flag)) return BY_FLAG.get(flag)!;
  if (!name) return null;
  if (_looseCache.has(name)) return _looseCache.get(name)!;
  const hit = LOOSE_NAMES.find((n) => n.re.test(name))?.iso ?? null;
  _looseCache.set(name, hit);
  return hit;
}

/* ── Continents ───────────────────────────────────────────────────────────── */

// ISO2 → continent, for the "continents visited" stat. Covers the countries a
// traveller is realistically going to log; anything unmapped simply isn't
// counted (better to undercount than mislabel).
const CONTINENT_BY_ISO: Record<string, string> = (() => {
  const groups: Record<string, string[]> = {
    Europe: ['GB','IE','FR','ES','PT','IT','DE','NL','BE','LU','CH','AT','DK','SE','NO','FI','IS','PL','CZ','SK','HU','SI','HR','BA','RS','ME','MK','AL','GR','BG','RO','EE','LV','LT','UA','BY','MD','RU','MT','CY','LI','MC','AD','SM','VA'],
    Asia: ['CN','JP','KR','KP','TW','HK','MO','TH','VN','LA','KH','MM','MY','SG','ID','PH','BN','IN','NP','BT','BD','LK','PK','AF','KZ','UZ','TM','KG','TJ','MN','AE','SA','QA','BH','KW','OM','YE','JO','LB','SY','IQ','IR','IL','PS','TR','GE','AM','AZ'],
    Africa: ['MA','DZ','TN','LY','EG','SD','ET','KE','TZ','UG','RW','ZA','NA','BW','ZW','ZM','MZ','MG','MU','SC','GH','NG','SN','CI','CM','CD','CG','AO'],
    'North America': ['US','CA','MX','GT','BZ','CR','PA','CU','DO','JM','HT','BS','TT','HN','SV','NI'],
    'South America': ['BR','AR','CL','PE','CO','EC','BO','PY','UY','VE','GY','SR'],
    Oceania: ['AU','NZ','FJ','PG','NC','PF','WS','TO','VU'],
  };
  const map: Record<string, string> = {};
  for (const [cont, isos] of Object.entries(groups)) for (const iso of isos) map[iso] = cont;
  return map;
})();

export function continentFor(iso: string): string | null {
  return CONTINENT_BY_ISO[iso] ?? null;
}

/* ── Constants ────────────────────────────────────────────────────────────── */

/** The one "Europe" camera centre — idle map, fallbacks, thumbnail home point. */
export const EUROPE_CENTER = { longitude: 10, latitude: 50 };

/* ── Distance ─────────────────────────────────────────────────────────────── */

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad, lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ── Coordinates ──────────────────────────────────────────────────────────── */

/** A saved lat/lng further than this from what the city name resolves to is
 *  treated as stale (the leg's city was edited after the coords were saved). */
export const STALE_ANCHOR_KM = 60;

/**
 * Pick a leg's anchor point. The coordinates saved on the leg are the cheapest
 * source, so they win — unless the city name resolves locally (bundled table or
 * cache) to somewhere clearly different, which means the saved point is stale.
 */
export function pickAnchor(saved: Partial<LatLng> | undefined, local: LatLng | null): LatLng | null {
  const hasSaved = saved?.lat != null && saved?.lng != null;
  if (!hasSaved) return local;
  const s = { lat: saved!.lat!, lng: saved!.lng! };
  if (!local) return s;
  return haversineKm(s, local) > STALE_ANCHOR_KM ? local : s;
}

/**
 * Geocode-cache key. The country hint is part of it so two cities that share a
 * name ("Bern" CH vs "Bern" US) don't overwrite each other. The hint is folded
 * to its ISO when it names a country, else to its lower-cased text.
 */
export function geocodeKey(name: string, countryHint?: string): string {
  const n = norm(name);
  const hint = (countryHint ?? '').trim();
  if (!hint) return n;
  return `${n}|${isoForCountry(hint) ?? norm(hint)}`;
}
