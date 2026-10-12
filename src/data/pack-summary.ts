/* ==========================================================================
   On the Road · Pack summary (Dashboard widget model)
   --------------------------------------------------------------------------
   What the Pack widget says right now. Always available, three shapes:
     none — no packing list yet
     near — a flight with a baggage limit is ≤2 days away: weight vs limit
     idle — otherwise: what you're carrying, and the latest bought/lost items
   Pure over plain data; weights are grams.
   ========================================================================== */

import type { PackItem, PackList, PackContainer } from './schema.ts';
import type { StoredLeg } from './stores/route-store.ts';
import { baggageLimitG, itemWeightG, itemsPresentAtLeg } from './packing-formula.ts';
import { daysBetween } from './trip-phase.ts';

export interface PackChange { name: string; kind: 'acquired' | 'dropped'; city: string }

export type PackSummary =
  | { kind: 'none' }
  | { kind: 'near'; leg: StoredLeg; days: number; limitG: number; carriedG: number; remainG: number; pct: number; over: boolean }
  | { kind: 'idle'; carriedG: number; pieces: number; recent: PackChange[] };

/** Days ahead at which a flight with a limit starts to matter. */
export const PACK_NEAR_DAYS = 2;

function containersG(list: PackList): number {
  return list.containers.reduce((s, c) => s + c.selfWeightG, 0);
}

function sortedLegs(legs: StoredLeg[]): StoredLeg[] {
  return [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
}

export function packSummary(list: PackList | null | undefined, legsIn: StoredLeg[], today: string): PackSummary {
  if (!list) return { kind: 'none' };
  const legs = sortedLegs(legsIn);

  const next = legs.find((l) => l.dateFrom >= today && baggageLimitG(l.arrivalTransport) > 0);
  if (next) {
    const days = daysBetween(today, next.dateFrom);
    if (days <= PACK_NEAR_DAYS) {
      const prev = legs[legs.indexOf(next) - 1];
      // What goes on the flight is what you hold leaving the previous stop; from
      // home, anything not picked up along the way.
      const onBoard = prev ? itemsPresentAtLeg(list.items, legs, prev.id) : list.items.filter((it) => !it.acquiredLegId);
      const carriedG = onBoard.reduce((s, it) => s + itemWeightG(it), 0) + containersG(list);
      const limitG = baggageLimitG(next.arrivalTransport);
      return { kind: 'near', leg: next, days, limitG, carriedG, remainG: limitG - carriedG, pct: Math.min(100, (carriedG / limitG) * 100), over: carriedG > limitG };
    }
  }

  const here = legs.find((l) => l.dateFrom <= today && l.dateTo >= today)
    ?? legs.find((l) => l.dateFrom >= today)
    ?? legs[legs.length - 1];
  const present = here ? itemsPresentAtLeg(list.items, legs, here.id) : list.items.filter((it) => !it.droppedLegId);
  const cityOf = (id: string | null) => legs.find((l) => l.id === id)?.city ?? '';
  // Items carry no timestamp, so "recent" is ordered by when the stop they
  // changed hands at began (not by storage order, which is just insertion order).
  const dateOf = (id: string | null) => legs.find((l) => l.id === id)?.dateFrom ?? '';
  const recent: PackChange[] = list.items
    .filter((it) => it.acquiredLegId || it.droppedLegId)
    .map((it) => ({ it, at: dateOf(it.droppedLegId ?? it.acquiredLegId) }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-3)
    .map(({ it }) => it.droppedLegId
      ? { name: it.name, kind: 'dropped' as const, city: cityOf(it.droppedLegId) }
      : { name: it.name, kind: 'acquired' as const, city: cityOf(it.acquiredLegId) });
  return {
    kind: 'idle',
    carriedG: present.reduce((s, it) => s + itemWeightG(it), 0) + containersG(list),
    pieces: present.reduce((s, it) => s + it.qty, 0),
    recent,
  };
}

/** Full change log for the drawer (newest last, as stored). */
export function packChanges(list: PackList, legs: StoredLeg[]): PackChange[] {
  const cityOf = (id: string | null) => legs.find((l) => l.id === id)?.city ?? '';
  return list.items
    .filter((it) => it.acquiredLegId || it.droppedLegId)
    .map((it) => it.droppedLegId
      ? { name: it.name, kind: 'dropped' as const, city: cityOf(it.droppedLegId) }
      : { name: it.name, kind: 'acquired' as const, city: cityOf(it.acquiredLegId) });
}

/* ── What is in each bag right now ───────────────────────────────────────── */

export interface ContainerContents { container: PackContainer; items: PackItem[]; weightG: number }

/** Items you hold today (acquired by now, not yet dropped), sorted into their bags.
 *  An item whose bag is missing or unset is "unassigned". Bag weight includes the
 *  empty bag itself. */
export function packContents(list: PackList, legsIn: StoredLeg[], today: string): { containers: ContainerContents[]; unassigned: PackItem[] } {
  const legs = sortedLegs(legsIn);
  const here = legs.find((l) => l.dateFrom <= today && l.dateTo >= today)
    ?? legs.find((l) => l.dateFrom >= today)
    ?? legs[legs.length - 1];
  const present = here ? itemsPresentAtLeg(list.items, legs, here.id) : list.items.filter((it) => !it.droppedLegId);
  const ids = new Set(list.containers.map((c) => c.id));
  return {
    containers: list.containers.map((container) => {
      const items = present.filter((it) => it.containerId === container.id);
      return { container, items, weightG: items.reduce((s, it) => s + itemWeightG(it), 0) + container.selfWeightG };
    }),
    unassigned: present.filter((it) => !it.containerId || !ids.has(it.containerId)),
  };
}
