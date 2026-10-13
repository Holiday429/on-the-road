/* ==========================================================================
   On the Road · Trip wrap (the "how it went" page's numbers)
   --------------------------------------------------------------------------
   One pure function turns a finished (or half-finished) trip's stores into the
   WrapModel the wrap page draws. Nothing is stored and nothing here reads the
   DOM, a store or the clock: callers pass plain rows, the currency conversion
   and a coordinate lookup, so every chapter is unit-testable.

   Chapters (see views/wrap/):  cover · route · passport · stays · spend · pack
   · journal · end.
   ========================================================================== */

import { haversineKm, type LatLng } from './geo-index.ts';
import { daysBetween } from './trip-phase.ts';
import { passportFor, type PassportStamp } from './passport.ts';
import type { FootprintLeg } from './footprint.ts';
import { itemWeightG, itemsPresentAtLeg } from './packing-formula.ts';
import type { PackList } from './schema.ts';
import type { StoredLeg } from './stores/route-store.ts';

/* ── Input ───────────────────────────────────────────────────────────────── */

export interface WrapTrip {
  name: string;
  startDate: string;
  endDate: string;
  homeCity?: string;
  returnCity?: string;
  /** Whole-trip budget in the trip's base currency; null/absent = none set. */
  totalBudget?: number | null;
}

export interface WrapExpense {
  date: string;
  category: string;
  country: string;
  city?: string;
  description?: string;
}

export interface WrapEntry {
  id: string;
  happenedOn: string;
  destination: string;
  favorite: boolean;
  /** Already resolved with the journal's `entryImages()`. */
  images: string[];
}

export interface WrapInput {
  trip: WrapTrip;
  legs: StoredLeg[];
  expenses: WrapExpense[];
  /** An expense's amount in the trip's base currency. */
  toBase: (e: WrapExpense) => number;
  pack: PackList | null | undefined;
  journal: WrapEntry[];
  /** Entries needed before Portrait is offered. */
  portraitMin: number;
  /** Local coordinate lookup by place name (bundled city table); null = unknown. */
  coordOf: (place: string) => LatLng | null;
  today: string;
}

/* ── Output ──────────────────────────────────────────────────────────────── */

export type TransportMode = 'flight' | 'train' | 'bus' | 'ferry';
const MODES: TransportMode[] = ['flight', 'train', 'bus', 'ferry'];

export interface WrapHop {
  /** 'out' = from home to the first stop, 'back' = the last stop to the return city. */
  kind: 'leg' | 'out' | 'back';
  from: string;
  to: string;
  mode: TransportMode | null;
  /** Great-circle km; null when either end can't be located. */
  km: number | null;
}

export interface WrapRoute {
  stops: Array<{ legId: string; city: string; country: string; flag: string; lat: number; lng: number }>;
  countries: number;
  cities: number;
  distanceKm: number;
  hops: WrapHop[];
  modes: Array<{ mode: TransportMode; count: number; km: number }>;
  longest: WrapHop | null;
}

export interface WrapCity {
  city: string;
  country: string;
  flag: string;
  nights: number;
  visits: number;
}

export interface WrapStays {
  cities: WrapCity[];
  totalNights: number;
  longest: WrapCity | null;
  /** Named stays across the route. */
  stayCount: number;
  /** Where they were booked (Airbnb, Booking.com …), most used first; unnamed ones are left out. */
  platforms: Array<{ name: string; count: number }>;
}

export interface WrapCategorySlice { id: string; amount: number; share: number }
export interface WrapCountrySpend { country: string; flag: string; amount: number; nights: number; perDay: number }

export interface WrapSpend {
  count: number;
  total: number;
  budget: number | null;
  /** total − budget: positive = over, negative = under; null without a budget. */
  overBy: number | null;
  perDay: number;
  byCategory: WrapCategorySlice[];
  byCountry: WrapCountrySpend[];
  biggestDay: { date: string; amount: number; city: string } | null;
  /** Lowest / highest daily average among countries (needs two to compare). */
  cheapestCountry: WrapCountrySpend | null;
  priciestCountry: WrapCountrySpend | null;
}

