/* ==========================================================================
   On the Road · Visas (pure)
   --------------------------------------------------------------------------
   What the traveller's visas mean for the trips they have taken and planned.
   Nothing here knows which nationalities need a visa where — that changes with
   politics and is easy to get wrong; the traveller says what they hold, and
   this only compares it with the itinerary:

   · which visits a visa covers (by region and validity dates)
   · warnings: a stay that outlasts the visa, or a stay longer than one entry allows
   · the Schengen 90/180 count, worked out from the itinerary
   ========================================================================== */

import { legIso, type FootprintLeg } from './footprint.ts';
import type { Visa } from './schema/visa.ts';

/** The Schengen Area as of 2026 (29 states). */
export const SCHENGEN: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL',
  'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH',
]);

export const SCHENGEN_REGION = 'SCHENGEN';

export function regionCovers(region: string, iso: string): boolean {
  if (!iso) return false;
  return region === SCHENGEN_REGION ? SCHENGEN.has(iso) : region.toUpperCase() === iso.toUpperCase();
}

const DAY = 86400000;
const t = (iso: string): number => new Date(`${iso}T00:00:00Z`).getTime();
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Legs of any trip that are in the visa's region. */
function legsIn(region: string, legs: FootprintLeg[]): FootprintLeg[] {
  return legs.filter((l) => regionCovers(region, legIso(l)));
}

export interface VisaUse {
  tripId: string;
  /** Countries (ISO) of this trip inside the visa's region and validity. */
  isos: string[];
}

/** The trips whose stops in the visa's region fall (at least partly) inside its validity. */
export function visaUses(v: Visa, legs: FootprintLeg[]): VisaUse[] {
  if (!v.validFrom || !v.validTo) return [];
  const byTrip = new Map<string, string[]>();
  for (const l of legsIn(v.region, legs)) {
    if (l.dateTo < v.validFrom || l.dateFrom > v.validTo) continue;
    const k = l.tripId ?? '_';
    const list = byTrip.get(k) ?? [];
    const c = legIso(l);
    if (!list.includes(c)) list.push(c);
    byTrip.set(k, list);
  }
  return [...byTrip].map(([tripId, isos]) => ({ tripId, isos }));
}

export type VisaWarningKind = 'outlasts' | 'longStay';

export interface VisaWarning {
  kind: VisaWarningKind;
  visaId: string;
  region: string;
  tripId: string;
  /** The date that matters: when the visa ends / how many days the stay is. */
  date: string;
  days?: number;
}

/**
 * Stays that do not fit the visa. Past stays are not checked; a leg that starts inside the validity but
 * ends after it is a stay that outlasts it. A run of back-to-back stops in the region longer than the
 * days allowed per stay is a long stay.
 */
export function visaWarnings(v: Visa, legs: FootprintLeg[], today: string): VisaWarning[] {
  const out: VisaWarning[] = [];
  if (!v.validTo) return out;
  const inRegion = legsIn(v.region, legs).sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  for (const l of inRegion) {
    if (l.dateTo < today) continue;
    if (l.dateFrom <= v.validTo && l.dateTo > v.validTo && (!v.validFrom || l.dateTo >= v.validFrom)) {
      out.push({ kind: 'outlasts', visaId: v.id, region: v.region, tripId: l.tripId ?? '_', date: v.validTo });
    }
  }
  if (v.stayDays) {
    // Runs: consecutive legs of one trip where each starts within a day of the previous leaving.
    let run: FootprintLeg[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const from = run[0].dateFrom;
      const to = run[run.length - 1].dateTo;
      const days = Math.round((t(to) - t(from)) / DAY) + 1;
      if (to >= today && days > v.stayDays!) out.push({ kind: 'longStay', visaId: v.id, region: v.region, tripId: run[0].tripId ?? '_', date: from, days });
      run = [];
    };
    for (const l of inRegion) {
      const last = run[run.length - 1];
      if (last && ((l.tripId ?? '_') !== (last.tripId ?? '_') || t(l.dateFrom) - t(last.dateTo) > DAY)) flush();
      run.push(l);
    }
    flush();
  }
  return out;
}

/* ── Schengen 90 / 180 ───────────────────────────────────────────────────── */

export interface SchengenUsage {
  /** Days in the Schengen Area in the 180 days up to and including today. */
  used: number;
  remaining: number;
  /** The most days in any 180-day window ending on a day of a stay that has not finished yet (today included). */
  peak: number;
  /** First date a planned stay takes the count past 90; '' when it never does. */
  overstayOn: string;
}

/** Every date (ISO) the legs put the traveller in the Schengen Area — arrival and departure days both count. */
export function schengenDays(legs: FootprintLeg[]): Set<string> {
  const days = new Set<string>();
  for (const l of legs) {
    if (!SCHENGEN.has(legIso(l))) continue;
    for (let d = t(l.dateFrom); d <= t(l.dateTo); d += DAY) days.add(iso(d));
  }
  return days;
}

function windowCount(days: ReadonlySet<string>, end: number): number {
  let n = 0;
  for (let d = end - 179 * DAY; d <= end; d += DAY) if (days.has(iso(d))) n += 1;
  return n;
}

/** The 90/180 count as of `today`, and how far the planned stays push it. Null when no stop is in the Schengen Area. */
export function schengenUsage(legs: FootprintLeg[], today: string): SchengenUsage | null {
  const days = schengenDays(legs);
  if (days.size === 0) return null;
  const used = windowCount(days, t(today));
  let peak = used;
  let overstayOn = '';
  for (const d of [...days].sort()) {
    if (d < today) continue;
    const n = windowCount(days, t(d));
    if (n > peak) peak = n;
    if (n > 90 && !overstayOn) overstayOn = d;
  }
  return { used, remaining: Math.max(0, 90 - used), peak, overstayOn };
}

/* ── Labels ──────────────────────────────────────────────────────────────── */

/** 🇩🇪 for 'DE'; 🇪🇺 for the Schengen Area. */
export function regionFlag(region: string): string {
  if (region === SCHENGEN_REGION) return '🇪🇺';
  if (!/^[A-Za-z]{2}$/.test(region)) return '🌐';
  return String.fromCodePoint(...[...region.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** The region's name in the reader's language: "Germany", or `schengenLabel` for the Schengen Area. */
export function regionLabel(region: string, locale: string, schengenLabel: string): string {
  if (region === SCHENGEN_REGION) return schengenLabel;
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(region.toUpperCase()) ?? region; } catch { return region; }
}
