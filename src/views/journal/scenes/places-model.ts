/* ==========================================================================
   On the Road · Journal places — stops on one line (pure)
   --------------------------------------------------------------------------
   Places and Map are one view now. The entries are grouped by the place they
   were written about and set out in the order the traveller got there, as the
   stops of a single line; the same stops are the pins on the country map. A
   place the bundled city table can place gets coordinates and a country (the
   same table the Map page uses, so the two never disagree); one it can't still
   gets its stop on the line, just no pin.

   A place the city table does not know (a village, a beach, a trailhead) is not
   dropped into "elsewhere": it is filed under the country it was written from —
   a country named in its label, the itinerary leg whose city it is, or the leg
   whose dates it falls inside.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { COUNTRIES } from '../../../data/destinations.ts';
import { cityLocationsFor, coordsFor, primaryCity, cityTokens } from '../../map/geo.ts';
import { isoForCountry } from '../../../data/geo-index.ts';
import type { Leg } from '../../../data/schema.ts';
import { WORLD_CITIES } from '../../map/world-cities.ts';
import { sortEntries } from '../shared/utils.ts';

export const NO_PLACE = 'No place yet';

export interface PlaceStop {
  key: string;
  label: string;
  /** Newest first. */
  entries: StoredJournalEntry[];
  /** First and last day written about this place (ISO). */
  from: string;
  to: string;
  iso: string | null;
  lat: number | null;
  lng: number | null;
}

const COUNTRY_NAME: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.country, c.label]));

/** "Portugal" from "PT"; the code itself if it is not one we know. */
export function countryName(iso: string): string {
  return COUNTRY_NAME[iso.toUpperCase()] ?? iso;
}

