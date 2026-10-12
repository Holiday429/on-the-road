/* ==========================================================================
   On the Road · Places export — unified place model
   --------------------------------------------------------------------------
   Plan items, stays, walk waypoints and nomad spots all describe "a place" with
   slightly different fields. This module normalises them into ExportPlace and
   groups them (per day / unassigned / stays / nomad) so the Google Maps
   deep-link and KML/GPX exporters share one input shape.

   Pure functions only — no DOM, no stores — so it's trivially unit-testable.
   ========================================================================== */

import type { Leg, PlanItem, Waypoint, NomadSpot } from './schema.ts';

export type PlaceSource = 'plan' | 'stay' | 'walk' | 'nomad';

export interface ExportPlace {
  name: string;
  note?: string;
  address?: string;
  lat?: number;
  lng?: number;
  /** Google place id (nomad spots only) — the most precise way to name a place. */
  placeId?: string;
  city?: string;
  category?: string;
  source: PlaceSource;
}

export type GroupKind = 'day' | 'pool' | 'stays' | 'nomad' | 'walk';

export interface ExportGroup {
  id: string;
  title: string;
  kind: GroupKind;
  city: string;
  places: ExportPlace[];
}

/* ── Place reference (how a place is addressed in a Google Maps URL) ─────── */

export type PlaceRefKind = 'placeId' | 'coords' | 'text';

export interface PlaceRef {
  kind: PlaceRefKind;
  /** Text for the origin/destination/waypoints param (always set — Google
   *  requires it even when a place id is supplied alongside). */
  query: string;
  placeId?: string;
}

