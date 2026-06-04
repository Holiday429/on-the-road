/* ==========================================================================
   On the Road · Itinerary / Route — Firestore-backed
   --------------------------------------------------------------------------
   Two levels, one view:
     • List   — timeline grouped by country, live status colours (upcoming /
                active / past), each city card opens its detail.
     • Detail — Getting here · Stays · (Plans | Clips side-by-side) for one
                leg, plus a link out to the city's AI guide.
   ========================================================================== */

import './route.css';
import { routeStore } from '../../data/stores/route-store.ts';
import { currentTripId, listTrips, switchTrip, type StoredTrip } from '../../data/trip-context.ts';
import { navigateTo } from '../../core/app.ts';
import { createDestinationInput, type DestinationInputInstance } from '../../core/destination-input.ts';
import { openTripChooser } from '../../core/trip-chooser.ts';
import type {
  Leg as SchemaLeg, PlanItem, Clip, PlanDay, ClipCategory,
} from '../../data/schema.ts';

type Transport = NonNullable<SchemaLeg['arrivalTransport']>;
type Accommodation = NonNullable<SchemaLeg['accommodations']>[number];
type Leg = SchemaLeg & { id: string };

const TRANSPORT_ICONS: Record<string, string> = {
  flight: '✈️', train: '🚆', bus: '🚌', ferry: '⛴️',
};

const FLAG_MAP: Record<string, string> = {
  'Denmark': '🇩🇰', 'Germany': '🇩🇪', 'Netherlands': '🇳🇱',
  'Belgium': '🇧🇪', 'France': '🇫🇷', 'Spain': '🇪🇸',
  'Portugal': '🇵🇹', 'Switzerland': '🇨🇭', 'Italy': '🇮🇹',
  'Austria': '🇦🇹', 'Czech Republic': '🇨🇿', 'Poland': '🇵🇱',
  'Hungary': '🇭🇺', 'Croatia': '🇭🇷', 'Greece': '🇬🇷',
  'United Kingdom': '🇬🇧', 'Ireland': '🇮🇪', 'Norway': '🇳🇴',
  'Sweden': '🇸🇪', 'Japan': '🇯🇵', 'Thailand': '🇹🇭',
};

// Built-in clip/plan categories — user can add their own on top.
export const BUILTIN_CATEGORIES: ClipCategory[] = [
  { id: 'official',  label: '官方 / Tourism', color: '#e2edf3', order: 0 },
  { id: 'social',    label: '小红书 / Social', color: '#fde8ef', order: 1 },
  { id: 'food',      label: '美食 Food',       color: '#fef3e2', order: 2 },
  { id: 'museum',    label: '博物馆 Museum',   color: '#ece2f3', order: 3 },
  { id: 'nature',    label: '自然 Nature',     color: '#e6f3e6', order: 4 },
  { id: 'daytrip',   label: '一日游 Day trip', color: '#e2f3ec', order: 5 },
  { id: 'shopping',  label: '购物 Shopping',   color: '#f3e2e8', order: 6 },
  { id: 'other',     label: 'Other',           color: '#ebebeb', order: 7 },
];

// 10 palette colours the user can pick when creating a custom category.
export const CATEGORY_PALETTE = [
  '#fde8ef','#fef3e2','#ece2f3','#e2edf3','#e6f3e6',
  '#e2f3ec','#f3e2e8','#f3f0e2','#f0e2f3','#ebebeb',
];

