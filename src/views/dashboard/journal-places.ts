/* ==========================================================================
   On the Road · Journal places — city tiles for the dashboard Journal card
   --------------------------------------------------------------------------
   Turns the trip's journal entries into "a photo per place", the way a phone's
   Photos app surfaces a Place. Pure (no DOM / stores) so the grouping rules are
   unit-testable:

   · An entry's place is its own `destination`; failing that, the leg that
     covers the day it happened (so a photo-only entry still lands somewhere).
   · Only entries with a photo count — the card is a photo wall.
   · Places are ordered newest first; each carries every photo and entry at it,
     for the drawer that opens when its tile is tapped.
   ========================================================================== */

import type { StoredLeg } from '../../data/stores/route-store.ts';
import type { StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { entryImages } from '../journal/shared/utils.ts';

export interface PlaceGroup {
  city: string;
  flag: string;
  /** Entries with photos at this place, newest first. */
  entries: StoredJournalEntry[];
  /** Every photo at this place, newest entry first. */
  images: string[];
  /** The newest entry's first photo. */
  cover: string;
  /** ISO date of the newest entry. */
  latest: string;
}

export interface PlaceTile { group: PlaceGroup; image: string }

/** How many tiles the card shows. */
export const TILE_COUNT = 3;

function placeFor(e: StoredJournalEntry, legs: StoredLeg[]): { city: string; flag: string } {
  const dest = e.destination?.trim();
  const leg = legs.find((l) => l.dateFrom <= e.happenedOn && e.happenedOn <= l.dateTo);
  if (dest) {
    // Borrow the flag from a leg with the same city when we have one.
    const match = legs.find((l) => l.city.toLowerCase() === dest.toLowerCase());
    return { city: dest, flag: match?.flag ?? '' };
  }
  return leg ? { city: leg.city, flag: leg.flag } : { city: '', flag: '' };
}

function newestFirst(a: StoredJournalEntry, b: StoredJournalEntry): number {
  return b.happenedOn.localeCompare(a.happenedOn) || (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

export function buildPlaceGroups(entries: StoredJournalEntry[], legs: StoredLeg[]): PlaceGroup[] {
  const withPhotos = entries.filter((e) => entryImages(e).length > 0).sort(newestFirst);
  const groups = new Map<string, PlaceGroup>();
  for (const e of withPhotos) {
    const p = placeFor(e, legs);
    const key = p.city.toLowerCase();
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { ...p, entries: [], images: [], cover: '', latest: e.happenedOn }));
    g.entries.push(e);
    g.images.push(...entryImages(e));
  }
  for (const g of groups.values()) g.cover = g.images[0];
  return [...groups.values()].sort((a, b) => b.latest.localeCompare(a.latest));
}

/** The tiles to draw and how many more places sit behind them.
 *  Two or more places → one tile per place (first three), `more` = the rest.
 *  Exactly one place → its first three photos, so the card isn't a lone tile. */
export function journalTiles(groups: PlaceGroup[]): { tiles: PlaceTile[]; more: number } {
  if (groups.length === 1) {
    const g = groups[0];
    return { tiles: g.images.slice(0, TILE_COUNT).map((image) => ({ group: g, image })), more: 0 };
  }
  return {
    tiles: groups.slice(0, TILE_COUNT).map((g) => ({ group: g, image: g.cover })),
    more: Math.max(0, groups.length - TILE_COUNT),
  };
}
