/* ==========================================================================
   On the Road · Expense migration (localStorage → Firestore)
   --------------------------------------------------------------------------
   Self-healing, non-destructive, idempotent. Runs once after sign-in: if the
   cloud `expenses` collection is empty, upload whatever the old localStorage
   tracker (`otr:expenses`) holds. The legacy shape stored `amountEur` against a
   hard EUR base; we map it onto the new snapshot shape (rate/baseAmount/
   baseCurrency='EUR'). localStorage is never deleted.
   ========================================================================== */

import { createCollectionStore } from '../firebase/db.ts';
import { currentTripId } from './trip-context.ts';
import { ExpenseSchema, type Expense } from './schema.ts';

const LEGACY_KEY = 'otr:expenses';

interface LegacyExpense {
  id?: string;
  amount: number;
  currency: string;
  amountEur: number;
  description: string;
  category: string;
  city?: string;
  date: string;
}

function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function readLegacy(): LegacyExpense[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore corrupt cache */ }
  return [];
}

/** Returns number of expenses uploaded (0 if cloud already had data). */
export async function migrateExpensesToCloud(): Promise<number> {
  const store = createCollectionStore(currentTripId(), 'expenses', ExpenseSchema);
  const cloud = await store.list();
  if (cloud.length > 0) return 0;

  const legacy = readLegacy();
  if (legacy.length === 0) return 0;

  const rows = legacy.map((e) => {
    const amount = Number(e.amount) || 0;
    const baseAmount = Number(e.amountEur);
    // Recover the original→EUR rate from the legacy converted figure.
    const rate = amount > 0 && Number.isFinite(baseAmount) ? baseAmount / amount : 1;
    return {
      id: e.id || uid(),
      amount,
      currency: e.currency || 'EUR',
      rate,
      baseAmount: Number.isFinite(baseAmount) ? baseAmount : amount,
      baseCurrency: 'EUR',
      description: e.description || '',
      category: e.category || '',
      tags: [],
      city: e.city || '',
      country: '',
      date: e.date,
    } satisfies Partial<Expense> & { id: string };
  });

  for (const row of rows) await store.set(row);
  return rows.length;
}
