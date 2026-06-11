/* ==========================================================================
   On the Road · Pack — simple weight-aware packing
   --------------------------------------------------------------------------
   Two screens:
     list   → pack lists + the Core Kit template (your reusable must-bring gear)
     detail → containers (each with its own weight limit) + an Unassigned area

   Mental model: add the bags you're taking, give each a weight limit, then drop
   items into them. Each container tallies its own weight live and warns when it
   goes over. Items you're unsure about sit in Unassigned (weight uncounted)
   until you commit them to a bag — or drop them to travel lighter.
   ========================================================================== */

import './pack.css';
import { packStore, STANDALONE_TRIP_ID, type StoredPackList } from '../../data/stores/pack-store.ts';
import { currentTrip, currentTripId } from '../../data/trip-context.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { openModal } from '../../core/modal.ts';
import { coreKitStore, type StoredCoreKitItem } from '../../data/stores/core-kit-store.ts';
import { itemWeightG, formatKg, itemsPresentAtLeg } from '../../data/packing-formula.ts';
import { buildPackSuggestions } from '../../data/pack-suggestions.ts';
import type { PackList, PackItem, PackContainer, PackPriority } from '../../data/schema.ts';
import { escHtml } from '../../core/utils.ts';
import { consumeNavIntent } from '../../core/app.ts';

/* ── Item categories ─────────────────────────────────────────────────────── */
// Colors: NOTE_PALETTE tones extended with a few extra muted hues.
// Each category gets a fixed pastel background so tags are instantly readable.
export const PACK_CATEGORIES: { label: string; value: string; color: string }[] = [
  { value: 'electronics', label: 'Electronics',  color: '#e2edf3' }, // blue-grey
  { value: 'clothing',    label: 'Clothing',      color: '#ece2f3' }, // lavender
  { value: 'toiletries',  label: 'Toiletries',    color: '#e2f3ec' }, // mint
  { value: 'documents',   label: 'Documents',     color: '#f3ede2' }, // sand
  { value: 'health',      label: 'Health & Med',  color: '#f3e6e6' }, // blush
  { value: 'feminine',    label: 'Feminine',      color: '#f0e2f3' }, // lilac
  { value: 'consumables', label: 'Consumables',   color: '#e6f3e6' }, // sage
  { value: 'food',        label: 'Food',          color: '#f3f0e2' }, // cream
  { value: 'gifts',       label: 'Gifts',         color: '#f3e2e8' }, // rose
  { value: 'other',       label: 'Other',         color: '#ebebeb' }, // neutral
];

const DEFAULT_CATEGORY = 'other';

function categoryColor(value: string): string {
  return PACK_CATEGORIES.find(c => c.value === value)?.color ?? '#ebebeb';
}

function categoryLabel(value: string): string {
  return PACK_CATEGORIES.find(c => c.value === value)?.label ?? value;
}

function categoryOptions(selected = DEFAULT_CATEGORY): string {
  return PACK_CATEGORIES.map(c =>
    `<option value="${c.value}" ${c.value === selected ? 'selected' : ''}>${c.label}</option>`
  ).join('');
}

/* ── Weight unit support ─────────────────────────────────────────────────── */

type WeightUnit = 'kg' | 'g' | 'lb' | 'jin';

const WEIGHT_UNITS: { value: WeightUnit; label: string }[] = [
  { value: 'kg', label: 'kg' },
  { value: 'g',  label: 'g' },
  { value: 'lb', label: 'lb' },
  { value: 'jin', label: '斤 (jin)' },
];

// Converts a value in the given unit to grams.
function toGrams(val: number, unit: WeightUnit): number {
  if (unit === 'g')   return val;
  if (unit === 'lb')  return val * 453.592;
  if (unit === 'jin') return val * 500;
  return val * 1000; // kg
}

// Displays grams in the user's preferred unit.
function displayWeight(g: number, unit: WeightUnit): string {
  if (unit === 'g')   return `${Math.round(g)}g`;
  if (unit === 'lb')  return `${(g / 453.592).toFixed(1)}lb`;
  if (unit === 'jin') return `${(g / 500).toFixed(2)}斤`;
  return `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 1)}kg`;
}

/* ── State ───────────────────────────────────────────────────────────────── */

type Screen = 'list' | 'detail';

let screen: Screen = 'list';
let activeId: string | null = null;
let packCheckMode = false;
let weightUnit: WeightUnit = (localStorage.getItem('pk-weight-unit') as WeightUnit) ?? 'kg';

let _lists: StoredPackList[] = [];
let _kit: StoredCoreKitItem[] = [];
let _legs: StoredLeg[] = [];

let _unsubLists: (() => void) | null = null;
let _unsubStandaloneLists: (() => void) | null = null;
let _unsubKit: (() => void) | null = null;
let _unsubLegs: (() => void) | null = null;

let _tripLists: StoredPackList[] = [];
let _standaloneLists: StoredPackList[] = [];

const KINDS: { value: PackContainer['kind']; label: string }[] = [
  { value: 'backpack', label: 'Backpack' },
  { value: 'suitcase', label: 'Suitcase' },
  { value: 'personal', label: 'Personal' },
];

const PRIORITIES: { value: PackPriority; label: string }[] = [
  { value: 'essential', label: 'Essential' },
  { value: 'nice', label: 'Nice' },
  { value: 'optional', label: 'Optional' },
];

