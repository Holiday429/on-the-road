/* ==========================================================================
   On the Road · Plan days for a leg
   --------------------------------------------------------------------------
   A leg's plan days are one per night (dateFrom … dateTo − 1), matching the
   itinerary view's own ensurePlanDays. Used by the Dashboard to drop a new
   plan item onto a date without opening the itinerary.
   ========================================================================== */

import type { PlanDay } from './schema.ts';
import type { StoredLeg } from './stores/route-store.ts';
import { daysBetween } from './trip-phase.ts';

export function planDaysFor(leg: Pick<StoredLeg, 'dateFrom' | 'dateTo' | 'planDays'>): PlanDay[] {
  const total = Math.max(0, daysBetween(leg.dateFrom, leg.dateTo));
  const existing = [...(leg.planDays ?? [])].sort((a, b) => a.order - b.order);
  const pad = (n: number) => String(n).padStart(2, '0');
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(leg.dateFrom + 'T00:00:00');
    d.setDate(d.getDate() + i);
    // Local-time iso (toISOString would roll the date back in negative-offset zones).
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return existing.find((e) => e.date === iso) ?? { id: `day-${iso}`, date: iso, order: i, label: '', notes: '' };
  });
}

/** The plan day for `iso`; a date outside the leg (its check-out day, or a
 *  date picked past the end) snaps to the nearest end rather than failing. */
export function pickPlanDay(days: PlanDay[], iso: string): PlanDay | null {
  if (!days.length) return null;
  return days.find((d) => d.date === iso) ?? (iso < days[0].date ? days[0] : days[days.length - 1]);
}

/** The leg a date belongs to: the one covering it (the arriving leg on a
 *  change-of-city day), else the nearest by date. null with no legs. */
export function legForDate<T extends Pick<StoredLeg, 'dateFrom' | 'dateTo'>>(legs: T[], iso: string): T | null {
  if (!legs.length) return null;
  const sorted = [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  return sorted.find((l) => l.dateFrom === iso)
    ?? sorted.find((l) => l.dateFrom <= iso && iso <= l.dateTo)
    ?? (iso < sorted[0].dateFrom ? sorted[0] : sorted[sorted.length - 1]);
}
