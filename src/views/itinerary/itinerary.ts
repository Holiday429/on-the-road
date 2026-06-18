/* ==========================================================================
   On the Road · Itinerary / Route — Firestore-backed
   --------------------------------------------------------------------------
   Two levels, one view:
     • List   — timeline grouped by country, live status colours (upcoming /
                active / past), each city card opens its detail.
     • Detail — Getting here · Stays · (Plans | Clips side-by-side) for one
                leg, plus a link out to the city's AI guide.
   ========================================================================== */

import './itinerary.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { t as tr } from '../../core/i18n.ts';
import { routeStore } from '../../data/stores/route-store.ts';
import { currentTripId, listTrips, switchTrip, type StoredTrip } from '../../data/trip-context.ts';
import { navigateTo, consumeNavIntent, type NavIntent } from '../../core/app.ts';
import { createDestinationInput, type DestinationInputInstance } from '../../core/destination-input.ts';
import { openTripChooser } from '../../core/trip-chooser.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { flagForCountry } from '../../data/destinations.ts';
import {
  TRANSPORT_ICONS, uid, clean, daysBetween, fmtDate, legStatus, sortLegs,
  legStays, mapHref, NOTE_COLORS, noteColor, resolveNoteColor, dayColour, bearing,
} from './itinerary-utils.ts';
import { coordsFor } from '../map/geo.ts';
import { geocode, geocodeLocal } from '../map/geocode.ts';
import { currencySymbol } from '../../data/rates.ts';
import { baseCurrency } from '../../data/trip-context.ts';
import type {
  Leg as SchemaLeg, PlanItem, Clip, PlanDay, ClipCategory, NoteCard,
} from '../../data/schema.ts';
import { uploadClipImage } from '../../firebase/storage.ts';
import {
  openDatesEditor,
  openTransportEditor,
  openStayEditor,
  openStaySyncDialog,
  openTransportSyncDialog,
  fieldVal,
} from './itinerary-editors.ts';

type Transport = NonNullable<SchemaLeg['arrivalTransport']>;
type Accommodation = NonNullable<SchemaLeg['accommodations']>[number];
type Leg = SchemaLeg & { id: string };


// Built-in clip/plan categories — user can add their own on top.
export const BUILTIN_CATEGORIES: ClipCategory[] = [
  { id: 'official',  label: 'Tourism',  color: '#e2edf3', order: 0 },
  { id: 'social',    label: 'Social',   color: '#fde8ef', order: 1 },
  { id: 'food',      label: 'Food',     color: '#fef3e2', order: 2 },
  { id: 'museum',    label: 'Museum',   color: '#ece2f3', order: 3 },
  { id: 'nature',    label: 'Nature',   color: '#e6f3e6', order: 4 },
  { id: 'daytrip',   label: 'Day trip', color: '#e2f3ec', order: 5 },
  { id: 'shopping',  label: 'Shopping', color: '#f3e2e8', order: 6 },
  { id: 'other',     label: 'Other',           color: '#ebebeb', order: 7 },
];

// 10 palette colours the user can pick when creating a custom category.
export const CATEGORY_PALETTE = [
  '#fde8ef','#fef3e2','#ece2f3','#e2edf3','#e6f3e6',
  '#e2f3ec','#f3e2e8','#f3f0e2','#f0e2f3','#ebebeb',
];

// Common booking platforms offered in the stay editor. Free-text "Other" is
// always allowed via the datalist, so this is a convenience list, not a closed set.
/** Per-night price preferring the structured amount, falling back to legacy text. */
function stayPriceLabel(a: Accommodation): string {
  if (a.priceAmount != null) return `${currencySymbol(a.priceCurrency ?? baseCurrency())}${a.priceAmount}`;
  return a.price ?? '';
}

