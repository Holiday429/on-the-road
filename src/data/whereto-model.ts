/* ==========================================================================
   On the Road · Where-to-go model
   --------------------------------------------------------------------------
   The Dashboard's recommendation strip: the guide's picks for a city (sights,
   food, coffee) plus the traveller's own work-friendly spots under one set of
   tabs. Pure — no stores, no DOM.
   ========================================================================== */

import type { CityIntel, NomadSpot } from './schema.ts';

export type WtgTab = 'all' | 'sights' | 'food' | 'coffee' | 'work';
export const WTG_TABS: WtgTab[] = ['all', 'sights', 'food', 'coffee', 'work'];

export type WtgType = 'attraction' | 'experience' | 'restaurant' | 'cafe' | 'work';

export interface WtgCard {
  id: string;
  type: WtgType;
  icon: string;
  title: string;
  highlight?: string;
  cost?: string;
  imageUrl?: string;
  photographer?: string;
  photographerUrl?: string;
  /** Work spots only: [emoji, score] pairs worth showing. */
  ratings?: Array<[string, number]>;
  /** Work spots only: Café / Co-working / … */
  subtype?: string;
}

/** Cards per tab (the strip scrolls; this just keeps it bounded). */
export const WTG_LIMIT = 12;

const GUIDE: Array<{ key: 'attractions' | 'experiences' | 'restaurants' | 'cafes'; type: WtgType; icon: string }> = [
  { key: 'attractions', type: 'attraction', icon: '🏛️' },
  { key: 'experiences', type: 'experience', icon: '✨' },
  { key: 'restaurants', type: 'restaurant', icon: '🍽️' },
  { key: 'cafes',       type: 'cafe',       icon: '☕' },
];
const TAB_KEYS: Record<Exclude<WtgTab, 'all' | 'work'>, string[]> = {
  sights: ['attractions', 'experiences'],
  food: ['restaurants'],
  coffee: ['cafes'],
};
const WORK_ICON: Record<string, string> = { 'Café': '☕', 'Co-working': '💼', 'Library': '📚', 'Hotel lobby': '🏨' };
const RATING_EMOJI: Record<string, string> = { wifi: '📶', power: '🔌', restroom: '🚻', coffee: '☕', service: '🛎️' };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function intelFor(intel: CityIntel[], city: string): CityIntel | undefined {
  return intel.find((c) => same(c.city, city));
}
export function spotsFor(spots: NomadSpot[], city: string): NomadSpot[] {
  return spots.filter((s) => same(s.city, city));
}

function guideCards(intel: CityIntel | undefined, keys: string[]): WtgCard[] {
  if (!intel) return [];
  const out: WtgCard[] = [];
  for (const g of GUIDE.filter((x) => keys.includes(x.key))) {
    for (const item of (intel[g.key] ?? []) as Array<{ id?: string; title?: string; highlight?: string; cost?: string; imageUrl?: string; photographer?: string; photographerUrl?: string }>) {
      if (!item.title) continue;
      out.push({
        id: `${g.key}-${item.id ?? item.title}`, type: g.type, icon: g.icon, title: item.title,
        highlight: item.highlight || undefined, cost: item.cost || undefined,
        imageUrl: item.imageUrl || undefined,
        photographer: item.photographer || undefined, photographerUrl: item.photographerUrl || undefined,
      });
    }
  }
  return out;
}

function workCards(spots: NomadSpot[]): WtgCard[] {
  return spots.map((s) => ({
    id: `work-${s.id}`, type: 'work' as const, icon: WORK_ICON[s.type] ?? '📍', title: s.name,
    highlight: s.comment || undefined, subtype: s.type,
    ratings: Object.entries(s.ratings ?? {})
      .filter(([k, v]) => RATING_EMOJI[k] && typeof v === 'number' && v > 0)
      .slice(0, 3)
      .map(([k, v]) => [RATING_EMOJI[k], v] as [string, number]),
  }));
}

/** Round-robin so "All" shows a mix instead of twelve sights in a row. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

export function wtgCards(tab: WtgTab, city: string, intel: CityIntel[], spots: NomadSpot[], limit = WTG_LIMIT): WtgCard[] {
  const ci = intelFor(intel, city);
  const work = workCards(spotsFor(spots, city));
  let cards: WtgCard[];
  if (tab === 'work') cards = work;
  else if (tab === 'all') cards = interleave([...GUIDE.map((g) => guideCards(ci, [g.key])), work]);
  else cards = guideCards(ci, TAB_KEYS[tab]);
  return cards.slice(0, limit);
}

/** Does this city have anything to recommend — guide picks or a work spot? */
export function cityHasRecommendations(city: string, intel: CityIntel[], spots: NomadSpot[]): boolean {
  return wtgCards('all', city, intel, spots, 1).length > 0;
}

/** The block is worth drawing only if some city on the trip has something. */
export function tripHasRecommendations(cities: string[], intel: CityIntel[], spots: NomadSpot[]): boolean {
  return cities.some((c) => cityHasRecommendations(c, intel, spots));
}
