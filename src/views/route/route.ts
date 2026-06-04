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
import { currentTrip, currentTripId, listTrips, switchTrip, type StoredTrip } from '../../data/trip-context.ts';
import { navigateTo } from '../../core/app.ts';
import { createDestinationInput, type DestinationInputInstance } from '../../core/destination-input.ts';
import type {
  Leg as SchemaLeg, PlanItem, Clip,
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

// Curated plan tags. Free text is allowed too — these just give quick chips.
const PLAN_TAGS = [
  { id: 'food', label: 'Food', icon: '🍜' },
  { id: 'sights', label: 'Sights', icon: '🏛️' },
  { id: 'walk', label: 'Walk', icon: '🚶' },
  { id: 'shop', label: 'Shop', icon: '🛍️' },
  { id: 'nature', label: 'Nature', icon: '🌿' },
  { id: 'nightlife', label: 'Nightlife', icon: '🍸' },
];
const TAG_META: Record<string, { label: string; icon: string }> = Object.fromEntries(
  PLAN_TAGS.map((t) => [t.id, { label: t.label, icon: t.icon }]),
);

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
function planMapHref(p: PlanItem, leg: Leg): string {
  if (p.mapUrl) return p.mapUrl;
  const q = encodeURIComponent(`${p.title} ${leg.city}`.trim());
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
    const trip = currentTrip();
    return `
      ${renderAddForm()}
      <div class="route-empty">
        <div class="route-empty-icon">🗺️</div>
        <div class="route-empty-title">No stops yet</div>
        ${trip
          ? `<div class="route-empty-trip-badge">${trip.name}</div>
             <div class="route-empty-text">Add the cities you'll visit. We'll order them by date and track each one as upcoming, current, or visited.</div>
             <button class="btn btn-primary" id="route-add-toggle">＋ Add your first stop</button>`
          : `<div class="route-empty-text">Start by linking a trip, then add your cities.</div>
             <div class="route-empty-actions">
               <button class="btn btn-primary" id="route-link-trip">Link a trip</button>
             </div>`
        }
      </div>`;
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

function renderPlansSection(leg: Leg): string {
  const plans = [...(leg.plans ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // Group by tag; untagged go under "Other".
  const byTag = new Map<string, PlanItem[]>();
  for (const p of plans) {
    const key = p.tag || 'other';
    if (!byTag.has(key)) byTag.set(key, []);
    byTag.get(key)!.push(p);
  }
  const card = (p: PlanItem) => `
    <div class="rd-plan ${p.done ? 'done' : ''}" data-plan="${p.id}">
      <button class="rd-plan-check" data-act="toggle-plan" data-plan="${p.id}">${p.done ? '✓' : ''}</button>
      <div class="rd-plan-body">
        <div class="rd-plan-title">${esc(p.title)}</div>
        ${p.note ? `<div class="rd-plan-note">${esc(p.note)}</div>` : ''}
      </div>
      <div class="rd-plan-actions">
        <a class="rd-icon-btn" href="${esc(planMapHref(p, leg))}" target="_blank" rel="noopener" title="Map">📍</a>
        <button class="rd-icon-btn rd-danger" data-act="del-plan" data-plan="${p.id}" title="Remove">✕</button>
      </div>
    </div>`;

  const groups = [...byTag.entries()].map(([tag, items]) => {
    const meta = TAG_META[tag];
    const label = meta ? `${meta.icon} ${meta.label}` : (tag === 'other' ? 'Other' : esc(tag));
    return `
      <div class="rd-plan-group">
        <div class="rd-plan-group-head">${label}</div>
        <div class="rd-plan-cards">${items.map(card).join('')}</div>
      </div>`;
  }).join('');

  return `
    <section class="rd-section rd-col">
      <div class="rd-section-head">
        <h3>✨ Plans</h3>
        <span class="rd-section-sub">Things to do — no fixed day</span>
      </div>
      ${plans.length ? groups : `<div class="rd-placeholder rd-placeholder-soft"><span>Nothing planned yet. Jot what you'd like to do — order, don't schedule.</span></div>`}
      <div class="rd-add-row">
        <input class="input rd-add-input" id="rd-plan-input" placeholder="e.g. Brunch at Markthalle Neun">
        <select class="input select rd-add-tag" id="rd-plan-tag">
          <option value="">Tag</option>
          ${PLAN_TAGS.map((t) => `<option value="${t.id}">${t.icon} ${t.label}</option>`).join('')}
        </select>
        <button class="btn btn-primary rd-sm" data-act="add-plan">Add</button>
      </div>
    </section>`;
}

function renderClipsSection(leg: Leg): string {
  const clips = [...(leg.clips ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const icon: Record<Clip['kind'], string> = { link: '🔗', note: '📝', image: '🖼️' };
  const card = (c: Clip) => `
    <div class="rd-clip" data-clip="${c.id}">
      <div class="rd-clip-icon">${icon[c.kind]}</div>
      <div class="rd-clip-body">
        ${c.url
          ? `<a class="rd-clip-title" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title || c.url)}</a>`
          : `<div class="rd-clip-title">${esc(c.title || 'Note')}</div>`}
        ${c.body ? `<div class="rd-clip-text">${esc(c.body)}</div>` : ''}
      </div>
      <div class="rd-clip-actions">
        <button class="rd-icon-btn" data-act="clip-to-plan" data-clip="${c.id}" title="Turn into a plan">→✨</button>
        <button class="rd-icon-btn rd-danger" data-act="del-clip" data-clip="${c.id}" title="Remove">✕</button>
      </div>
    </div>`;

  return `
    <section class="rd-section rd-col">
      <div class="rd-section-head">
        <h3>📎 Clips</h3>
        <span class="rd-section-sub">Collected research</span>
      </div>
      ${clips.length ? `<div class="rd-clip-list">${clips.map(card).join('')}</div>`
        : `<div class="rd-placeholder rd-placeholder-soft"><span>Paste links or notes you find. Turn the good ones into plans with →✨.</span></div>`}
      <div class="rd-add-row rd-add-row-col">
        <input class="input rd-add-input" id="rd-clip-title" placeholder="Title (optional)">
        <input class="input rd-add-input" id="rd-clip-url" placeholder="Paste a link, or leave blank for a note">
        <textarea class="input rd-add-area" id="rd-clip-body" placeholder="Note / details (optional)"></textarea>
        <button class="btn btn-primary rd-sm" data-act="add-clip">Add clip</button>
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

      ${renderTransportSection(leg)}
      ${renderStaysSection(leg)}
      <div class="rd-split">
        ${renderPlansSection(leg)}
        ${renderClipsSection(leg)}
      </div>
    </div>`;
}

/* ── Render root ────────────────────────────────────────────────────────── */

function render() {
  const root = document.getElementById('view-route');
  if (!root) return;
  const timeline = root.querySelector<HTMLElement>('.route-timeline')!;

  // No trip linked → guide the user to link/create one.
  if (!currentTrip()) {
    timeline.innerHTML = `
      <div class="route-empty">
        <div class="route-empty-icon">🧭</div>
        <div class="route-empty-title">Link a trip first</div>
        <div class="route-empty-text">Your itinerary lives inside a trip. Pick or create one to start mapping your route.</div>
        <button class="btn btn-primary" id="route-link-trip">Choose a trip</button>
      </div>`;
    // The trip pill in the shell owns trip linking/creation — defer to it.
    timeline.querySelector('#route-link-trip')?.addEventListener('click', () => {
      document.getElementById('trip-pill')?.click();
    });
    return;
  }

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
    document.getElementById('trip-pill')?.click();
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
  // Once the array exists, legStays() ignores the legacy single `accommodation`
  // field, so we don't need to clear it (and Firestore can't take undefined).
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
    if (confirm('Remove transport details for this stop?')) {
      rewriteLeg(leg, ['arrivalTransport']);
    }
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

  /* — Plans — */
  on('add-plan', () => {
    const input = timeline.querySelector('#rd-plan-input') as HTMLInputElement;
    const tag = (timeline.querySelector('#rd-plan-tag') as HTMLSelectElement).value;
    const title = input.value.trim();
    if (!title) return;
    const plans = leg.plans ?? [];
    const next: PlanItem = { id: uid(), title, tag: tag || undefined, done: false, order: plans.length };
    patchLeg(leg.id, { plans: [...plans, next] });
  });
  on('toggle-plan', (el) => {
    const id = el.dataset.plan!;
    const plans = (leg.plans ?? []).map((p) => p.id === id ? { ...p, done: !p.done } : p);
    patchLeg(leg.id, { plans });
  });
  on('del-plan', (el) => {
    const id = el.dataset.plan!;
    patchLeg(leg.id, { plans: (leg.plans ?? []).filter((p) => p.id !== id) });
  });

  /* — Clips — */
  on('add-clip', () => {
    const title = (timeline.querySelector('#rd-clip-title') as HTMLInputElement).value.trim();
    const url = (timeline.querySelector('#rd-clip-url') as HTMLInputElement).value.trim();
    const body = (timeline.querySelector('#rd-clip-body') as HTMLTextAreaElement).value.trim();
    if (!title && !url && !body) return;
    const clips = leg.clips ?? [];
    const next: Clip = {
      id: uid(),
      kind: url ? 'link' : 'note',
      title: title || undefined, url: url || undefined, body: body || undefined,
      order: clips.length,
    };
    patchLeg(leg.id, { clips: [...clips, next] });
  });
  on('clip-to-plan', (el) => {
    const id = el.dataset.clip!;
    const clip = (leg.clips ?? []).find((c) => c.id === id);
    if (!clip) return;
    const plans = leg.plans ?? [];
    const next: PlanItem = {
      id: uid(),
      title: clip.title || clip.url || 'Untitled',
      note: clip.body, done: false, order: plans.length,
    };
    patchLeg(leg.id, { plans: [...plans, next] });
  });
  on('del-clip', (el) => {
    const id = el.dataset.clip!;
    patchLeg(leg.id, { clips: (leg.clips ?? []).filter((c) => c.id !== id) });
  });

  // Enter-to-add for the plan input.
  timeline.querySelector('#rd-plan-input')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') (timeline.querySelector('[data-act="add-plan"]') as HTMLElement)?.click();
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
