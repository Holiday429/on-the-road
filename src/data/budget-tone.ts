/**
 * Budget progress colour, shared by Dashboard, Expenses and the budget editor
 * so the same percentage always reads the same everywhere.
 * ≥100% over, ≥80% close to the limit, otherwise fine.
 */
export type BudgetTone = 'over' | 'warn' | 'ok';

export function budgetTone(pct: number): BudgetTone {
  return pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
}

const TONE_COLOR: Record<BudgetTone, string> = {
  over: 'var(--coral-500)',
  warn: 'var(--amber-500)',
  ok: 'var(--sage-500)',
};

export function budgetBarColor(pct: number): string {
  return TONE_COLOR[budgetTone(pct)];
}
