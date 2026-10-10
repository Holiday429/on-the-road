/* ==========================================================================
   On the Road · Day agenda
   --------------------------------------------------------------------------
   Aggregates everything dated on one calendar day — transport, stays, plan
   items, to-dos, spend, journal — into one ordered stream. This is a port of
   iOS `CalendarStore.day(on:)` / `kindsByDate`, kept deliberately in step with
   it so the two platforms show the same day the same way.

   Used by both the dashboard agenda widget and the full Calendar view; do not
   fork a second aggregation. Pure functions over plain arrays (no stores, no
   DOM) so it is trivially testable.

   Why date-keyed and not leg-keyed: on a travel day the content spans two legs
   (check out of Lisbon → fly → check in at Rome). A per-leg feed can't show
   that; a per-date feed does it for free.
   ========================================================================== */

import type { StoredLeg } from './stores/route-store.ts';
import type { StoredExpense } from './stores/expense-store.ts';
import type { StoredJournalEntry } from './stores/journal-store.ts';
import type { StoredTodo } from './stores/todo-store.ts';
import type { ViewId, NavIntent } from '../core/app.ts';

export type AgendaKind = 'context' | 'transport' | 'stay' | 'plan' | 'todo' | 'spend' | 'journal';

/** Sort rank within a day (iOS CalendarKind.rank). */
const RANK: Record<AgendaKind, number> = {
  context: 0, transport: 1, stay: 2, plan: 3, todo: 4, spend: 5, journal: 6,
};

/** Shared palette — the same hues iOS borrows from the expense-category chart
 *  so the calendar and the Analysis donut agree. */
export const AGENDA_COLORS: Record<AgendaKind, string> = {
  transport: '#5fd0a5', // mint
  stay:      '#7fb5e8', // sky
  plan:      '#ef9a9a', // coral
  journal:   '#b39ddb', // soft purple
  spend:     '#f0c96a', // warm yellow
  todo:      '#ffb974', // peach
  context:   '#a8a29e',
};

export interface AgendaDetail { label: string; value: string }

export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  /** 'HH:MM', or null — untimed items sort after timed ones. */
  time: string | null;
  title: string;
  subtitle?: string;
  /** Emoji glyph. */
  icon: string;
  details: AgendaDetail[];
  done?: boolean;
  legId?: string;
  /** Where a click should go. */
  navTo?: ViewId;
  intent?: NavIntent;
  /** Tie-break within a kind (check-out before check-in). */
  subRank: number;
  /** Plan items / todos can be ticked inline: the owning ids. */
  planRef?: { legId: string; planId: string };
  todoId?: string;
}

/** Day-shape flags the UI turns into phase-aware hints ("arrived today",
 *  "leaving tomorrow", "last day") — computed here so every view agrees. */
export interface DayFlags {
  isArrival: boolean;        // a leg starts today
  isDeparture: boolean;      // a leg ends today
  isEveOfDeparture: boolean; // a leg ends tomorrow
  isFirstDayOfTrip: boolean;
  isLastDayOfTrip: boolean;
}

export interface DayAgenda {
  iso: string;
  /** The leg you are "in" today: the leg that starts today if any (you sleep
   *  there tonight), else the leg covering the date. */
  leg: StoredLeg | null;
  /** The leg being left today, when different from `leg` (a change-of-city day). */
  leavingLeg: StoredLeg | null;
  dayInLeg: { n: number; total: number } | null;
  planDayLabel: string | null;
  flags: DayFlags;
  items: AgendaItem[];
  journalEntries: StoredJournalEntry[];
  isEmpty: boolean;
}

export interface AgendaSources {
  legs: StoredLeg[];
  journal: StoredJournalEntry[];
  todos: StoredTodo[];
  expenses: StoredExpense[];
}

/* ── Date helpers ────────────────────────────────────────────────────────── */

/** Accommodation check-in/out are free-ish strings: 'YYYY-MM-DD', or with a
 *  time, or a full ISO stamp. Take the leading date, and a time only if there. */
export function datePart(s: string | undefined | null): string | null {
  const v = s?.trim();
  if (!v || v.length < 10) return null;
  const d = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}