// Lower rank = drop first when over weight. Falls back gracefully for any
// legacy/unknown priority value read off an old document.
const PRIORITY_RANK: Record<PackPriority, number> = { optional: 0, nice: 1, essential: 2 };
function priRank(p: PackItem['priority']): number {
  return PRIORITY_RANK[p as PackPriority] ?? 1;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function getRoot(): HTMLElement | null {
  return document.getElementById('view-pack');
}

function activeList(): StoredPackList | undefined {
  return activeId ? _lists.find(l => l.id === activeId) : undefined;
}

function num(v: string, fallback = 0): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function kindLabel(kind: PackContainer['kind']): string {
  return KINDS.find(k => k.value === kind)?.label ?? kind;
}

/** Total weight inside a container = its items + the empty bag's own weight. */
function containerWeight(list: PackList, c: PackContainer): number {
  const items = list.items
    .filter(it => it.containerId === c.id)
    .reduce((sum, it) => sum + itemWeightG(it), 0);
  return items + c.selfWeightG;
}

/** Whole-list weight = every item + every bag's self-weight (Unassigned counts items only). */
export function listTotalWeight(list: PackList): number {
  const items = list.items.reduce((s, it) => s + itemWeightG(it), 0);
  const bags = list.containers.reduce((s, c) => s + c.selfWeightG, 0);
  return items + bags;
}

function isOver(list: PackList, c: PackContainer): boolean {
  return c.limitG > 0 && containerWeight(list, c) > c.limitG;
}

function genLocalId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ── Subscriptions ───────────────────────────────────────────────────────── */

function startSubscriptions() {
  _unsubLists?.();
  _unsubStandaloneLists?.();
  _unsubKit?.();
  _unsubLegs?.();
  _unsubLists = packStore.subscribe(rows => {
    _tripLists = rows;
    _lists = [..._tripLists, ..._standaloneLists];
    render();
  });
  _unsubStandaloneLists = packStore.subscribe(rows => {
    _standaloneLists = rows;
    _lists = [..._tripLists, ..._standaloneLists];
    render();
  }, STANDALONE_TRIP_ID);
  _unsubKit = coreKitStore.subscribe(rows => { _kit = rows; render(); });
  _unsubLegs = routeStore.subscribe(rows => {
    _legs = [...rows].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
    render();
  });
}

/* ── Render dispatch ─────────────────────────────────────────────────────── */

function render() {
  const root = getRoot();
  if (!root) return;
  const body = root.querySelector<HTMLElement>('.pack-body');
  if (!body) return;
  if (screen === 'detail' && activeList()) renderDetail(body, activeList()!);
  else { screen = 'list'; renderList(body); }
}

/* ── Trip itinerary bar ──────────────────────────────────────────────────── */

function renderTripBar(): string {
  const tripId = currentTripId();
  if (!tripId) return '';
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = routeStore.peek()
    .filter((l) => l.tripId === tripId && l.dateTo >= today)
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))
    .slice(0, 6);
  if (!upcoming.length) return '';

  const chips = upcoming.map((l) => {
    const weatherUrl = `https://www.google.com/search?q=weather+${encodeURIComponent(l.city)}`;
    return `<a class="pack-trip-chip" href="${weatherUrl}" target="_blank" rel="noopener" title="Check weather in ${escHtml(l.city)}">
      <span class="pack-trip-chip-flag">${escHtml(l.flag || '🗺️')}</span>
      <span class="pack-trip-chip-city">${escHtml(l.city)}</span>
      <span class="pack-trip-chip-date">${escHtml(l.dateFrom.slice(5))}</span>
    </a>`;
  }).join('');

  return `<div class="pack-trip-bar">
    <span class="pack-trip-bar-label">Upcoming</span>
    <div class="pack-trip-chips">${chips}</div>
    <span class="pack-trip-bar-hint">Tap a city to check weather</span>
  </div>`;
}

/* ── List screen ─────────────────────────────────────────────────────────── */