export interface WrapPack {
  /** Grams in the bags (items + the empty bags). */
  departG: number;
  returnG: number;
  bought: Array<{ name: string; city: string }>;
  lost: Array<{ name: string; city: string }>;
}

export interface WrapJournal {
  entries: number;
  photos: number;
  topCity: { city: string; count: number } | null;
  /** Up to six photo URLs: favourites first, then the busiest entries; one per entry. */
  featured: string[];
  /** Entries still needed before Portrait can be made; 0 = ready. */
  portraitShort: number;
}

export interface WrapModel {
  cover: { name: string; startDate: string; endDate: string; days: number; stamps: number; stampCountries: number };
  route: WrapRoute;
  /** Every earned stamp, oldest first. */
  stamps: PassportStamp[];
  stays: WrapStays;
  spend: WrapSpend;
  pack: WrapPack | null;
  journal: WrapJournal;
  /** True once there is anything to wrap up (at least one stop). */
  hasRoute: boolean;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function sortedLegs(legs: StoredLeg[]): StoredLeg[] {
  return [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom) || (a.order ?? 0) - (b.order ?? 0));
}

const cityKey = (city: string) => city.trim().toLowerCase();

function nightsOf(l: { dateFrom: string; dateTo: string }): number {
  return Math.max(0, daysBetween(l.dateFrom, l.dateTo));
}

function legPoint(l: StoredLeg, coordOf: WrapInput['coordOf']): LatLng | null {
  if (l.lat != null && l.lng != null) return { lat: l.lat, lng: l.lng };
  return coordOf(l.city);
}

function modeOf(t: { type?: string } | undefined): TransportMode | null {
  return t?.type && (MODES as string[]).includes(t.type) ? (t.type as TransportMode) : null;
}

function hopKm(a: LatLng | null, b: LatLng | null): number | null {
  return a && b ? Math.round(haversineKm(a, b)) : null;
}

/* ── Chapters ────────────────────────────────────────────────────────────── */

export function wrapRoute(trip: WrapTrip, legsIn: StoredLeg[], coordOf: WrapInput['coordOf']): WrapRoute {
  const legs = sortedLegs(legsIn);
  const stops: WrapRoute['stops'] = [];
  const hops: WrapHop[] = [];
  let prev: { name: string; pt: LatLng | null } | null = null;

  legs.forEach((l, i) => {
    const pt = legPoint(l, coordOf);
    if (pt) stops.push({ legId: l.id, city: l.city, country: l.country, flag: l.flag, lat: pt.lat, lng: pt.lng });
    const mode = modeOf(l.arrivalTransport);
    if (i === 0) {
      const origin = (trip.homeCity ?? '').trim() || l.arrivalTransport?.from?.trim() || '';
      if (origin) hops.push({ kind: 'out', from: origin, to: l.city, mode, km: hopKm(coordOf(origin), pt) });
    } else if (prev) {
      hops.push({ kind: 'leg', from: prev.name, to: l.city, mode, km: hopKm(prev.pt, pt) });
    }
    prev = { name: l.city, pt };
  });
  const back = (trip.returnCity ?? '').trim();
  if (back && prev) {
    const last = prev as { name: string; pt: LatLng | null };
    hops.push({ kind: 'back', from: last.name, to: back, mode: 'flight', km: hopKm(last.pt, coordOf(back)) });
  }

  const modes = MODES.map((mode) => {
    const of = hops.filter((h) => h.mode === mode);
    return { mode, count: of.length, km: of.reduce((s, h) => s + (h.km ?? 0), 0) };
  }).filter((m) => m.count > 0).sort((a, b) => b.count - a.count || b.km - a.km);

  const located = hops.filter((h) => h.km != null);
  const longest = located.reduce<WrapHop | null>((best, h) => (!best || (h.km ?? 0) > (best.km ?? 0) ? h : best), null);

  return {
    stops,
    countries: new Set(legs.map((l) => l.country.trim().toLowerCase()).filter(Boolean)).size,
    cities: new Set(legs.map((l) => cityKey(l.city))).size,
    distanceKm: hops.reduce((s, h) => s + (h.km ?? 0), 0),
    hops,
    modes,
    longest,
  };
}