export function timePart(s: string | undefined | null): string | null {
  const v = s?.trim();
  if (!v || v.length < 16) return null;
  const t = v.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(t) ? t : null;
}
function blank(s: string | undefined | null): string | null {
  const v = s?.trim();
  return v ? v : null;
}
function isoOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoOf(d);
}
function diffDays(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
}
/** ISO dates strictly between two ISO dates. Capped so a mistyped multi-year
 *  checkOut can't spin out a huge set. */
function datesBetween(after: string, before: string): string[] {
  const out: string[] = [];
  for (let d = addDays(after, 1); d < before && out.length < 366; d = addDays(d, 1)) out.push(d);
  return out;
}

const TRANSPORT_ICON: Record<string, string> = { flight: '✈️', train: '🚆', bus: '🚌', ferry: '⛴️' };
const TRANSPORT_LABEL: Record<string, string> = { flight: 'Flight', train: 'Train', bus: 'Bus', ferry: 'Ferry' };

function sorted<T>(arr: T[], cmp: (a: T, b: T) => number): T[] { return [...arr].sort(cmp); }

/** plan-day id → date for one leg. */
function planDayDates(leg: StoredLeg): Map<string, string> {
  return new Map((leg.planDays ?? []).map((d) => [d.id, d.date]));
}

/* ── Leg lookup ──────────────────────────────────────────────────────────── */

function legStartingOn(legs: StoredLeg[], iso: string): StoredLeg | null {
  return legs.find((l) => l.dateFrom === iso) ?? null;
}
function legCovering(legs: StoredLeg[], iso: string): StoredLeg | null {
  return legs.find((l) => l.dateFrom <= iso && iso <= l.dateTo) ?? null;
}

/* ── Per-kind builders ───────────────────────────────────────────────────── */

function contextItems(iso: string, leg: StoredLeg | null, dayInLeg: DayAgenda['dayInLeg'], label: string | null): AgendaItem[] {
  if (!leg) return [];
  const parts: string[] = [];
  if (dayInLeg) parts.push(`Day ${dayInLeg.n} of ${dayInLeg.total} in ${leg.city}`);
  if (iso === leg.dateFrom) parts.push('Arrival day');
  if (iso === leg.dateTo) parts.push('Departure day');
  if (!parts.length && !label) return [];
  return [{
    id: `ctx-${iso}`, kind: 'context', time: null,
    title: label ?? parts[0] ?? leg.city,
    subtitle: (label ? parts : parts.slice(1)).join(' · ') || undefined,
    icon: '📍', details: [], legId: leg.id, subRank: 0,
    navTo: 'route', intent: { legId: leg.id },
  }];
}

function transportItems(legs: StoredLeg[], iso: string): AgendaItem[] {
  const out: AgendaItem[] = [];
  for (const leg of legs) {
    const t = leg.arrivalTransport;
    if (!t || t.date !== iso) continue;
    const details: AgendaDetail[] = [];
    const add = (label: string, v: string | null | undefined) => { const x = blank(v); if (x) details.push({ label, value: x }); };
    add('Service', t.service);
    add('Departs', [blank(t.time), blank(t.depPlace)].filter(Boolean).join(' · '));
    add('Arrives', [blank(t.arrivalTime), blank(t.arrPlace)].filter(Boolean).join(' · '));
    add('Duration', t.duration);
    if (t.via?.length) add('Via', t.via.filter(Boolean).join(' · '));
    add('Price', t.priceAmount != null ? `${t.priceAmount} ${t.priceCurrency ?? ''}`.trim() : t.price);
    add('Booking', t.bookingRef);
    add('Notes', t.notes);
    const route = [t.from, t.to].filter(Boolean).join(' → ');
    out.push({
      id: `transport-${leg.id}`, kind: 'transport', time: blank(t.time),
      title: route || leg.city,
      subtitle: [TRANSPORT_LABEL[t.type] ?? 'Transport', blank(t.service)].filter(Boolean).join(' · '),
      icon: TRANSPORT_ICON[t.type] ?? '🚀', details, legId: leg.id, subRank: 0,
      navTo: 'route', intent: { legId: leg.id },
    });
  }
  return out;
}

