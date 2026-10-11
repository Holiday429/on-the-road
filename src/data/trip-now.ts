/* ==========================================================================
   On the Road · "Where am I right now" — banner model
   --------------------------------------------------------------------------
   Pure functions behind the Dashboard banner: which stop you're at, tonight's
   stay, the next transport with a countdown, and the progress dial. Segment
   based (one stop = one city stay), not date based — that's the day agenda's
   job (see day-agenda.ts).

   A transport's wall-clock time ("14:20") is in the zone it departs from, not
   the viewer's, so the countdown converts through the departure zone: the
   previous stop's, or the traveller's home zone for the first flight.
   ========================================================================== */

import type { StoredLeg } from './stores/route-store.ts';
import type { Leg } from './schema.ts';
import type { Phase } from './trip-phase.ts';
import { daysBetween } from './trip-phase.ts';
import { datePart } from './day-agenda.ts';
import { timezoneForPlace } from './country-timezone.ts';
import { wallTimeToInstant } from './tz-math.ts';

export type Stay = NonNullable<Leg['accommodations']>[number];
export type Transport = NonNullable<Leg['arrivalTransport']>;

function byFrom(legs: StoredLeg[]): StoredLeg[] {
  return [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
}

/* ── Stop (the current city segment) ─────────────────────────────────────── */

export interface Stop { leg: StoredLeg; index: number; count: number }

/** The stop the banner talks about. Before the trip: the first. After: the
 *  last. During: the leg that starts today (you sleep there tonight), else the
 *  one covering today, else — in a gap between legs — the one you left. */
export function currentStop(legs: StoredLeg[], iso: string, phase: Phase): Stop | null {
  const sorted = byFrom(legs);
  if (!sorted.length) return null;
  let leg: StoredLeg;
  if (phase === 'before') leg = sorted[0];
  else if (phase === 'after') leg = sorted[sorted.length - 1];
  else {
    leg = sorted.find((l) => l.dateFrom === iso)
      ?? sorted.find((l) => l.dateFrom <= iso && iso <= l.dateTo)
      ?? [...sorted].reverse().find((l) => l.dateTo < iso)
      ?? sorted[0];
  }
  return { leg, index: sorted.indexOf(leg) + 1, count: sorted.length };
}

/* ── Stays ───────────────────────────────────────────────────────────────── */

export function legStays(leg: StoredLeg): Stay[] {
  const list = leg.accommodations?.length ? leg.accommodations : leg.accommodation ? [leg.accommodation] : [];
  return [...list].sort((a, b) =>
    (datePart(a.checkIn) ?? '9999').localeCompare(datePart(b.checkIn) ?? '9999') || (a.order ?? 0) - (b.order ?? 0));
}

export function stayNights(s: Stay): number | null {
  const ci = datePart(s.checkIn), co = datePart(s.checkOut);
  return ci && co && co > ci ? daysBetween(ci, co) : null;
}

/** The stay to headline for `iso`: the one you're in tonight; else the next to
 *  begin; else the most recent. null when the stop has no stays. */
export function tonightStay(leg: StoredLeg, iso: string): Stay | null {
  const stays = legStays(leg);
  if (!stays.length) return null;
  const ci = (s: Stay) => datePart(s.checkIn);
  const co = (s: Stay) => datePart(s.checkOut);
  return stays.find((s) => ci(s) && ci(s)! <= iso && (co(s) ? iso < co(s)! : ci(s) === iso))
    ?? stays.find((s) => ci(s) && ci(s)! > iso)
    ?? [...stays].reverse().find((s) => ci(s) && ci(s)! <= iso)
    ?? stays[0];
}

/* ── Transports ──────────────────────────────────────────────────────────── */

export interface TransportLeg {
  /** The stop this transport arrives at. */
  leg: StoredLeg;
  transport: Transport;
  /** Zone the departure time is written in (null if unknown). */
  depTz: string | null;
  /** Departure instant; null when the transport has no (valid) time. */
  depAt: Date | null;
}

/** Every dated transport in trip order, with its departure instant resolved.
 *  `homeTz` is the zone of the first flight's origin. */
export function tripTransports(legs: StoredLeg[], homeTz: string | null): TransportLeg[] {
  const sorted = byFrom(legs);
  const out: TransportLeg[] = [];
  sorted.forEach((leg, i) => {
    const transport = leg.arrivalTransport;
    if (!transport?.date) return;
    const prev = sorted[i - 1];
    const depTz = prev ? timezoneForPlace(prev.city, prev.country) : homeTz;
    const time = transport.time?.trim();
    const depAt = time && depTz ? wallTimeToInstant(transport.date, time, depTz) : null;
    out.push({ leg, transport, depTz, depAt });
  });
  return out.sort((a, b) =>
    a.transport.date.localeCompare(b.transport.date)
    || (a.depAt?.getTime() ?? 0) - (b.depAt?.getTime() ?? 0));
}

/** The next transport still to be taken. Timed → departure after `now`;
 *  untimed → dated today or later (in the viewer's `todayIso`). */
export function nextTransport(list: TransportLeg[], now: Date, todayIso: string): TransportLeg | null {
  return list.find((t) => (t.depAt ? t.depAt.getTime() > now.getTime() : t.transport.date >= todayIso)) ?? null;
}

/** The transport that brought you to `leg` (shown under "how you arrived"). */
export function arrivalFor(list: TransportLeg[], leg: StoredLeg): TransportLeg | null {
  return list.find((t) => t.leg.id === leg.id) ?? null;
}

export interface Countdown { days: number; hours: number; minutes: number; ms: number }

export function countdownTo(at: Date, now: Date): Countdown {
  const ms = Math.max(0, at.getTime() - now.getTime());
  const totalMin = Math.floor(ms / 60000);
  return { days: Math.floor(totalMin / 1440), hours: Math.floor((totalMin % 1440) / 60), minutes: totalMin % 60, ms };
}

/** Whole calendar days to an untimed transport date (0 = today). */
export function daysUntilDate(iso: string, todayIso: string): number {
  return Math.max(0, daysBetween(todayIso, iso));
}

/* ── Progress dial ───────────────────────────────────────────────────────── */

export type Dial =
  | { kind: 'before'; daysToGo: number; fraction: 0 }
  | { kind: 'during'; day: number; total: number; fraction: number }
  | { kind: 'after'; total: number; fraction: 1 };

export function tripSpan(trip: { startDate: string; endDate: string } | null, legs: StoredLeg[]): { start: string; end: string } | null {
  if (trip?.startDate && trip.endDate) return { start: trip.startDate, end: trip.endDate };
  const s = byFrom(legs);
  return s.length ? { start: s[0].dateFrom, end: s.reduce((m, l) => (l.dateTo > m ? l.dateTo : m), s[0].dateTo) } : null;
}

export function tripDial(phase: Phase, span: { start: string; end: string } | null, iso: string): Dial {
  const total = span ? daysBetween(span.start, span.end) + 1 : 0;
  if (phase === 'before') return { kind: 'before', daysToGo: span ? Math.max(0, daysBetween(iso, span.start)) : 0, fraction: 0 };
  if (phase === 'after') return { kind: 'after', total, fraction: 1 };
  const day = span ? Math.min(total, Math.max(1, daysBetween(span.start, iso) + 1)) : 1;
  return { kind: 'during', day, total, fraction: total ? day / total : 0 };
}