/** Normalise a pasted order URL to an absolute href. */
function stayBookingHref(a: Accommodation): string {
  const u = (a.bookingUrl ?? '').trim();
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/** Returns the canonical image URL list for a clip, migrating legacy imageUrl. */
function clipImages(c: Clip): string[] {
  if (c.imageUrls?.length) return c.imageUrls;
  if (c.imageUrl) return [c.imageUrl];
  return [];
}

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
type PlanView = 'board' | 'feed' | 'category' | 'calendar' | 'map';
let _planView: PlanView = 'board';

// Drag state (plan items → day columns)
let _dragItemId: string | null = null;
let _dragStartX = 0, _dragStartY = 0;
let _dragging = false;

let legs: Leg[] = [];
let addFormOpen = false;
let selectedLegId: string | null = null;   // null = list view
let _unsubRoute: (() => void) | null = null;
let _navIntentBound = false;   // window listener for Today deep-links, bound once
// IDs of legs whose note cards were just saved locally — suppress one Firestore echo re-render.
const _notesSuppressed = new Set<string>();
let _tripList: StoredTrip[] = [];          // cached for the add-form trip selector
let _countryPicker: DestinationInputInstance | null = null;
let _cityPicker: DestinationInputInstance | null = null;
let _fromPicker: DestinationInputInstance | null = null;

// Plan map view — Leaflet instance
let _planLeaflet: L.Map | null = null;
let _planLeafletEl: HTMLElement | null = null;

/* ── Helpers (pure utilities live in route-utils.ts) ─────────────────────── */

let _saveToastTimer = 0;
function saveFailed(e?: unknown) {
  console.error('[route] save failed:', e);
  let el = document.getElementById('rd-save-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rd-save-toast';
    el.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#ef4444;color:#fff;padding:.5rem 1.25rem;border-radius:9999px;font-size:.875rem;z-index:9999;pointer-events:none;opacity:0;transition:opacity .2s';
    document.body.appendChild(el);
  }
  el.textContent = '⚠ Save failed — check your connection and retry';
  el.style.opacity = '1';
  clearTimeout(_saveToastTimer);
  _saveToastTimer = window.setTimeout(() => { if (el) el.style.opacity = '0'; }, 4000);
}

/* ── Mutations (all async → Firestore) ──────────────────────────────────── */

async function addLeg(city: string, country: string, dateFrom: string, dateTo: string,
                      transportType: string, transportFrom: string, transportVia: string[] = []) {
  const row: Partial<SchemaLeg> & { id: string } = {
    id: uid(), city, country,
    flag: flagForCountry(country),
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
  await routeStore.set(clean(row)).catch(saveFailed);
  // render() fires from the Firestore subscription
}

async function deleteLeg(id: string) {
  if (!confirm('Remove this stop from the itinerary?')) return;
  if (selectedLegId === id) selectedLegId = null;
  await routeStore.remove(id).catch(saveFailed);
}

function patchLeg(id: string, patch: Partial<SchemaLeg>) {
  return routeStore.update(id, clean(patch)).catch(saveFailed);
}

/** Rewrite a leg from scratch, dropping any keys listed in `omit`. Needed for
 *  true field removal — patchLeg/clean() can't send `undefined` to Firestore. */
function rewriteLeg(leg: Leg, omit: (keyof SchemaLeg)[]) {
  const next: Record<string, unknown> = { ...leg };
  for (const k of omit) delete next[k as string];
  return routeStore.set(clean(next) as Partial<SchemaLeg> & { id: string }).catch(saveFailed);
}

/* ── Render: list (timeline grouped by country) ─────────────────────────── */

function legSummary(leg: Leg): string {
  const t = leg.arrivalTransport;
  const stays = legStays(leg);

  const leftChips: string[] = [];
  const rightChips: string[] = [];

  if (t) {
    const times = t.time
      ? (t.arrivalTime ? `${esc(t.time)}–${esc(t.arrivalTime)}` : esc(t.time))
      : '';
    const parts = [
      TRANSPORT_ICONS[t.type],
      esc(t.from),
      t.service ? `· ${esc(t.service)}` : '',
      times ? `· ${times}` : '',
    ].filter(Boolean).join(' ');
    leftChips.push(`<span class="route-sum-chip route-sum-transport">${parts}</span>`);
  }

  stays.forEach((a) => {
    const href = mapHref(a, leg);
    rightChips.push(
      `<a class="route-sum-chip route-sum-hotel" href="${esc(href)}" target="_blank" rel="noopener" title="Open in Google Maps">` +
      `🏨 ${esc(a.name)}</a>`
    );
  });

  if (!leftChips.length && !rightChips.length) {
    return `<div class="route-leg-summary"><span class="route-sum-chip route-sum-empty">${tr('route.emptyLegTip')}</span></div>`;
  }

  return `
    <div class="route-leg-summary">
      <div class="route-sum-left">${leftChips.join('')}</div>
      <div class="route-sum-right">${rightChips.join('')}</div>
    </div>`;
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
              <span class="route-status-label">${status === 'active' ? tr('route.statusActive') : status === 'past' ? tr('route.statusPast') : tr('route.statusUpcoming')}</span>
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
        <div class="route-empty-title">${tr('route.emptyTitle')}</div>
        <div class="route-empty-text">${tr('route.emptyText')}</div>
        <div class="route-empty-actions">
          <button class="btn btn-primary" id="route-add-toggle">${tr('route.addStop')}</button>
          <button class="btn btn-ghost" id="route-link-trip">${tr('route.linkTrip')}</button>
        </div>
      </div>`}`;
  }

  const groups: { country: string; flag: string; legs: Leg[] }[] = [];
  for (const leg of legs) {
    const last = groups[groups.length - 1];
    if (last && last.country === leg.country) last.legs.push(leg);
    else groups.push({ country: leg.country, flag: leg.flag || flagForCountry(leg.country), legs: [leg] });
  }

  const sections = groups.map((g) => `
    <div class="route-country-group">
      <div class="route-country-head">
        <span class="route-country-flag">${g.flag}</span>
        <span class="route-country-name">${esc(g.country)}</span>
        <span class="route-country-count">${g.legs.length} ${g.legs.length === 1 ? tr('route.citySingular') : tr('route.citiesPlural')}</span>
      </div>
      ${g.legs.map(renderLegCard).join('')}
    </div>`).join('');

  return `
    ${renderAddForm()}
    ${sections}
    <div class="route-add-wrap">
      <button class="route-add-btn" id="route-add-toggle">
        <span style="font-size:20px">＋</span>
        ${tr('route.addStop')}
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
        <span class="pk-scope-desc">${t.startDate ? `${t.startDate} → ${t.endDate ?? '…'}` : tr('route.noDatesSet')}</span>
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
      <div class="route-add-form-title">${tr('route.formAddStop')}</div>
      ${renderTripSelector()}
      <div class="route-add-form-grid">
        <div>
          <label class="field-label">${tr('route.labelCountry')}</label>
          <div id="raf-country-mount"></div>
        </div>
        <div>
          <label class="field-label">${tr('route.labelCity')}</label>
          <div id="raf-city-mount"></div>
        </div>
        <div>
          <label class="field-label">${tr('route.labelArrivalDate')}</label>
          <input class="input" type="date" id="raf-from">
        </div>
        <div>
          <label class="field-label">${tr('route.labelDepartureDate')}</label>
          <input class="input" type="date" id="raf-to">
        </div>
        <div>
          <label class="field-label">${tr('route.labelArriveBy')}</label>
          <select class="input select" id="raf-transport">
            <option value="">${tr('route.notSet')}</option>
            <option value="train">🚆 Train</option>
            <option value="flight">✈️ Flight</option>
            <option value="bus">🚌 Bus</option>
            <option value="ferry">⛴️ Ferry</option>
          </select>
        </div>
        <div>
          <label class="field-label">${tr('route.labelComingFrom')}</label>
          <div id="raf-from-mount"></div>
        </div>
      </div>
      <div class="route-add-form-btns">
        <button class="btn btn-ghost" id="raf-cancel">Cancel</button>
        <button class="btn btn-primary" id="raf-save">${tr('route.btnAddStop')}</button>
      </div>
    </div>`;
}

/* ── Render: detail ─────────────────────────────────────────────────────── */

/** Price preferring the structured amount, falling back to legacy text. */
function transportPriceLabel(t: Transport): string {
  if (t.priceAmount != null) return `${currencySymbol(t.priceCurrency ?? baseCurrency())}${t.priceAmount}`;
  return t.price ?? '';
}

/** Baggage allowances as "Personal 5 · Carry-on 10 · Checked 23 kg", or ''. */
function baggageLabel(t: Transport): string {
  const parts: string[] = [];
  const personal = t.baggagePersonalG;
  const carry = t.baggageCarryOnG ?? t.baggageAllowanceG; // legacy single value = carry-on
  const checked = t.baggageCheckedG;
  if (personal) parts.push(`Personal ${personal / 1000}`);
  if (carry) parts.push(`Carry-on ${carry / 1000}`);
  if (checked) parts.push(`Checked ${checked / 1000}`);
  return parts.length ? `${parts.join(' · ')} kg` : '';
}

function renderTransportSection(leg: Leg): string {
  const t = leg.arrivalTransport;
  const price = t ? transportPriceLabel(t) : '';
  const bags = t ? baggageLabel(t) : '';
  const synced = !!t?.expenseId;
  const body = t ? `
    <div class="rd-transport">
      <div class="rd-transport-icon">${TRANSPORT_ICONS[t.type]}</div>
      <div class="rd-transport-main">
        <div class="rd-transport-route">${esc(t.from)} → ${esc(t.to)}</div>
        <div class="rd-transport-meta">
          ${t.service ? `<span>${esc(t.service)}</span>` : ''}
          ${t.time ? `<span>🕑 ${esc(t.time)}${t.arrivalTime ? `–${esc(t.arrivalTime)}` : ''}</span>` : ''}
          ${t.duration ? `<span>⏱ ${esc(t.duration)}</span>` : ''}
          ${price ? `<span>💰 ${esc(price)}${synced ? ` · ${tr('route.loggedLabel')}` : ''}</span>` : ''}
        </div>
        ${(t.depPlace || t.arrPlace) ? `<div class="rd-transport-meta">${t.depPlace ? `<span>📍 ${esc(t.depPlace)}</span>` : ''}${t.arrPlace ? `<span>🏁 ${esc(t.arrPlace)}</span>` : ''}</div>` : ''}
        ${bags ? `<div class="rd-transport-meta"><span>🎒 ${esc(bags)}</span></div>` : ''}
        ${t.notes ? `<div class="rd-transport-note">${esc(t.notes)}</div>` : ''}
      </div>
      <span class="badge ${t.confirmed ? 'badge-green' : 'badge-gray'}" data-act="toggle-transport-confirmed" role="button" tabindex="0">
        ${t.confirmed ? '✓ Booked' : 'Not booked'}
      </span>
    </div>
    <div class="rd-section-actions">
      <button class="btn btn-ghost rd-sm" data-act="edit-transport">Edit transport</button>
      ${t.priceAmount != null ? `<button class="btn btn-ghost rd-sm" data-act="sync-transport">${synced ? '↻ Update expense' : '＋ Log to expenses'}</button>` : ''}
      <button class="btn btn-ghost rd-sm rd-danger" data-act="del-transport">Remove</button>
    </div>` : `
    <div class="rd-placeholder">
      <span>${tr('route.noTransport')}</span>
      <button class="btn btn-primary rd-sm" data-act="edit-transport">${tr('route.btnAddTransport')}</button>
    </div>`;

  return `
    <section class="rd-section">
      <div class="rd-section-head"><h3>${tr('route.sectionTransport')}</h3></div>
      ${body}
    </section>`;
}

function renderStaysSection(leg: Leg): string {
  const stays = legStays(leg);
  const rows = stays.map((a, i) => {
    const price = stayPriceLabel(a);
    const canSync = a.priceAmount != null;
    const synced = !!a.expenseId;
    return `
    <div class="rd-stay" data-stay="${a.id ?? i}">
      <div class="rd-stay-order">${i + 1}</div>
      <div class="rd-stay-main">
        <div class="rd-stay-name">${esc(a.name)}</div>
        <div class="rd-stay-meta">
          ${(a.checkIn || a.checkOut) ? `<span>📅 ${a.checkIn ? fmtDate(a.checkIn) : '?'} → ${a.checkOut ? fmtDate(a.checkOut) : '?'}</span>` : ''}
          ${price ? `<span>💰 ${esc(price)}${tr('route.perNight')}${synced ? ` · ${tr('route.loggedLabel')}` : ''}</span>` : ''}
          ${a.platform ? `<span>🛎️ ${esc(a.platform)}</span>` : ''}
          ${a.phone ? `<span>📞 ${esc(a.phone)}</span>` : ''}
          <span class="badge ${a.confirmed ? 'badge-green' : 'badge-gray'}">${a.confirmed ? '✓ Confirmed' : 'Not confirmed'}</span>
        </div>
      </div>
      <div class="rd-stay-actions">
        ${a.bookingUrl ? `<a class="rd-map-btn" href="${esc(stayBookingHref(a))}" target="_blank" rel="noopener" title="Open the booking on ${esc(a.platform || 'the platform')}">🔗 Order</a>` : ''}
        <a class="rd-map-btn" href="${esc(mapHref(a, leg))}" target="_blank" rel="noopener" title="Navigate in Google Maps">📍 Navigate</a>
        ${canSync ? `<button class="rd-icon-btn" data-act="sync-stay" data-stay="${a.id ?? i}" title="${synced ? 'Update the linked expense' : 'Log this stay in Expenses'}">${synced ? '↻ Expense' : '＋ Expense'}</button>` : ''}
        <button class="rd-icon-btn" data-act="edit-stay" data-stay="${a.id ?? i}" title="Edit">✎</button>
        <button class="rd-icon-btn rd-danger" data-act="del-stay" data-stay="${a.id ?? i}" title="Remove">✕</button>
      </div>
    </div>`;
  }).join('');

  return `
    <section class="rd-section">
      <div class="rd-section-head">
        <h3>${tr('route.sectionStays')}</h3>
        <button class="btn btn-ghost rd-sm" data-act="add-stay">${tr('route.btnAddStay')}</button>
      </div>
      ${stays.length ? `<div class="rd-stay-list">${rows}</div>`
        : `<div class="rd-placeholder"><span>${tr('route.noStays')}</span></div>`}
    </section>`;
}

/* ── Category helpers ────────────────────────────────────────────────────── */


function categorySelectOptions(leg: Leg, selected: string): string {
  return `<option value="">${tr('route.categorySelect')}</option>` +
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
    const imgs = clipImages(c);
    const hasDetail = !!(imgs.length || (c.body && c.body.length > 80));
    return `
    <div class="rd-clip-card${hasDetail ? ' rd-clip-card--expandable' : ''}" data-clip="${esc(c.id)}" data-clip-cat="${esc(c.category ?? '')}"${hasDetail ? ` data-act="preview-clip" data-clip-preview="${esc(c.id)}"` : ''}>
      <div class="rd-clip-card-color" style="background:${esc(color)}"></div>
      <div class="rd-clip-card-body">
        ${imgs.length ? `<div class="rd-clip-card-imgs">${imgs.slice(0, 3).map((u, i) => `<div class="rd-clip-card-img-wrap">${i === 2 && imgs.length > 3 ? `<img class="rd-clip-card-img" src="${esc(u)}" alt=""><div class="rd-clip-card-img-more">+${imgs.length - 2}</div>` : `<img class="rd-clip-card-img" src="${esc(u)}" alt="">`}</div>`).join('')}</div>` : ''}
        <div class="rd-clip-card-top">
          ${cat ? `<span class="rd-cat-badge rd-cat-badge--sm" style="background:${esc(color)}">${esc(cat.label)}</span>` : ''}
          <div class="rd-clip-card-actions">
            <button class="rd-icon-btn" data-act="clip-to-plan" data-clip="${esc(c.id)}" title="Convert to plan item">→✨</button>
            <button class="rd-icon-btn" data-act="edit-clip" data-clip="${esc(c.id)}" title="Edit">✎</button>
            <button class="rd-icon-btn rd-danger" data-act="del-clip" data-clip="${esc(c.id)}" title="Remove">✕</button>
          </div>
        </div>
        ${c.url
          ? `<a class="rd-clip-card-title" href="${esc(/^https?:\/\//i.test(c.url) ? c.url : 'https://' + c.url)}" target="_blank" rel="noopener">${esc(c.title || c.url)}</a>`
          : `<div class="rd-clip-card-title">${esc(c.title || 'Note')}</div>`}
        ${c.body ? `<div class="rd-clip-card-body-text">${esc(c.body)}</div>` : ''}
      </div>
    </div>`;
  };

  const filterBar = `
    <div class="rd-filter-bar" id="rd-clip-filter-bar">
      <button class="rd-filter-chip is-active" data-filter="">${tr('route.filterAll')}</button>
      ${cats.filter(c => clips.some(cl => cl.category === c.id)).map(c =>
        `<button class="rd-filter-chip" data-filter="${esc(c.id)}" style="--chip-color:${esc(c.color)}">${esc(c.label)}</button>`
      ).join('')}
      <button class="rd-filter-chip rd-filter-chip--add" data-act="add-clip-category" title="New category">${tr('route.btnAddCategory')}</button>
    </div>`;

  return `
    <section class="rd-section" id="rd-clips-section" ${filterAttr}>
      <div class="rd-section-head">
        <h3>${tr('route.sectionClips')}</h3>
        <button class="btn btn-ghost rd-sm" data-act="open-add-clip">${tr('route.btnAddClip')}</button>
      </div>
      ${filterBar}
      ${clips.length
        ? `<div class="rd-clip-grid">${clips.map(card).join('')}</div>`
        : `<div class="rd-placeholder rd-placeholder-soft"><span>${tr('route.clipsEmpty')}</span></div>`}
    </section>`;
}

