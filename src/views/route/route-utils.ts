/* ==========================================================================
   On the Road · Itinerary — pure helpers
   --------------------------------------------------------------------------
   Side-effect-free utilities extracted from route.ts: date maths, sorting,
   colour palettes, Google Maps links, geometry. None of these read module
   state, so they live here to keep route.ts focused on rendering + wiring.
   ========================================================================== */

import type { Leg as SchemaLeg } from '../../data/schema.ts';

type Leg = SchemaLeg & { id: string };
type Accommodation = NonNullable<SchemaLeg['accommodations']>[number];

export const TRANSPORT_ICONS: Record<string, string> = {
  flight: '✈️', train: '🚆', bus: '🚌', ferry: '⛴️',
};

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Drop undefined keys — Firestore rejects undefined values. */
export function clean<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
}

export function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export type LegStatus = 'past' | 'active' | 'upcoming';
export function legStatus(leg: Leg): LegStatus {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const from = new Date(leg.dateFrom + 'T00:00:00');
  const to = new Date(leg.dateTo + 'T00:00:00');
  if (today > to) return 'past';
  if (today >= from) return 'active';
  return 'upcoming';
}

export function sortLegs(rows: Leg[]): Leg[] {
  return [...rows].sort((a, b) => {
    const byDate = a.dateFrom.localeCompare(b.dateFrom);
    if (byDate !== 0) return byDate;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

/** Stays for a leg, normalising the legacy single `accommodation` field. */
export function legStays(leg: Leg): Accommodation[] {
  if (leg.accommodations?.length) {
    return [...leg.accommodations].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  if (leg.accommodation) return [{ ...leg.accommodation, id: 'legacy' }];
  return [];
}

/** Google Maps deep link: pasted URL wins, else search by name + city. */
export function mapHref(a: Accommodation, leg: Leg): string {
  if (a.mapUrl) {
    return /^https?:\/\//i.test(a.mapUrl) ? a.mapUrl : `https://${a.mapUrl}`;
  }
  const q = encodeURIComponent(`${a.name} ${leg.city}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/* ── Note-card palette ───────────────────────────────────────────────────── */
export const NOTE_COLORS = [
  '#e2edf3', // Tourism blue-grey
  '#fde8ef', // Social pink
  '#fef3e2', // Food warm
  '#ece2f3', // Museum lavender
  '#e6f3e6', // Nature green
  '#e2f3ec', // Day trip mint
  '#f3e2e8', // Shopping rose
  '#ebebeb', // Other neutral
];

export function noteColor(idx: number): string {
  return NOTE_COLORS[idx % NOTE_COLORS.length];
}

/** If a card has an old/unknown color, remap it to the canonical palette by position. */
export function resolveNoteColor(stored: string, idx: number): string {
  return NOTE_COLORS.includes(stored) ? stored : noteColor(idx);
}

/* ── Plan-day palette ────────────────────────────────────────────────────── */
export const DAY_COLOURS = [
  '#f97316','#3b82f6','#22c55e','#a855f7','#ec4899',
  '#14b8a6','#eab308','#ef4444','#6366f1','#84cc16',
  '#f43f5e','#0ea5e9','#d97706','#8b5cf6',
];

export function dayColour(idx: number): string {
  return DAY_COLOURS[idx % DAY_COLOURS.length];
}

/** Compass bearing in degrees from point a to point b ([lat, lng]). */
export function bearing(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => d * Math.PI / 180;
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]), lat2 = toRad(b[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
