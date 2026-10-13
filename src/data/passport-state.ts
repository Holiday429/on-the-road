/* ==========================================================================
   On the Road · Passport state (pure)
   --------------------------------------------------------------------------
   Joins the derived stamps (data/passport.ts) with what the traveller pressed
   (the stored placements):

   · pressed  — stamps with a placement: they are on a page
   · pending  — derived stamps with none yet: waiting in the tray to be pressed
   · orphans  — a placement whose stamp can no longer be derived (its stop or
                trip was deleted): it stays on its page from the copy saved
                when it was pressed, marked as from a deleted trip (Q3)

   Also: the optional real-document check (expiry vs. planned trips).
   ========================================================================== */

import type { PassportData, PassportStamp } from './passport.ts';
import type { PlacementRec, StampSnap } from './schema/passport.ts';
import { COUNTRY_SHAPES } from '../core/paper/stamp-country.ts';
import { countryInk } from './country-ink.ts';
import { hashStr } from './palette.ts';

export function snapOf(s: PassportStamp): StampSnap {
  return {
    tripId: s.tripId, tripName: s.tripName, iso: s.iso, country: s.country, date: s.date,
    nights: s.nights, cities: s.cities, mode: s.mode,
  };
}

export function stampFromSnap(id: string, p: PlacementRec): PassportStamp | null {
  const n = p.snap;
  if (!n) return null;
  return {
    id, kind: 'country', city: n.cities[0] ?? '', country: n.country, iso: n.iso, date: n.date, nights: Math.max(1, n.nights),
    mode: n.mode, shape: COUNTRY_SHAPES[hashStr(n.iso || n.country.toLowerCase()) % COUNTRY_SHAPES.length],
    rotation: p.rot, ink: countryInk(n.iso, n.country), earned: true, tripId: n.tripId, tripName: n.tripName,
    firstEver: false, cities: n.cities, legIds: [], orphan: true,
  };
}

export interface PassportState {
  pressed: PassportStamp[];
  pending: PassportStamp[];
}

/** Everything the passport's entry points need: the derived data plus what is pressed and what waits. */
export interface PassportFeed extends PassportData {
  pressed: PassportStamp[];
  pending: PassportStamp[];
  /** Real-document checks (expiry vs. upcoming trips); [] when none was entered. */
  warnings: DocWarning[];
}

export function passportState(derived: PassportStamp[], placements: Readonly<Record<string, PlacementRec>>): PassportState {
  const pressed: PassportStamp[] = [];
  const pending: PassportStamp[] = [];
  const have = new Set<string>();
  for (const s of derived) {
    have.add(s.id);
    (placements[s.id] ? pressed : pending).push(s);
  }
  for (const [id, p] of Object.entries(placements)) {
    if (have.has(id)) continue;
    const o = stampFromSnap(id, p);
    if (o) pressed.push(o);
  }
  const byDate = (a: PassportStamp, b: PassportStamp) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  return { pressed: pressed.sort(byDate), pending: pending.sort(byDate) };
}

/* ── Real document check ─────────────────────────────────────────────────── */

export interface DocWarning {
  /** Trip (or date) the check is about. */
  tripName: string;
  /** Last day of that trip. */
  endDate: string;
  /** Passport expiry. */
  expires: string;
  kind: 'expired' | 'short';
}

function addMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Trips that start or end too close to the passport's expiry: many countries want it valid for 6 months
 * after you leave. Past trips are not checked. '' / unparseable expiry = nothing to warn about.
 */
export function docWarnings(
  expires: string,
  trips: ReadonlyArray<{ name: string; startDate: string; endDate: string }>,
  today: string,
): DocWarning[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) return [];
  const out: DocWarning[] = [];
  for (const t of trips) {
    if (t.endDate < today) continue;
    if (expires < t.endDate) out.push({ tripName: t.name, endDate: t.endDate, expires, kind: 'expired' });
    else if (expires < addMonths(t.endDate, 6)) out.push({ tripName: t.name, endDate: t.endDate, expires, kind: 'short' });
  }
  return out;
}
