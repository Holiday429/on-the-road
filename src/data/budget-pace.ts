/* ==========================================================================
   On the Road · Budget pace
   --------------------------------------------------------------------------
   "Am I on track?" — what the total budget means once the trip has dates:
   average spend per day so far, what you can still spend per day, and where
   the trip ends up if the pace holds. Pure; no stores.
   ========================================================================== */

export type PaceStatus = 'ok' | 'fast' | 'over';

export interface BudgetPace {
  /** Trip dates against today: not started, running, or finished. */
  phase: 'before' | 'during' | 'after';
  daysTotal: number;
  /** Days that have passed including today (0 before the trip). */
  daysElapsed: number;
  daysLeft: number;
  /** Spent ÷ elapsed days; null before the trip starts. */
  avgPerDay: number | null;
  /** Remaining budget ÷ days left; null once the trip is over or with no budget. */
  allowedPerDay: number | null;
  /** Spent so far + average × days left, if the pace holds; null before the trip or after it. */
  forecast: number | null;
  /** over: already past the budget · fast: on course to overshoot it · ok otherwise. */
  status: PaceStatus;
}

const DAY = 86_400_000;
const dayIndex = (iso: string) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / DAY);

export function budgetPace(i: { spent: number; budget: number | null; startIso: string | null; endIso: string | null; todayIso: string }): BudgetPace {
  const { spent, budget, startIso, endIso, todayIso } = i;
  const over = budget != null && budget > 0 && spent > budget;
  if (!startIso || !endIso) {
    return { phase: 'during', daysTotal: 0, daysElapsed: 0, daysLeft: 0, avgPerDay: null, allowedPerDay: null, forecast: null, status: over ? 'over' : 'ok' };
  }
  const start = dayIndex(startIso);
  const end = dayIndex(endIso);
  const today = dayIndex(todayIso);
  const daysTotal = Math.max(1, end - start + 1);
  const phase = today < start ? 'before' : today > end ? 'after' : 'during';
  const daysElapsed = phase === 'before' ? 0 : phase === 'after' ? daysTotal : today - start + 1;
  const daysLeft = daysTotal - daysElapsed;
  const avgPerDay = daysElapsed > 0 ? spent / daysElapsed : null;
  const allowedPerDay = budget != null && budget > 0 && daysLeft > 0 ? Math.max(0, budget - spent) / daysLeft : null;
  const forecast = phase === 'during' && avgPerDay != null ? spent + avgPerDay * daysLeft : null;
  const fast = !over && budget != null && budget > 0 && forecast != null && forecast > budget;
  return { phase, daysTotal, daysElapsed, daysLeft, avgPerDay, allowedPerDay, forecast, status: over ? 'over' : fast ? 'fast' : 'ok' };
}

/** First departure and last return across the legs, or nulls when there are none. */
export function tripSpan(legs: { dateFrom: string; dateTo: string }[]): { startIso: string | null; endIso: string | null } {
  const from = legs.map((l) => l.dateFrom).filter(Boolean).sort();
  const to = legs.map((l) => l.dateTo).filter(Boolean).sort();
  return { startIso: from[0] ?? null, endIso: to[to.length - 1] ?? null };
}
