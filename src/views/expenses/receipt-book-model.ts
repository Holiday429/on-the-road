/* ==========================================================================
   On the Road · Expenses · receipt book — model (pure)
   --------------------------------------------------------------------------
   The receipt book is one till receipt per day that has any spend. This turns
   the expense rows into those days, and answers the few questions the book
   asks about them. No DOM, no stores.
   ========================================================================== */

export interface BookDay {
  iso: string;
  count: number;
  /** The day's spend in the trip's base currency. */
  total: number;
}

/** Days that have spend, oldest first. */
export function bookDays<T extends { date: string }>(rows: readonly T[], base: (r: T) => number): BookDay[] {
  const by = new Map<string, BookDay>();
  for (const r of rows) {
    if (!r.date) continue;
    const d = by.get(r.date) ?? { iso: r.date, count: 0, total: 0 };
    d.count += 1;
    d.total += base(r);
    by.set(r.date, d);
  }
  return [...by.values()].sort((a, b) => a.iso.localeCompare(b.iso));
}

/** Spend from the first day up to and including `iso`. */
export function runningTotal(days: readonly BookDay[], iso: string): number {
  return days.filter((d) => d.iso <= iso).reduce((n, d) => n + d.total, 0);
}

/**
 * Which day the book opens on: `iso` itself when it has spend, else the nearest day
 * before it, else the first day after it. -1 when the book is empty.
 */
export function openIndex(days: readonly BookDay[], iso: string): number {
  if (days.length === 0) return -1;
  const exact = days.findIndex((d) => d.iso === iso);
  if (exact >= 0) return exact;
  let before = -1;
  days.forEach((d, i) => { if (d.iso < iso) before = i; });
  return before >= 0 ? before : 0;
}

/** Height of a day's bar in the day strip, 12–100 (% of the busiest day). */
export function barHeight(total: number, max: number): number {
  if (!(max > 0) || !(total > 0)) return 12;
  return Math.max(12, Math.round((total / max) * 100));
}

/** The index a step lands on; stays put at either end. */
export function stepIndex(i: number, step: number, length: number): number {
  return Math.min(length - 1, Math.max(0, i + step));
}