function renderList(c: HTMLElement) {
  const kitTotal = _kit.reduce((s, k) => s + k.weightG, 0);
  c.innerHTML = `
    ${renderTripBar()}
    <div class="pack-action-bar">
      <button class="btn btn-primary" id="pk-new">+ New Pack List</button>
      ${_legs.length > 0 ? `<button class="btn btn-ghost" id="pk-formula">✨ Pack Formula</button>` : ''}
    </div>

    ${_lists.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">🎒</div>
        <p>No pack lists yet.</p>
        <p style="font-size:var(--fs-sm);color:var(--ink-faint)">Create one, add your bags with weight limits, then drop items in and keep each bag under budget.</p>
      </div>
    ` : `
      <div class="pack-grid">
        ${_lists.map(renderListCard).join('')}
      </div>
    `}

    <div class="pack-kit-section">
      <div class="pack-section-header">
        <div class="pack-section-title">Core Kit</div>
        <div class="pack-kit-header-right">
          ${_kit.length > 0 ? `<span class="pack-kit-total">${displayWeight(kitTotal, weightUnit)} total</span>` : ''}
          <select class="pack-unit-sel" id="pk-unit-sel">
            ${WEIGHT_UNITS.map(u => `<option value="${u.value}" ${u.value === weightUnit ? 'selected' : ''}>${u.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="pack-kit-hint">Your reusable must-bring gear. Maintain it once here; pull it into any new pack list with one click.</p>
      <div class="pack-kit-table">
        <div class="pack-kit-thead">
          <span>Item</span><span>Category</span><span>Weight (${weightUnit === 'jin' ? '斤' : weightUnit})</span><span></span>
        </div>
        ${_kit.map(renderKitRow).join('')}
        ${renderKitAddRow()}
      </div>
    </div>

  `;
  bindList(c);
}

function renderListCard(l: StoredPackList): string {
  const total = listTotalWeight(l);
  const over = l.containers.some(c => isOver(l, c));
  return `
    <div class="pack-card ${over ? 'is-over' : ''}" data-id="${l.id}">
      <div class="pack-card-top">
        <div class="pack-card-name">${escHtml(l.name)}</div>
        <button class="pk-del-list" data-id="${l.id}" title="Delete">✕</button>
      </div>
      <div class="pack-card-meta">${l.containers.length} bags · ${l.items.length} items</div>
      <div class="pack-card-weight ${over ? 'is-over' : ''}">${formatKg(total)}${over ? ' · over limit' : ''}</div>
    </div>
  `;
}

function kitWeightDisplay(weightG: number): string {
  // Display in user unit for existing rows; input in user unit too.
  if (weightUnit === 'g')   return String(Math.round(weightG));
  if (weightUnit === 'lb')  return (weightG / 453.592).toFixed(2);
  if (weightUnit === 'jin') return (weightG / 500).toFixed(3);
  return (weightG / 1000).toFixed(weightG % 1000 === 0 ? 0 : 2);
}

function renderKitRow(k: StoredCoreKitItem): string {
  const catVal = PACK_CATEGORIES.find(c => c.label === k.category || c.value === k.category)?.value ?? DEFAULT_CATEGORY;
  return `
    <div class="pack-kit-row" data-id="${k.id}">
      <input class="pack-kit-cell-input" data-id="${k.id}" data-field="name" value="${escHtml(k.name)}" placeholder="Item name">
      <select class="pack-kit-cell-input pk-cat-sel" data-id="${k.id}" data-field="category">
        ${categoryOptions(catVal)}
      </select>
      <input class="pack-kit-cell-input pk-weight-input" data-id="${k.id}" data-field="weightG" type="number" min="0" step="any" value="${kitWeightDisplay(k.weightG)}" placeholder="0">
      <button class="pk-del-kit" data-id="${k.id}" title="Remove">✕</button>
    </div>
  `;
}

function renderKitAddRow(): string {
  return `
    <div class="pack-kit-row pack-kit-add-row" id="pk-kit-add-row">
      <input class="pack-kit-cell-input" id="pk-kit-name" placeholder="+ Add item… (Enter to save)">
      <select class="pack-kit-cell-input pk-cat-sel" id="pk-kit-cat">
        ${categoryOptions('electronics')}
      </select>
      <input class="pack-kit-cell-input pk-weight-input" id="pk-kit-weight" type="number" min="0" step="any" placeholder="0">
      <span></span>
    </div>
  `;
}

/* ── Bag change summary strip (above containers) ─────────────────────────── */

function renderBagChangeSummary(l: StoredPackList): string {
  // Show items that have been acquired or dropped during the trip
  const acquired = l.items.filter(it => it.acquiredLegId);
  const dropped  = l.items.filter(it => it.droppedLegId);
  if (!acquired.length && !dropped.length) return '';

  const acqChips = acquired.map(it => {
    const leg = _legs.find(lg => lg.id === it.acquiredLegId);
    return `<span class="pk-bl-chip pk-bl-chip--add" title="Acquired in ${leg ? escHtml(leg.city) : ''}">+ ${escHtml(it.name)}</span>`;
  }).join('');
  const dropChips = dropped.map(it => {
    const leg = _legs.find(lg => lg.id === it.droppedLegId);
    return `<span class="pk-bl-chip pk-bl-chip--drop" title="Left in ${leg ? escHtml(leg.city) : ''}">− ${escHtml(it.name)}</span>`;
  }).join('');

  return `<div class="pk-change-strip">${acqChips}${dropChips}</div>`;
}

/* ── Detail screen ───────────────────────────────────────────────────────── */

function renderDetail(c: HTMLElement, l: PackList) {
  const unassigned = l.items.filter(i => i.containerId === null);
  const hasLegs = _legs.length > 0;
  c.innerHTML = `
    <div class="pack-detail">
      <div class="pack-detail-bar">
        <button class="btn btn-ghost pk-sm" id="pk-back">← All lists</button>
        <div class="pack-detail-title">${escHtml(l.name)}</div>
        <div class="pack-detail-actions">
          ${hasLegs ? `<button class="btn btn-ghost pk-sm" id="pk-record-change">↕ Record change</button>` : ''}
          <button class="btn btn-ghost pk-sm" id="pk-open-add-bag">+ Add bag</button>
          <label class="pk-toggle"><input type="checkbox" id="pk-check-mode" ${packCheckMode ? 'checked' : ''}> Pack-check</label>
        </div>
      </div>

      ${packCheckMode ? renderPackCheck(l) : ''}

      ${renderBagChangeSummary(l as StoredPackList)}

      <div class="pack-containers-grid">
        ${l.containers.map(ct => renderContainerCard(l, ct)).join('')}
        ${renderUnassigned(l, unassigned)}
      </div>

      <div class="pack-add-panel">
        <span class="pack-add-label">New item</span>
        <input class="input pack-add-name" id="pk-add-name" placeholder="Name…">
        <select class="input pack-add-cat" id="pk-add-cat">
          ${categoryOptions('other')}
        </select>
        <input class="input pack-add-weight" id="pk-add-weight" type="number" min="0" step="any" placeholder="${weightUnit === 'jin' ? '斤' : weightUnit}">
        <select class="input pack-add-pri" id="pk-add-pri">
          ${PRIORITIES.map(p => `<option value="${p.value}">${p.label}</option>`).join('')}
        </select>
        <button class="btn btn-primary pk-sm" id="pk-add-item">Add ↵</button>
      </div>
    </div>

    <div id="pk-drag-ghost" class="pk-drag-ghost" hidden></div>
  `;
  bindDetail(c, l);
}

function renderContainerCard(l: PackList, c: PackContainer): string {
  const used = containerWeight(l, c);
  const over = isOver(l, c);
  const pct = c.limitG > 0 ? Math.min(100, (used / c.limitG) * 100) : 0;
  const items = l.items
    .filter(i => i.containerId === c.id)
    .sort((a, b) => priRank(a.priority) - priRank(b.priority) || a.order - b.order);
  // When over, flag the lowest-priority items in this bag as drop candidates.
  const dropCandidate = new Set<string>();
  if (over) {
    let excess = used - c.limitG;
    for (const it of items.filter(i => i.source !== 'core')) {
      if (excess <= 0) break;
      dropCandidate.add(it.id);
      excess -= itemWeightG(it);
    }
  }
  return `
    <div class="pack-container-card ${over ? 'is-over' : ''}" data-id="${c.id}">
      <div class="pack-c-head">
        <div class="pack-c-titlewrap">
          <span class="pack-c-name">${escHtml(c.label)}</span>
          <span class="pack-c-kind">${kindLabel(c.kind)}</span>
        </div>
        <button class="pk-del-c" data-id="${c.id}" title="Remove bag">✕</button>
      </div>

      <div class="pack-c-limits">
        <label>Empty <input class="pk-c-self-edit pk-mini" data-id="${c.id}" type="number" min="0" step="0.1" value="${c.selfWeightG ? (c.selfWeightG / 1000) : ''}" placeholder="0"> kg</label>
        <label>Limit <input class="pk-c-limit-edit pk-mini" data-id="${c.id}" type="number" min="0" step="0.1" value="${c.limitG ? (c.limitG / 1000) : ''}" placeholder="0"> kg</label>
      </div>

      <div class="pack-c-meter">
        <div class="pack-c-num ${over ? 'is-over' : ''}">${formatKg(used)}${c.limitG > 0 ? ` / ${formatKg(c.limitG)}` : ''}</div>
        <div class="pack-bar"><span class="${over ? 'is-over' : ''}" style="width:${pct}%"></span></div>
        ${over ? `<div class="pack-c-warn">Over by ${formatKg(used - c.limitG)} — move the highlighted items to Unassigned or another bag.</div>` : ''}
      </div>

      <div class="pack-c-items pk-drop-zone" data-container-id="${c.id}">
        ${items.length === 0
          ? `<div class="pack-c-empty">Empty — drag items here.</div>`
          : items.map(i => renderItemTag(i, dropCandidate.has(i.id))).join('')}
      </div>
    </div>
  `;
}

function renderUnassigned(_l: PackList, items: PackItem[]): string {
  const w = items.reduce((s, i) => s + itemWeightG(i), 0);
  const sorted = [...items].sort((a, b) => priRank(a.priority) - priRank(b.priority) || a.order - b.order);
  const note = items.length > 0 ? `${displayWeight(w, weightUnit)} waiting` : 'Drop items here to decide later';
  return `
    <div class="pack-container-card pack-unassigned-card">
      <div class="pack-c-head">
        <div class="pack-c-titlewrap">
          <span class="pack-c-name">Unassigned</span>
          <span class="pack-c-kind">${note}</span>
        </div>
      </div>
      <div class="pack-c-items pk-drop-zone" data-container-id="">
        ${items.length === 0
          ? `<div class="pack-c-empty">Not in any bag — weight not counted.</div>`
          : sorted.map(i => renderItemTag(i, false)).join('')}
      </div>
    </div>
  `;
}

function renderItemTag(i: PackItem, isDropCandidate: boolean): string {
  const isCore = i.source === 'core';
  const wDisplay = displayWeight(itemWeightG(i), weightUnit);
  const priLabel = PRIORITIES.find(p => p.value === i.priority)?.label ?? i.priority;
  const catLabel = categoryLabel(i.category);
  const bgColor = categoryColor(i.category);
  const qtyNote = i.qty > 1 ? ` ×${i.qty}` : '';
  const tooltip = isCore
    ? `${catLabel} · ${wDisplay}`
    : `${catLabel} · ${wDisplay}${qtyNote} · ${priLabel}`;
  const dropStyle = isDropCandidate ? 'outline:2px solid var(--coral-400);' : '';
  return `
    <div class="pack-item-tag ${i.packed ? 'is-packed' : ''}"
         data-id="${i.id}" data-drag="item" data-tooltip="${escHtml(tooltip)}"
         style="background:${bgColor};${dropStyle}">
      ${packCheckMode ? `<input type="checkbox" class="pk-packed" data-id="${i.id}" ${i.packed ? 'checked' : ''} style="flex-shrink:0">` : ''}
      <span class="tag-drag-handle">⠿</span>
      <span class="tag-name">${isCore ? '🔒 ' : ''}${escHtml(i.name)}${i.qty > 1 ? `<span class="tag-qty-badge">×${i.qty}</span>` : ''}</span>
      <span class="tag-actions">
        ${isCore ? '' : `<button class="pk-edit-item tag-action" data-id="${i.id}" title="Edit">✎</button>`}
        <button class="pk-del-item tag-action tag-del" data-id="${i.id}" title="Remove">✕</button>
      </span>
    </div>
  `;
}

/* ── Pack-check progress + completion ────────────────────────────────────── */

function renderPackCheck(l: PackList): string {
  const total = l.items.length;
  const packed = l.items.filter(i => i.packed).length;
  const pct = total > 0 ? Math.round((packed / total) * 100) : 0;
  const done = total > 0 && packed === total;
  if (done) {
    return `
      <div class="pack-check-done">
        <div class="pack-check-done-emoji">🎉</div>
        <div class="pack-check-done-text">
          <strong>All packed — ready to go.</strong>
          <span>${total} items · ${formatKg(listTotalWeight(l))} total</span>
        </div>
      </div>
    `;
  }
  return `
    <div class="pack-check-bar">
      <div class="pack-check-head">
        <span>Packed ${packed} / ${total}</span>
        <span>${pct}%</span>
      </div>
      <div class="pack-check-track"><span style="width:${pct}%"></span></div>
    </div>
  `;
}

/* ── Modals ──────────────────────────────────────────────────────────────── */

/* ── By leg modals ───────────────────────────────────────────────────────── */

/**
 * Unified bag-change modal — user picks a leg from a dropdown, then chooses
 * Acquired (new or existing item) or Left behind (checklist of present items).
 */
function openBagChangeModal(list: StoredPackList, defaultAction?: 'acquired' | 'left') {
  if (_legs.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  const defaultLeg = _legs.find(l => l.dateFrom <= today && l.dateTo >= today)
    ?? _legs.find(l => l.dateFrom >= today)
    ?? _legs[_legs.length - 1];

  const legOptions = _legs.map(lg =>
    `<option value="${lg.id}" ${lg.id === defaultLeg?.id ? 'selected' : ''}>${lg.flag || '🗺️'} ${escHtml(lg.city)}</option>`
  ).join('');

  const m = openModal({
    title: 'Record bag change',
    variant: 'sheet',
    body: `
      <label class="field-label">City / stop</label>
      <select class="input" id="pk-bc-leg">${legOptions}</select>

      <div class="pk-bc-tabs" style="display:flex;gap:0;margin-top:var(--sp-4);border:1.5px solid var(--rule-soft);border-radius:var(--r-md);overflow:hidden">
        <button class="pk-bc-tab ${defaultAction !== 'left' ? 'is-active' : ''}" data-tab="acquired"
          style="flex:1;border:none;padding:8px;font-size:var(--fs-sm);font-weight:600;cursor:pointer;background:${defaultAction !== 'left' ? 'var(--ink)' : 'var(--surface)'};color:${defaultAction !== 'left' ? '#fff' : 'var(--ink-soft)'}">
          + Acquired
        </button>
        <button class="pk-bc-tab ${defaultAction === 'left' ? 'is-active' : ''}" data-tab="left"
          style="flex:1;border:none;border-left:1.5px solid var(--rule-soft);padding:8px;font-size:var(--fs-sm);font-weight:600;cursor:pointer;background:${defaultAction === 'left' ? 'var(--ink)' : 'var(--surface)'};color:${defaultAction === 'left' ? '#fff' : 'var(--ink-soft)'}">
          − Left behind
        </button>
      </div>

      <div id="pk-bc-acquired-panel" ${defaultAction === 'left' ? 'hidden' : ''}>
        <div style="margin-top:var(--sp-4)">
          <label class="field-label">New item name</label>
          <input class="input" id="pk-ac-name" placeholder="e.g. Souvenir scarf">
          <div style="display:flex;gap:var(--sp-3);margin-top:var(--sp-3)">
            <div style="flex:1">
              <label class="field-label">Category</label>
              <select class="input" id="pk-ac-cat">${categoryOptions('gifts')}</select>
            </div>
            <div style="width:90px">
              <label class="field-label">Weight (${weightUnit === 'jin' ? '斤' : weightUnit})</label>
              <input class="input" id="pk-ac-weight" type="number" min="0" step="any" placeholder="0">
            </div>
            <div style="width:72px">
              <label class="field-label">Qty</label>
              <input class="input" id="pk-ac-qty" type="number" min="1" step="1" value="1">
            </div>
          </div>
        </div>
        ${list.items.filter(it => !it.acquiredLegId && !it.droppedLegId).length ? `
          <div style="margin-top:var(--sp-4)">
            <label class="field-label">Or tag an existing item as acquired here</label>
            <select class="input" id="pk-ac-existing">
              <option value="">— select item —</option>
              ${list.items.filter(it => !it.acquiredLegId && !it.droppedLegId).map(it =>
                `<option value="${it.id}">${escHtml(it.name)}</option>`
              ).join('')}
            </select>
          </div>` : ''}
      </div>

      <div id="pk-bc-left-panel" ${defaultAction !== 'left' ? 'hidden' : ''}>
        <div style="margin-top:var(--sp-4)">
          <label class="field-label">Items left behind</label>
          <div class="pk-drop-checklist" id="pk-bc-drop-list">
            <div class="pk-drop-empty" style="font-size:var(--fs-sm);color:var(--ink-muted);padding:var(--sp-3)">
              Select a city above to see items present there.
            </div>
          </div>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="confirm">Save</button>
    `,
  });

  // Active tab tracking
  let activeTab: 'acquired' | 'left' = defaultAction ?? 'acquired';

  function updateDropList() {
    const legId = m.root.querySelector<HTMLSelectElement>('#pk-bc-leg')?.value;
    if (!legId) return;
    const present = itemsPresentAtLeg(list.items, _legs, legId).filter(it => !it.droppedLegId);
    const listEl = m.root.querySelector<HTMLElement>('#pk-bc-drop-list')!;
    listEl.innerHTML = present.length
      ? present.map(it => `
          <label class="pk-drop-check-row">
            <input type="checkbox" value="${it.id}">
            <span>${escHtml(it.name)}</span>
            <span class="pk-drop-weight">${displayWeight(itemWeightG(it), weightUnit)}</span>
          </label>`).join('')
      : `<div style="font-size:var(--fs-sm);color:var(--ink-muted);padding:var(--sp-3)">No items present at this stop.</div>`;
  }

  function switchTab(tab: 'acquired' | 'left') {
    activeTab = tab;
    m.root.querySelectorAll<HTMLElement>('.pk-bc-tab').forEach(btn => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('is-active', isActive);
      btn.style.background = isActive ? 'var(--ink)' : 'var(--surface)';
      btn.style.color = isActive ? '#fff' : 'var(--ink-soft)';
    });
    const acq  = m.root.querySelector<HTMLElement>('#pk-bc-acquired-panel')!;
    const left = m.root.querySelector<HTMLElement>('#pk-bc-left-panel')!;
    if (tab === 'acquired') { acq.removeAttribute('hidden'); left.setAttribute('hidden', ''); }
    else                    { left.removeAttribute('hidden'); acq.setAttribute('hidden', ''); updateDropList(); }
  }

  m.root.querySelectorAll<HTMLElement>('.pk-bc-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab as 'acquired' | 'left'));
  });
  m.root.querySelector<HTMLSelectElement>('#pk-bc-leg')?.addEventListener('change', () => {
    if (activeTab === 'left') updateDropList();
  });

  if (defaultAction === 'left') updateDropList();

  requestAnimationFrame(() => {
    if (activeTab === 'acquired') m.root.querySelector<HTMLInputElement>('#pk-ac-name')?.focus();
  });

  m.root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => m.close());
  m.root.querySelector('[data-act="confirm"]')?.addEventListener('click', async () => {
    const legId = m.root.querySelector<HTMLSelectElement>('#pk-bc-leg')?.value || '';
    if (!legId) return;

    if (activeTab === 'acquired') {
      const existingId = m.root.querySelector<HTMLSelectElement>('#pk-ac-existing')?.value;
      if (existingId) {
        await packStore.updateItem(list.id, existingId, { acquiredLegId: legId });
        m.close(); return;
      }
      const name = (m.root.querySelector<HTMLInputElement>('#pk-ac-name')?.value || '').trim();
      if (!name) { m.root.querySelector<HTMLInputElement>('#pk-ac-name')?.focus(); return; }
      const cat  = m.root.querySelector<HTMLSelectElement>('#pk-ac-cat')?.value || 'gifts';
      const wRaw = num(m.root.querySelector<HTMLInputElement>('#pk-ac-weight')?.value || '0');
      const qty  = Math.max(1, num(m.root.querySelector<HTMLInputElement>('#pk-ac-qty')?.value || '1'));
      await packStore.addItem(list.id, {
        name, category: cat, qty,
        unitWeightG: toGrams(wRaw, weightUnit),
        containerId: null, priority: 'nice' as const,
        locked: false, packed: false, source: 'manual',
        acquiredLegId: legId, droppedLegId: null, consumable: false,
      });
    } else {
      const checked = [...m.root.querySelectorAll<HTMLInputElement>('#pk-bc-drop-list input:checked')];
      if (!checked.length) { m.close(); return; }
      await Promise.all(checked.map(cb => packStore.updateItem(list.id, cb.value, { droppedLegId: legId })));
    }
    m.close();
  });
}