function stayItems(legs: StoredLeg[], iso: string): AgendaItem[] {
  const out: AgendaItem[] = [];
  for (const leg of legs) {
    const stays = leg.accommodations?.length ? leg.accommodations : leg.accommodation ? [leg.accommodation] : [];
    stays.forEach((a, i) => {
      const key = a.id ?? `${leg.id}-${i}`;
      const details: AgendaDetail[] = [];
      const add = (label: string, v: string | null | undefined) => { const x = blank(v); if (x) details.push({ label, value: x }); };
      add('Address', a.address);
      add('Check-in', a.checkIn);
      add('Check-out', a.checkOut);
      add('Price', a.price);
      add('Platform', a.platform);
      add('Phone', a.phone);
      add('Status', a.confirmed ? 'Confirmed' : 'Not confirmed');
      const base = { kind: 'stay' as const, title: a.name, icon: '🏠', details, legId: leg.id, navTo: 'route' as ViewId, intent: { legId: leg.id } };
      const ci = datePart(a.checkIn), co = datePart(a.checkOut);
      // Both cards share the house icon; subRank orders check-out → check-in,
      // the order a travel day actually happens in.
      if (co === iso) out.push({ ...base, id: `stay-out-${key}`, time: timePart(a.checkOut), subtitle: `Check out · ${leg.city}`, subRank: 0 });
      if (ci === iso) out.push({ ...base, id: `stay-in-${key}`, time: timePart(a.checkIn), subtitle: `Check in · ${leg.city}`, subRank: 1 });
      // A mid-stay night has neither — but "where am I sleeping tonight" is
      // exactly the question, so carry it as a quiet untimed card.
      if (ci && co && ci < iso && iso < co) out.push({ ...base, id: `stay-at-${key}`, time: null, subtitle: `Staying · ${leg.city}`, subRank: 2 });
    });
  }
  return out;
}