export function hasCoords(p: Pick<ExportPlace, 'lat' | 'lng'>): p is { lat: number; lng: number } {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

export function textQuery(p: Pick<ExportPlace, 'name' | 'address' | 'city'>): string {
  const name = p.name.trim();
  const address = (p.address ?? '').trim();
  const city = (p.city ?? '').trim();
  // An address that already leads with the name replaces it; otherwise append.
  const parts = address && address.toLowerCase().includes(name.toLowerCase()) ? [address] : [name, address];
  if (city && !parts.join(' ').toLowerCase().includes(city.toLowerCase())) parts.push(city);
  return parts.filter(Boolean).join(', ');
}

/**
 * Resolution priority (most → least precise):
 *   1. placeId  — exact Google hit
 *   2. lat/lng  — exact point, but anonymous
 *   3. text     — name + address + city search, may land on the wrong place
 * Returns null when the place has nothing usable (blank name, no coords).
 */
export function resolvePlaceRef(p: ExportPlace): PlaceRef | null {
  const text = textQuery(p);
  if (p.placeId) return { kind: 'placeId', query: text || p.placeId, placeId: p.placeId };
  if (hasCoords(p)) return { kind: 'coords', query: `${p.lat.toFixed(6)},${p.lng.toFixed(6)}` };
  if (text) return { kind: 'text', query: text };
  return null;
}

/* ── Adapters ─────────────────────────────────────────────────────────────── */

export function fromPlanItem(item: PlanItem, city: string): ExportPlace {
  return {
    name: item.title,
    note: item.note || undefined,
    address: item.address,
    lat: item.lat,
    lng: item.lng,
    city,
    category: item.category || undefined,
    source: 'plan',
  };
}

export function fromWaypoint(w: Waypoint, city: string): ExportPlace {
  return {
    name: w.name,
    note: w.note || undefined,
    lat: w.lat,
    lng: w.lng,
    city,
    source: 'walk',
  };
}

export function fromNomadSpot(s: NomadSpot): ExportPlace {
  return {
    name: s.name,
    note: s.comment || undefined,
    address: s.address,
    placeId: s.placeId,
    city: s.city || undefined,
    category: s.type,
    source: 'nomad',
  };
}

type StayLike = { name: string; address?: string };

function staysOf(leg: Leg): StayLike[] {
  if (leg.accommodations?.length) {
    return [...leg.accommodations].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  return leg.accommodation ? [leg.accommodation] : [];
}

/* ── Grouping ─────────────────────────────────────────────────────────────── */

const byOrder = <T extends { order?: number }>(a: T, b: T) => (a.order ?? 0) - (b.order ?? 0);

export interface LegGroupOptions {
  /** Include the leg's accommodations as a "Stays" group (default true). */
  includeStays?: boolean;
}

/**
 * One ExportGroup per non-empty plan day (in day order), then the unassigned
 * pool, then stays. Items pointing at a dayId that no longer exists fall into
 * the pool rather than vanishing.
 */
export function legGroups(leg: Leg, opts: LegGroupOptions = {}): ExportGroup[] {
  const { includeStays = true } = opts;
  const city = leg.city;
  const plans = [...(leg.plans ?? [])].sort(byOrder);
  const days = [...(leg.planDays ?? [])].sort((a, b) => byOrder(a, b) || a.date.localeCompare(b.date));
  const dayIds = new Set(days.map(d => d.id));
  const groups: ExportGroup[] = [];

  days.forEach((day, i) => {
    const places = plans.filter(p => p.dayId === day.id).map(p => fromPlanItem(p, city));
    if (!places.length) return;
    const label = day.label ? ` ${day.label}` : '';
    groups.push({
      id: `${leg.id}:${day.id}`,
      title: `${city} · Day ${i + 1} (${day.date})${label}`,
      kind: 'day',
      city,
      places,
    });
  });

  const pool = plans.filter(p => !p.dayId || !dayIds.has(p.dayId)).map(p => fromPlanItem(p, city));
  if (pool.length) {
    groups.push({ id: `${leg.id}:pool`, title: `${city} · Unassigned`, kind: 'pool', city, places: pool });
  }

  if (includeStays) {
    const stays = staysOf(leg)
      .filter(s => s.name?.trim())
      .map<ExportPlace>(s => ({ name: s.name, address: s.address, city, category: 'stay', source: 'stay' }));
    if (stays.length) {
      groups.push({ id: `${leg.id}:stays`, title: `${city} · Stays`, kind: 'stays', city, places: stays });
    }
  }
  return groups;
}

/** A walk's ordered waypoints as a single group. */
export function walkGroup(id: string, title: string, city: string, waypoints: Waypoint[]): ExportGroup {
  return { id, title, kind: 'walk', city, places: waypoints.map(w => fromWaypoint(w, city)) };
}

/** Nomad spots grouped by city (one group per city, spot order preserved). */
export function nomadGroups(spots: NomadSpot[]): ExportGroup[] {
  const byCity = new Map<string, ExportPlace[]>();
  for (const s of spots) {
    const key = s.city.trim() || 'Other';
    const list = byCity.get(key) ?? [];
    list.push(fromNomadSpot(s));
    byCity.set(key, list);
  }
  return [...byCity.entries()].map(([city, places]) => ({
    id: `nomad:${city.toLowerCase()}`,
    title: `${city} · Nomad spots`,
    kind: 'nomad' as const,
    city,
    places,
  }));
}

/** Whole-trip export: legs in route order, then nomad spots. */
export function tripGroups(legs: Leg[], nomadSpots: NomadSpot[] = [], opts: LegGroupOptions = {}): ExportGroup[] {
  const ordered = [...legs].sort((a, b) => byOrder(a, b) || a.dateFrom.localeCompare(b.dateFrom));
  return [...ordered.flatMap(l => legGroups(l, opts)), ...nomadGroups(nomadSpots)];
}

/** Flatten groups into one ordered place list. */
export function groupsPlaces(groups: ExportGroup[]): ExportPlace[] {
  return groups.flatMap(g => g.places);
}

/* ── Scopes (what the user picks in the export sheet) ─────────────────────── */

export interface ExportScope {
  id: string;
  label: string;
  groups: ExportGroup[];
}

/**
 * "Whole trip" first, then one scope per city/leg (that leg's days + stays +
 * any nomad spots filed under the same city). Scopes with no places are dropped.
 */
export function exportScopes(legs: Leg[], nomadSpots: NomadSpot[] = [], opts: LegGroupOptions = {}): ExportScope[] {
  const ordered = [...legs].sort((a, b) => byOrder(a, b) || a.dateFrom.localeCompare(b.dateFrom));
  const scopes: ExportScope[] = [{ id: 'trip', label: 'Whole trip', groups: tripGroups(legs, nomadSpots, opts) }];
  for (const leg of ordered) {
    const cityKey = leg.city.trim().toLowerCase();
    const cityNomad = nomadGroups(nomadSpots.filter(s => s.city.trim().toLowerCase() === cityKey));
    scopes.push({ id: leg.id, label: `${leg.flag} ${leg.city}`.trim(), groups: [...legGroups(leg, opts), ...cityNomad] });
  }
  return scopes.filter(s => groupsPlaces(s.groups).length > 0);
}