function openNewListModal() {
  const trip = currentTrip();
  const tripOption = trip
    ? `<label class="pk-scope-option">
        <input type="radio" name="pk-scope" value="trip" checked>
        <span class="pk-scope-label">
          <span class="pk-scope-title">Under <em>${escHtml(trip.name)}</em></span>
          <span class="pk-scope-desc">Shows up in this trip's pack view</span>
        </span>
      </label>`
    : '';

  const m = openModal({
    title: 'New Pack List',
    variant: 'sheet',
    body: `
      <label class="field-label">Name</label>
      <input class="input" id="pk-new-name" placeholder="e.g. Europe Summer — Carry-on">
      ${trip ? `<div class="pk-scope-group">
        ${tripOption}
        <label class="pk-scope-option">
          <input type="radio" name="pk-scope" value="standalone">
          <span class="pk-scope-label">
            <span class="pk-scope-title">Standalone</span>
            <span class="pk-scope-desc">Not linked to any trip</span>
          </span>
        </label>
      </div>` : ''}
      ${_kit.length > 0 ? `<label class="pk-kit-bring">
        <input type="checkbox" id="pk-bring-kit" checked>
        <span>Bring in my Core Kit (${_kit.length} items · ${formatKg(_kit.reduce((s, k) => s + k.weightG, 0))})</span>
      </label>` : ''}
    `,
    footer: `
      <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="confirm">Create</button>
    `,
  });

  requestAnimationFrame(() => m.root.querySelector<HTMLInputElement>('#pk-new-name')?.focus());

  m.root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => m.close());
  m.root.querySelector('[data-act="confirm"]')?.addEventListener('click', async () => {
    const name = (m.root.querySelector<HTMLInputElement>('#pk-new-name')?.value || '').trim();
    if (!name) return;
    const scope = (m.root.querySelector<HTMLInputElement>('input[name="pk-scope"]:checked')?.value) ?? 'trip';
    const tripId = scope === 'standalone' ? STANDALONE_TRIP_ID : undefined;
    const bringKit = m.root.querySelector<HTMLInputElement>('#pk-bring-kit')?.checked ?? false;
    const id = await packStore.create({
      name, tripId,
      items: bringKit ? coreKitItems() : [],
    });
    m.close();
    activeId = id;
    screen = 'detail';
    packCheckMode = false;
    render();
  });
}

