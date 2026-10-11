/* ==========================================================================
   On the Road · Day map model
   --------------------------------------------------------------------------
   What the Dashboard map shows for one day: tonight's stay and the day's plan
   items, in the order the day runs, joined by a line. On a change-of-city day
   the city you left is the first point. Pure — coordinates come through a
   synchronous resolver (cached/bundled lookups); anything it can't place is
   returned as `pending` so the UI can geocode it and call again.
   ========================================================================== */

import type { StoredLeg } from './stores/route-store.ts';
import { agendaForDay, datePart, type AgendaSources } from './day-agenda.ts';
import { tonightStay } from './trip-now.ts';
import { legForDate } from './plan-days.ts';

export interface LatLng { lat: number; lng: number }
/** Synchronous place lookup: free text (+ country hint) → coordinates or null. */
export type GeoResolver = (query: string, countryHint?: string) => LatLng | null;

export interface DayMapPoint extends LatLng {
  id: string;
  kind: 'stay' | 'plan' | 'city';
  label: string;
  /** Plan item id (kind 'plan') or the leg id (kinds 'stay' / 'city'). */
  ref: string;
  legId: string;
  /** 1-based position among numbered (plan) points; 0 for stay / city. */
  n: number;
}

export interface PendingGeo { id: string; query: string; hint: string }

export interface DayMapModel {
  points: DayMapPoint[];
  pending: PendingGeo[];
  /** Fallback view when there are no points: the stop's city. */
  center: LatLng | null;
  /** Changes whenever what the map should draw changes. */
  sig: string;
}

export function dayMapModel(iso: string, src: AgendaSources, geo: GeoResolver): DayMapModel {
  const day = agendaForDay(iso, src);
  const points: DayMapPoint[] = [];
  const pending: PendingGeo[] = [];
  const leg = day.leg;

  const add = (p: Omit<DayMapPoint, 'lat' | 'lng'>, query: string, hint: string, known?: LatLng | null) => {
    const at = known ?? geo(query, hint);
    if (at) points.push({ ...p, lat: at.lat, lng: at.lng });
    else pending.push({ id: p.id, query, hint });
  };

  // The city just left (travel day) starts the line.
  if (day.leavingLeg) {
    const l = day.leavingLeg;
    add({ id: `city-${l.id}`, kind: 'city', label: l.city, ref: l.id, legId: l.id, n: 0 }, l.city, l.country);
  }

  if (leg) {
    const stay = tonightStay(leg, iso);
    // Only a stay that actually covers the date — not "the next one to begin".
    const ci = datePart(stay?.checkIn), co = datePart(stay?.checkOut);
    if (stay && ci && ci <= iso && (!co || iso <= co)) {
      add({ id: `stay-${stay.id ?? leg.id}`, kind: 'stay', label: stay.name, ref: leg.id, legId: leg.id, n: 0 },
        stay.address?.trim() || `${stay.name}, ${leg.city}`, leg.country);
    }

    const planDay = (leg.planDays ?? []).find((d) => d.date === iso);
    const plans = (leg.plans ?? [])
      .filter((p) => planDay && p.dayId === planDay.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    let n = 0;
    for (const p of plans) {
      n += 1;
      add({ id: `plan-${p.id}`, kind: 'plan', label: p.title, ref: p.id, legId: leg.id, n },
        p.address?.trim() || `${p.title}, ${leg.city}`, leg.country,
        p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null);
    }
  }

  // Outside the trip there is no covering stop — use the nearest one.
  const near = leg ?? legForDate(src.legs, iso);
  const center = near ? geo(near.city, near.country) : null;
  const sig = JSON.stringify([
    points.map((p) => [p.id, p.label, +p.lat.toFixed(5), +p.lng.toFixed(5), p.n]),
    pending.length,
    center && [+center.lat.toFixed(3), +center.lng.toFixed(3)],
  ]);
  return { points, pending, center, sig };
}

export type { StoredLeg };
