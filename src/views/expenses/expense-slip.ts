/* ==========================================================================
   On the Road · Expenses · receipt slip
   --------------------------------------------------------------------------
   After an expense is saved from anywhere (Dashboard quick-add, the spend
   drawer, an agenda item, the Expenses page) a small till slip prints in the
   corner: what was rung up, the day's total and what is left of the budget.

   Call `expenseSlip(input)` BEFORE saving — it snapshots the stores so the new
   line is not double-counted — then call the function it returns once the save
   succeeded.
   ========================================================================== */

import { showSlip } from '../../core/paper/slip.ts';
import type { PaperRow } from '../../core/paper/paper.ts';
import { t } from '../../core/i18n.ts';
import { expenseStore } from '../../data/stores/expense-store.ts';
import { baseCurrency, tripBudget } from '../../data/trip-context.ts';
import { currencySymbol, type RateTable } from '../../data/rates.ts';
import { BUILTIN_CATEGORIES, convert } from './expense-defaults.ts';
import { slipFigures } from './slip-figures.ts';

export interface SlipInput {
  amount: number;
  currency: string;
  description: string;
  date: string;
  category: string;
  rates: RateTable;
}

export function expenseSlip(input: SlipInput): () => void {
  const base = baseCurrency();
  const fmt = (n: number) => `${currencySymbol(base)}${Math.round(n).toLocaleString()}`;
  const toBase = (e: { baseAmount: number; baseCurrency: string }) =>
    e.baseCurrency === base ? e.baseAmount : e.baseAmount * (input.rates[e.baseCurrency] ?? 1);
  const existing = expenseStore.peek().map((e) => ({ date: e.date, base: toBase(e) }));
  const itemBase = convert(input.rates, input.amount, input.currency).baseAmount;
  const f = slipFigures(existing, itemBase, input.date, tripBudget() ?? null);
  const cat = BUILTIN_CATEGORIES.find((c) => c.id === input.category);

  return () => {
    const rows: PaperRow[] = [
      {
        label: input.description.trim() || cat?.label || t('dash.spend.unlabelled'), icon: cat?.icon ?? '🗂️',
        value: fmt(f.itemBase),
        sub: input.currency !== base ? `${currencySymbol(input.currency)}${input.amount.toFixed(2)}` : undefined,
      },
      { label: t('expenses.slipDay'), value: fmt(f.dayTotal), strong: true },
    ];
    if (f.left !== null) {
      rows.push({ label: f.left >= 0 ? t('expenses.slipLeft') : t('expenses.slipOver'), value: fmt(Math.abs(f.left)), tone: f.left >= 0 ? 'good' : 'bad' });
    }
    showSlip({
      title: t('expenses.slipTitle'),
      meta: new Date(input.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase(),
      rows,
      total: { label: t('expenses.slipTrip'), value: fmt(f.tripTotal) },
      stamp: { text: t('expenses.slipStamp'), tone: 'good', pressed: true },
      barcode: true,
    });
  };
}