/** 🇵🇹 from "PT" — regional-indicator letters, no lookup table. */
export function flagOf(iso: string | null): string {
  if (!iso || !/^[A-Za-z]{2}$/.test(iso)) return '📍';
  return String.fromCodePoint(...iso.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function placeKey(label: string): string {
  return (primaryCity(label) || label).trim().toLowerCase();
}

/** The slice of an itinerary leg this model needs. */
export type LegLike = Pick<Leg, 'city' | 'country' | 'flag' | 'dateFrom' | 'dateTo'> & { lat?: number; lng?: number };

interface Filed { iso: string | null; lat: number | null; lng: number | null }

/** Country (and, when a leg supplies one, coordinates) for a place the city table could not place. */
function fileUnder(label: string, entries: StoredJournalEntry[], legs: LegLike[]): Filed {
  const none: Filed = { iso: null, lat: null, lng: null };
  if (label === NO_PLACE && !entries.length) return none;
  if (label !== NO_PLACE) {
    const named = isoForCountry(label);
    if (named) return { ...none, iso: named };
    const key = placeKey(label);
    const leg = legs.find((l) => cityTokens(l.city).some((t) => t.toLowerCase() === key));
    const legIso = leg ? isoForCountry(leg.country, leg.flag) : null;
    if (leg && legIso) {
      const at = leg.lat != null && leg.lng != null ? { lat: leg.lat, lng: leg.lng } : coordsFor(leg.city);
      return { iso: legIso, lat: at?.lat ?? null, lng: at?.lng ?? null };
    }
  }
  // by the calendar: the leg most of its entries were written during
  const tally = new Map<string, number>();
  for (const e of entries) {
    const leg = legs.find((l) => l.dateFrom <= e.happenedOn && e.happenedOn <= l.dateTo && isoForCountry(l.country, l.flag));
    const iso = leg ? isoForCountry(leg.country, leg.flag) : null;
    if (iso) tally.set(iso, (tally.get(iso) ?? 0) + 1);
  }
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? { ...none, iso: best[0] } : none;
}

/** Stops in the order the traveller reached them (earliest entry first). */
export function buildStops(entries: StoredJournalEntry[], legs: LegLike[] = []): PlaceStop[] {
  const byKey = new Map<string, StoredJournalEntry[]>();
  const labels = new Map<string, string>();
  for (const e of entries) {
    const label = e.destination.trim() || NO_PLACE;
    const key = label === NO_PLACE ? '__none__' : placeKey(label);
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(e);
    if (!labels.has(key)) labels.set(key, label);
  }

  const stops: PlaceStop[] = [];
  for (const [key, list] of byKey) {
    const label = labels.get(key)!;
    const sorted = sortEntries(list);
    const loc = key === '__none__' ? undefined : cityLocationsFor(label)[0];
    const dates = list.map((e) => e.happenedOn).sort();
    const filed: Filed = loc
      ? { iso: WORLD_CITIES[loc.key]?.iso ?? null, lat: loc.lat, lng: loc.lng }
      : fileUnder(label, list, legs);
    stops.push({
      key, label, entries: sorted,
      from: dates[0], to: dates[dates.length - 1],
      iso: filed.iso, lat: filed.lat, lng: filed.lng,
    });
  }
  return stops.sort((a, b) => a.from.localeCompare(b.from) || a.label.localeCompare(b.label));
}

/** The stop to show first: the one most recently written about. */
export function latestStop(stops: PlaceStop[]): PlaceStop | null {
  let best: PlaceStop | null = null;
  for (const s of stops) if (!best || s.to > best.to) best = s;
  return best;
}

export interface MapPin { key: string; label: string; count: number; lat: number; lng: number; iso: string | null }

/** The stops that can be pinned, and the countries they light up. */
export function mapPins(stops: PlaceStop[]): { pins: MapPin[]; countries: string[] } {
  const pins: MapPin[] = [];
  for (const s of stops) {
    if (s.lat === null || s.lng === null) continue;
    pins.push({ key: s.key, label: s.label, count: s.entries.length, lat: s.lat, lng: s.lng, iso: s.iso });
  }
  return { pins, countries: [...new Set(pins.map((p) => p.iso).filter((x): x is string => !!x))] };
}

export interface CountryGroup {
  /** The ISO code, or '' for the stops no country could be found for. */
  iso: string;
  stops: PlaceStop[];
  entries: number;
  /** Earliest day written about anywhere in this country. */
  from: string;
  /** Latest day written about anywhere in this country. */
  to: string;
}

/** The pick key of a whole country ('c:PT'; 'c:' for the stops no country was found for). */
export function countryKey(iso: string): string { return `c:${iso}`; }

/**
 * The stops gathered by country, countries in the order they were first reached. The ones
 * with no country of their own come last, under a single unplaced heading.
 */
export function byCountry(stops: PlaceStop[]): CountryGroup[] {
  const groups = new Map<string, CountryGroup>();
  for (const s of stops) {
    const iso = s.iso ?? '';
    const g = groups.get(iso) ?? { iso, stops: [], entries: 0, from: s.from, to: s.to };
    g.stops.push(s);
    g.entries += s.entries.length;
    if (s.from < g.from) g.from = s.from;
    if (s.to > g.to) g.to = s.to;
    groups.set(iso, g);
  }
  return [...groups.values()].sort((a, b) =>
    (a.iso ? 0 : 1) - (b.iso ? 0 : 1) || a.from.localeCompare(b.from) || a.iso.localeCompare(b.iso));
}

/** What the page is showing: a whole country, or one small place inside it. */
export interface Chosen {
  group: CountryGroup;
  /** Set when a single place (not the whole country) was picked. */
  stop: PlaceStop | null;
  key: string;
  entries: StoredJournalEntry[];
}

/**
 * Resolve a pick key ('c:PT', or a stop key) against the groups. Unknown or empty keys fall
 * back to the country of the place written about most recently.
 */
export function resolveChosen(groups: CountryGroup[], stops: PlaceStop[], key: string | null): Chosen {
  const byStop = key && !key.startsWith('c:') ? stops.find((s) => s.key === key) : undefined;
  const byIso = key?.startsWith('c:') ? groups.find((g) => g.iso === key.slice(2)) : undefined;
  const latest = latestStop(stops)!;
  const group = (byStop && groups.find((g) => g.stops.includes(byStop)))
    ?? byIso ?? groups.find((g) => g.stops.includes(latest))!;
  const stop = byStop ?? null;
  const entries = stop ? stop.entries : sortEntries(group.stops.flatMap((s) => s.entries));
  return { group, stop, key: stop ? stop.key : countryKey(group.iso), entries };
}

export interface RouteNode { lat: number; lng: number; iso: string | null; reached: boolean }

/**
 * The itinerary as the Map page draws it: one node per leg, in order. A leg you have arrived at
 * (its first day is today or earlier) is reached — the line up to it is coloured; the ones still
 * ahead are not.
 */
export function routeNodes(legs: LegLike[], today: string): RouteNode[] {
  const out: RouteNode[] = [];
  for (const l of [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))) {
    const at = l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : coordsFor(l.city);
    if (!at) continue;
    out.push({ lat: at.lat, lng: at.lng, iso: isoForCountry(l.country, l.flag), reached: l.dateFrom <= today });
  }
  return out;
}
