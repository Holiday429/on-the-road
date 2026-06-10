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

/* ── Country → default currency ──────────────────────────────────────────────
   Used to seed the currency from the leg's country. Not exhaustive — anything
   unmapped falls back to the trip base currency. */
export const COUNTRY_CURRENCY: Record<string, string> = {
  Denmark: 'DKK', Sweden: 'SEK', Norway: 'NOK', Switzerland: 'CHF',
  'United Kingdom': 'GBP', 'Czech Republic': 'CZK', Czechia: 'CZK',
  Japan: 'JPY', 'United States': 'USD', China: 'CNY',
  Germany: 'EUR', France: 'EUR', Spain: 'EUR', Portugal: 'EUR',
  Italy: 'EUR', Netherlands: 'EUR', Belgium: 'EUR', Austria: 'EUR',
  Ireland: 'EUR', Greece: 'EUR',
};

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
  if (leg) return COUNTRY_CURRENCY[leg.country] ?? baseCurrency();
  return baseCurrency();
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
  if (!amount || !description.trim()) return false;
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
