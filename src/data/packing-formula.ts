/* ==========================================================================
   On the Road · Pack weight helpers
   --------------------------------------------------------------------------
   Per-item weight math, kg formatter, and trip-aware weight derivations.
   ========================================================================== */

import type { PackItem } from './schema.ts';
import type { StoredLeg } from './stores/route-store.ts';

/* ── Weight math ─────────────────────────────────────────────────────────── */

export function itemWeightG(it: { qty: number; unitWeightG: number }): number {
  return it.qty * it.unitWeightG;
}

export function formatKg(grams: number): string {
  return (grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 1) + 'kg';
}

/* ── Trip-aware weight derivations ──────────────────────────────────────── */

/**
 * Items that are physically present at a given leg (by order index).
 * An item is present if:
 *   - it was acquired before or at this leg (or acquiredLegId is null = brought from home)
 *   - it has not been dropped before or at this leg (or droppedLegId is null = still carrying)
 */
export function itemsPresentAtLeg(
  items: PackItem[],
  legs: StoredLeg[],
  legId: string,
): PackItem[] {
  const legOrder = legs.findIndex(l => l.id === legId);
  if (legOrder === -1) return items.filter(it => !it.droppedLegId);

  return items.filter(it => {
    const acquiredOrder = it.acquiredLegId
      ? legs.findIndex(l => l.id === it.acquiredLegId)
      : -1; // -1 = brought from home, always present from leg 0
    const droppedOrder = it.droppedLegId
      ? legs.findIndex(l => l.id === it.droppedLegId)
      : Infinity;

    return acquiredOrder <= legOrder && droppedOrder > legOrder;
  });
}

/**
 * Total weight in grams at a specific leg.
 */
export function weightAtLeg(
  items: PackItem[],
  legs: StoredLeg[],
  legId: string,
): number {
  return itemsPresentAtLeg(items, legs, legId)
    .reduce((sum, it) => sum + itemWeightG(it), 0);
}

/**
 * Weight curve across all legs — returns one entry per leg.
 * Useful for the Pack timeline view.
 */
export function weightCurve(
  items: PackItem[],
  legs: StoredLeg[],
): Array<{ leg: StoredLeg; weightG: number }> {
  return legs.map(leg => ({
    leg,
    weightG: weightAtLeg(items, legs, leg.id),
  }));
}

/**
 * Remaining allowance in grams for the transport arriving at a given leg.
 * Returns null if no allowance is set on that transport.
 */
export function baggageRemainG(
  items: PackItem[],
  legs: StoredLeg[],
  legId: string,
): number | null {
  const leg = legs.find(l => l.id === legId);
  const allowance = leg?.arrivalTransport?.baggageAllowanceG;
  if (!allowance) return null;
  return allowance - weightAtLeg(items, legs, legId);
}
