/* ==========================================================================
   On the Road · Journal places — stops on one line (pure)
   --------------------------------------------------------------------------
   Places and Map are one view now. The entries are grouped by the place they
   were written about and set out in the order the traveller got there, as the
   stops of a single line; the same stops are the pins on the country map. A
   place the bundled city table can place gets coordinates and a country (the
   same table the Map page uses, so the two never disagree); one it can't still
   gets its stop on the line, just no pin.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { cityLocationsFor, primaryCity } from '../../map/geo.ts';
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

/** 🇵🇹 from "PT" — regional-indicator letters, no lookup table. */
export function flagOf(iso: string | null): string {
  if (!iso || !/^[A-Za-z]{2}$/.test(iso)) return '📍';
  return String.fromCodePoint(...iso.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function placeKey(label: string): string {
  return (primaryCity(label) || label).trim().toLowerCase();
}

/** Stops in the order the traveller reached them (earliest entry first). */
export function buildStops(entries: StoredJournalEntry[]): PlaceStop[] {
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
    stops.push({
      key, label, entries: sorted,
      from: dates[0], to: dates[dates.length - 1],
      iso: loc ? (WORLD_CITIES[loc.key]?.iso ?? null) : null,
      lat: loc ? loc.lat : null,
      lng: loc ? loc.lng : null,
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
