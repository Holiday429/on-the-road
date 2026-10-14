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

export interface JournalRow { destination?: string; happenedOn: string; tripId?: string | null; images?: string[]; coverImage?: string; title?: string; body?: string }
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

/** One journal entry as a line: its title (or the start of its text), the day and a short excerpt. */
export interface EntryLine { title: string; date: string; excerpt: string }

/** A photo with the place it was taken, for the stamp's memory card. */
export interface CityPhoto { url: string; city: string; date: string }

/** Any one photo of the country's journal entries, with where and when it was taken. */
export interface JournalPhoto extends CityPhoto { title: string }

export interface CountryExtras {
  journalCount: number;
  /** The newest few entries, for a peek without opening the journal. */
  entries: EntryLine[];
  /** One photo per city of this country, newest first — the memory card's grid. */
  cityPhotos: CityPhoto[];
  /** Every photo of this country's entries (up to nine), newest first — the memory card's polaroids. */
  photos: JournalPhoto[];
  /** Up to three of the newest photos from this country's entries. */
  covers: string[];
  spend: SpendLine[];
  /** One figure for the whole country, only when every line shares a currency. */
  spendTotal: { currency: string; total: number } | null;
  nomadCount: number;
  guideCount: number;
}

const MAX_COVERS = 3;
const MAX_ENTRIES = 3;
/** Photos on a stamp's memory card: one per city, three to a row. */
const MAX_CITY_PHOTOS = 9;
/** Polaroids on a stamp's memory card. */
const MAX_PHOTOS = 9;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function entryLine(e: JournalRow): EntryLine {
  const body = (e.body ?? '').replace(/\s+/g, ' ').trim();
  const title = (e.title ?? '').trim();
  return { title: title || clip(body, 36), date: e.happenedOn, excerpt: title ? clip(body, 110) : clip(body.slice(36), 110) };
}

/** The leg a journal entry belongs to: the stop it names, else the one covering the day it happened. */
function journalLeg(e: JournalRow, legs: PlottedLeg[]): PlottedLeg | undefined {
  const dest = (e.destination ?? '').trim().toLowerCase();
  if (dest) {
    const stop = legs.find((l) => l.stops.some((s) => dest === s.name.toLowerCase() || dest === s.key)
      || l.city.toLowerCase() === dest);
    if (stop?.iso) return stop;
  }
  return legs.find((l) => l.dateFrom <= e.happenedOn && e.happenedOn <= l.dateTo
    && (!e.tripId || l.tripId === e.tripId));
}

/** Which country a journal entry belongs to ('' = can't tell). */
export function journalIso(e: JournalRow, legs: PlottedLeg[]): string {
  const named = journalLeg(e, legs);
  if (named?.iso) return named.iso;
  // A destination that names a country but no stop of ours ("a weekend in Portugal").
  const dest = (e.destination ?? '').trim();
  return (dest && isoForCountry(dest)) || '';
}

/**
 * The place an entry was written, as the traveller would name it: the stop it names, else the city of the
 * leg covering that day. '' when neither is known — the caller falls back to the country.
 */
export function journalCity(e: JournalRow, legs: PlottedLeg[]): string {
  const dest = (e.destination ?? '').trim();
  const leg = journalLeg(e, legs);
  if (leg) {
    const low = dest.toLowerCase();
    const stop = leg.stops.find((x) => low === x.name.toLowerCase() || low === x.key);
    return stop?.name || leg.city || '';
  }
  return '';
}

const photos = (e: JournalRow) => (e.images?.length ? e.images : e.coverImage ? [e.coverImage] : []).filter(Boolean);

export function buildCountryExtras(iso: string, legs: PlottedLeg[], data: ExtrasData): CountryExtras {
  const entries = data.journal
    .filter((e) => journalIso(e, legs) === iso)
    .sort((a, b) => b.happenedOn.localeCompare(a.happenedOn));
  const covers: string[] = [];
  for (const e of entries) for (const p of photos(e)) if (covers.length < MAX_COVERS) covers.push(p);

  // One photo per city: the newest entry from each place that has one. Entries are already newest-first,
  // so the first photo seen for a city is that city's most recent.
  const byCity = new Map<string, CityPhoto>();
  for (const e of entries) {
    const city = journalCity(e, legs);
    const key = city.toLowerCase();
    if (byCity.has(key)) continue;
    const first = photos(e)[0];
    if (first) byCity.set(key, { url: first, city, date: e.happenedOn });
  }
  const cityPhotos = [...byCity.values()].slice(0, MAX_CITY_PHOTOS);

  // Every photo, not one per city: the polaroid wall is the country's own pictures, newest entry first.
  const all: JournalPhoto[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const city = journalCity(e, legs);
    for (const url of photos(e)) {
      if (all.length >= MAX_PHOTOS) break;
      if (seen.has(url)) continue;
      seen.add(url);
      all.push({ url, city, date: e.happenedOn, title: (e.title ?? '').trim() });
    }
  }

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
    entries: entries.slice(0, MAX_ENTRIES).map(entryLine),
    cityPhotos,
    photos: all,
    covers,
    spend,
    spendTotal,
    nomadCount: data.nomad.filter((n) => n.country && isoForCountry(n.country) === iso).length,
    guideCount: data.intel
      .filter((c) => c.country && isoForCountry(c.country) === iso)
      .reduce((n, c) => n + count(c.attractions) + count(c.cityWalks) + count(c.restaurants) + count(c.cafes) + count(c.experiences), 0),
  };
}