/* ── Notes section ───────────────────────────────────────────────────────── */

/** Migrate legacy `leg.notes` string into a single NoteCard if noteCards is empty.
 *  Also normalises any out-of-palette colors to the current palette. */
function legNoteCards(leg: Leg): NoteCard[] {
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

function renderNotesSection(leg: Leg): string {
  const cards = legNoteCards(leg);

  const cardHtml = cards.map((c, i) => {
    const color = resolveNoteColor(c.color, i);
    return `
    <div class="rd-note-card" data-note-id="${esc(c.id)}" style="background:${esc(color)}">
      <div class="rd-note-card-head">
        <input class="rd-note-title-input" data-note-id="${esc(c.id)}" value="${esc(c.title)}" placeholder="Title…">
        <div class="rd-note-card-actions">
          <div class="rd-note-color-picker" data-note-id="${esc(c.id)}">
            ${NOTE_COLORS.map(col => `<button class="rd-note-color-swatch${col === color ? ' is-active' : ''}" data-color="${col}" data-note-id="${esc(c.id)}" style="background:${col}"></button>`).join('')}
          </div>
          <button class="rd-note-del" data-act="del-note" data-note-id="${esc(c.id)}" title="Delete note">✕</button>
        </div>
      </div>
      <div class="rd-note-body-wrap">
        <textarea class="rd-note-body" data-note-id="${esc(c.id)}" placeholder="Write anything…">${esc(c.body)}</textarea>
        <button class="rd-note-expand" data-act="expand-note" data-note-id="${esc(c.id)}" title="Expand">↗</button>
      </div>
    </div>`;
  }).join('');

  return `
    <section class="rd-section rd-section-notes">
      <div class="rd-section-head">
        <h3>${tr('route.sectionNotes')}</h3>
        <button class="btn btn-ghost rd-sm" data-act="add-note">${tr('route.btnAddNote')}</button>
      </div>
      ${cards.length
        ? `<div class="rd-note-grid">${cardHtml}</div>`
        : `<div class="rd-placeholder rd-placeholder-soft"><span>${tr('route.notesEmpty')}</span></div>`}
    </section>`;
}

/* ── Plan section ────────────────────────────────────────────────────────── */

/** Ensure planDays covers every night of the leg. Returns the canonical list. */
function ensurePlanDays(leg: Leg): PlanDay[] {
  const total = daysBetween(leg.dateFrom, leg.dateTo);
  const existing = [...(leg.planDays ?? [])].sort((a, b) => a.order - b.order);

  // Build expected day list from leg dates
  const pad = (n: number) => String(n).padStart(2, '0');
  const expected: PlanDay[] = Array.from({ length: total }, (_, i) => {
    const d = new Date(leg.dateFrom + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const found = existing.find(e => e.date === iso);
    return found ?? { id: `day-${iso}`, date: iso, label: '', notes: '', order: i };
  });
  return expected;
}

function renderPlanItem(p: PlanItem, leg: Leg): string {
  const cat = p.category ? categoryById(leg, p.category) : undefined;
  const color = cat?.color ?? '#ebebeb';
  const tooltipParts = [cat?.label, p.note, p.duration, p.cost].filter(Boolean);
  const tooltip = tooltipParts.join(' · ');
  return `
    <div class="rd-plan-tag ${p.done ? 'is-done' : ''}" data-id="${esc(p.id)}" data-drag="plan-item" style="background:${esc(color)}"${tooltip ? ` data-tooltip="${esc(tooltip)}"` : ''}>
      <button class="rd-plan-tag-check" data-act="toggle-plan" data-plan="${esc(p.id)}" title="Mark done">
        ${p.done ? '✓' : ''}
      </button>
      <span class="rd-plan-tag-name">${esc(p.title)}</span>
      <button class="rd-plan-tag-open" data-act="open-plan" data-plan="${esc(p.id)}" title="Details">›</button>
      <button class="rd-plan-tag-del" data-act="del-plan" data-plan="${esc(p.id)}" title="Delete">✕</button>
    </div>`;
}

function renderPlanBoardView(leg: Leg): string {
  const days = ensurePlanDays(leg);
  const plans = leg.plans ?? [];

  const dayCol = (day: PlanDay, idx: number) => {
    const items = plans.filter(p => p.dayId === day.id).sort((a, b) => a.order - b.order);
    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return `
      <div class="rd-plan-day-col">
        <div class="rd-plan-day-head">
          <span class="rd-plan-day-num">${tr('route.dayPrefix', { n: idx + 1 })}</span>
          <span class="rd-plan-day-date">${dateLabel}</span>
          ${day.label ? `<span class="rd-plan-day-label">${esc(day.label)}</span>` : ''}
        </div>
        <div class="rd-plan-drop-zone pk-drop-zone" data-day-id="${esc(day.id)}">
          ${items.map(p => renderPlanItem(p, leg)).join('')}
          ${items.length === 0 ? `<div class="rd-plan-drop-hint">${tr('route.dropHint')}</div>` : ''}
        </div>
      </div>`;
  };

  return `
    <div class="rd-plan-board-wrap">
      <div class="rd-plan-columns">
        ${days.map((d, i) => dayCol(d, i)).join('')}
      </div>
    </div>
    <div id="rd-plan-drag-ghost" class="rd-plan-drag-ghost" hidden></div>`;
}

function renderPlanCategoryView(leg: Leg): string {
  const plans = leg.plans ?? [];
  if (!plans.length) return `<div class="rd-placeholder rd-placeholder-soft"><span>${tr('route.planCategoryEmpty')}</span></div>`;

  const days = ensurePlanDays(leg);
  const dayLabel = (dayId: string | null | undefined) => {
    if (!dayId) return tr('route.unassigned');
    const idx = days.findIndex(d => d.id === dayId);
    return idx >= 0 ? tr('route.dayPrefix', { n: idx + 1 }) : tr('route.unassigned');
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

  return `<div class="rd-plan-cat-list">${groups || `<div class="rd-placeholder rd-placeholder-soft"><span>${tr('route.noItemsYet')}</span></div>`}</div>`;
}

function renderPlanFeedView(leg: Leg): string {
  const plans = leg.plans ?? [];
  const days = ensurePlanDays(leg);
  const today = new Date().toISOString().slice(0, 10);

  if (!plans.length) {
    return `<div class="rd-placeholder rd-placeholder-soft"><span>${tr('route.feedEmpty')}</span></div>`;
  }

  // Group by day in chronological order; unassigned appended at end
  const assigned: { day: PlanDay; items: typeof plans }[] = days
    .map(day => ({ day, items: plans.filter(p => p.dayId === day.id).sort((a, b) => a.order - b.order) }))
    .filter(g => g.items.length > 0);

  const unassigned = plans.filter(p => !p.dayId).sort((a, b) => a.order - b.order);

  function dayStatus(date: string): 'active' | 'past' | 'upcoming' {
    if (date === today) return 'active';
    if (date < today) return 'past';
    return 'upcoming';
  }

  const feedItem = (p: PlanItem, status: 'active' | 'past' | 'upcoming') => {
    const cat = p.category ? categoryById(leg, p.category) : undefined;
    const color = cat?.color ?? '#ebebeb';
    return `
      <div class="rd-feed-item ${p.done ? 'is-done' : ''} rd-feed-item--${status}" data-plan="${esc(p.id)}">
        <div class="rd-feed-item-dot" style="background:${p.done ? 'var(--ink-faint)' : status === 'active' ? 'var(--route-active)' : status === 'past' ? 'var(--route-past)' : 'var(--route-upcoming)'}"></div>
        <div class="rd-feed-item-body">
          <div class="rd-feed-item-row">
            <button class="rd-plan-tag-check ${p.done ? 'is-done' : ''}" data-act="toggle-plan" data-plan="${esc(p.id)}">${p.done ? '✓' : ''}</button>
            ${cat ? `<span class="rd-cat-badge rd-cat-badge--sm" style="background:${esc(color)}">${esc(cat.label)}</span>` : ''}
            <span class="rd-feed-item-title">${esc(p.title)}</span>
            <button class="rd-icon-btn" data-act="open-plan" data-plan="${esc(p.id)}">›</button>
          </div>
          ${p.note ? `<div class="rd-feed-item-note">${esc(p.note)}</div>` : ''}
        </div>
      </div>`;
  };

  const dayGroups = assigned.map(({ day, items }) => {
    const status = dayStatus(day.date);
    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    const dayIdx = days.findIndex(d => d.id === day.id);
    return `
      <div class="rd-feed-day-group rd-feed-day--${status}">
        <div class="rd-feed-day-head">
          <span class="rd-feed-day-dot" style="background:${status === 'active' ? 'var(--route-active)' : status === 'past' ? 'var(--route-past)' : 'var(--route-upcoming)'}"></span>
          <span class="rd-feed-day-label">${tr('route.dayPrefix', { n: dayIdx + 1 })}${status === 'active' ? ' · Today' : ''}</span>
          <span class="rd-feed-day-date">${dateLabel}</span>
          ${day.label ? `<span class="rd-plan-day-label">${esc(day.label)}</span>` : ''}
        </div>
        <div class="rd-feed-items">
          ${items.map(p => feedItem(p, status)).join('')}
        </div>
      </div>`;
  }).join('');

  const unassignedGroup = unassigned.length ? `
    <div class="rd-feed-day-group rd-feed-day--unassigned">
      <div class="rd-feed-day-head">
        <span class="rd-feed-day-dot" style="background:var(--ink-faint)"></span>
        <span class="rd-feed-day-label">${tr('route.unassigned')}</span>
        <span class="rd-feed-day-date">${tr('route.notYetScheduled')}</span>
      </div>
      <div class="rd-feed-items">
        ${unassigned.map(p => feedItem(p, 'upcoming')).join('')}
      </div>
    </div>` : '';

  return `<div class="rd-feed-list">${dayGroups}${unassignedGroup}</div>`;
}

/** Stored on the section so prev/next buttons can navigate without full re-render. */
let _calMonth = 0;  // offset in months from leg's start month; reset on new leg

function renderPlanCalendarView(leg: Leg): string {
  const plans = leg.plans ?? [];
  const planDays = ensurePlanDays(leg);
  const today = new Date().toISOString().slice(0, 10);

  // Determine the displayed month
  const legStart = new Date(leg.dateFrom + 'T00:00:00');
  const displayDate = new Date(legStart.getFullYear(), legStart.getMonth() + _calMonth, 1);
  const year = displayDate.getFullYear();
  const month = displayDate.getMonth(); // 0-based

  const monthLabel = displayDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Day-of-week offset (Mon=0 … Sun=6)
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Set of ISO dates that belong to this leg
  const legDates = new Set(planDays.map(d => d.date));

  // Build calendar cells
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  let cells = '';
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDow + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      // padding cell
      const adjDate = dayNum < 1
        ? new Date(year, month, dayNum).toISOString().slice(0, 10)
        : new Date(year, month + 1, dayNum - daysInMonth).toISOString().slice(0, 10);
      cells += `<div class="rd-cal-grid-cell rd-cal-grid-cell--other"><span class="rd-cal-grid-num">${new Date(adjDate + 'T00:00:00').getDate()}</span></div>`;
      continue;
    }
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const isToday = iso === today;
    const inLeg = legDates.has(iso);
    const planDay = planDays.find(d => d.date === iso);
    const items = planDay ? plans.filter(p => p.dayId === planDay.id).sort((a, b) => a.order - b.order) : [];

    cells += `
      <div class="rd-cal-grid-cell${isToday ? ' is-today' : ''}${inLeg ? ' in-leg' : ''}">
        <span class="rd-cal-grid-num${isToday ? ' is-today-num' : ''}">${dayNum}</span>
        ${items.slice(0, 3).map(p => {
          const cat = p.category ? categoryById(leg, p.category) : undefined;
          const color = cat?.color ?? '#f0f0f0';
          return `<div class="rd-cal-grid-item ${p.done ? 'is-done' : ''}" data-plan="${esc(p.id)}" data-act="open-plan" style="background:${esc(color)}" title="${esc(p.title)}">${esc(p.title)}</div>`;
        }).join('')}
        ${items.length > 3 ? `<div class="rd-cal-grid-more">+${items.length - 3} more</div>` : ''}
      </div>`;
  }

  const DOW_HEADERS = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

  return `
    <div class="rd-cal-grid-wrap">
      <div class="rd-cal-grid-nav">
        <button class="rd-icon-btn" data-act="cal-prev">‹</button>
        <span class="rd-cal-grid-month">${monthLabel}</span>
        <button class="rd-icon-btn" data-act="cal-next">›</button>
      </div>
      <div class="rd-cal-grid">
        ${DOW_HEADERS.map(d => `<div class="rd-cal-grid-dow">${d}</div>`).join('')}
        ${cells}
      </div>
    </div>`;
}

// Palette: one colour per day index (cycles after 14). Each entry is [bg, text].
/** Render the plan map sidebar item list (synchronous — uses cached coords). */
function renderPlanMapView(leg: Leg): string {
  const plans = leg.plans ?? [];
  const days = ensurePlanDays(leg);

  const itemRow = (p: PlanItem, colour: string) => {
    const hasCoords = p.lat != null || geocodeLocal(p.address || p.title) != null;
    return `
      <div class="rd-pmap-item${hasCoords ? '' : ' rd-pmap-item--pending'}" data-pmap-item="${esc(p.id)}" style="--day-colour:${colour}">
        <span class="rd-pmap-item-dot" style="background:${hasCoords ? colour : 'var(--ink-faint)'}"></span>
        <span class="rd-pmap-item-name">${esc(p.title)}</span>
        ${p.address ? `<span class="rd-pmap-item-addr">${esc(p.address)}</span>` : ''}
        ${!hasCoords ? `<span class="rd-pmap-item-locating">${tr('route.locating')}</span>` : ''}
      </div>`;
  };

  // Build sidebar legend rows grouped by day — show ALL items, not just geocoded ones
  const dayRows = days.map((day, i) => {
    const items = plans.filter(p => p.dayId === day.id);
    if (!items.length) return '';
    const colour = dayColour(i);
    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return `
      <div class="rd-pmap-day-group">
        <div class="rd-pmap-day-head">
          <span class="rd-pmap-day-dot" style="background:${colour}"></span>
          <span class="rd-pmap-day-label">${tr('route.dayPrefix', { n: i + 1 })}</span>
          <span class="rd-pmap-day-date">${dateLabel}</span>
        </div>
        ${items.map(p => itemRow(p, colour)).join('')}
      </div>`;
  }).join('');

  const unassigned = plans.filter(p => !p.dayId);
  const unassignedRows = unassigned.length ? `
    <div class="rd-pmap-day-group">
      <div class="rd-pmap-day-head">
        <span class="rd-pmap-day-dot" style="background:var(--ink-faint)"></span>
        <span class="rd-pmap-day-label">${tr('route.unassigned')}</span>
      </div>
      ${unassigned.map(p => itemRow(p, 'var(--ink-faint)')).join('')}
    </div>` : '';

  const hasAny = plans.length > 0;
  const hint = !hasAny
    ? `<div class="rd-placeholder rd-placeholder-soft" style="margin-top:var(--sp-3)"><span>${tr('route.planMapEmpty')}</span></div>`
    : '';

  return `
    <div class="rd-plan-map-layout">
      <div class="rd-plan-map-tile" id="rd-plan-leaflet" data-leg-id="${esc(leg.id)}"></div>
      <aside class="rd-plan-map-panel">
        <div class="rd-pmap-header">
          <span class="rd-plan-map-flag">${leg.flag || '🗺️'}</span>
          <div>
            <div class="rd-plan-map-city-name">${esc(leg.city)}</div>
            <div class="rd-plan-map-city-meta">${fmtDate(leg.dateFrom)} → ${fmtDate(leg.dateTo)}</div>
          </div>
        </div>
        <div class="rd-pmap-list">
          ${dayRows}${unassignedRows}${hint}
        </div>
      </aside>
    </div>`;
}

/** Geocode all plan items that have an address or title, caching lat/lng back to Firestore. */
async function geocodePlanItems(leg: Leg) {
  const plans = leg.plans ?? [];
  const needsGeocode = plans.filter(p => p.lat == null && (p.address || p.title));
  if (!needsGeocode.length) return;

  const updated = [...plans];
  let changed = false;
  for (const p of needsGeocode) {
    const query = p.address || `${p.title}, ${leg.city}`;
    const hit = await geocode(query, leg.country);
    if (!hit) continue;
    const idx = updated.findIndex(x => x.id === p.id);
    if (idx >= 0) { updated[idx] = { ...updated[idx], lat: hit.lat, lng: hit.lng }; changed = true; }
  }
  if (changed) patchLeg(leg.id, { plans: clean(updated) });
}

/** Bearing in degrees (0 = north, clockwise) from point A to point B. */
function initPlanLeaflet(timeline: HTMLElement, leg: Leg) {
  const mapEl = timeline.querySelector<HTMLElement>('#rd-plan-leaflet');
  if (!mapEl) {
    if (_planLeaflet) { _planLeaflet.remove(); _planLeaflet = null; _planLeafletEl = null; }
    return;
  }
  if (_planLeaflet && _planLeafletEl === mapEl) { _planLeaflet.invalidateSize(); return; }
  if (_planLeaflet) { _planLeaflet.remove(); _planLeaflet = null; _planLeafletEl = null; }

  const map = L.map(mapEl, { zoomControl: true, attributionControl: false });
  _planLeaflet = map;
  _planLeafletEl = mapEl;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  L.control.attribution({ prefix: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>' }).addTo(map);

  const days = ensurePlanDays(leg);
  const plans = leg.plans ?? [];
  const cityCoords = coordsFor(leg.city);

  const boundsMarkers: L.Marker[] = [];

  // City centre marker (grey)
  if (cityCoords) {
    const icon = L.divIcon({
      className: 'rd-pmap-pin rd-pmap-pin--city',
      html: `<span class="rd-pmap-pin-label">${leg.city}</span>`,
      iconSize: [0, 0], iconAnchor: [0, 0],
    });
    L.marker([cityCoords.lat, cityCoords.lng], { icon }).addTo(map);
    boundsMarkers.push(L.marker([cityCoords.lat, cityCoords.lng], { opacity: 0 }).addTo(map));
  }

  // Per-day: draw dashed route lines with arrowheads, then markers on top
  days.forEach((day, dayIdx) => {
    const colour = dayColour(dayIdx);
    const dayPlans = plans
      .filter(p => p.dayId === day.id && p.lat != null && p.lng != null)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    if (dayPlans.length >= 2) {
      const coords: [number, number][] = dayPlans.map(p => [p.lat!, p.lng!]);

      // Dashed polyline
      L.polyline(coords, {
        color: colour,
        weight: 2.5,
        opacity: 0.85,
        dashArray: '6 5',
      }).addTo(map);

      // Arrowhead at midpoint of each segment
      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i], b = coords[i + 1];
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const deg = bearing(a, b);
        const arrowIcon = L.divIcon({
          className: '',
          html: `<div class="rd-pmap-arrow" style="transform:rotate(${deg - 90}deg);color:${colour}">▶</div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        L.marker(mid, { icon: arrowIcon, interactive: false }).addTo(map);
      }
    }
  });

  // Plan item markers coloured by day (rendered after lines so they appear on top)
  for (const p of plans) {
    if (p.lat == null || p.lng == null) continue;
    const dayIdx = p.dayId ? days.findIndex(d => d.id === p.dayId) : -1;
    const colour = dayIdx >= 0 ? dayColour(dayIdx) : '#94a3b8';
    const label = dayIdx >= 0 ? `D${dayIdx + 1}` : '?';

    const icon = L.divIcon({
      className: 'rd-pmap-pin',
      html: `<span class="rd-pmap-pin-badge" style="background:${colour}">${label}</span><span class="rd-pmap-pin-label">${esc(p.title)}</span>`,
      iconSize: [0, 0], iconAnchor: [0, 0],
    });
    const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
    marker.on('click', () => {
      const el = timeline.querySelector<HTMLElement>(`[data-pmap-item="${p.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      el?.classList.add('is-highlighted');
      setTimeout(() => el?.classList.remove('is-highlighted'), 1500);
    });
    boundsMarkers.push(marker);
  }

  if (boundsMarkers.length > 1) {
    const group = L.featureGroup(boundsMarkers);
    map.fitBounds(group.getBounds().pad(0.3));
  } else if (cityCoords) {
    map.setView([cityCoords.lat, cityCoords.lng], 13);
  } else {
    map.setView([48, 6], 4);
  }

  // Wire sidebar items to fly-to on map
  timeline.querySelectorAll<HTMLElement>('[data-pmap-item]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.pmapItem!;
      const p = plans.find(x => x.id === id);
      if (p?.lat != null && p?.lng != null) map.flyTo([p.lat, p.lng], 15, { duration: 0.7 });
    });
  });

  // Kick off geocoding in background — new coords will arrive via Firestore subscription
  void geocodePlanItems(leg);
}

const PLANS_ONBOARDED_KEY = 'route-plans-onboarded';

function renderPlansSection(leg: Leg): string {
  const views: { id: PlanView; label: string }[] = [
    { id: 'board',    label: '📋 Board' },
    { id: 'feed',     label: '📖 Feed' },
    { id: 'category', label: '🏷️ Category' },
    { id: 'calendar', label: '📅 Calendar' },
    { id: 'map',      label: '🗺️ Map' },
  ];

  const cats = allCategories(leg);
  const catOptions = `<option value="">${tr('route.categorySelect')}</option>` +
    cats.map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('');

  let body = '';
  if (_planView === 'board')         body = renderPlanBoardView(leg);
  else if (_planView === 'feed')     body = renderPlanFeedView(leg);
  else if (_planView === 'category') body = renderPlanCategoryView(leg);
  else if (_planView === 'calendar') body = renderPlanCalendarView(leg);
  else                               body = renderPlanMapView(leg);

  const plans = leg.plans ?? [];
  const unassigned = plans.filter(p => !p.dayId).sort((a, b) => a.order - b.order);

  const showOnboard = !localStorage.getItem(PLANS_ONBOARDED_KEY) && !plans.length;
  const onboardBanner = showOnboard ? `
    <div class="rd-plans-onboard" id="rd-plans-onboard">
      <span>${tr('route.planOnboard')}</span>
      <button class="rd-plans-onboard-close" data-act="dismiss-onboard" title="Dismiss">✕</button>
    </div>` : '';

  const sidebar = `
    <div class="rd-plan-sidebar">
      <div class="rd-plan-unassigned-head">
        <span class="rd-plan-unassigned-title">${tr('route.unassigned')}</span>
        ${unassigned.length ? `<span class="rd-plan-unassigned-badge">${unassigned.length}</span>` : ''}
      </div>
      <div class="rd-plan-drop-zone pk-drop-zone rd-plan-unassigned-items" data-day-id="">
        ${unassigned.map(p => renderPlanItem(p, leg)).join('')}
        ${unassigned.length === 0 ? `<div class="rd-plan-drop-hint">${tr('route.newItemsHint')}</div>` : ''}
      </div>
    </div>`;

  return `
    <section class="rd-section rd-section--plans" id="rd-plan-section">
      <div class="rd-plan-header">
        <div class="rd-plan-header-top">
          <h3>✨ Plan</h3>
          <div class="rd-view-tabs">
            ${views.map(v => `<button class="rd-view-tab ${_planView === v.id ? 'is-active' : ''}" data-act="plan-view" data-view="${v.id}">${v.label}</button>`).join('')}
          </div>
        </div>
        <div class="rd-plan-add-bar">
          <input class="input rd-add-input" id="rd-plan-input" placeholder="${tr('route.planPlaceholder')}">
          <select class="input select rd-plan-cat-sel" id="rd-plan-cat">${catOptions}</select>
          <input class="input rd-plan-dur-input" id="rd-plan-duration" placeholder="${tr('route.planDurationPh')}">
          <input class="input rd-plan-cost-input" id="rd-plan-cost" placeholder="${tr('route.planCostPh')}">
          <button class="btn btn-primary rd-sm" data-act="add-plan">+ Add</button>
        </div>
        <div id="rd-plan-add-details" class="rd-plan-add-details" hidden>
          <input class="input" id="rd-plan-note" placeholder="${tr('route.planNoteLabel')}">
        </div>
      </div>
      ${onboardBanner}
      <div class="rd-plan-layout">
        <div class="rd-plan-main">
          ${body}
        </div>
        ${sidebar}
      </div>
    </section>`;
}

function renderDetail(leg: Leg): string {
  const days = daysBetween(leg.dateFrom, leg.dateTo);
  const status = legStatus(leg);
  return `
    <div class="rd-shell status-${status}">
      <div class="rd-topbar">
        <button class="btn btn-ghost rd-back" data-act="back">${tr('route.btnBackAllStops')}</button>
        <div class="rd-title">
          <span class="rd-title-flag">${leg.flag || '🗺️'}</span>
          <span class="rd-title-city">${esc(leg.city)}</span>
          <span class="rd-title-country">${esc(leg.country)}</span>
        </div>
        <button class="btn btn-ghost rd-sm rd-guide-link" data-act="open-guide">${leg.flag || ''} ${tr('route.btnCityGuide')}</button>
        <button class="btn btn-ghost rd-sm" data-act="open-compare">${tr('route.btnCompare')}</button>
      </div>
      <div class="rd-datebar">
        <span class="rd-status-pill status-${status}">${status === 'active' ? tr('route.statusActive') : status === 'past' ? tr('route.statusPast') : tr('route.statusUpcoming')}</span>
        <div class="rd-datebar-dates" id="rd-datebar-dates">
          <span class="rd-datebar-label">${fmtDate(leg.dateFrom)} → ${fmtDate(leg.dateTo)} · ${days} night${days !== 1 ? 's' : ''}</span>
          <button class="rd-datebar-edit-btn" data-act="edit-dates" title="Edit dates">✎</button>
        </div>
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

  // Skip re-render if only note cards changed (suppress one echo to avoid typing flicker).
  if (selected && _notesSuppressed.has(selected.id)) {
    _notesSuppressed.delete(selected.id);
    return;
  }

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
    openTripChooser({ title: tr('route.linkTripTitle'), subtitle: tr('route.linkTripSubtitle') });
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
      _calMonth = 0;
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

  on('back', () => {
    if (_planLeaflet) { _planLeaflet.remove(); _planLeaflet = null; _planLeafletEl = null; }
    selectedLegId = null;
    render();
  });
  on('open-guide', () => navigateTo('cities'));
  on('open-compare', () => navigateTo('budget', { city: leg.city, dateFrom: leg.dateFrom } satisfies NavIntent));

  /* — Dates — */
  on('edit-dates', () => openDatesEditor(timeline, leg, patchLeg));

  /* — Transport — */
  on('toggle-transport-confirmed', () => {
    if (!leg.arrivalTransport) return;
    patchLeg(leg.id, { arrivalTransport: { ...leg.arrivalTransport, confirmed: !leg.arrivalTransport.confirmed } });
  });
  on('del-transport', () => {
    if (confirm('Remove transport details for this stop?')) rewriteLeg(leg, ['arrivalTransport']);
  });
  on('edit-transport', () => openTransportEditor(timeline, leg, patchLeg, (tl, l) => openTransportSyncDialog(tl, l, patchLeg)));
  on('sync-transport', () => {
    if (leg.arrivalTransport?.priceAmount != null) openTransportSyncDialog(timeline, leg, patchLeg);
  });

  /* — Stays — */
  on('add-stay', () => openStayEditor(timeline, leg, null, patchLeg, persistStays));
  on('edit-stay', (el) => openStayEditor(timeline, leg, el.dataset.stay!, patchLeg, persistStays));
  on('del-stay', (el) => {
    const stays = legStays(leg);
    const key = el.dataset.stay!;
    const next = stays.filter((s, i) => (s.id ?? String(i)) !== key);
    if (confirm('Remove this stay?')) persistStays(leg, next);
  });
  on('sync-stay', (el) => {
    const stays = legStays(leg);
    const key = el.dataset.stay!;
    const stay = stays.find((s, i) => (s.id ?? String(i)) === key);
    if (stay) openStaySyncDialog(timeline, leg, key, stay, patchLeg, persistStays);
  });

  /* — Notes — */
  function saveNoteCards(cards: NoteCard[]) {
    // Patch in-memory leg so the Firestore echo finds the same value and render() is suppressed.
    const idx = legs.findIndex(l => l.id === leg.id);
    if (idx >= 0) legs[idx] = { ...legs[idx], noteCards: cards };
    leg.noteCards = cards;
    _notesSuppressed.add(leg.id);
    patchLeg(leg.id, { noteCards: clean(cards) });
  }

  // Add note
  on('add-note', () => {
    const cards = legNoteCards(leg);
    const next: NoteCard = {
      id: uid(), title: '', body: '',
      color: noteColor(cards.length),
      order: cards.length,
    };
    patchLeg(leg.id, { noteCards: clean([...cards, next]) });
  });

  // Delete note
  on('del-note', (el) => {
    const id = el.dataset.noteId!;
    const cards = legNoteCards(leg).filter(c => c.id !== id);
    patchLeg(leg.id, { noteCards: clean(cards) });
  });

  // Per-card textarea & title — debounced, no re-render
  let _noteTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  const MAX_NOTE_H = 150;

  function autoHeight(ta: HTMLTextAreaElement) {
    ta.style.height = '0';
    const natural = ta.scrollHeight;
    ta.style.height = Math.min(natural, MAX_NOTE_H) + 'px';
    const wrap = ta.closest<HTMLElement>('.rd-note-body-wrap');
    if (wrap) wrap.classList.toggle('is-overflow', natural > MAX_NOTE_H);
  }

  timeline.querySelectorAll<HTMLTextAreaElement>('.rd-note-body').forEach(ta => {
    autoHeight(ta); // set initial height
    ta.addEventListener('input', () => {
      autoHeight(ta);
      const id = ta.dataset.noteId!;
      clearTimeout(_noteTimers[id]);
      _noteTimers[id] = setTimeout(() => {
        const cards = legNoteCards(leg).map(c => c.id === id ? { ...c, body: ta.value } : c);
        saveNoteCards(cards);
      }, 800);
    });
  });

  timeline.querySelectorAll<HTMLInputElement>('.rd-note-title-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const id = inp.dataset.noteId!;
      clearTimeout(_noteTimers[id + '-title']);
      _noteTimers[id + '-title'] = setTimeout(() => {
        const cards = legNoteCards(leg).map(c => c.id === id ? { ...c, title: inp.value } : c);
        saveNoteCards(cards);
      }, 600);
    });
  });

  // Color swatch picker
  timeline.querySelectorAll<HTMLButtonElement>('.rd-note-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      const id = sw.dataset.noteId!;
      const color = sw.dataset.color!;
      const cards = legNoteCards(leg).map(c => c.id === id ? { ...c, color } : c);
      // Update card background immediately without full re-render
      const card = timeline.querySelector<HTMLElement>(`.rd-note-card[data-note-id="${id}"]`);
      if (card) {
        card.style.background = color;
        card.querySelectorAll<HTMLButtonElement>('.rd-note-color-swatch').forEach(s => s.classList.toggle('is-active', s.dataset.color === color));
      }
      saveNoteCards(cards);
    });
  });

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

  on('preview-clip', (el, e) => {
    if ((e.target as HTMLElement).closest('[data-act]:not([data-act="preview-clip"])')) return;
    const id = el.dataset.clipPreview ?? el.closest<HTMLElement>('[data-clip-preview]')?.dataset.clipPreview;
    if (!id) return;
    const clip = (leg.clips ?? []).find(c => c.id === id);
    if (!clip) return;
    const cat = clip.category ? categoryById(leg, clip.category) : undefined;
    const color = cat?.color ?? '#ebebeb';
    const host = timeline.querySelector<HTMLElement>('.rd-shell')!;
    const dlg = document.createElement('div');
    dlg.className = 'rd-editor-overlay';
    dlg.innerHTML = `
      <div class="rd-editor rd-clip-preview-modal">
        <div class="rd-clip-preview-top">
          ${cat ? `<span class="rd-cat-badge" style="background:${esc(color)}">${esc(cat.label)}</span>` : ''}
          <button class="rd-note-del rd-clip-preview-close" data-ed="close">✕</button>
        </div>
        ${clipImages(clip).map(u => `<img class="rd-clip-preview-img" src="${esc(u)}" alt="">`).join('')}
        ${clip.url
          ? `<a class="rd-clip-preview-title" href="${esc(/^https?:\/\//i.test(clip.url) ? clip.url : 'https://' + clip.url)}" target="_blank" rel="noopener">${esc(clip.title || clip.url)}</a>`
          : (clip.title ? `<div class="rd-clip-preview-title">${esc(clip.title)}</div>` : '')}
        ${clip.body ? `<div class="rd-clip-preview-body">${esc(clip.body)}</div>` : ''}
        <div class="rd-editor-btns" style="margin-top:var(--sp-4)">
          <button class="btn btn-ghost" data-ed="close">Close</button>
          <button class="btn btn-ghost" data-act="edit-clip" data-clip="${esc(id)}">Edit</button>
        </div>
      </div>`;
    host.appendChild(dlg);
    const close = () => dlg.remove();
    dlg.querySelectorAll('[data-ed="close"]').forEach(b => b.addEventListener('click', close));
    dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
    dlg.querySelector<HTMLElement>('[data-act="edit-clip"]')?.addEventListener('click', () => {
      close();
      openClipEditor(timeline, leg, id);
    });
  });

  on('expand-note', (el) => {
    const id = el.dataset.noteId!;
    const card = legNoteCards(leg).find(c => c.id === id);
    if (!card) return;
    const color = card.color ?? NOTE_COLORS[0];
    const host = timeline.querySelector<HTMLElement>('.rd-shell')!;
    const dlg = document.createElement('div');
    dlg.className = 'rd-editor-overlay';
    dlg.innerHTML = `
      <div class="rd-editor rd-note-expand-modal" style="background:${esc(color)}">
        <div class="rd-note-card-head">
          <div class="rd-note-expand-title">${esc(card.title || 'Note')}</div>
          <button class="rd-note-del" data-ed="close" style="opacity:1">✕</button>
        </div>
        <div class="rd-note-expand-body">${esc(card.body)}</div>
      </div>`;
    host.appendChild(dlg);
    const close = () => dlg.remove();
    dlg.querySelector('[data-ed="close"]')!.addEventListener('click', close);
    dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  });

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

  on('dismiss-onboard', () => {
    localStorage.setItem(PLANS_ONBOARDED_KEY, '1');
    timeline.querySelector('#rd-plans-onboard')?.remove();
  });

  /* — Calendar nav — */
  on('cal-prev', () => { _calMonth--; render(); });
  on('cal-next', () => { _calMonth++; render(); });

  /* — Plan add — */
  const planInput = timeline.querySelector<HTMLInputElement>('#rd-plan-input');
  const planDetails = timeline.querySelector<HTMLElement>('#rd-plan-add-details');
  planInput?.addEventListener('focus', () => { if (planDetails) planDetails.hidden = false; });

  on('add-plan', () => {
    const input = timeline.querySelector<HTMLInputElement>('#rd-plan-input');
    const catSel = timeline.querySelector<HTMLSelectElement>('#rd-plan-cat');
    const noteEl = timeline.querySelector<HTMLInputElement>('#rd-plan-note');
    const durEl = timeline.querySelector<HTMLInputElement>('#rd-plan-duration');
    const costEl = timeline.querySelector<HTMLInputElement>('#rd-plan-cost');
    const title = input?.value.trim() ?? '';
    if (!title) return;
    const plans = leg.plans ?? [];
    const next: PlanItem = {
      id: uid(), title,
      category: catSel?.value ?? '',
      note: noteEl?.value.trim() || undefined,
      duration: durEl?.value.trim() || undefined,
      cost: costEl?.value.trim() || undefined,
      dayId: null, done: false, order: plans.length,
    };
    if (input) input.value = '';
    if (noteEl) noteEl.value = '';
    if (durEl) durEl.value = '';
    if (costEl) costEl.value = '';
    if (planDetails) planDetails.hidden = true;
    patchLeg(leg.id, { plans: [...plans, clean(next)] });
  });
  planInput?.addEventListener('keydown', (e) => {
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

  /* — Plan map — */
  initPlanLeaflet(timeline, leg);
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
          <div class="rd-clip-title-row">
            <input class="input" id="ce-title" value="${esc(existing?.title ?? '')}" placeholder="e.g. Must-visit museums in Copenhagen">
            <label class="rd-clip-img-btn" id="ce-img-label" title="Add photo">
              🖼
              <input type="file" id="ce-image" accept="image/*" multiple style="display:none">
            </label>
          </div>
        </div>
        <div class="field-full" id="ce-img-previews"></div>
        <div class="field-full">
          <label class="field-label">Link (optional)</label>
          <input class="input" id="ce-url" value="${esc(existing?.url ?? '')}" placeholder="https://…">
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

  const MAX_IMAGES = 9;
  // Each entry: { localUrl: object-url for preview, file: File for upload, remoteUrl?: string already uploaded }
  type PendingImg = { localUrl: string; file?: File; remoteUrl?: string };
  const pending: PendingImg[] = clipImages(existing ?? {} as Clip).map(u => ({ localUrl: u, remoteUrl: u }));

  const previewsEl = dlg.querySelector<HTMLElement>('#ce-img-previews')!;
  const imgLabel = dlg.querySelector<HTMLElement>('#ce-img-label')!;
  const saveBtn = dlg.querySelector<HTMLButtonElement>('[data-ed="save"]')!;

  function refreshPreviews() {
    previewsEl.style.display = pending.length ? '' : 'none';
    previewsEl.className = 'rd-clip-img-previews';
    previewsEl.innerHTML = pending.map((p, i) => `
      <div class="rd-clip-img-thumb">
        <img src="${esc(p.localUrl)}" alt="">
        ${p.file && !p.remoteUrl ? '<div class="rd-clip-img-uploading">↑</div>' : ''}
        <button class="rd-clip-img-remove" data-idx="${i}" title="Remove">✕</button>
      </div>`).join('');
    imgLabel.style.display = pending.length >= MAX_IMAGES ? 'none' : '';
    previewsEl.querySelectorAll<HTMLButtonElement>('.rd-clip-img-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        const removed = pending.splice(idx, 1)[0];
        if (removed.file && removed.localUrl.startsWith('blob:')) URL.revokeObjectURL(removed.localUrl);
        refreshPreviews();
      });
    });
  }
  refreshPreviews();

  const imgInput = dlg.querySelector<HTMLInputElement>('#ce-image')!;
  imgInput.addEventListener('change', () => {
    const files = Array.from(imgInput.files ?? []).slice(0, MAX_IMAGES - pending.length);
    imgInput.value = '';
    if (!files.length) return;
    files.forEach(file => {
      const localUrl = URL.createObjectURL(file);
      const entry: PendingImg = { localUrl, file };
      pending.push(entry);
      // Upload in background — update entry when done
      uploadClipImage(file).then(result => {
        entry.remoteUrl = result.url;
        refreshPreviews();
      }).catch(err => {
        console.error('Clip upload failed:', err);
        const idx = pending.indexOf(entry);
        if (idx >= 0) pending.splice(idx, 1);
        URL.revokeObjectURL(localUrl);
        refreshPreviews();
        alert(`Upload failed: ${err instanceof Error ? err.message : 'check connection'}`);
      });
    });
    refreshPreviews();
  });

  const close = () => {
    // Revoke any remaining object URLs
    pending.forEach(p => { if (p.file && p.localUrl.startsWith('blob:')) URL.revokeObjectURL(p.localUrl); });
    dlg.remove();
  };
  dlg.querySelector('[data-ed="cancel"]')!.addEventListener('click', close);
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  saveBtn.addEventListener('click', async () => {
    const title = fieldVal(dlg, 'ce-title');
    const rawUrl = fieldVal(dlg, 'ce-url');
    const url = rawUrl && !/^https?:\/\//i.test(rawUrl) ? 'https://' + rawUrl : rawUrl;
    const body = fieldVal(dlg, 'ce-body');
    const category = (dlg.querySelector('#ce-cat') as HTMLSelectElement).value;
    if (!title && !url && !body && !pending.length) { alert('Add at least a title, link, or image.'); return; }

    // Wait for any still-uploading images (those with a file but no remoteUrl yet)
    const uploading = pending.filter(p => p.file && !p.remoteUrl);
    if (uploading.length) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Uploading…';
      await Promise.allSettled(uploading.map(p =>
        uploadClipImage(p.file!).then(r => { p.remoteUrl = r.url; }).catch(() => {})
      ));
      saveBtn.disabled = false;
      saveBtn.textContent = existing ? 'Save' : 'Add clip';
    }

    const imageUrls = pending.map(p => p.remoteUrl ?? p.localUrl).filter(u => u.startsWith('http'));
    const clips = leg.clips ?? [];
    if (existing) {
      const next = clips.map(c => c.id === clipId
        ? { ...c, title: title || undefined, url: url || undefined, body: body || undefined, imageUrls: imageUrls.length ? imageUrls : undefined, imageUrl: undefined, category }
        : c);
      patchLeg(leg.id, { clips: clean(next) });
    } else {
      const next: Clip = {
        id: uid(), kind: imageUrls.length ? 'image' : url ? 'link' : 'note',
        title: title || undefined, url: url || undefined,
        body: body || undefined, imageUrls: imageUrls.length ? imageUrls : undefined,
        category, order: clips.length,
      };
      patchLeg(leg.id, { clips: clean([...clips, next]) });
    }
    dlg.remove(); // don't use close() to avoid revoking URLs we just saved
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
        <input class="input" id="cate-name" placeholder="e.g. Nightlife">
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

/* ── Boot ───────────────────────────────────────────────────────────────── */

/** Open a specific leg (and remember a day to scroll to) from a nav intent. */
function applyNavIntent() {
  const intent = consumeNavIntent('route');
  if (!intent?.legId) return;
  selectedLegId = intent.legId;
  addFormOpen = false;
  _calMonth = 0;
  render();
  const root = document.getElementById('view-route');
  const target = intent.dayId
    ? root?.querySelector<HTMLElement>(`[data-day-id="${intent.dayId}"]`)
    : root?.querySelector<HTMLElement>('.route-timeline');
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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
    applyNavIntent();
  });

  // A re-activation (view already mounted) won't re-run init — listen so a
  // Today deep-link can still open the right leg.
  if (!_navIntentBound) {
    _navIntentBound = true;
    window.addEventListener('otr:nav-intent', (e) => {
      if ((e as CustomEvent).detail?.view === 'route') applyNavIntent();
    });
  }
}
