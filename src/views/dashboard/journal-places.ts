/* ==========================================================================
   On the Road · Journal places — slides for the dashboard photo carousel
   --------------------------------------------------------------------------
   Turns the trip's journal entries into "a photo per place", the way a phone's
   Photos app surfaces a Place. Pure (no DOM / stores) so the grouping rules are
   unit-testable:

   · An entry's place is its own `destination`; failing that, the leg that
     covers the day it happened (so a photo-only entry still lands somewhere).
   · Several places → one slide per place (newest entry's cover), newest first.
   · Exactly one place → slides become that place's individual photos, so the
     carousel isn't a single frozen card.
   ========================================================================== */

import type { StoredLeg } from '../../data/stores/route-store.ts';
import type { StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { entryImages } from '../journal/shared/utils.ts';

export interface PlaceSlide {
  image: string;
  city: string;
  flag: string;
  /** Entries at this place (place mode) — 1 for a single-photo slide. */
  count: number;
  /** ISO first/last date of the entries behind the slide. */
  from: string;
  to: string;
}

const MAX_SLIDES = 8;

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

export function buildPlaceSlides(entries: StoredJournalEntry[], legs: StoredLeg[]): PlaceSlide[] {
  const withPhotos = entries.filter((e) => entryImages(e).length > 0).sort(newestFirst);
  if (!withPhotos.length) return [];

  const groups = new Map<string, { city: string; flag: string; entries: StoredJournalEntry[] }>();
  for (const e of withPhotos) {
    const p = placeFor(e, legs);
    const key = p.city.toLowerCase();
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { ...p, entries: [] }));
    g.entries.push(e);
  }

  if (groups.size === 1) {
    const g = [...groups.values()][0];
    const out: PlaceSlide[] = [];
    for (const e of g.entries) {
      for (const image of entryImages(e)) {
        out.push({ image, city: g.city, flag: g.flag, count: 1, from: e.happenedOn, to: e.happenedOn });
        if (out.length >= MAX_SLIDES) return out;
      }
    }
    return out;
  }

  return [...groups.values()]
    .map((g) => {
      const dates = g.entries.map((e) => e.happenedOn).sort();
      return {
        image: entryImages(g.entries[0])[0],
        city: g.city, flag: g.flag,
        count: g.entries.length,
        from: dates[0], to: dates[dates.length - 1],
        latest: g.entries[0].happenedOn,
      };
    })
    .sort((a, b) => b.latest.localeCompare(a.latest))
    .slice(0, MAX_SLIDES)
    .map(({ latest: _l, ...slide }) => slide);
}
