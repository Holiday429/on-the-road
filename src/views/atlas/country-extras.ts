/* ==========================================================================
   On the Road · World — what else the app knows about a country (pure)
   --------------------------------------------------------------------------
   Journal entries, spending, saved work spots and Guide briefings all live in
   their own stores and carry a free-text place, not a country. This turns those
   rows into the per-country figures the country panel shows.

   · Journal: an entry belongs to a country if its destination names one of the
     trip's stops (or a country), else the stop covering the day it happened.
   · Spend: summed per trip in that trip's own currency (each expense keeps the
     base-currency snapshot it was recorded with). Different currencies are never
     added together — a grand total appears only when every trip agrees.
   ========================================================================== */

import { isoForCountry } from '../../data/geo-index.ts';
import type { PlottedLeg } from '../map/map-stats.ts';

export interface JournalRow { destination?: string; happenedOn: string; tripId?: string | null; images?: string[]; coverImage?: string }
export interface ExpenseRow { country?: string; baseAmount?: number; baseCurrency?: string; tripId?: string | null }
export interface NomadRow { country?: string }
export interface IntelRow {
  country?: string;
  attractions?: unknown[]; cityWalks?: unknown[]; restaurants?: unknown[]; cafes?: unknown[]; experiences?: unknown[];
}

export interface ExtrasData {
  journal: JournalRow[];
  expenses: ExpenseRow[];
  nomad: NomadRow[];
  intel: IntelRow[];
}

export interface SpendLine { tripId: string; currency: string; total: number; count: number }

export interface CountryExtras {
  journalCount: number;
  /** Up to three of the newest photos from this country's entries. */
  covers: string[];
  spend: SpendLine[];
  /** One figure for the whole country, only when every line shares a currency. */
  spendTotal: { currency: string; total: number } | null;
  nomadCount: number;
  guideCount: number;
}

const MAX_COVERS = 3;

/** Which country a journal entry belongs to ('' = can't tell). */
export function journalIso(e: JournalRow, legs: PlottedLeg[]): string {
  const dest = (e.destination ?? '').trim().toLowerCase();
  if (dest) {
    const stop = legs.find((l) => l.stops.some((s) => dest === s.name.toLowerCase() || dest === s.key)
      || l.city.toLowerCase() === dest);
    if (stop?.iso) return stop.iso;
    const named = isoForCountry(e.destination!);
    if (named) return named;
  }
  const covering = legs.find((l) => l.dateFrom <= e.happenedOn && e.happenedOn <= l.dateTo
    && (!e.tripId || l.tripId === e.tripId));
  return covering?.iso ?? '';
}

const photos = (e: JournalRow) => (e.images?.length ? e.images : e.coverImage ? [e.coverImage] : []).filter(Boolean);

export function buildCountryExtras(iso: string, legs: PlottedLeg[], data: ExtrasData): CountryExtras {
  const entries = data.journal
    .filter((e) => journalIso(e, legs) === iso)
    .sort((a, b) => b.happenedOn.localeCompare(a.happenedOn));
  const covers: string[] = [];
  for (const e of entries) for (const p of photos(e)) if (covers.length < MAX_COVERS) covers.push(p);

  const lines = new Map<string, SpendLine>();
  for (const x of data.expenses) {
    if (!x.country || isoForCountry(x.country) !== iso) continue;
    const currency = x.baseCurrency || '';
    const tripId = x.tripId ?? '';
    const key = `${tripId}|${currency}`;
    const line = lines.get(key) ?? { tripId, currency, total: 0, count: 0 };
    line.total += x.baseAmount || 0;
    line.count += 1;
    lines.set(key, line);
  }
  const spend = [...lines.values()];
  const currencies = new Set(spend.map((l) => l.currency));
  const spendTotal = spend.length && currencies.size === 1
    ? { currency: spend[0].currency, total: spend.reduce((n, l) => n + l.total, 0) }
    : null;

  const count = (a?: unknown[]) => a?.length ?? 0;
  return {
    journalCount: entries.length,
    covers,
    spend,
    spendTotal,
    nomadCount: data.nomad.filter((n) => n.country && isoForCountry(n.country) === iso).length,
    guideCount: data.intel
      .filter((c) => c.country && isoForCountry(c.country) === iso)
      .reduce((n, c) => n + count(c.attractions) + count(c.cityWalks) + count(c.restaurants) + count(c.cafes) + count(c.experiences), 0),
  };
}