/** Build PackItems from the Core Kit, all landing in Unassigned, locked. */
function coreKitItems(): PackItem[] {
  return _kit.map((k, idx) => ({
    id: genLocalId(),
    name: k.name,
    category: k.category,
    qty: 1,
    unitWeightG: k.weightG,
    containerId: null,
    priority: 'essential' as const,
    locked: true,
    packed: false,
    source: 'core' as const,
    order: idx,
    acquiredLegId: null,
    droppedLegId: null,
    consumable: false,
  }));
}

/* ── Formula modal ───────────────────────────────────────────────────────── */

function openFormulaModal() {
  const groups = buildPackSuggestions(_legs);
  const totalDays = (() => {
    if (!_legs.length) return 0;
    const from = new Date(_legs[0].dateFrom);
    const to   = new Date(_legs[_legs.length - 1].dateTo);
    return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
  })();

  const body = `
    <p class="formula-intro">Based on your ${totalDays}-day itinerary across ${[...new Set(_legs.map(l => l.country))].length} countries. Select items to add to a pack list.</p>
    <div class="formula-groups">
      ${groups.map(g => `
        <div class="formula-group">
          <div class="formula-group-header">
            <span class="formula-group-icon">${g.icon}</span>
            <span class="formula-group-title">${escHtml(g.title)}</span>
            <label class="formula-select-all">
              <input type="checkbox" class="formula-group-check" data-group="${escHtml(g.title)}" checked>
              <span>All</span>
            </label>
          </div>
          <div class="formula-items">
            ${g.items.map((item, i) => `
              <label class="formula-item">
                <input type="checkbox" class="formula-item-check" checked
                  data-group="${escHtml(g.title)}"
                  data-name="${escHtml(item.text)}"
                  data-qty="${item.qty}"
                  data-cat="${escHtml(item.category)}"
                  id="fi-${escHtml(g.title)}-${i}">
                <div class="formula-item-body">
                  <span class="formula-item-name">${escHtml(item.text)}</span>
                  ${item.qty > 1 ? `<span class="formula-item-qty">× ${item.qty}</span>` : ''}
                  <span class="formula-item-why">${escHtml(item.rationale)}</span>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
    <div class="formula-footer-target">
      <label class="field-label" for="formula-target-list">Add to list</label>
      <select class="input" id="formula-target-list">
        ${_lists.map(l => `<option value="${escHtml(l.id)}">${escHtml(l.name)}</option>`).join('')}
        <option value="__new__">+ Create new list</option>
      </select>
    </div>
  `;

  const m = openModal({
    title: '✨ Pack Formula',
    variant: 'sheet',
    body,
    footer: `
      <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="confirm">Add selected items</button>
    `,
  });

  // Group checkbox toggles all items in group
  m.root.querySelectorAll<HTMLInputElement>('.formula-group-check').forEach(cb => {
    cb.addEventListener('change', () => {
      m.root.querySelectorAll<HTMLInputElement>(`.formula-item-check[data-group="${cb.dataset.group}"]`)
        .forEach(ic => { ic.checked = cb.checked; });
    });
  });

  m.root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => m.close());
  m.root.querySelector('[data-act="confirm"]')?.addEventListener('click', async () => {
    const checked = [...m.root.querySelectorAll<HTMLInputElement>('.formula-item-check:checked')];
    if (!checked.length) { m.close(); return; }

    let targetId = (m.root.querySelector<HTMLSelectElement>('#formula-target-list')?.value ?? '');
    if (targetId === '__new__') {
      targetId = await packStore.create({ name: 'Formula Pack' });
    }

    await Promise.all(checked.map(cb => packStore.addItem(targetId, {
      name: cb.dataset.name ?? '',
      category: cb.dataset.cat ?? 'other',
      qty: parseInt(cb.dataset.qty ?? '1', 10),
      unitWeightG: 0,
      containerId: null,
      priority: 'nice' as const,
      locked: false,
      packed: false,
      source: 'manual' as const,
      acquiredLegId: null,
      droppedLegId: null,
      consumable: false,
    })));

    m.close();
    activeId = targetId;
    screen = 'detail';
    packCheckMode = false;
    render();
  });
}

/* ── Bind: list screen ───────────────────────────────────────────────────── */

function bindList(c: HTMLElement) {
  c.querySelector('#pk-new')?.addEventListener('click', () => openNewListModal());
  c.querySelector('#pk-formula')?.addEventListener('click', () => openFormulaModal());

  /* Unit selector */
  c.querySelector<HTMLSelectElement>('#pk-unit-sel')?.addEventListener('change', e => {
    weightUnit = (e.target as HTMLSelectElement).value as WeightUnit;
    localStorage.setItem('pk-weight-unit', weightUnit);
    render();
  });

  /* Kit add: Enter on any field triggers save, focus moves to name */
  const confirmKitAdd = async () => {
    const nameEl = c.querySelector<HTMLInputElement>('#pk-kit-name');
    const catEl  = c.querySelector<HTMLSelectElement>('#pk-kit-cat');
    const wEl    = c.querySelector<HTMLInputElement>('#pk-kit-weight');
    const name = (nameEl?.value || '').trim();
    if (!name) { nameEl?.focus(); return; }
    await coreKitStore.add({
      name,
      category: catEl?.value || DEFAULT_CATEGORY,
      weightG: toGrams(num(wEl?.value || '0'), weightUnit),
    });
    if (nameEl) nameEl.value = '';
    if (wEl) wEl.value = '';
    nameEl?.focus();
  };
  ['#pk-kit-name', '#pk-kit-cat', '#pk-kit-weight'].forEach(sel => {
    c.querySelector<HTMLInputElement>(sel)?.addEventListener('keydown', e => {
      if ((e as KeyboardEvent).key === 'Enter') void confirmKitAdd();
    });
  });

  /* Inline kit cell edits — inputs blur-to-save, selects change-to-save */
  c.querySelectorAll<HTMLInputElement>('.pack-kit-row:not(.pack-kit-add-row) input.pack-kit-cell-input').forEach(inp => {
    inp.addEventListener('blur', async () => {
      const id = inp.dataset.id!;
      const field = inp.dataset.field as 'name' | 'weightG';
      if (field === 'weightG') {
        await coreKitStore.update(id, { weightG: toGrams(num(inp.value), weightUnit) });
      } else {
        const val = inp.value.trim();
        if (!val) return;
        await coreKitStore.update(id, { name: val });
      }
    });
    inp.addEventListener('keydown', e => {
      if ((e as KeyboardEvent).key === 'Enter') inp.blur();
    });
  });
  c.querySelectorAll<HTMLSelectElement>('.pack-kit-row:not(.pack-kit-add-row) select.pk-cat-sel').forEach(sel => {
    sel.addEventListener('change', async () => {
      await coreKitStore.update(sel.dataset.id!, { category: sel.value });
    });
  });

  c.querySelectorAll<HTMLElement>('.pack-card').forEach(card => {
    card.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('.pk-del-list')) return;
      activeId = card.dataset.id!;
      screen = 'detail';
      packCheckMode = false;
      render();
    });
  });
  c.querySelectorAll<HTMLElement>('.pk-del-list').forEach(b => {
    b.addEventListener('click', async e => {
      e.stopPropagation();
      if (confirm('Delete this pack list?')) await packStore.remove(b.dataset.id!);
    });
  });
  c.querySelectorAll<HTMLElement>('.pk-del-kit').forEach(b => {
    b.addEventListener('click', async () => { await coreKitStore.remove(b.dataset.id!); });
  });
}

