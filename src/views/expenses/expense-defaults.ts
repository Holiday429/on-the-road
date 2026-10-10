/* ==========================================================================
   On the Road · Shared expense defaults & write path
   --------------------------------------------------------------------------
   One place that both the Expenses page and the Dashboard quick-add use to log
   a spend, so the two entry points never drift. Responsibilities:

   • Remembered prefs — last currency / country / city the user picked, kept in
     localStorage (device-level UI convenience, NOT trip data). Logging a spend
     is then usually just an amount + a few words; you only touch the place when
     you actually move.
   • Leg-derived option lists — distinct countries and their cities from the
     itinerary, for the form's Country → City dropdowns.
   • Default resolution — remembered value first, else the leg covering the
     date, else empty. So the chosen place sticks until you change it.
   • Conversion snapshot + write — converts the raw amount to base currency at
     record time and persists via expenseStore, mirroring the historical-books
     guarantee documented on ExpenseSchema.
   ========================================================================== */

import { expenseStore } from '../../data/stores/expense-store.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { baseCurrency } from '../../data/trip-context.ts';
import type { RateTable } from '../../data/rates.ts';
import { COUNTRY_CURRENCY, currencyForCountry, knownCurrencyForCountry } from '../../data/country-currency.ts';
import type { StoredExpense } from '../../data/stores/expense-store.ts';

/* ── Shared expense categories (used by widget + expenses page) ──────────── */
export const BUILTIN_CATEGORIES = [
  { id: 'accommodation', label: 'Stay',       icon: '🏠' },
  { id: 'food',          label: 'Food',       icon: '🍜' },
  { id: 'transport',     label: 'Transport',  icon: '🚆' },
  { id: 'activities',    label: 'Activities', icon: '🎭' },
  { id: 'shopping',      label: 'Shopping',   icon: '🛍️' },
  { id: 'health',        label: 'Health',     icon: '💊' },
  { id: 'misc',          label: 'Misc',       icon: '📌' },
] as const;

/* Country → currency now lives in data/country-currency.ts (full table). */
export { COUNTRY_CURRENCY, currencyForCountry, knownCurrencyForCountry };

/* ── Remembered prefs (localStorage) ─────────────────────────────────────── */

const KEY = 'otr:expense-last';

export interface LastUsed { currency?: string; country?: string; city?: string; }

export function lastUsed(): LastUsed {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as LastUsed;
  } catch {
    return {};
  }
}

export function rememberUsed(v: LastUsed): void {
  try {
    const next = { ...lastUsed(), ...v };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* storage unavailable — defaults just won't persist */ }
}

/* ── Leg-derived option lists ────────────────────────────────────────────── */

export function legForDate(legs: StoredLeg[], iso: string): StoredLeg | undefined {
  return legs.find((l) => iso >= l.dateFrom && iso <= l.dateTo);
}

/** Distinct countries on the itinerary, in leg order. */
export function legCountries(legs: StoredLeg[]): string[] {
  return [...new Set(legs.map((l) => l.country).filter(Boolean))];
}

/** Distinct cities for a country (or all cities if country is blank). */
export function legCitiesFor(legs: StoredLeg[], country: string): string[] {
  return [...new Set(
    legs.filter((l) => !country || l.country === country).map((l) => l.city).filter(Boolean),
  )];
}

/* ── Default resolution ──────────────────────────────────────────────────── */

/** Country/city defaults for a date: remembered → leg covering the date → empty. */
export function defaultPlace(legs: StoredLeg[], iso: string): { country: string; city: string } {
  const last = lastUsed();
  if (last.country) return { country: last.country, city: last.city ?? '' };
  const leg = legForDate(legs, iso);
  return { country: leg?.country ?? '', city: leg?.city ?? '' };
}

/** Currency default: remembered → country mapping for the date's leg → base. */
export function defaultCurrency(legs: StoredLeg[], iso: string): string {
  const last = lastUsed();
  if (last.currency) return last.currency;
  const leg = legForDate(legs, iso);
  if (leg) return knownCurrencyForCountry(leg.country) ?? baseCurrency();
  return baseCurrency();
}

/** Smart "what currency am I spending right now" — geography sets the
 *  expectation, recent spending corrects it:
 *   1. the current leg's country → its currency (candidate);
 *   2. if ≥3 spends in the last 3 days in that country used a different
 *      dominant currency (card-in-EUR in Denmark, say) → that one wins;
 *   3. unknown country → the most recent spend's currency → EUR. */
export function suggestedCurrency(legs: StoredLeg[], expenses: StoredExpense[], iso: string): string {
  const leg = legForDate(legs, iso) ?? legs.filter((l) => l.dateFrom <= iso).sort((a, b) => b.dateFrom.localeCompare(a.dateFrom))[0];
  const candidate = leg ? currencyForCountry(leg.country) : null;

  const from = new Date(iso + 'T00:00:00');
  from.setDate(from.getDate() - 3);
  const fromIso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
  const recent = expenses.filter((e) => e.date >= fromIso && e.date <= iso && (!leg || e.country === leg.country));
  if (recent.length >= 3) {
    const counts = new Map<string, number>();
    for (const e of recent) counts.set(e.currency, (counts.get(e.currency) ?? 0) + 1);
    const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top !== candidate) return top;
  }
  if (candidate) return candidate;

  const last = [...expenses].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
  return last?.currency ?? 'EUR';
}

/* ── Conversion + write ──────────────────────────────────────────────────── */

/** Convert a raw amount in `currency` to base using the live rate table. */
export function convert(rates: RateTable, amount: number, currency: string): { rate: number; baseAmount: number } {
  const rate = rates[currency] ?? 1;
  return { rate, baseAmount: amount * rate };
}

export interface AddExpenseInput {
  amount: number;
  currency: string;
  description: string;
  date: string;
  category: string;
  country: string;
  city: string;
  rates: RateTable;
}

/** Unified add path for both entry points. Snapshots the conversion, persists,
 *  and remembers the place/currency for next time. Returns false on bad input. */
export async function addExpenseWithDefaults(input: AddExpenseInput): Promise<boolean> {
  const { amount, currency, description, date, category, country, city, rates } = input;
  // Only the amount is required; a description is optional (an amount + category
  // + date is enough to log a spend and tidy the note in later).
  if (!amount) return false;
  const { rate, baseAmount } = convert(rates, amount, currency);
  await expenseStore.add({
    amount, currency, rate, baseAmount,
    baseCurrency: baseCurrency(),
    description: description.trim(),
    category,
    tags: [],
    city,
    country,
    date,
  });
  rememberUsed({ currency, country, city });
  return true;
}
