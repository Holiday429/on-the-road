/* ==========================================================================
   On the Road · "As of a day" views for the Dashboard
   --------------------------------------------------------------------------
   When the Dashboard is looking back at a day (see sim-clock.ts) its cards show
   that day's state: spend up to and on that day, the to-dos that existed then,
   the journal entries written on it. `asOf` is null in normal use, which leaves
   every list untouched. Pure.
   ========================================================================== */

/** Expenses dated on or before `asOf`; everything when `asOf` is null. */
export function expensesAsOf<T extends { date: string }>(rows: T[], asOf: string | null): T[] {
  return asOf ? rows.filter((e) => e.date <= asOf) : rows;
}

/** End of the local calendar day `iso`, in epoch ms. */
export function endOfDayMs(iso: string): number {
  return new Date(`${iso}T23:59:59.999`).getTime();
}

/** To-dos that already existed at the end of `asOf`. (There is no completion
 *  time on a to-do, so whether it was done by then can't be reconstructed —
 *  its current state stands.) */
export function todosAsOf<T extends { createdAt?: number }>(rows: T[], asOf: string | null): T[] {
  if (!asOf) return rows;
  const end = endOfDayMs(asOf);
  return rows.filter((t) => !t.createdAt || t.createdAt <= end);
}

export interface DaySpend {
  count: number;
  /** Biggest categories that day, base-currency amounts, largest first. */
  top: Array<{ category: string; amount: number }>;
}

export function daySpend<T extends { date: string; category: string }>(
  rows: T[], iso: string, toBase: (e: T) => number, topN = 3,
): DaySpend {
  const mine = rows.filter((e) => e.date === iso);
  const by = new Map<string, number>();
  for (const e of mine) by.set(e.category || '', (by.get(e.category || '') ?? 0) + toBase(e));
  return {
    count: mine.length,
    top: [...by].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount).slice(0, topN),
  };
}

/** Entries written on `iso`, oldest first (the order the day happened in). */
export function entriesOn<T extends { happenedOn: string; createdAt?: number }>(rows: T[], iso: string): T[] {
  return rows.filter((e) => e.happenedOn === iso).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}