export function wrapStays(legsIn: StoredLeg[]): WrapStays {
  const legs = sortedLegs(legsIn);
  const byCity = new Map<string, WrapCity>();
  const platforms = new Map<string, number>();
  let stayCount = 0;

  for (const l of legs) {
    const key = cityKey(l.city);
    const row = byCity.get(key) ?? { city: l.city.trim(), country: l.country, flag: l.flag, nights: 0, visits: 0 };
    row.nights += nightsOf(l);
    row.visits += 1;
    byCity.set(key, row);

    const stays = l.accommodations?.length ? l.accommodations : (l.accommodation ? [l.accommodation] : []);
    for (const s of stays) {
      if (!s.name?.trim()) continue;
      stayCount += 1;
      const p = s.platform?.trim();
      if (p) platforms.set(p, (platforms.get(p) ?? 0) + 1);
    }
  }
  const cities = [...byCity.values()];
  const longest = cities.reduce<WrapCity | null>((best, c) => (c.nights > 0 && (!best || c.nights > best.nights) ? c : best), null);
  return {
    cities,
    totalNights: cities.reduce((s, c) => s + c.nights, 0),
    longest,
    stayCount,
    platforms: [...platforms].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

export function wrapSpend(
  trip: WrapTrip, legsIn: StoredLeg[], expenses: WrapExpense[], toBase: WrapInput['toBase'],
): WrapSpend {
  const legs = sortedLegs(legsIn);
  const days = Math.max(1, daysBetween(trip.startDate, trip.endDate) + 1);
  const coverLeg = (date: string) => legs.find((l) => l.dateFrom <= date && date <= l.dateTo);
  const flagOf = new Map(legs.map((l) => [l.country.trim().toLowerCase(), l.flag]));

  let total = 0;
  const byCat = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const byDay = new Map<string, { amount: number; city: string }>();

  for (const e of expenses) {
    const amt = toBase(e);
    total += amt;
    byCat.set(e.category || '', (byCat.get(e.category || '') ?? 0) + amt);
    const leg = coverLeg(e.date);
    const country = e.country?.trim() || leg?.country.trim() || '';
    if (country) byCountry.set(country, (byCountry.get(country) ?? 0) + amt);
    const day = byDay.get(e.date) ?? { amount: 0, city: '' };
    day.amount += amt;
    day.city = day.city || e.city?.trim() || leg?.city || '';
    byDay.set(e.date, day);
  }

  const nightsIn = (country: string) => legs
    .filter((l) => l.country.trim().toLowerCase() === country.toLowerCase())
    .reduce((s, l) => s + nightsOf(l), 0);

  const countries: WrapCountrySpend[] = [...byCountry].map(([country, amount]) => {
    const nights = nightsIn(country);
    return { country, flag: flagOf.get(country.toLowerCase()) ?? '', amount, nights, perDay: amount / Math.max(1, nights) };
  }).sort((a, b) => b.amount - a.amount);

  const biggest = [...byDay].reduce<{ date: string; amount: number; city: string } | null>((best, [date, v]) => (
    !best || v.amount > best.amount || (v.amount === best.amount && date < best.date) ? { date, ...v } : best
  ), null);

  const budget = trip.totalBudget && trip.totalBudget > 0 ? trip.totalBudget : null;
  const comparable = countries.filter((c) => c.nights > 0);
  const cheapest = comparable.length >= 2 ? [...comparable].sort((a, b) => a.perDay - b.perDay)[0] : null;
  const priciest = comparable.length >= 2 ? [...comparable].sort((a, b) => b.perDay - a.perDay)[0] : null;

  return {
    count: expenses.length,
    total,
    budget,
    overBy: budget == null ? null : total - budget,
    perDay: total / days,
    byCategory: [...byCat].map(([id, amount]) => ({ id, amount, share: total > 0 ? amount / total : 0 }))
      .sort((a, b) => b.amount - a.amount),
    byCountry: countries,
    biggestDay: biggest,
    cheapestCountry: cheapest,
    priciestCountry: priciest && priciest !== cheapest ? priciest : null,
  };
}

export function wrapPack(list: PackList | null | undefined, legsIn: StoredLeg[]): WrapPack | null {
  if (!list || !list.items.length && !list.containers.length) return null;
  const legs = sortedLegs(legsIn);
  const bagsG = list.containers.reduce((s, c) => s + c.selfWeightG, 0);
  const sum = (items: PackList['items']) => items.reduce((s, it) => s + itemWeightG(it), 0) + bagsG;
  const last = legs[legs.length - 1];
  const cityOf = (id: string | null) => legs.find((l) => l.id === id)?.city ?? '';
  return {
    // What left home is what was never picked up along the way.
    departG: sum(list.items.filter((it) => !it.acquiredLegId)),
    returnG: sum(last ? itemsPresentAtLeg(list.items, legs, last.id) : list.items.filter((it) => !it.droppedLegId)),
    bought: list.items.filter((it) => it.acquiredLegId).map((it) => ({ name: it.name, city: cityOf(it.acquiredLegId) })),
    lost: list.items.filter((it) => it.droppedLegId).map((it) => ({ name: it.name, city: cityOf(it.droppedLegId) })),
  };
}

export function wrapJournal(
  entries: WrapEntry[], legsIn: StoredLeg[], portraitMin: number,
): WrapJournal {
  const legs = sortedLegs(legsIn);
  const cityFor = (e: WrapEntry) => e.destination.trim() || legs.find((l) => l.dateFrom <= e.happenedOn && e.happenedOn <= l.dateTo)?.city || '';

  const counts = new Map<string, { city: string; count: number }>();
  for (const e of entries) {
    const city = cityFor(e);
    if (!city) continue;
    const row = counts.get(cityKey(city)) ?? { city, count: 0 };
    row.count += 1;
    counts.set(cityKey(city), row);
  }
  const topCity = [...counts.values()].sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))[0] ?? null;

  const withPhotos = entries.filter((e) => e.images.length > 0)
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.images.length - a.images.length || a.happenedOn.localeCompare(b.happenedOn));

  return {
    entries: entries.length,
    photos: entries.reduce((s, e) => s + e.images.length, 0),
    topCity,
    featured: withPhotos.slice(0, 6).map((e) => e.images[0]),
    portraitShort: Math.max(0, portraitMin - entries.length),
  };
}

/* ── The whole page ──────────────────────────────────────────────────────── */

export function tripWrap(input: WrapInput): WrapModel {
  const { trip, legs, today } = input;
  // The passport's country stamps for this trip: earned by arrival, so a wrap opened mid-trip only shows the countries reached so far.
  const passport = passportFor(legs as unknown as FootprintLeg[], today);
  const stamps = passport.stamps;
  return {
    cover: {
      name: trip.name, startDate: trip.startDate, endDate: trip.endDate,
      days: Math.max(1, daysBetween(trip.startDate, trip.endDate) + 1),
      stamps: stamps.length, stampCountries: passport.countries,
    },
    route: wrapRoute(trip, legs, input.coordOf),
    stamps,
    stays: wrapStays(legs),
    spend: wrapSpend(trip, legs, input.expenses, input.toBase),
    pack: wrapPack(input.pack, legs),
    journal: wrapJournal(input.journal, legs, input.portraitMin),
    hasRoute: legs.length > 0,
  };
}