function allCategories(leg: Leg): ClipCategory[] {
  const custom = leg.clipCategories ?? [];
  const customIds = new Set(custom.map(c => c.id));
  return [
    ...BUILTIN_CATEGORIES.filter(b => !customIds.has(b.id)),
    ...custom,
  ].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function categoryById(leg: Leg, id: string): ClipCategory | undefined {
  return allCategories(leg).find(c => c.id === id);
}

// Plan view modes
type PlanView = 'timeline' | 'category' | 'calendar';
let _planView: PlanView = 'timeline';

// Drag state (plan items → day columns)
let _dragItemId: string | null = null;
let _dragStartX = 0, _dragStartY = 0;
let _dragging = false;

let legs: Leg[] = [];
let addFormOpen = false;
let selectedLegId: string | null = null;   // null = list view
let _unsubRoute: (() => void) | null = null;
let _tripList: StoredTrip[] = [];          // cached for the add-form trip selector
let _countryPicker: DestinationInputInstance | null = null;
let _cityPicker: DestinationInputInstance | null = null;
let _fromPicker: DestinationInputInstance | null = null;

function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Drop undefined keys — Firestore rejects undefined values. */
function clean<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function esc(s: string | undefined): string {
  return (s ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!
  ));
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

type LegStatus = 'past' | 'active' | 'upcoming';
function legStatus(leg: Leg): LegStatus {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const from = new Date(leg.dateFrom + 'T00:00:00');
  const to = new Date(leg.dateTo + 'T00:00:00');
  if (today > to) return 'past';
  if (today >= from) return 'active';
  return 'upcoming';
}

function sortLegs(rows: Leg[]): Leg[] {
  return [...rows].sort((a, b) => {
    const byDate = a.dateFrom.localeCompare(b.dateFrom);
    if (byDate !== 0) return byDate;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

/** Stays for a leg, normalising the legacy single `accommodation` field. */
function legStays(leg: Leg): Accommodation[] {
  if (leg.accommodations?.length) {
    return [...leg.accommodations].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  if (leg.accommodation) return [{ ...leg.accommodation, id: 'legacy' }];
  return [];
}

/** Google Maps deep link: pasted URL wins, else search by name + city. */
function mapHref(a: Accommodation, leg: Leg): string {
  if (a.mapUrl) return a.mapUrl;
  const q = encodeURIComponent(`${a.name} ${leg.city}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/* ── Mutations (all async → Firestore) ──────────────────────────────────── */

async function addLeg(city: string, country: string, dateFrom: string, dateTo: string,
                      transportType: string, transportFrom: string, transportVia: string[] = []) {
  const row: Partial<SchemaLeg> & { id: string } = {
    id: uid(), city, country,
    flag: FLAG_MAP[country] ?? '🗺️',
    dateFrom, dateTo,
    order: legs.length,
  };
  if (transportType && transportFrom) {
    row.arrivalTransport = {
      type: transportType as Transport['type'],
      from: transportFrom, to: city, date: dateFrom,
      ...(transportVia.length ? { via: transportVia } : {}),
      confirmed: false,
    };
  }
  addFormOpen = false;
  await routeStore.set(clean(row));
  // render() fires from the Firestore subscription
}

async function deleteLeg(id: string) {
  if (!confirm('Remove this stop from the itinerary?')) return;
  if (selectedLegId === id) selectedLegId = null;
  await routeStore.remove(id);
}

function patchLeg(id: string, patch: Partial<SchemaLeg>) {
  return routeStore.update(id, clean(patch));
}

/** Rewrite a leg from scratch, dropping any keys listed in `omit`. Needed for
 *  true field removal — patchLeg/clean() can't send `undefined` to Firestore. */
function rewriteLeg(leg: Leg, omit: (keyof SchemaLeg)[]) {
  const next: Record<string, unknown> = { ...leg };
  for (const k of omit) delete next[k as string];
  return routeStore.set(clean(next) as Partial<SchemaLeg> & { id: string });
}

/* ── Render: list (timeline grouped by country) ─────────────────────────── */

function legSummary(leg: Leg): string {
  const t = leg.arrivalTransport;
  const stays = legStays(leg);
  const plans = leg.plans ?? [];
  const clips = leg.clips ?? [];
  const bits: string[] = [];
  if (t) bits.push(`<span class="route-sum-chip">${TRANSPORT_ICONS[t.type]} ${esc(t.from)}${t.service ? ` · ${esc(t.service)}` : ''}</span>`);
  if (stays.length) bits.push(`<span class="route-sum-chip">🏨 ${esc(stays[0].name)}${stays.length > 1 ? ` +${stays.length - 1}` : ''}</span>`);
  if (plans.length) bits.push(`<span class="route-sum-chip">✨ ${plans.length} plan${plans.length !== 1 ? 's' : ''}</span>`);
  if (clips.length) bits.push(`<span class="route-sum-chip">📎 ${clips.length} clip${clips.length !== 1 ? 's' : ''}</span>`);
  if (!bits.length) bits.push('<span class="route-sum-chip route-sum-empty">Tap to add transport, stays & plans</span>');
  return `<div class="route-leg-summary">${bits.join('')}</div>`;
}

function renderLegCard(leg: Leg): string {
  const days = daysBetween(leg.dateFrom, leg.dateTo);
  const status = legStatus(leg);
  return `
    <div class="route-leg status-${status}" data-id="${leg.id}">
      <div class="route-leg-dot"></div>
      <div class="route-leg-card" data-act="open" data-id="${leg.id}" role="button" tabindex="0">
        <div class="route-leg-header">
          <div class="route-leg-flag">${leg.flag || '🗺️'}</div>
          <div class="route-leg-info">
            <div class="route-leg-city">${esc(leg.city)}</div>
            <div class="route-leg-status-row">
              <span class="route-status-dot"></span>
              <span class="route-status-label">${status === 'active' ? 'Here now' : status === 'past' ? 'Visited' : 'Upcoming'}</span>
            </div>
          </div>
          <div class="route-leg-dates">
            <div>${fmtDate(leg.dateFrom)} → ${fmtDate(leg.dateTo)}</div>
            <div class="route-leg-duration">${days} night${days !== 1 ? 's' : ''}</div>
          </div>
          <button class="route-leg-del delete-leg" data-act="del" data-id="${leg.id}" title="Remove">✕</button>
        </div>
        ${legSummary(leg)}
      </div>
    </div>`;
}

/** Group consecutive legs by country into headed sections. */
function renderTimeline(): string {
  if (legs.length === 0) {
    return `
      ${renderAddForm()}
      ${addFormOpen ? '' : `
      <div class="route-empty">
        <div class="route-empty-icon">🗺️</div>
        <div class="route-empty-title">No stops yet</div>
        <div class="route-empty-text">Link an existing trip to pull in its stops, or add cities manually to start building your route.</div>
        <div class="route-empty-actions">
          <button class="btn btn-primary" id="route-add-toggle">＋ Add a stop</button>
          <button class="btn btn-ghost" id="route-link-trip">Link a trip</button>
        </div>
      </div>`}`;
  }

  const groups: { country: string; flag: string; legs: Leg[] }[] = [];
  for (const leg of legs) {
    const last = groups[groups.length - 1];
    if (last && last.country === leg.country) last.legs.push(leg);
    else groups.push({ country: leg.country, flag: leg.flag || FLAG_MAP[leg.country] || '🗺️', legs: [leg] });
  }

  const sections = groups.map((g) => `
    <div class="route-country-group">
      <div class="route-country-head">
        <span class="route-country-flag">${g.flag}</span>
        <span class="route-country-name">${esc(g.country)}</span>
        <span class="route-country-count">${g.legs.length} ${g.legs.length === 1 ? 'city' : 'cities'}</span>
      </div>
      ${g.legs.map(renderLegCard).join('')}
    </div>`).join('');

  return `
    ${renderAddForm()}
    ${sections}
    <div class="route-add-wrap">
      <button class="route-add-btn" id="route-add-toggle">
        <span style="font-size:20px">＋</span>
        Add a stop
      </button>
    </div>`;
}

function renderTripSelector(): string {
  if (_tripList.length === 0) return '';
  const active = currentTripId();
  const options = _tripList.map((t) =>
    `<label class="pk-scope-option">
      <input type="radio" name="raf-trip" value="${esc(t.id)}" ${t.id === active ? 'checked' : ''}>
      <span class="pk-scope-label">
        <span class="pk-scope-title">${esc(t.name)}</span>
        <span class="pk-scope-desc">${t.startDate ? `${t.startDate} → ${t.endDate ?? '…'}` : 'No dates set'}</span>
      </span>
    </label>`
  ).join('');
  return `
    <div class="raf-trip-selector">
      <div class="field-label" style="margin-bottom:var(--sp-2)">Trip</div>
      <div class="pk-scope-group">${options}</div>
    </div>`;
}

function renderAddForm(): string {
  return `
    <div class="route-add-form ${addFormOpen ? 'open' : ''}" id="route-add-form">
      <div class="route-add-form-title">Add a stop</div>
      ${renderTripSelector()}
      <div class="route-add-form-grid">
        <div>
          <label class="field-label">Country</label>
          <div id="raf-country-mount"></div>
        </div>
        <div>
          <label class="field-label">City</label>
          <div id="raf-city-mount"></div>
        </div>
        <div>
          <label class="field-label">Arrival date</label>
          <input class="input" type="date" id="raf-from">
        </div>
        <div>
          <label class="field-label">Departure date</label>
          <input class="input" type="date" id="raf-to">
        </div>
        <div>
          <label class="field-label">Arrive by</label>
          <select class="input select" id="raf-transport">
            <option value="">Not set</option>
            <option value="train">🚆 Train</option>
            <option value="flight">✈️ Flight</option>
            <option value="bus">🚌 Bus</option>
            <option value="ferry">⛴️ Ferry</option>
          </select>
        </div>
        <div>
          <label class="field-label">Coming from</label>
          <div id="raf-from-mount"></div>
        </div>
      </div>
      <div class="route-add-form-btns">
        <button class="btn btn-ghost" id="raf-cancel">Cancel</button>
        <button class="btn btn-primary" id="raf-save">Add stop</button>
      </div>
    </div>`;
}

/* ── Render: detail ─────────────────────────────────────────────────────── */

function renderTransportSection(leg: Leg): string {
  const t = leg.arrivalTransport;
  const body = t ? `
    <div class="rd-transport">
      <div class="rd-transport-icon">${TRANSPORT_ICONS[t.type]}</div>
      <div class="rd-transport-main">
        <div class="rd-transport-route">${esc(t.from)} → ${esc(t.to)}</div>
        <div class="rd-transport-meta">
          ${t.service ? `<span>${esc(t.service)}</span>` : ''}
          ${t.time ? `<span>🕑 ${esc(t.time)}${t.arrivalTime ? `–${esc(t.arrivalTime)}` : ''}</span>` : ''}
          ${t.duration ? `<span>⏱ ${esc(t.duration)}</span>` : ''}
          ${t.price ? `<span>💰 ${esc(t.price)}</span>` : ''}
        </div>
        ${(t.depPlace || t.arrPlace) ? `<div class="rd-transport-meta">${t.depPlace ? `<span>📍 ${esc(t.depPlace)}</span>` : ''}${t.arrPlace ? `<span>🏁 ${esc(t.arrPlace)}</span>` : ''}</div>` : ''}
        ${t.bookingRef ? `<div class="rd-transport-meta"><span>🎫 ${esc(t.bookingRef)}</span></div>` : ''}
        ${t.notes ? `<div class="rd-transport-note">${esc(t.notes)}</div>` : ''}
      </div>
      <span class="badge ${t.confirmed ? 'badge-green' : 'badge-gray'}" data-act="toggle-transport-confirmed" role="button" tabindex="0">
        ${t.confirmed ? '✓ Booked' : 'Not booked'}
      </span>
    </div>
    <div class="rd-section-actions">
      <button class="btn btn-ghost rd-sm" data-act="edit-transport">Edit transport</button>
      <button class="btn btn-ghost rd-sm rd-danger" data-act="del-transport">Remove</button>
    </div>` : `
    <div class="rd-placeholder">
      <span>No transport added yet.</span>
      <button class="btn btn-primary rd-sm" data-act="edit-transport">＋ Add transport</button>
    </div>`;

  return `
    <section class="rd-section">
      <div class="rd-section-head"><h3>🚆 Getting here</h3></div>
      ${body}
    </section>`;
}

function renderStaysSection(leg: Leg): string {
  const stays = legStays(leg);
  const rows = stays.map((a, i) => `
    <div class="rd-stay" data-stay="${a.id ?? i}">
      <div class="rd-stay-order">${i + 1}</div>
      <div class="rd-stay-main">
        <div class="rd-stay-name">${esc(a.name)}</div>
        <div class="rd-stay-meta">
          ${(a.checkIn || a.checkOut) ? `<span>📅 ${a.checkIn ? fmtDate(a.checkIn) : '?'} → ${a.checkOut ? fmtDate(a.checkOut) : '?'}</span>` : ''}
          ${a.price ? `<span>💰 ${esc(a.price)}/night</span>` : ''}
          ${a.phone ? `<span>📞 ${esc(a.phone)}</span>` : ''}
          <span class="badge ${a.confirmed ? 'badge-green' : 'badge-gray'}">${a.confirmed ? '✓ Confirmed' : 'Not confirmed'}</span>
        </div>
      </div>
      <div class="rd-stay-actions">
        <a class="rd-map-btn" href="${esc(mapHref(a, leg))}" target="_blank" rel="noopener" title="Navigate in Google Maps">📍 Navigate</a>
        <button class="rd-icon-btn" data-act="edit-stay" data-stay="${a.id ?? i}" title="Edit">✎</button>
        <button class="rd-icon-btn rd-danger" data-act="del-stay" data-stay="${a.id ?? i}" title="Remove">✕</button>
      </div>
    </div>`).join('');

  return `
    <section class="rd-section">
      <div class="rd-section-head">
        <h3>🏨 Stays</h3>
        <button class="btn btn-ghost rd-sm" data-act="add-stay">＋ Add stay</button>
      </div>
      ${stays.length ? `<div class="rd-stay-list">${rows}</div>`
        : `<div class="rd-placeholder"><span>No stays added. One city can hold several — they'll list in order.</span></div>`}
    </section>`;
}

/* ── Category helpers ────────────────────────────────────────────────────── */


function categorySelectOptions(leg: Leg, selected: string): string {
  return `<option value="">— category —</option>` +
    allCategories(leg).map(c =>
      `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.label)}</option>`
    ).join('');
}

/* ── Clips section ───────────────────────────────────────────────────────── */

function renderClipsSection(leg: Leg): string {
  const clips = [...(leg.clips ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const cats = allCategories(leg);

  // active filter stored in data attr of the section element; default = ''
  const filterAttr = `data-clip-filter=""`;

  const card = (c: Clip) => {
    const cat = c.category ? categoryById(leg, c.category) : undefined;
    const color = cat?.color ?? '#ebebeb';
    return `
    <div class="rd-clip-card" data-clip="${esc(c.id)}" data-clip-cat="${esc(c.category ?? '')}">
      <div class="rd-clip-card-color" style="background:${esc(color)}"></div>
      <div class="rd-clip-card-body">
        <div class="rd-clip-card-top">
          ${cat ? `<span class="rd-cat-badge rd-cat-badge--sm" style="background:${esc(color)}">${esc(cat.label)}</span>` : ''}
          <div class="rd-clip-card-actions">
            <button class="rd-icon-btn" data-act="clip-to-plan" data-clip="${esc(c.id)}" title="提炼为 Plan">→✨</button>
            <button class="rd-icon-btn" data-act="edit-clip" data-clip="${esc(c.id)}" title="Edit">✎</button>
            <button class="rd-icon-btn rd-danger" data-act="del-clip" data-clip="${esc(c.id)}" title="Remove">✕</button>
          </div>
        </div>
        ${c.url
          ? `<a class="rd-clip-card-title" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title || c.url)}</a>`
          : `<div class="rd-clip-card-title">${esc(c.title || 'Note')}</div>`}
        ${c.body ? `<div class="rd-clip-card-body-text">${esc(c.body)}</div>` : ''}
      </div>
    </div>`;
  };

  const filterBar = `
    <div class="rd-filter-bar" id="rd-clip-filter-bar">
      <button class="rd-filter-chip is-active" data-filter="">All</button>
      ${cats.filter(c => clips.some(cl => cl.category === c.id)).map(c =>
        `<button class="rd-filter-chip" data-filter="${esc(c.id)}" style="--chip-color:${esc(c.color)}">${esc(c.label)}</button>`
      ).join('')}
      <button class="rd-filter-chip rd-filter-chip--add" data-act="add-clip-category" title="New category">＋ 分类</button>
    </div>`;

  return `
    <section class="rd-section" id="rd-clips-section" ${filterAttr}>
      <div class="rd-section-head">
        <h3>📎 Clips</h3>
        <button class="btn btn-ghost rd-sm" data-act="open-add-clip">＋ Add clip</button>
      </div>
      ${filterBar}
      ${clips.length
        ? `<div class="rd-clip-grid">${clips.map(card).join('')}</div>`
        : `<div class="rd-placeholder rd-placeholder-soft"><span>从小红书、旅游局等来源收集信息，按类别整理成卡片。</span></div>`}
    </section>`;
}

/* ── Notes section ───────────────────────────────────────────────────────── */

function renderNotesSection(leg: Leg): string {
  return `
    <section class="rd-section rd-section-notes">
      <div class="rd-section-head">
        <h3>📝 Notes</h3>
      </div>
      <textarea class="input rd-notes-area" id="rd-notes" placeholder="Write anything — ideas, reminders, impressions…">${esc(leg.notes ?? '')}</textarea>
    </section>`;
}

/* ── Plan section ────────────────────────────────────────────────────────── */

/** Ensure planDays covers every night of the leg. Returns the canonical list. */
function ensurePlanDays(leg: Leg): PlanDay[] {
  const total = daysBetween(leg.dateFrom, leg.dateTo);
  const existing = [...(leg.planDays ?? [])].sort((a, b) => a.order - b.order);

  // Build expected day list from leg dates
  const expected: PlanDay[] = Array.from({ length: total }, (_, i) => {
    const d = new Date(leg.dateFrom + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const found = existing.find(e => e.date === iso);
    return found ?? { id: `day-${iso}`, date: iso, label: '', notes: '', order: i };
  });
  return expected;
}

function renderPlanItem(p: PlanItem, leg: Leg): string {
  const cat = p.category ? categoryById(leg, p.category) : undefined;
  const color = cat?.color ?? '#f0f0f0';
  return `
    <div class="rd-plan-tag ${p.done ? 'is-done' : ''}" data-id="${esc(p.id)}" data-drag="plan-item">
      <button class="rd-plan-tag-check" data-act="toggle-plan" data-plan="${esc(p.id)}" title="Mark done">
        ${p.done ? '✓' : ''}
      </button>
      <span class="rd-plan-tag-dot" style="background:${esc(color)}"></span>
      <span class="rd-plan-tag-name">${esc(p.title)}</span>
      <button class="rd-plan-tag-open" data-act="open-plan" data-plan="${esc(p.id)}" title="Details">›</button>
    </div>`;
}

function renderPlanTimelineView(leg: Leg): string {
  const days = ensurePlanDays(leg);
  const plans = leg.plans ?? [];
  const unassigned = plans.filter(p => !p.dayId).sort((a, b) => a.order - b.order);

  const dayCol = (day: PlanDay, idx: number) => {
    const items = plans.filter(p => p.dayId === day.id).sort((a, b) => a.order - b.order);
    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return `
      <div class="rd-plan-day-col">
        <div class="rd-plan-day-head">
          <span class="rd-plan-day-num">Day ${idx + 1}</span>
          <span class="rd-plan-day-date">${dateLabel}</span>
          ${day.label ? `<span class="rd-plan-day-label">${esc(day.label)}</span>` : ''}
        </div>
        <div class="rd-plan-drop-zone pk-drop-zone" data-day-id="${esc(day.id)}">
          ${items.map(p => renderPlanItem(p, leg)).join('')}
          ${items.length === 0 ? `<div class="rd-plan-drop-hint">Drop here</div>` : ''}
        </div>
      </div>`;
  };

  return `
    <div class="rd-plan-timeline-wrap">
      <div class="rd-plan-columns">
        <div class="rd-plan-day-col rd-plan-unassigned">
          <div class="rd-plan-day-head">
            <span class="rd-plan-day-num">待定</span>
            <span class="rd-plan-day-date">Unassigned</span>
          </div>
          <div class="rd-plan-drop-zone pk-drop-zone" data-day-id="">
            ${unassigned.map(p => renderPlanItem(p, leg)).join('')}
            ${unassigned.length === 0 ? `<div class="rd-plan-drop-hint">New items start here</div>` : ''}
          </div>
        </div>
        ${days.map((d, i) => dayCol(d, i)).join('')}
      </div>
    </div>
    <div id="rd-plan-drag-ghost" class="rd-plan-drag-ghost" hidden></div>`;
}

function renderPlanCategoryView(leg: Leg): string {
  const plans = leg.plans ?? [];
  if (!plans.length) return `<div class="rd-placeholder rd-placeholder-soft"><span>添加事项后可在此按类别查看。</span></div>`;

  const days = ensurePlanDays(leg);
  const dayLabel = (dayId: string | null | undefined) => {
    if (!dayId) return '待定';
    const idx = days.findIndex(d => d.id === dayId);
    return idx >= 0 ? `Day ${idx + 1}` : '待定';
  };

  const cats = allCategories(leg);
  const groups = cats.map(cat => {
    const items = plans.filter(p => (p.category || 'other') === cat.id).sort((a, b) => a.order - b.order);
    if (!items.length) return '';
    return `
      <div class="rd-plan-cat-group">
        <div class="rd-plan-cat-head">
          <span class="rd-cat-badge" style="background:${esc(cat.color)}">${esc(cat.label)}</span>
          <span class="rd-plan-cat-count">${items.length}</span>
        </div>
        <div class="rd-plan-cat-rows">
          ${items.map(p => `
            <div class="rd-plan-cat-row ${p.done ? 'is-done' : ''}" data-plan="${esc(p.id)}">
              <button class="rd-plan-tag-check" data-act="toggle-plan" data-plan="${esc(p.id)}">${p.done ? '✓' : ''}</button>
              <span class="rd-plan-cat-title">${esc(p.title)}</span>
              <span class="rd-plan-cat-day">${dayLabel(p.dayId)}</span>
              <button class="rd-icon-btn rd-sm" data-act="open-plan" data-plan="${esc(p.id)}">›</button>
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');

  return `<div class="rd-plan-cat-list">${groups || '<div class="rd-placeholder rd-placeholder-soft"><span>No items yet.</span></div>'}</div>`;
}

function renderPlanCalendarView(leg: Leg): string {
  const days = ensurePlanDays(leg);
  const plans = leg.plans ?? [];

  const dayBlock = (day: PlanDay, idx: number) => {
    const items = plans.filter(p => p.dayId === day.id).sort((a, b) => a.order - b.order);
    const d = new Date(day.date + 'T00:00:00');
    const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
    const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    const isToday = day.date === new Date().toISOString().slice(0, 10);
    return `
      <div class="rd-cal-day ${isToday ? 'is-today' : ''}">
        <div class="rd-cal-day-head">
          <div class="rd-cal-day-num">Day ${idx + 1}${isToday ? ' · Today' : ''}</div>
          <div class="rd-cal-day-date">${weekday}, ${dateStr}</div>
          ${day.label ? `<div class="rd-cal-day-label">${esc(day.label)}</div>` : ''}
        </div>
        ${day.notes ? `<div class="rd-cal-day-notes">${esc(day.notes)}</div>` : ''}
        ${items.length ? `
          <div class="rd-cal-day-items">
            ${items.map(p => {
              const cat = p.category ? categoryById(leg, p.category) : undefined;
              const color = cat?.color ?? '#ebebeb';
              return `
                <div class="rd-cal-item ${p.done ? 'is-done' : ''}" data-plan="${esc(p.id)}">
                  <button class="rd-plan-tag-check" data-act="toggle-plan" data-plan="${esc(p.id)}">${p.done ? '✓' : ''}</button>
                  <span class="rd-cal-item-dot" style="background:${esc(color)}"></span>
                  <span class="rd-cal-item-title">${esc(p.title)}</span>
                  ${p.duration ? `<span class="rd-cal-item-meta">${esc(p.duration)}</span>` : ''}
                  <button class="rd-icon-btn" data-act="open-plan" data-plan="${esc(p.id)}">›</button>
                </div>`;
            }).join('')}
          </div>` : `<div class="rd-cal-day-empty">Nothing planned yet — drag items here from Timeline.</div>`}
      </div>`;
  };

  return `<div class="rd-cal-list">${days.map((d, i) => dayBlock(d, i)).join('')}</div>`;
}

function renderPlansSection(leg: Leg): string {
  const views: { id: PlanView; label: string }[] = [
    { id: 'timeline', label: '📋 Timeline' },
    { id: 'category', label: '🏷️ Category' },
    { id: 'calendar', label: '📅 Calendar' },
  ];

  const cats = allCategories(leg);
  const catOptions = `<option value="">— category —</option>` +
    cats.map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('');

  let body = '';
  if (_planView === 'timeline') body = renderPlanTimelineView(leg);
  else if (_planView === 'category') body = renderPlanCategoryView(leg);
  else body = renderPlanCalendarView(leg);

  return `
    <section class="rd-section" id="rd-plan-section">
      <div class="rd-section-head">
        <h3>✨ Plan</h3>
        <div class="rd-view-tabs">
          ${views.map(v => `<button class="rd-view-tab ${_planView === v.id ? 'is-active' : ''}" data-act="plan-view" data-view="${v.id}">${v.label}</button>`).join('')}
        </div>
      </div>
      ${body}
      <div class="rd-plan-add-row">
        <input class="input rd-add-input" id="rd-plan-input" placeholder="Add a plan item…">
        <select class="input select" id="rd-plan-cat">${catOptions}</select>
        <button class="btn btn-primary rd-sm" data-act="add-plan">Add</button>
      </div>
    </section>`;
}

function renderDetail(leg: Leg): string {
  const days = daysBetween(leg.dateFrom, leg.dateTo);
  const status = legStatus(leg);
  return `
    <div class="rd-shell status-${status}">
      <div class="rd-topbar">
        <button class="btn btn-ghost rd-back" data-act="back">← All stops</button>
        <div class="rd-title">
          <span class="rd-title-flag">${leg.flag || '🗺️'}</span>
          <span class="rd-title-city">${esc(leg.city)}</span>
          <span class="rd-title-country">${esc(leg.country)}</span>
        </div>
        <button class="btn btn-ghost rd-sm rd-guide-link" data-act="open-guide">${leg.flag || ''} City guide ↗</button>
      </div>
      <div class="rd-datebar">
        <span class="rd-status-pill status-${status}">${status === 'active' ? 'Here now' : status === 'past' ? 'Visited' : 'Upcoming'}</span>
        <span>${fmtDate(leg.dateFrom)} → ${fmtDate(leg.dateTo)} · ${days} night${days !== 1 ? 's' : ''}</span>
      </div>
      <div class="rd-detail-layout">
        <div class="rd-detail-grid rd-detail-grid--top">
          ${renderTransportSection(leg)}
          ${renderStaysSection(leg)}
        </div>
        ${renderClipsSection(leg)}
        ${renderPlansSection(leg)}
        ${renderNotesSection(leg)}
      </div>
    </div>`;
}

/* ── Render root ────────────────────────────────────────────────────────── */

function render() {
  const root = document.getElementById('view-route');
  if (!root) return;
  const timeline = root.querySelector<HTMLElement>('.route-timeline')!;

  const selected = selectedLegId ? legs.find((l) => l.id === selectedLegId) : null;
  if (selectedLegId && !selected) selectedLegId = null;

  timeline.innerHTML = selected ? renderDetail(selected) : renderTimeline();
  timeline.classList.toggle('is-detail', !!selected);

  if (selected) wireDetail(timeline, selected);
  else wireList(timeline);
}

/* ── Wiring: list ───────────────────────────────────────────────────────── */

function destroyPickers() {
  _countryPicker?.destroy(); _countryPicker = null;
  _cityPicker?.destroy();    _cityPicker = null;
  _fromPicker?.destroy();    _fromPicker = null;
}

async function openAddForm(timeline: HTMLElement) {
  addFormOpen = true;
  try { _tripList = await listTrips(); } catch { _tripList = []; }
  render();
  mountAddFormPickers(timeline);
  timeline.querySelector('#route-add-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function mountAddFormPickers(timeline: HTMLElement) {
  destroyPickers();
  const countryMount = timeline.querySelector<HTMLElement>('#raf-country-mount');
  const cityMount    = timeline.querySelector<HTMLElement>('#raf-city-mount');
  if (countryMount) {
    _countryPicker = createDestinationInput({
      container: countryMount,
      placeholder: 'e.g. Czech Republic',
      maxTags: 1,
    });
  }
  if (cityMount) {
    _cityPicker = createDestinationInput({
      container: cityMount,
      placeholder: 'e.g. Prague',
      maxTags: 1,
    });
  }
  const fromMount = timeline.querySelector<HTMLElement>('#raf-from-mount');
  if (fromMount) {
    // Multiple tags = connecting trip (联程): first is the origin, the rest are
    // stopovers in order, e.g. Harbin · Beijing → (destination).
    _fromPicker = createDestinationInput({
      container: fromMount,
      placeholder: 'Origin, then any stopovers',
    });
  }
}

function wireList(timeline: HTMLElement) {
  timeline.querySelector('#route-add-toggle')?.addEventListener('click', () => openAddForm(timeline));
  timeline.querySelector('#route-link-trip')?.addEventListener('click', () => {
    openTripChooser({ title: 'Link a trip', subtitle: 'Linking a trip pulls in its stops so you can build your route.' });
  });

  timeline.querySelector('#raf-cancel')?.addEventListener('click', () => {
    destroyPickers();
    addFormOpen = false;
    render();
  });

  timeline.querySelector('#raf-save')?.addEventListener('click', async () => {
    const val = (id: string) => (timeline.querySelector('#' + id) as HTMLInputElement | HTMLSelectElement)?.value ?? '';
    const country = _countryPicker?.getValues()[0] ?? '';
    const city    = _cityPicker?.getValues()[0]    ?? '';
    const from = val('raf-from'), to = val('raf-to');
    const tType = val('raf-transport');
    const fromChain = _fromPicker?.getValues() ?? [];
    const tFrom = fromChain[0] ?? '';
    const tVia  = fromChain.slice(1);   // connecting-flight stopovers (联程)
    if (!city || !from || !to) { alert('Please fill in city and both dates.'); return; }
    const chosenTripId = (timeline.querySelector<HTMLInputElement>('input[name="raf-trip"]:checked'))?.value;
    if (chosenTripId && chosenTripId !== currentTripId()) {
      await switchTrip(chosenTripId);
    }
    destroyPickers();
    addLeg(city, country, from, to, tType, tFrom, tVia);
  });

  timeline.querySelectorAll<HTMLElement>('[data-act="open"]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="del"]')) return;
      selectedLegId = card.dataset.id!;
      addFormOpen = false;
      render();
      timeline.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    card.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') { selectedLegId = card.dataset.id!; render(); }
    });
  });

  timeline.querySelectorAll<HTMLElement>('[data-act="del"]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteLeg(btn.dataset.id!); });
  });
}

/* ── Wiring: detail ─────────────────────────────────────────────────────── */

function persistStays(leg: Leg, stays: Accommodation[]) {
  const reindexed = stays.map((s, i) => ({ ...s, order: i }));
  return patchLeg(leg.id, { accommodations: reindexed });
}

function wireDetail(timeline: HTMLElement, leg: Leg) {
  const on = (act: string, fn: (el: HTMLElement, e: Event) => void) => {
    timeline.querySelectorAll<HTMLElement>(`[data-act="${act}"]`).forEach((el) => {
      el.addEventListener('click', (e) => fn(el, e));
    });
  };

  on('back', () => { selectedLegId = null; render(); });
  on('open-guide', () => navigateTo('cities'));

  /* — Transport — */
  on('toggle-transport-confirmed', () => {
    if (!leg.arrivalTransport) return;
    patchLeg(leg.id, { arrivalTransport: { ...leg.arrivalTransport, confirmed: !leg.arrivalTransport.confirmed } });
  });
  on('del-transport', () => {
    if (confirm('Remove transport details for this stop?')) rewriteLeg(leg, ['arrivalTransport']);
  });
  on('edit-transport', () => openTransportEditor(timeline, leg));

  /* — Stays — */
  on('add-stay', () => openStayEditor(timeline, leg, null));
  on('edit-stay', (el) => openStayEditor(timeline, leg, el.dataset.stay!));
  on('del-stay', (el) => {
    const stays = legStays(leg);
    const key = el.dataset.stay!;
    const next = stays.filter((s, i) => (s.id ?? String(i)) !== key);
    if (confirm('Remove this stay?')) persistStays(leg, next);
  });

  /* — Notes — */
  const notesArea = timeline.querySelector<HTMLTextAreaElement>('#rd-notes');
  if (notesArea) {
    let notesTimer: ReturnType<typeof setTimeout>;
    notesArea.addEventListener('input', () => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => patchLeg(leg.id, { notes: notesArea.value }), 800);
    });
  }

  /* — Clips — */
  on('open-add-clip', () => openClipEditor(timeline, leg, null));
  on('edit-clip', (el) => openClipEditor(timeline, leg, el.dataset.clip!));
  on('del-clip', (el) => {
    const id = el.dataset.clip!;
    if (confirm('Remove this clip?')) patchLeg(leg.id, { clips: (leg.clips ?? []).filter(c => c.id !== id) });
  });
  on('clip-to-plan', (el) => {
    const id = el.dataset.clip!;
    const clip = (leg.clips ?? []).find(c => c.id === id);
    if (!clip) return;
    const plans = leg.plans ?? [];
    const next: PlanItem = {
      id: uid(), title: clip.title || clip.url || 'Untitled',
      note: clip.body, category: clip.category ?? '', dayId: null,
      done: false, order: plans.length,
    };
    patchLeg(leg.id, { plans: [...plans, next] });
  });
  on('add-clip-category', () => openCategoryEditor(timeline, leg));

  // Clip filter chips
  const clipFilterBar = timeline.querySelector<HTMLElement>('#rd-clip-filter-bar');
  if (clipFilterBar) {
    clipFilterBar.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('.rd-filter-chip[data-filter]');
      if (!chip) return;
      const filter = chip.dataset.filter!;
      clipFilterBar.querySelectorAll('.rd-filter-chip').forEach(c => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      const grid = timeline.querySelector<HTMLElement>('.rd-clip-grid');
      if (!grid) return;
      grid.querySelectorAll<HTMLElement>('.rd-clip-card').forEach(card => {
        card.hidden = filter !== '' && card.dataset.clipCat !== filter;
      });
    });
  }

  /* — Plan view tabs — */
  on('plan-view', (el) => {
    _planView = el.dataset.view as PlanView;
    render();
  });

  /* — Plan add — */
  on('add-plan', () => {
    const input = timeline.querySelector<HTMLInputElement>('#rd-plan-input');
    const catSel = timeline.querySelector<HTMLSelectElement>('#rd-plan-cat');
    const title = input?.value.trim() ?? '';
    if (!title) return;
    const plans = leg.plans ?? [];
    const next: PlanItem = {
      id: uid(), title,
      category: catSel?.value ?? '',
      dayId: null, done: false, order: plans.length,
    };
    if (input) input.value = '';
    patchLeg(leg.id, { plans: [...plans, next] });
  });
  timeline.querySelector('#rd-plan-input')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') (timeline.querySelector('[data-act="add-plan"]') as HTMLElement)?.click();
  });

  /* — Plan item actions — */
  on('toggle-plan', (el) => {
    const id = el.dataset.plan!;
    const plans = (leg.plans ?? []).map(p => p.id === id ? { ...p, done: !p.done } : p);
    patchLeg(leg.id, { plans });
  });
  on('open-plan', (el) => openPlanItemDrawer(timeline, leg, el.dataset.plan!));
  on('del-plan', (el) => {
    const id = el.dataset.plan!;
    patchLeg(leg.id, { plans: (leg.plans ?? []).filter(p => p.id !== id) });
  });

  /* — Plan drag to day — */
  wirePlanDrag(timeline, leg);
}

/* ── Plan drag (pointer-based, same pattern as pack.ts) ─────────────────── */

function wirePlanDrag(timeline: HTMLElement, leg: Leg) {
  const ghost = timeline.querySelector<HTMLElement>('#rd-plan-drag-ghost')!;
  if (!ghost) return;

  function findDropZone(x: number, y: number): { el: HTMLElement; dayId: string | null } | null {
    for (const zone of timeline.querySelectorAll<HTMLElement>('.rd-plan-drop-zone')) {
      const r = zone.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const raw = zone.dataset.dayId;
        return { el: zone, dayId: raw === '' ? null : (raw ?? null) };
      }
    }
    return null;
  }

  function onMove(e: PointerEvent) {
    if (!_dragItemId) return;
    const dx = e.clientX - _dragStartX, dy = e.clientY - _dragStartY;
    if (!_dragging && Math.hypot(dx, dy) > 6) {
      _dragging = true;
      ghost.removeAttribute('hidden');
      const tag = timeline.querySelector<HTMLElement>(`[data-id="${_dragItemId}"][data-drag="plan-item"]`);
      ghost.textContent = tag?.querySelector('.rd-plan-tag-name')?.textContent ?? '';
      document.body.style.cursor = 'grabbing';
    }
    if (_dragging) {
      ghost.style.left = `${e.clientX + 12}px`;
      ghost.style.top  = `${e.clientY - 12}px`;
      timeline.querySelectorAll('.rd-plan-drop-zone').forEach(z => z.classList.remove('is-drag-over'));
      findDropZone(e.clientX, e.clientY)?.el.classList.add('is-drag-over');
    }
  }

  function onUp(e: PointerEvent) {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.body.style.cursor = '';
    ghost.setAttribute('hidden', '');
    timeline.querySelectorAll('.rd-plan-drop-zone').forEach(z => z.classList.remove('is-drag-over'));

    if (_dragging && _dragItemId) {
      const zone = findDropZone(e.clientX, e.clientY);
      if (zone) {
        const plans = (leg.plans ?? []).map(p =>
          p.id === _dragItemId ? { ...p, dayId: zone.dayId } : p
        );
        patchLeg(leg.id, { plans: clean(plans) });
      }
    }
    _dragItemId = null;
    _dragging = false;
  }

  timeline.querySelectorAll<HTMLElement>('[data-drag="plan-item"]').forEach(tag => {
    tag.addEventListener('pointerdown', e => {
      if ((e.target as HTMLElement).closest('button')) return;
      _dragItemId = tag.dataset.id!;
      _dragStartX = e.clientX;
      _dragStartY = e.clientY;
      _dragging = false;
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });
}

/* ── Plan item detail drawer ─────────────────────────────────────────────── */

function openPlanItemDrawer(timeline: HTMLElement, leg: Leg, planId: string) {
  const p = (leg.plans ?? []).find(x => x.id === planId);
  if (!p) return;

  timeline.querySelector('.rd-plan-drawer')?.remove();
  const drawer = document.createElement('div');
  drawer.className = 'rd-plan-drawer';

  const catOptions = categorySelectOptions(leg, p.category ?? '');

  drawer.innerHTML = `
    <div class="rd-drawer-inner">
      <div class="rd-drawer-header">
        <button class="rd-plan-tag-check ${p.done ? 'is-done' : ''}" id="drw-done" title="Toggle done">${p.done ? '✓' : ''}</button>
        <input class="rd-drawer-title-input input" id="drw-title" value="${esc(p.title)}" placeholder="Item title">
        <button class="rd-icon-btn rd-danger" id="drw-del" title="Delete">✕</button>
        <button class="rd-icon-btn" id="drw-close" title="Close">✕</button>
      </div>
      <div class="rd-drawer-body">
        <div class="rd-drawer-row">
          <label class="field-label">Category</label>
          <select class="input select" id="drw-cat">${catOptions}</select>
        </div>
        <div class="rd-drawer-row">
          <label class="field-label">Notes</label>
          <textarea class="input rd-drawer-note" id="drw-note" placeholder="Jot what you know about this place…">${esc(p.note ?? '')}</textarea>
        </div>
        <div class="rd-drawer-row-2col">
          <div>
            <label class="field-label">Duration</label>
            <input class="input" id="drw-duration" value="${esc(p.duration ?? '')}" placeholder="e.g. 2h">
          </div>
          <div>
            <label class="field-label">Est. cost</label>
            <input class="input" id="drw-cost" value="${esc(p.cost ?? '')}" placeholder="e.g. €15">
          </div>
        </div>
        <div class="rd-drawer-row">
          <label class="field-label">Maps link</label>
          <input class="input" id="drw-map" value="${esc(p.mapUrl ?? '')}" placeholder="Paste Google Maps URL">
        </div>
        ${p.address ? `<div class="rd-drawer-row"><label class="field-label">Address</label><input class="input" id="drw-addr" value="${esc(p.address)}"></div>` : ''}
      </div>
      <div class="rd-drawer-footer">
        <button class="btn btn-ghost rd-sm" id="drw-close2">Close</button>
        <button class="btn btn-primary rd-sm" id="drw-save">Save</button>
      </div>
    </div>`;

  timeline.querySelector('.rd-shell')!.appendChild(drawer);

  const save = () => {
    const patch: Partial<PlanItem> = {
      title: (drawer.querySelector<HTMLInputElement>('#drw-title'))!.value.trim() || p.title,
      category: (drawer.querySelector<HTMLSelectElement>('#drw-cat'))!.value,
      note: (drawer.querySelector<HTMLTextAreaElement>('#drw-note'))!.value.trim() || undefined,
      duration: (drawer.querySelector<HTMLInputElement>('#drw-duration'))!.value.trim() || undefined,
      cost: (drawer.querySelector<HTMLInputElement>('#drw-cost'))!.value.trim() || undefined,
      mapUrl: (drawer.querySelector<HTMLInputElement>('#drw-map'))!.value.trim() || undefined,
    };
    const plans = (leg.plans ?? []).map(x => x.id === planId ? { ...x, ...patch } : x);
    patchLeg(leg.id, { plans: clean(plans) });
    drawer.remove();
  };

  drawer.querySelector('#drw-save')?.addEventListener('click', save);
  drawer.querySelector('#drw-close')?.addEventListener('click', () => drawer.remove());
  drawer.querySelector('#drw-close2')?.addEventListener('click', () => drawer.remove());
  drawer.querySelector('#drw-del')?.addEventListener('click', () => {
    if (confirm('Delete this plan item?')) {
      patchLeg(leg.id, { plans: (leg.plans ?? []).filter(x => x.id !== planId) });
      drawer.remove();
    }
  });
  drawer.querySelector('#drw-done')?.addEventListener('click', () => {
    const plans = (leg.plans ?? []).map(x => x.id === planId ? { ...x, done: !x.done } : x);
    patchLeg(leg.id, { plans });
    drawer.remove();
  });
}

/* ── Clip editor (add / edit) ────────────────────────────────────────────── */

function openClipEditor(timeline: HTMLElement, leg: Leg, clipId: string | null) {
  const existing = clipId ? (leg.clips ?? []).find(c => c.id === clipId) : undefined;
  const host = timeline.querySelector<HTMLElement>('.rd-shell')!;
  const dlg = document.createElement('div');
  dlg.className = 'rd-editor-overlay';

  const catOptions = categorySelectOptions(leg, existing?.category ?? '');

  dlg.innerHTML = `
    <div class="rd-editor">
      <div class="rd-editor-title">${existing ? 'Edit clip' : 'Add clip'}</div>
      <div class="rd-editor-grid">
        <div class="field-full">
          <label class="field-label">Title</label>
          <input class="input" id="ce-title" value="${esc(existing?.title)}" placeholder="e.g. 哥本哈根必去博物馆">
        </div>
        <div class="field-full">
          <label class="field-label">Link (optional)</label>
          <input class="input" id="ce-url" value="${esc(existing?.url)}" placeholder="https://…">
        </div>
        <div class="field-full">
          <label class="field-label">Notes</label>
          <textarea class="input rd-add-area" id="ce-body" placeholder="Key points, what caught your eye…">${esc(existing?.body ?? '')}</textarea>
        </div>
        <div class="field-full">
          <label class="field-label">Category</label>
          <select class="input select" id="ce-cat">${catOptions}</select>
        </div>
      </div>
      <div class="rd-editor-btns">
        <button class="btn btn-ghost" data-ed="cancel">Cancel</button>
        <button class="btn btn-primary" data-ed="save">${existing ? 'Save' : 'Add clip'}</button>
      </div>
    </div>`;
  host.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('[data-ed="cancel"]')!.addEventListener('click', close);
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  dlg.querySelector('[data-ed="save"]')!.addEventListener('click', () => {
    const title = fieldVal(dlg, 'ce-title');
    const url = fieldVal(dlg, 'ce-url');
    const body = fieldVal(dlg, 'ce-body');
    const category = (dlg.querySelector('#ce-cat') as HTMLSelectElement).value;
    if (!title && !url && !body) { alert('Add at least a title or link.'); return; }
    const clips = leg.clips ?? [];
    if (existing) {
      const next = clips.map(c => c.id === clipId
        ? { ...c, title: title || undefined, url: url || undefined, body: body || undefined, category }
        : c);
      patchLeg(leg.id, { clips: clean(next) });
    } else {
      const next: Clip = {
        id: uid(), kind: url ? 'link' : 'note',
        title: title || undefined, url: url || undefined,
        body: body || undefined, category, order: clips.length,
      };
      patchLeg(leg.id, { clips: clean([...clips, next]) });
    }
    close();
  });
}

/* ── Category editor ─────────────────────────────────────────────────────── */

function openCategoryEditor(timeline: HTMLElement, leg: Leg) {
  const host = timeline.querySelector<HTMLElement>('.rd-shell')!;
  const dlg = document.createElement('div');
  dlg.className = 'rd-editor-overlay';

  const paletteSwatches = CATEGORY_PALETTE.map(c =>
    `<button class="rd-cat-swatch" data-color="${c}" style="background:${c}" type="button"></button>`
  ).join('');

  dlg.innerHTML = `
    <div class="rd-editor" style="max-width:380px">
      <div class="rd-editor-title">New category</div>
      <div style="margin-bottom:var(--sp-3)">
        <label class="field-label">Name</label>
        <input class="input" id="cate-name" placeholder="e.g. 夜生活 Nightlife">
      </div>
      <div style="margin-bottom:var(--sp-4)">
        <label class="field-label">Color</label>
        <div class="rd-cat-palette" id="cate-palette">${paletteSwatches}</div>
        <input type="hidden" id="cate-color" value="${CATEGORY_PALETTE[0]}">
      </div>
      <div class="rd-editor-btns">
        <button class="btn btn-ghost" data-ed="cancel">Cancel</button>
        <button class="btn btn-primary" data-ed="save">Create</button>
      </div>
    </div>`;
  host.appendChild(dlg);

  // Pre-select first colour
  dlg.querySelector<HTMLElement>(`.rd-cat-swatch[data-color="${CATEGORY_PALETTE[0]}"]`)?.classList.add('is-selected');

  dlg.querySelectorAll<HTMLElement>('.rd-cat-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      dlg.querySelectorAll('.rd-cat-swatch').forEach(s => s.classList.remove('is-selected'));
      sw.classList.add('is-selected');
      (dlg.querySelector('#cate-color') as HTMLInputElement).value = sw.dataset.color!;
    });
  });

  const close = () => dlg.remove();
  dlg.querySelector('[data-ed="cancel"]')!.addEventListener('click', close);
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  dlg.querySelector('[data-ed="save"]')!.addEventListener('click', () => {
    const label = fieldVal(dlg, 'cate-name');
    const color = (dlg.querySelector('#cate-color') as HTMLInputElement).value;
    if (!label) { alert('Enter a category name.'); return; }
    const cats = leg.clipCategories ?? [];
    const newCat: ClipCategory = { id: uid(), label, color, order: cats.length };
    patchLeg(leg.id, { clipCategories: clean([...cats, newCat]) });
    close();
  });
}

/* ── Inline editors (transport / stay) ──────────────────────────────────── */

function fieldVal(scope: HTMLElement, id: string): string {
  return (scope.querySelector('#' + id) as HTMLInputElement | HTMLSelectElement)?.value.trim() ?? '';
}

function openTransportEditor(timeline: HTMLElement, leg: Leg) {
  const t = leg.arrivalTransport;
  const host = timeline.querySelector<HTMLElement>('.rd-shell')!;
  const dlg = document.createElement('div');
  dlg.className = 'rd-editor-overlay';
  dlg.innerHTML = `
    <div class="rd-editor">
      <div class="rd-editor-title">Getting to ${esc(leg.city)}</div>
      <div class="rd-editor-grid">
        <div>
          <label class="field-label">Mode</label>
          <select class="input select" id="te-type">
            ${['train', 'flight', 'bus', 'ferry'].map((m) => `<option value="${m}" ${t?.type === m ? 'selected' : ''}>${TRANSPORT_ICONS[m]} ${m[0].toUpperCase() + m.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="field-label">Coming from</label>
          <input class="input" id="te-from" value="${esc(t?.from)}" placeholder="e.g. Vienna">
        </div>
        <div>
          <label class="field-label">Via (stopovers)</label>
          <input class="input" id="te-via" value="${esc((t?.via ?? []).join(', '))}" placeholder="e.g. Beijing (联程)">
        </div>
        <div>
          <label class="field-label">Service / number</label>
          <input class="input" id="te-service" value="${esc(t?.service)}" placeholder="e.g. EC 79 / LH 234">
        </div>
        <div>
          <label class="field-label">Booking ref</label>
          <input class="input" id="te-ref" value="${esc(t?.bookingRef)}" placeholder="optional">
        </div>
        <div>
          <label class="field-label">Depart</label>
          <input class="input" id="te-time" value="${esc(t?.time)}" placeholder="e.g. 09:15">
        </div>
        <div>
          <label class="field-label">Arrive</label>
          <input class="input" id="te-arr-time" value="${esc(t?.arrivalTime)}" placeholder="e.g. 14:30">
        </div>
        <div>
          <label class="field-label">From station / terminal</label>
          <input class="input" id="te-dep-place" value="${esc(t?.depPlace)}" placeholder="optional">
        </div>
        <div>
          <label class="field-label">To station / terminal</label>
          <input class="input" id="te-arr-place" value="${esc(t?.arrPlace)}" placeholder="optional">
        </div>
        <div>
          <label class="field-label">Duration</label>
          <input class="input" id="te-duration" value="${esc(t?.duration)}" placeholder="e.g. ~5h">
        </div>
        <div>
          <label class="field-label">Price</label>
          <input class="input" id="te-price" value="${esc(t?.price)}" placeholder="e.g. €89">
        </div>
        <div class="field-full">
          <label class="field-label">Notes</label>
          <input class="input" id="te-notes" value="${esc(t?.notes)}" placeholder="optional">
        </div>
      </div>
      <div class="rd-editor-btns">
        <button class="btn btn-ghost" data-ed="cancel">Cancel</button>
        <button class="btn btn-primary" data-ed="save">Save</button>
      </div>
    </div>`;
  host.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('[data-ed="cancel"]')!.addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.querySelector('[data-ed="save"]')!.addEventListener('click', () => {
    const from = fieldVal(dlg, 'te-from');
    if (!from) { alert('Add where you\'re coming from.'); return; }
    const via = fieldVal(dlg, 'te-via').split(',').map((s) => s.trim()).filter(Boolean);
    const next: Transport = {
      type: fieldVal(dlg, 'te-type') as Transport['type'],
      from, to: leg.city, date: leg.dateFrom,
      ...(via.length ? { via } : {}),
      service: fieldVal(dlg, 'te-service') || undefined,
      bookingRef: fieldVal(dlg, 'te-ref') || undefined,
      time: fieldVal(dlg, 'te-time') || undefined,
      arrivalTime: fieldVal(dlg, 'te-arr-time') || undefined,
      depPlace: fieldVal(dlg, 'te-dep-place') || undefined,
      arrPlace: fieldVal(dlg, 'te-arr-place') || undefined,
      duration: fieldVal(dlg, 'te-duration') || undefined,
      price: fieldVal(dlg, 'te-price') || undefined,
      notes: fieldVal(dlg, 'te-notes') || undefined,
      confirmed: t?.confirmed ?? false,
    };
    patchLeg(leg.id, { arrivalTransport: clean(next) });
    close();
  });
}

function openStayEditor(timeline: HTMLElement, leg: Leg, stayKey: string | null) {
  const stays = legStays(leg);
  const existing = stayKey != null ? stays.find((s, i) => (s.id ?? String(i)) === stayKey) : undefined;
  const host = timeline.querySelector<HTMLElement>('.rd-shell')!;
  const dlg = document.createElement('div');
  dlg.className = 'rd-editor-overlay';
  dlg.innerHTML = `
    <div class="rd-editor">
      <div class="rd-editor-title">${existing ? 'Edit stay' : 'Add stay'} · ${esc(leg.city)}</div>
      <div class="rd-editor-grid">
        <div class="field-full">
          <label class="field-label">Name</label>
          <input class="input" id="se-name" value="${esc(existing?.name)}" placeholder="e.g. Generator Hostel">
        </div>
        <div>
          <label class="field-label">Check-in</label>
          <input class="input" type="date" id="se-in" value="${esc(existing?.checkIn)}">
        </div>
        <div>
          <label class="field-label">Check-out</label>
          <input class="input" type="date" id="se-out" value="${esc(existing?.checkOut)}">
        </div>
        <div>
          <label class="field-label">Price / night</label>
          <input class="input" id="se-price" value="${esc(existing?.price)}" placeholder="e.g. €40">
        </div>
        <div>
          <label class="field-label">Phone</label>
          <input class="input" id="se-phone" value="${esc(existing?.phone)}" placeholder="optional">
        </div>
        <div class="field-full">
          <label class="field-label">Google Maps link</label>
          <input class="input" id="se-map" value="${esc(existing?.mapUrl)}" placeholder="Paste a Maps link — or leave blank to search by name">
        </div>
        <div class="field-full">
          <label class="rd-check">
            <input type="checkbox" id="se-confirmed" ${existing?.confirmed ? 'checked' : ''}>
            Confirmed / booked
          </label>
        </div>
      </div>
      <div class="rd-editor-btns">
        <button class="btn btn-ghost" data-ed="cancel">Cancel</button>
        <button class="btn btn-primary" data-ed="save">Save</button>
      </div>
    </div>`;
  host.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('[data-ed="cancel"]')!.addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.querySelector('[data-ed="save"]')!.addEventListener('click', () => {
    const name = fieldVal(dlg, 'se-name');
    if (!name) { alert('Add a name for the stay.'); return; }
    const next: Accommodation = {
      id: existing?.id && existing.id !== 'legacy' ? existing.id : uid(),
      name,
      checkIn: fieldVal(dlg, 'se-in') || undefined,
      checkOut: fieldVal(dlg, 'se-out') || undefined,
      price: fieldVal(dlg, 'se-price') || undefined,
      phone: fieldVal(dlg, 'se-phone') || undefined,
      mapUrl: fieldVal(dlg, 'se-map') || undefined,
      confirmed: (dlg.querySelector('#se-confirmed') as HTMLInputElement).checked,
    };
    const list = existing
      ? stays.map((s, i) => (s.id ?? String(i)) === stayKey ? next : s)
      : [...stays, next];
    persistStays(leg, list);
    close();
  });
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

export function initRoute() {
  // Idempotent: re-runs on trip switch, re-subscribing under the new tripId.
  _unsubRoute?.();
  destroyPickers();
  legs = [];
  selectedLegId = null;
  addFormOpen = false;
  _unsubRoute = routeStore.subscribe((rows) => {
    legs = sortLegs(rows as Leg[]);
    render();
  });
}