function planItems(legs: StoredLeg[], iso: string): AgendaItem[] {
  const out: AgendaItem[] = [];
  for (const leg of legs) {
    const dayDate = planDayDates(leg);
    const todays = sorted(
      (leg.plans ?? []).filter((p) => p.dayId && dayDate.get(p.dayId) === iso),
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
    for (const p of todays) {
      const details: AgendaDetail[] = [];
      const add = (label: string, v: string | null | undefined) => { const x = blank(v); if (x) details.push({ label, value: x }); };
      add('Note', p.note); add('Duration', p.duration); add('Cost', p.cost);
      details.push({ label: 'City', value: `${leg.flag} ${leg.city}`.trim() });
      out.push({
        id: `plan-${p.id}`, kind: 'plan', time: null, title: p.title,
        subtitle: [blank(p.category), leg.city].filter(Boolean).join(' · '),
        icon: p.done ? '✅' : '📌', details, done: p.done, legId: leg.id, subRank: 0,
        navTo: 'route', intent: { legId: leg.id }, planRef: { legId: leg.id, planId: p.id },
      });
    }
  }
  return out;
}

function todoItems(todos: StoredTodo[], iso: string): AgendaItem[] {
  return todos.filter((t) => t.dueDate === iso && !t.done).map((t) => ({
    id: `todo-${t.id}`, kind: 'todo' as const, time: null, title: t.text,
    subtitle: 'Due today', icon: '☑️', details: [], done: t.done, subRank: 0,
    navTo: 'calendar' as ViewId, todoId: t.id,
  }));
}

/** One rolled-up card for the day's spend, per-entry breakdown in details — a
 *  day of six coffees shouldn't push the itinerary off screen. */
function spendItems(expenses: StoredExpense[], iso: string): AgendaItem[] {
  const rows = expenses.filter((e) => e.date === iso);
  if (!rows.length) return [];
  const baseCur = rows[0].baseCurrency;
  const total = rows.reduce((s, e) => s + e.baseAmount, 0);
  const details = [...rows].sort((a, b) => b.baseAmount - a.baseAmount).map((e) => ({
    label: blank(e.description) ?? blank(e.category) ?? 'Unlabelled',
    value: `${e.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${e.currency}`,
  }));
  return [{
    id: `spend-${iso}`, kind: 'spend', time: null,
    title: `${Math.round(total).toLocaleString()} ${baseCur}`,
    subtitle: `${rows.length} expense${rows.length === 1 ? '' : 's'}`,
    icon: '💶', details, subRank: 0, navTo: 'expenses',
  }];
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/** Everything for one date, ordered the way the day actually happens:
 *  timed items by clock, then untimed by kind rank (context → transport →
 *  stay → plan → todo → spend), then subRank. */
export function agendaForDay(iso: string, src: AgendaSources): DayAgenda {
  const legs = sorted(src.legs, (a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const arriving = legStartingOn(legs, iso);
  const leg = arriving ?? legCovering(legs, iso);
  const leavingLeg = arriving ? (legs.find((l) => l.dateTo === iso && l.id !== arriving.id) ?? null) : null;
  const dayInLeg = leg
    ? { n: diffDays(leg.dateFrom, iso) + 1, total: diffDays(leg.dateFrom, leg.dateTo) + 1 }
    : null;
  const planDay = legs.flatMap((l) => l.planDays ?? []).find((d) => d.date === iso);
  const planDayLabel = blank(planDay?.label);

  const items = [
    ...contextItems(iso, leg, dayInLeg, planDayLabel),
    ...transportItems(legs, iso),
    ...stayItems(legs, iso),
    ...planItems(legs, iso),
    ...todoItems(src.todos, iso),
    ...spendItems(src.expenses, iso),
  ].sort((a, b) =>
    (a.time == null ? 1 : 0) - (b.time == null ? 1 : 0)
    || (a.time ?? '').localeCompare(b.time ?? '')
    || RANK[a.kind] - RANK[b.kind]
    || a.subRank - b.subRank);

  const journalEntries = sorted(
    src.journal.filter((e) => e.happenedOn === iso),
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
  );

  const first = legs[0]?.dateFrom, last = legs.reduce((m, l) => (l.dateTo > m ? l.dateTo : m), '');
  const flags: DayFlags = {
    isArrival: !!arriving,
    isDeparture: legs.some((l) => l.dateTo === iso),
    isEveOfDeparture: legs.some((l) => l.dateTo === addDays(iso, 1)),
    isFirstDayOfTrip: !!first && iso === first,
    isLastDayOfTrip: !!last && iso === last,
  };

  return {
    iso, leg, leavingLeg, dayInLeg, planDayLabel, flags, items, journalEntries,
    isEmpty: items.filter((i) => i.kind !== 'context').length === 0 && journalEntries.length === 0,
  };
}

/** Per-date kinds, driving the coloured dots on a month grid. Computed once per
 *  data change rather than per cell. A grid dot and a card can never disagree
 *  about a date because both use the same date rules as above. */
export function kindsByDate(src: AgendaSources): Map<string, Set<AgendaKind>> {
  const map = new Map<string, Set<AgendaKind>>();
  const mark = (d: string | null | undefined, k: AgendaKind) => {
    if (!d) return;
    let s = map.get(d); if (!s) map.set(d, (s = new Set()));
    s.add(k);
  };
  for (const leg of src.legs) {
    const t = leg.arrivalTransport;
    if (t?.date) mark(t.date, 'transport');
    const stays = leg.accommodations?.length ? leg.accommodations : leg.accommodation ? [leg.accommodation] : [];
    for (const a of stays) {
      const ci = datePart(a.checkIn), co = datePart(a.checkOut);
      mark(ci, 'stay'); mark(co, 'stay');
      if (ci && co) for (const d of datesBetween(ci, co)) mark(d, 'stay');
    }
    const dayDate = planDayDates(leg);
    for (const p of leg.plans ?? []) if (p.dayId) mark(dayDate.get(p.dayId), 'plan');
  }
  for (const e of src.journal) mark(e.happenedOn, 'journal');
  for (const e of src.expenses) mark(e.date, 'spend');
  for (const t of src.todos) if (!t.done) mark(t.dueDate, 'todo');
  return map;
}

/** Not-done to-dos with no due date — surfaced on today's panel. */
export function undatedTodos(todos: StoredTodo[]): StoredTodo[] {
  return todos.filter((t) => !t.done && !t.dueDate);
}
