/* ==========================================================================
   On the Road · Itinerary — pure helpers
   --------------------------------------------------------------------------
   Side-effect-free utilities extracted from route.ts: date maths, sorting,
   colour palettes, Google Maps links, geometry. None of these read module
   state, so they live here to keep route.ts focused on rendering + wiring.
   ========================================================================== */

import type { Leg as SchemaLeg, NoteCard, Clip } from '../../data/schema.ts';
import { currencySymbol } from '../../data/rates.ts';
import { slugId } from '../../core/utils.ts';

type Leg = SchemaLeg & { id: string };
type Accommodation = NonNullable<SchemaLeg['accommodations']>[number];
type Transport = NonNullable<SchemaLeg['arrivalTransport']>;

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

/** Note cards for a leg, migrating the legacy single `notes` string and
 *  normalising palette colours. Shared by the detail renderer and the
 *  city-sharing aggregator. */
export function legNoteCardsOf(leg: Leg): NoteCard[] {
  if (leg.noteCards?.length) {
    return [...leg.noteCards]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((c, i) => ({ ...c, color: resolveNoteColor(c.color, i) }));
  }
  if (leg.notes?.trim()) {
    return [{ id: 'legacy', title: '', body: leg.notes, color: NOTE_COLORS[0], order: 0 }];
  }
  return [];
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

/* ── Price / label formatters ────────────────────────────────────────────── */
// The structured price fields win over the free-text legacy `price`. The
// trip's base currency is passed in (not read from module state) so these
// stay pure and testable.

/** Accommodation price as "€120", or the legacy free-text price, or ''. */
export function stayPriceLabel(a: Accommodation, fallbackCurrency: string): string {
  if (a.priceAmount != null) return `${currencySymbol(a.priceCurrency ?? fallbackCurrency)}${a.priceAmount}`;
  return a.price ?? '';
}

/** Transport price as "€39", or the legacy free-text price, or ''. */
export function transportPriceLabel(t: Transport, fallbackCurrency: string): string {
  if (t.priceAmount != null) return `${currencySymbol(t.priceCurrency ?? fallbackCurrency)}${t.priceAmount}`;
  return t.price ?? '';
}

/** Normalise a pasted booking URL to an absolute https href (or '' if empty). */
export function stayBookingHref(a: Accommodation): string {
  const u = (a.bookingUrl ?? '').trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/** Baggage allowances as "Personal 5 · Carry-on 10 · Checked 23 kg", or ''.
 *  Weights are stored in grams; a legacy single allowance maps to carry-on. */
export function baggageLabel(t: Transport): string {
  const parts: string[] = [];
  const personal = t.baggagePersonalG;
  const carry = t.baggageCarryOnG ?? t.baggageAllowanceG; // legacy single value = carry-on
  const checked = t.baggageCheckedG;
  if (personal) parts.push(`Personal ${personal / 1000}`);
  if (carry) parts.push(`Carry-on ${carry / 1000}`);
  if (checked) parts.push(`Checked ${checked / 1000}`);
  return parts.length ? `${parts.join(' · ')} kg` : '';
}

/** Canonical image URL list for a clip, migrating the legacy single imageUrl. */
export function clipImages(c: Clip): string[] {
  if (c.imageUrls?.length) return c.imageUrls;
  if (c.imageUrl) return [c.imageUrl];
  return [];
}

/** Slugged titles of a leg's plan items — used to dedupe "from other visits". */
export function legPlanTitleSet(leg: Leg): Set<string> {
  return new Set((leg.plans ?? []).map(p => slugId(p.title) || p.title.trim().toLowerCase()));
}