/* ── Bind: detail screen ─────────────────────────────────────────────────── */

function bindDetail(c: HTMLElement, l: PackList) {
  const id = l.id;

  c.querySelector('#pk-back')?.addEventListener('click', () => { screen = 'list'; activeId = null; render(); });
  c.querySelector('#pk-check-mode')?.addEventListener('change', e => { packCheckMode = (e.target as HTMLInputElement).checked; render(); });

  // "Record change" button → unified leg-picker modal
  c.querySelector('#pk-record-change')?.addEventListener('click', () => {
    openBagChangeModal(l as StoredPackList);
  });

  /* Add bag — now uses openModal instead of inline HTML */
  c.querySelector('#pk-open-add-bag')?.addEventListener('click', () => {
    const m = openModal({
      title: 'Add bag',
      body: `
        <label class="field-label">Name</label>
        <input class="input" id="pk-c-label" placeholder="e.g. Carry-on backpack">
        <div style="display:flex;gap:var(--sp-3);margin-top:var(--sp-4)">
          <div style="flex:1">
            <label class="field-label">Type</label>
            <select class="input" id="pk-c-kind">
              ${KINDS.map(k => `<option value="${k.value}">${k.label}</option>`).join('')}
            </select>
          </div>
          <div style="width:96px">
            <label class="field-label">Empty (${weightUnit === 'jin' ? '斤' : weightUnit})</label>
            <input class="input" id="pk-c-self" type="number" min="0" step="any" placeholder="0">
          </div>
          <div style="width:96px">
            <label class="field-label">Limit (${weightUnit === 'jin' ? '斤' : weightUnit})</label>
            <input class="input" id="pk-c-limit" type="number" min="0" step="any" placeholder="0">
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn btn-primary" data-act="confirm">Add bag</button>
      `,
    });
    m.root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => m.close());
    const confirmAddBag = async () => {
      const label = (m.root.querySelector<HTMLInputElement>('#pk-c-label')?.value || '').trim();
      if (!label) { m.root.querySelector<HTMLInputElement>('#pk-c-label')?.focus(); return; }
      const kind = (m.root.querySelector<HTMLSelectElement>('#pk-c-kind')?.value || 'backpack') as PackContainer['kind'];
      await packStore.addContainer(id, {
        label, kind,
        selfWeightG: toGrams(num(m.root.querySelector<HTMLInputElement>('#pk-c-self')?.value || '0'), weightUnit),
        limitG:      toGrams(num(m.root.querySelector<HTMLInputElement>('#pk-c-limit')?.value || '0'), weightUnit),
      });
      m.close();
    };
    m.root.querySelector('[data-act="confirm"]')?.addEventListener('click', confirmAddBag);
    m.root.querySelector<HTMLInputElement>('#pk-c-label')?.addEventListener('keydown', e => {
      if ((e as KeyboardEvent).key === 'Enter') void confirmAddBag();
    });
  });

  c.querySelectorAll<HTMLElement>('.pk-del-c').forEach(b => {
    b.addEventListener('click', async () => { await packStore.removeContainer(id, b.dataset.id!); });
  });

  /* Inline container limit / self-weight edits */
  c.querySelectorAll<HTMLInputElement>('.pk-c-limit-edit').forEach(inp => {
    inp.addEventListener('change', async () => {
      await packStore.updateContainer(id, inp.dataset.id!, { limitG: toGrams(num(inp.value), weightUnit) });
    });
  });
  c.querySelectorAll<HTMLInputElement>('.pk-c-self-edit').forEach(inp => {
    inp.addEventListener('change', async () => {
      await packStore.updateContainer(id, inp.dataset.id!, { selfWeightG: toGrams(num(inp.value), weightUnit) });
    });
  });

  /* Item edit — name editable inline, popover for category/weight/priority */
  c.querySelectorAll<HTMLElement>('.pk-edit-item').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const itemId = btn.dataset.id!;
      const item = l.items.find(i => i.id === itemId);
      if (!item) return;

      const tag = btn.closest<HTMLElement>('.pack-item-tag')!;
      if (tag.classList.contains('is-editing')) return;
      tag.classList.add('is-editing');

      // Close any previously open popover
      document.getElementById('pk-edit-popover')?.remove();

      // Make the tag-name span editable in-place
      const nameEl = tag.querySelector<HTMLElement>('.tag-name')!;
      const originalText = item.name;
      nameEl.contentEditable = 'true';
      nameEl.focus();
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(nameEl);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      // Build popover (no name field)
      const wVal = (itemWeightG(item) > 0) ? kitWeightDisplay(itemWeightG(item)) : '';
      const catVal = PACK_CATEGORIES.find(cat => cat.value === item.category || cat.label === item.category)?.value ?? DEFAULT_CATEGORY;
      const pop = document.createElement('div');
      pop.id = 'pk-edit-popover';
      pop.className = 'pk-edit-popover';
      pop.innerHTML = `
        <select class="input pk-ep-cat">${categoryOptions(catVal)}</select>
        <input class="input pk-ep-weight" type="number" min="0" step="any" value="${wVal}" placeholder="${weightUnit === 'jin' ? '斤' : weightUnit}">
        <select class="input pk-ep-pri">
          ${PRIORITIES.map(p => `<option value="${p.value}" ${p.value === item.priority ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
        <button class="btn btn-primary pk-sm pk-ep-save">Save</button>
      `;
      tag.appendChild(pop);

      const close = (revert = false) => {
        nameEl.contentEditable = 'false';
        if (revert) nameEl.textContent = originalText;
        tag.classList.remove('is-editing');
        pop.remove();
        document.removeEventListener('click', onOutside, true);
      };

      const save = async () => {
        const name = (nameEl.textContent || '').trim();
        if (!name) { close(true); return; }
        const category = pop.querySelector<HTMLSelectElement>('.pk-ep-cat')?.value || DEFAULT_CATEGORY;
        const wRaw = num(pop.querySelector<HTMLInputElement>('.pk-ep-weight')?.value || '0');
        const priority = (pop.querySelector<HTMLSelectElement>('.pk-ep-pri')?.value || 'essential') as PackPriority;
        await packStore.updateItem(id, itemId, {
          name, category,
          unitWeightG: toGrams(wRaw, weightUnit),
          priority,
        });
        close();
      };

      pop.querySelector('.pk-ep-save')?.addEventListener('click', e => { e.stopPropagation(); void save(); });

      // Enter in popover saves; Escape cancels
      pop.addEventListener('keydown', e => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Enter') { e.stopPropagation(); void save(); }
        if (key === 'Escape') { e.stopPropagation(); close(true); }
      });
      // Enter in the editable name also saves
      nameEl.addEventListener('keydown', e => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Enter') { e.preventDefault(); void save(); }
        if (key === 'Escape') close(true);
      }, { once: false });

      // Click outside → save
      const onOutside = (ev: MouseEvent) => {
        if (!tag.contains(ev.target as Node)) void save();
      };
      setTimeout(() => document.addEventListener('click', onOutside, true), 0);
    });
  });

  /* Item delete */
  c.querySelectorAll<HTMLElement>('.pk-del-item').forEach(b => {
    b.addEventListener('click', async e => {
      e.stopPropagation();
      await packStore.removeItem(id, b.dataset.id!);
    });
  });

  /* Pack-check toggle */
  c.querySelectorAll<HTMLInputElement>('.pk-packed').forEach(box => {
    box.addEventListener('change', async () => { await packStore.togglePacked(id, box.dataset.id!); });
  });

  /* Add item — lands in Unassigned as a draggable tag */
  const addItem = async () => {
    const nameEl = c.querySelector<HTMLInputElement>('#pk-add-name');
    const catEl  = c.querySelector<HTMLSelectElement>('#pk-add-cat');
    const wEl    = c.querySelector<HTMLInputElement>('#pk-add-weight');
    const priEl  = c.querySelector<HTMLSelectElement>('#pk-add-pri');
    const name = (nameEl?.value || '').trim();
    if (!name) { nameEl?.focus(); return; }
    await packStore.addItem(id, {
      name, category: catEl?.value || DEFAULT_CATEGORY, qty: 1,
      unitWeightG: toGrams(num(wEl?.value || '0'), weightUnit),
      containerId: null,
      priority: (priEl?.value || 'essential') as PackPriority,
      locked: false, packed: false, source: 'manual',
      acquiredLegId: null, droppedLegId: null, consumable: false,
    });
    if (nameEl) nameEl.value = '';
    if (wEl) wEl.value = '';
    nameEl?.focus();
  };
  c.querySelector('#pk-add-item')?.addEventListener('click', addItem);
  c.querySelector('#pk-add-name')?.addEventListener('keydown', e => {
    if ((e as KeyboardEvent).key === 'Enter') void addItem();
  });
  c.querySelector('#pk-add-weight')?.addEventListener('keydown', e => {
    if ((e as KeyboardEvent).key === 'Enter') void addItem();
  });

  /* ── Drag-to-bag ─────────────────────────────────────────────────────────
     Items are draggable tags. On pointerdown → ghost follows cursor. On drop
     over a .pk-drop-zone, the item is moved to that container (or Unassigned
     if data-container-id=""). A drop outside any zone cancels the drag.
  ── */
  const ghost = c.querySelector<HTMLElement>('#pk-drag-ghost')!;
  const DRAG_THRESHOLD = 6;

  let dragItemId: string | null = null;
  let dragStartX = 0, dragStartY = 0;
  let dragging = false;

  function findDropZone(x: number, y: number): { el: HTMLElement; containerId: string | null } | null {
    const zones = c.querySelectorAll<HTMLElement>('.pk-drop-zone');
    for (const zone of zones) {
      const r = zone.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const cid = zone.dataset.containerId;
        return { el: zone, containerId: cid === '' ? null : (cid ?? null) };
      }
    }
    return null;
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragItemId) return;
    const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
    if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragging = true;
      ghost.removeAttribute('hidden');
      const tag = c.querySelector<HTMLElement>(`[data-id="${dragItemId}"][data-drag="item"]`);
      ghost.textContent = tag?.querySelector('.tag-name')?.textContent ?? '';
      document.body.style.cursor = 'grabbing';
    }
    if (dragging) {
      ghost.style.left = `${e.clientX + 12}px`;
      ghost.style.top  = `${e.clientY - 12}px`;
      // Highlight drop zone under cursor
      c.querySelectorAll('.pk-drop-zone').forEach(z => z.classList.remove('is-drag-over'));
      const zone = findDropZone(e.clientX, e.clientY);
      zone?.el.classList.add('is-drag-over');
    }
  }

  function onPointerUp(e: PointerEvent) {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.body.style.cursor = '';
    ghost.setAttribute('hidden', '');
    c.querySelectorAll('.pk-drop-zone').forEach(z => z.classList.remove('is-drag-over'));

    if (dragging && dragItemId) {
      const zone = findDropZone(e.clientX, e.clientY);
      if (zone) {
        void packStore.moveItem(id, dragItemId, zone.containerId);
      }
    }
    dragItemId = null;
    dragging = false;
  }

  c.querySelectorAll<HTMLElement>('[data-drag="item"]').forEach(tag => {
    tag.addEventListener('pointerdown', e => {
      // Don't steal clicks on buttons/selects inside the tag
      if ((e.target as HTMLElement).closest('button, select, input')) return;
      dragItemId = tag.dataset.id!;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragging = false;
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });
  });
}

/* ── Init ────────────────────────────────────────────────────────────────── */

export function initPack() {
  const intent = consumeNavIntent('pack');
  screen = intent?.listId ? 'detail' : 'list';
  activeId = intent?.listId ?? null;
  packCheckMode = false;
  weightUnit = (localStorage.getItem('pk-weight-unit') as WeightUnit) ?? 'kg';
  startSubscriptions();
}
