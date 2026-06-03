/* ==========================================================================
   On the Road · Pack — weight-budget packing (P1 + P2)
   Screens:  list → setup (containers + airline) → core (lock kit) →
             formula (generate clothing) → detail (the working list)
   P2 adds the trim engine: three-layer advisory, auto-trim to budget on
   generate, and one-click overflow rebalance to checked.
   ========================================================================== */

import './pack.css';
import { packStore, type StoredPackList } from '../../data/stores/pack-store.ts';
import { coreKitStore, type StoredCoreKitItem } from '../../data/stores/core-kit-store.ts';
import { packTemplateStore, type StoredPackTemplate } from '../../data/stores/pack-template-store.ts';
import {
  buildFormulaItems, specsToItems, itemWeightG, formatKg,
  layerAdvice, trimToBudget,
  CLIMATES, ACTIVITIES, CATEGORY_ORDER,
} from '../../data/packing-formula.ts';
import type { PackList, PackItem, PackContainer, PackProfile } from '../../data/schema.ts';

/* ── State ───────────────────────────────────────────────────────────────── */

type Screen = 'list' | 'detail';
type SlotKey = 'carryOn' | 'checked' | 'personal';

let screen: Screen = 'list';
let activeId: string | null = null;
let hideLuxury = false;
let packCheckMode = false;
// Transient banner after a generate that auto-trimmed items. Cleared on next render-causing action.
let trimNotice: string | null = null;

let _lists: StoredPackList[] = [];
let _kit: StoredCoreKitItem[] = [];
let _templates: StoredPackTemplate[] = [];

let _unsubLists: (() => void) | null = null;
let _unsubKit: (() => void) | null = null;
let _unsubTemplates: (() => void) | null = null;

const SLOTS: { key: SlotKey; label: string }[] = [
  { key: 'carryOn', label: 'Carry-on' },
  { key: 'checked', label: 'Checked' },
  { key: 'personal', label: 'Personal' },
];

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

/** Total packed-item weight in a container (excludes the bag's own weight). */
function containerItemsWeight(list: PackList, containerId: string): number {
  return list.items
    .filter(it => it.containerId === containerId)
    .reduce((sum, it) => sum + itemWeightG(it), 0);
}

/** Per-container budget: limit comes from the airline by slot. */
function containerLimitG(list: PackList, c: PackContainer): number {
  const a = list.airline;
  const kg = c.slot === 'carryOn' ? a.carryOnKg : c.slot === 'checked' ? a.checkedKg : a.personalKg;
  return kg * 1000;
}

function listTotalWeight(list: PackList): number {
  const items = list.items.reduce((s, it) => s + itemWeightG(it), 0);
  const bags = list.containers.reduce((s, c) => s + c.selfWeightG, 0);
  return items + bags;
}

/* ── Subscriptions ───────────────────────────────────────────────────────── */

function startSubscriptions() {
  _unsubLists?.();
  _unsubKit?.();
  _unsubTemplates?.();
  _unsubLists = packStore.subscribe(rows => { _lists = rows; render(); });
  _unsubKit = coreKitStore.subscribe(rows => { _kit = rows; render(); });
  _unsubTemplates = packTemplateStore.subscribe(rows => { _templates = rows; render(); });
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

/* ── List screen ─────────────────────────────────────────────────────────── */

function renderList(c: HTMLElement) {
  c.innerHTML = `
    <div class="pack-action-bar">
      <button class="btn btn-primary" id="pk-new">+ New Pack List</button>
    </div>

    ${_lists.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">🎒</div>
        <p>No pack lists yet.</p>
        <p style="font-size:var(--fs-sm);color:var(--ink-faint)">Create one, set your bags and limits, then let the formula pack you light.</p>
      </div>
    ` : `
      <div class="pack-grid">
        ${_lists.map(renderListCard).join('')}
      </div>
    `}

    ${_templates.length > 0 ? `
    <div class="pack-tpl-section">
      <div class="pack-section-header">
        <div class="pack-section-title">Templates</div>
      </div>
      <p class="pack-kit-hint">Reusable setups. Start a new list from a proven kit.</p>
      <div class="pack-tpl-grid">
        ${_templates.map(renderTemplateCard).join('')}
      </div>
    </div>` : ''}

    <div class="pack-kit-section">
      <div class="pack-section-header">
        <div class="pack-section-title">Core Kit</div>
        <button class="btn btn-ghost pk-sm" id="pk-add-kit">+ Add gear</button>
      </div>
      <p class="pack-kit-hint">Your must-bring gear. It locks into every new pack list and its weight is deducted from the budget first.</p>
      <div class="pack-kit-list">
        ${_kit.length === 0 ? `<div class="pack-kit-empty">No gear yet — add your laptop, camera, chargers…</div>`
          : _kit.map(renderKitRow).join('')}
      </div>
    </div>

    ${newListModal()}
    ${kitModal()}
  `;
  bindList(c);
}

function renderTemplateCard(t: StoredPackTemplate): string {
  const w = t.items.reduce((s, i) => s + itemWeightG(i), 0);
  return `
    <div class="pack-tpl-card" data-id="${t.id}">
      <div class="pack-card-top">
        <div class="pack-card-name">${escHtml(t.name)}</div>
        <button class="pk-del-tpl" data-id="${t.id}" title="Delete">✕</button>
      </div>
      <div class="pack-card-meta">${t.profile.days}d · ${t.items.length} items · ${formatKg(w)}</div>
      <button class="btn btn-ghost pk-sm pk-use-tpl" data-id="${t.id}">Use this →</button>
    </div>
  `;
}

function renderListCard(l: StoredPackList): string {
  const total = listTotalWeight(l);
  const over = l.containers.some(c => {
    const lim = containerLimitG(l, c);
    return lim > 0 && containerItemsWeight(l, c.id) + c.selfWeightG > lim;
  });
  return `
    <div class="pack-card ${over ? 'is-over' : ''}" data-id="${l.id}">
      <div class="pack-card-top">
        <div class="pack-card-name">${escHtml(l.name)}</div>
        <button class="pk-del-list" data-id="${l.id}" title="Delete">✕</button>
      </div>
      <div class="pack-card-meta">${l.profile.days}d · ${l.items.length} items · ${l.containers.length} bags</div>
      <div class="pack-card-weight ${over ? 'is-over' : ''}">${formatKg(total)}${over ? ' · over limit' : ''}</div>
    </div>
  `;
}

function renderKitRow(k: StoredCoreKitItem): string {
  return `
    <div class="pack-kit-row" data-id="${k.id}">
      <span class="pack-kit-name">${escHtml(k.name)}</span>
      <span class="pack-kit-cat">${escHtml(k.category)}</span>
      <span class="pack-kit-weight">${formatKg(k.weightG)}</span>
      <button class="pk-del-kit" data-id="${k.id}" title="Remove">✕</button>
    </div>
  `;
}

/* ── Detail screen ───────────────────────────────────────────────────────── */

function renderDetail(c: HTMLElement, l: PackList) {
  const slotsUsed = new Set(l.containers.map(c => c.slot));
  c.innerHTML = `
    <div class="pack-detail">
      <div class="pack-detail-bar">
        <button class="btn btn-ghost pk-sm" id="pk-back">← All lists</button>
        <div class="pack-detail-title">${escHtml(l.name)}</div>
        <div class="pack-detail-actions">
          <button class="btn btn-ghost pk-sm" id="pk-save-tpl">⭐ Save as template</button>
          <label class="pk-toggle"><input type="checkbox" id="pk-hide-lux" ${hideLuxury ? 'checked' : ''}> Hide luxuries</label>
          <label class="pk-toggle"><input type="checkbox" id="pk-check-mode" ${packCheckMode ? 'checked' : ''}> Pack-check</label>
        </div>
      </div>

      ${trimNotice ? `<div class="pack-trim-notice">✂️ ${trimNotice}</div>` : ''}
      ${packCheckMode ? renderPackCheck(l) : ''}
      ${renderBudgets(l)}
      ${renderLayerAdvice(l)}
      ${renderSetupRow(l)}
      ${renderItems(l)}

      <div class="pack-add-row">
        <input class="input" id="pk-add-name" placeholder="Add an item…">
        <input class="input pk-w-input" id="pk-add-weight" type="number" min="0" placeholder="g">
        <button class="btn btn-primary pk-sm" id="pk-add-item">Add</button>
      </div>

      <div class="modal-overlay" id="pk-tpl-modal" hidden>
        <div class="modal-box">
          <div class="modal-header"><div class="modal-title">Save as Template</div><button class="modal-close" id="pk-close-tpl">✕</button></div>
          <div class="modal-body">
            <label class="field-label">Template name</label>
            <input class="input" id="pk-tpl-name" value="${escHtml(l.name)}" placeholder="e.g. Carry-on summer setup">
            <p style="font-size:var(--fs-sm);color:var(--ink-muted);margin-top:var(--sp-3)">Saves bags, limits, and items. Core-kit gear re-attaches live, so it's left out.</p>
            <div style="margin-top:var(--sp-5);display:flex;justify-content:flex-end;gap:var(--sp-3)">
              <button class="btn btn-ghost" id="pk-cancel-tpl">Cancel</button>
              <button class="btn btn-primary" id="pk-confirm-tpl">Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  // mark which slots have bags (used to gray the formula notice) — simple ref to silence unused
  void slotsUsed;
  bindDetail(c, l);
}

function renderBudgets(l: PackList): string {
  if (l.containers.length === 0) {
    return `<div class="pack-budget-empty">Add a bag below to start tracking your weight budget.</div>`;
  }
  const coreW = l.items.filter(i => i.source === 'core').reduce((s, i) => s + itemWeightG(i), 0);
  return `
    <div class="pack-budgets">
      ${l.containers.map(c => renderBudgetBar(l, c)).join('')}
    </div>
    <div class="pack-budget-legend">
      <span><i class="seg seg-bag"></i>bag</span>
      <span><i class="seg seg-core"></i>core kit</span>
      <span><i class="seg seg-formula"></i>formula</span>
      <span><i class="seg seg-manual"></i>added</span>
      ${coreW ? `<span class="pack-core-note">Core kit reserves ${formatKg(coreW)}</span>` : ''}
    </div>
  `;
}

function renderBudgetBar(l: PackList, c: PackContainer): string {
  const limit = containerLimitG(l, c);
  const items = l.items.filter(i => i.containerId === c.id);
  const seg = (src: string) => items.filter(i => i.source === src).reduce((s, i) => s + itemWeightG(i), 0);
  const used = c.selfWeightG + seg('core') + seg('formula') + seg('manual');
  const denom = limit > 0 ? limit : used || 1;
  const pct = (g: number) => Math.min(100, (g / denom) * 100);
  const over = limit > 0 && used > limit;
  // Offer one-click rebalance only when overflowing a non-checked bag and a checked bag exists.
  const hasChecked = l.containers.some(x => x.slot === 'checked');
  const canRebalance = over && c.slot !== 'checked' && hasChecked;
  return `
    <div class="pack-budget ${over ? 'is-over' : ''}">
      <div class="pack-budget-head">
        <span class="pack-budget-label">${escHtml(c.label)} <em>${slotLabel(c.slot)}</em></span>
        <span class="pack-budget-num">${formatKg(used)}${limit > 0 ? ` / ${formatKg(limit)}` : ''}</span>
      </div>
      <div class="pack-bar">
        <span class="seg-bag" style="width:${pct(c.selfWeightG)}%"></span>
        <span class="seg-core" style="width:${pct(seg('core'))}%"></span>
        <span class="seg-formula" style="width:${pct(seg('formula'))}%"></span>
        <span class="seg-manual" style="width:${pct(seg('manual'))}%"></span>
      </div>
      ${over ? `<div class="pack-budget-warn">
        Over by ${formatKg(used - limit)} — drop items${canRebalance ? '' : ' or move to checked'}.
        ${canRebalance ? `<button class="pk-rebalance pk-sm" data-id="${c.id}">↪ Move overflow to checked</button>` : ''}
      </div>` : ''}
    </div>
  `;
}

function renderLayerAdvice(l: PackList): string {
  const advice = layerAdvice(l.profile, l.items.map(i => ({ name: i.name, qty: i.qty })));
  const actionable = advice.filter(a => a.status === 'missing' || a.status === 'excess');
  if (actionable.length === 0) return '';
  const icon = (s: string) => s === 'missing' ? '⚠️' : s === 'excess' ? '⬇️' : '✓';
  return `
    <div class="pack-layers">
      <div class="pack-layers-head">🧅 Three-layer check</div>
      <div class="pack-layers-rows">
        ${actionable.map(a => `
          <div class="pack-layer-row status-${a.status}">
            <span class="pack-layer-icon">${icon(a.status)}</span>
            <span class="pack-layer-label">${escHtml(a.label)}</span>
            <span class="pack-layer-msg">${escHtml(a.message)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function slotLabel(slot: SlotKey): string {
  return SLOTS.find(s => s.key === slot)?.label ?? slot;
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

function renderSetupRow(l: PackList): string {
  return `
    <details class="pack-setup">
      <summary>Bags & airline limits</summary>
      <div class="pack-setup-body">
        <div class="pack-airline-row">
          <div class="pk-field"><label>Airline</label><input class="input" id="pk-airline" value="${escHtml(l.airline.airline)}" placeholder="e.g. Ryanair"></div>
          <div class="pk-field"><label>Carry-on kg</label><input class="input" id="pk-lim-carryOn" type="number" min="0" value="${l.airline.carryOnKg || ''}"></div>
          <div class="pk-field"><label>Checked kg</label><input class="input" id="pk-lim-checked" type="number" min="0" value="${l.airline.checkedKg || ''}"></div>
          <div class="pk-field"><label>Personal kg</label><input class="input" id="pk-lim-personal" type="number" min="0" value="${l.airline.personalKg || ''}"></div>
          <button class="btn btn-ghost pk-sm" id="pk-save-airline">Save limits</button>
        </div>

        <div class="pack-containers">
          ${l.containers.map(renderContainerRow).join('')}
        </div>
        <div class="pack-add-container">
          <input class="input" id="pk-c-label" placeholder="Bag name (e.g. Carry-on backpack)">
          <select class="input" id="pk-c-slot">
            ${SLOTS.map(s => `<option value="${s.key}">${s.label}</option>`).join('')}
          </select>
          <input class="input pk-w-input" id="pk-c-self" type="number" min="0" placeholder="self kg">
          <button class="btn btn-ghost pk-sm" id="pk-add-c">+ Bag</button>
        </div>

        <div class="pack-formula-box">
          <div class="pk-field"><label>Days</label><input class="input pk-w-input" id="pk-f-days" type="number" min="1" value="${l.profile.days}"></div>
          <div class="pk-field"><label>Climate</label>
            <select class="input" id="pk-f-climate">
              ${CLIMATES.map(cl => `<option value="${cl.value}" ${l.profile.climate === cl.value ? 'selected' : ''}>${cl.label}</option>`).join('')}
            </select>
          </div>
          <div class="pk-field pk-acts"><label>Activities</label>
            <div class="pack-act-chips">
              ${ACTIVITIES.map(a => `<label class="pack-chip ${l.profile.activities.includes(a.value) ? 'on' : ''}"><input type="checkbox" class="pk-act" value="${a.value}" ${l.profile.activities.includes(a.value) ? 'checked' : ''}>${a.label}</label>`).join('')}
            </div>
          </div>
          <button class="btn btn-primary pk-sm" id="pk-run-formula">⚡ Generate clothing</button>
        </div>

        <div class="pack-corekit-pick">
          <div class="pk-field-label">Core kit in this list:</div>
          <div class="pack-corekit-chips">
            ${_kit.length === 0 ? `<span class="pack-kit-empty">No gear in Core Kit yet.</span>` :
              _kit.map(k => {
                const inList = l.items.some(i => i.source === 'core' && i.name === k.name);
                return `<label class="pack-chip ${inList ? 'on' : ''}"><input type="checkbox" class="pk-kit-pick" value="${k.id}" ${inList ? 'checked' : ''}>${escHtml(k.name)}</label>`;
              }).join('')}
          </div>
        </div>
      </div>
    </details>
  `;
}

function renderContainerRow(c: PackContainer): string {
  return `
    <div class="pack-container-row" data-id="${c.id}">
      <span class="pack-c-name">${escHtml(c.label)}</span>
      <span class="pack-c-slot">${slotLabel(c.slot)}</span>
      <span class="pack-c-self">${formatKg(c.selfWeightG)} bag</span>
      <button class="pk-del-c" data-id="${c.id}" title="Remove bag">✕</button>
    </div>
  `;
}

function renderItems(l: PackList): string {
  let items = [...l.items].sort((a, b) => a.order - b.order);
  if (hideLuxury) items = items.filter(i => i.priority !== 'luxury');
  if (items.length === 0) {
    return `<div class="pack-items-empty">No items yet. Generate from the formula or add manually below.</div>`;
  }
  const cats = CATEGORY_ORDER.filter(cat => items.some(i => i.category === cat));
  const extra = [...new Set(items.map(i => i.category))].filter(c => !CATEGORY_ORDER.includes(c));
  return `
    <div class="pack-items">
      ${[...cats, ...extra].map(cat => renderCategory(l, cat, items.filter(i => i.category === cat))).join('')}
    </div>
  `;
}

function renderCategory(l: PackList, cat: string, items: PackItem[]): string {
  const w = items.reduce((s, i) => s + itemWeightG(i), 0);
  return `
    <div class="pack-cat">
      <div class="pack-cat-head"><span>${escHtml(cat)}</span><span class="pack-cat-w">${formatKg(w)}</span></div>
      ${items.map(i => renderItemRow(l, i)).join('')}
    </div>
  `;
}

function renderItemRow(l: PackList, i: PackItem): string {
  const cName = l.containers.find(c => c.id === i.containerId)?.label ?? '—';
  return `
    <div class="pack-item ${i.locked ? 'is-locked' : ''} pri-${i.priority} ${i.packed ? 'is-packed' : ''}" data-id="${i.id}">
      ${packCheckMode ? `<input type="checkbox" class="pk-packed" data-id="${i.id}" ${i.packed ? 'checked' : ''}>` : ''}
      <span class="pack-item-name">${i.locked ? '🔒 ' : ''}${escHtml(i.name)}</span>
      ${i.source !== 'core' ? `<span class="pack-pri-badge">${i.priority}</span>` : `<span class="pack-pri-badge core">core</span>`}
      <div class="pack-item-qty">
        <button class="pk-qty" data-id="${i.id}" data-d="-1" ${i.locked ? 'disabled' : ''}>−</button>
        <span>${i.qty}</span>
        <button class="pk-qty" data-id="${i.id}" data-d="1" ${i.locked ? 'disabled' : ''}>+</button>
      </div>
      <span class="pack-item-w">${formatKg(itemWeightG(i))}</span>
      <select class="pack-item-c" data-id="${i.id}">
        <option value="">${escHtml(cName)}…</option>
        ${l.containers.map(c => `<option value="${c.id}" ${c.id === i.containerId ? 'selected' : ''}>${escHtml(c.label)}</option>`).join('')}
      </select>
      ${i.locked ? '' : `<button class="pk-del-item" data-id="${i.id}" title="Remove">✕</button>`}
    </div>
  `;
}

/* ── Modals ──────────────────────────────────────────────────────────────── */

function newListModal(): string {
  return `
    <div class="modal-overlay" id="pk-new-modal" hidden>
      <div class="modal-box">
        <div class="modal-header"><div class="modal-title">New Pack List</div><button class="modal-close" id="pk-close-new">✕</button></div>
        <div class="modal-body">
          <label class="field-label">Name</label>
          <input class="input" id="pk-new-name" placeholder="e.g. Europe Summer — Carry-on">
          <div style="margin-top:var(--sp-5);display:flex;justify-content:flex-end;gap:var(--sp-3)">
            <button class="btn btn-ghost" id="pk-cancel-new">Cancel</button>
            <button class="btn btn-primary" id="pk-confirm-new">Create</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function kitModal(): string {
  return `
    <div class="modal-overlay" id="pk-kit-modal" hidden>
      <div class="modal-box">
        <div class="modal-header"><div class="modal-title">Add Core Gear</div><button class="modal-close" id="pk-close-kit">✕</button></div>
        <div class="modal-body">
          <label class="field-label">Name</label>
          <input class="input" id="pk-kit-name" placeholder="e.g. MacBook Pro 14&quot;">
          <div style="display:flex;gap:var(--sp-3);margin-top:var(--sp-4)">
            <div style="flex:1"><label class="field-label">Category</label><input class="input" id="pk-kit-cat" value="Tech"></div>
            <div style="width:120px"><label class="field-label">Weight (g)</label><input class="input" id="pk-kit-weight" type="number" min="0" placeholder="1400"></div>
          </div>
          <div style="margin-top:var(--sp-5);display:flex;justify-content:flex-end;gap:var(--sp-3)">
            <button class="btn btn-ghost" id="pk-cancel-kit">Cancel</button>
            <button class="btn btn-primary" id="pk-confirm-kit">Add</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ── Bind: list screen ───────────────────────────────────────────────────── */

function bindList(c: HTMLElement) {
  const newModal = c.querySelector<HTMLElement>('#pk-new-modal');
  const kModal = c.querySelector<HTMLElement>('#pk-kit-modal');

  c.querySelector('#pk-new')?.addEventListener('click', () => newModal?.removeAttribute('hidden'));
  c.querySelector('#pk-close-new')?.addEventListener('click', () => newModal?.setAttribute('hidden', ''));
  c.querySelector('#pk-cancel-new')?.addEventListener('click', () => newModal?.setAttribute('hidden', ''));
  c.querySelector('#pk-confirm-new')?.addEventListener('click', async () => {
    const name = (c.querySelector<HTMLInputElement>('#pk-new-name')?.value || '').trim();
    if (!name) return;
    const id = await packStore.create({ name });
    activeId = id;
    screen = 'detail';
    render();
  });

  c.querySelector('#pk-add-kit')?.addEventListener('click', () => kModal?.removeAttribute('hidden'));
  c.querySelector('#pk-close-kit')?.addEventListener('click', () => kModal?.setAttribute('hidden', ''));
  c.querySelector('#pk-cancel-kit')?.addEventListener('click', () => kModal?.setAttribute('hidden', ''));
  c.querySelector('#pk-confirm-kit')?.addEventListener('click', async () => {
    const name = (c.querySelector<HTMLInputElement>('#pk-kit-name')?.value || '').trim();
    if (!name) return;
    await coreKitStore.add({
      name,
      category: (c.querySelector<HTMLInputElement>('#pk-kit-cat')?.value || 'Tech').trim(),
      weightG: num(c.querySelector<HTMLInputElement>('#pk-kit-weight')?.value || '0'),
    });
    kModal?.setAttribute('hidden', '');
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

  c.querySelectorAll<HTMLElement>('.pk-use-tpl').forEach(b => {
    b.addEventListener('click', async e => {
      e.stopPropagation();
      const tpl = packTemplateStore.get(b.dataset.id!);
      if (!tpl) return;
      const id = await packStore.create({ name: tpl.name, ...packTemplateStore.toListInput(tpl) });
      activeId = id;
      screen = 'detail';
      packCheckMode = false;
      render();
    });
  });
  c.querySelectorAll<HTMLElement>('.pk-del-tpl').forEach(b => {
    b.addEventListener('click', async e => {
      e.stopPropagation();
      if (confirm('Delete this template?')) await packTemplateStore.remove(b.dataset.id!);
    });
  });
}

/* ── Bind: detail screen ─────────────────────────────────────────────────── */

function bindDetail(c: HTMLElement, l: PackList) {
  const id = l.id;

  c.querySelector('#pk-back')?.addEventListener('click', () => { screen = 'list'; activeId = null; trimNotice = null; render(); });
  c.querySelector('#pk-hide-lux')?.addEventListener('change', e => { hideLuxury = (e.target as HTMLInputElement).checked; render(); });
  c.querySelector('#pk-check-mode')?.addEventListener('change', e => { packCheckMode = (e.target as HTMLInputElement).checked; render(); });

  c.querySelectorAll<HTMLElement>('.pk-rebalance').forEach(b => {
    b.addEventListener('click', async () => { trimNotice = null; await rebalanceToChecked(id, b.dataset.id!); });
  });

  /* Save as template */
  const tplModal = c.querySelector<HTMLElement>('#pk-tpl-modal');
  c.querySelector('#pk-save-tpl')?.addEventListener('click', () => tplModal?.removeAttribute('hidden'));
  c.querySelector('#pk-close-tpl')?.addEventListener('click', () => tplModal?.setAttribute('hidden', ''));
  c.querySelector('#pk-cancel-tpl')?.addEventListener('click', () => tplModal?.setAttribute('hidden', ''));
  c.querySelector('#pk-confirm-tpl')?.addEventListener('click', async () => {
    const name = (c.querySelector<HTMLInputElement>('#pk-tpl-name')?.value || '').trim();
    const list = packStore.get(id);
    if (!name || !list) return;
    await packTemplateStore.saveFromList(name, list);
    tplModal?.setAttribute('hidden', '');
  });

  /* Airline limits */
  c.querySelector('#pk-save-airline')?.addEventListener('click', async () => {
    await packStore.setAirline(id, {
      airline: (c.querySelector<HTMLInputElement>('#pk-airline')?.value || '').trim(),
      carryOnKg: num(c.querySelector<HTMLInputElement>('#pk-lim-carryOn')?.value || '0'),
      checkedKg: num(c.querySelector<HTMLInputElement>('#pk-lim-checked')?.value || '0'),
      personalKg: num(c.querySelector<HTMLInputElement>('#pk-lim-personal')?.value || '0'),
    });
  });

  /* Containers */
  c.querySelector('#pk-add-c')?.addEventListener('click', async () => {
    const label = (c.querySelector<HTMLInputElement>('#pk-c-label')?.value || '').trim();
    if (!label) return;
    const slot = (c.querySelector<HTMLSelectElement>('#pk-c-slot')?.value || 'carryOn') as SlotKey;
    const kind = slot === 'checked' ? 'suitcase' : slot === 'personal' ? 'personal' : 'backpack';
    await packStore.addContainer(id, {
      label, slot, kind,
      capacityL: 0,
      selfWeightG: num(c.querySelector<HTMLInputElement>('#pk-c-self')?.value || '0') * 1000,
    });
  });
  c.querySelectorAll<HTMLElement>('.pk-del-c').forEach(b => {
    b.addEventListener('click', async () => { await packStore.removeContainer(id, b.dataset.id!); });
  });

  /* Profile activity chips */
  c.querySelectorAll<HTMLInputElement>('.pk-act').forEach(chip => {
    chip.addEventListener('change', async () => {
      const acts = Array.from(c.querySelectorAll<HTMLInputElement>('.pk-act:checked')).map(x => x.value);
      const profile: PackProfile = {
        days: num(c.querySelector<HTMLInputElement>('#pk-f-days')?.value || '7', 7),
        climate: (c.querySelector<HTMLSelectElement>('#pk-f-climate')?.value || 'mild') as PackProfile['climate'],
        activities: acts,
      };
      await packStore.setProfile(id, profile);
    });
  });

  /* Run formula */
  c.querySelector('#pk-run-formula')?.addEventListener('click', async () => {
    const profile: PackProfile = {
      days: num(c.querySelector<HTMLInputElement>('#pk-f-days')?.value || '7', 7),
      climate: (c.querySelector<HTMLSelectElement>('#pk-f-climate')?.value || 'mild') as PackProfile['climate'],
      activities: Array.from(c.querySelectorAll<HTMLInputElement>('.pk-act:checked')).map(x => x.value),
    };
    await applyFormula(id, profile);
  });

  /* Core-kit picker */
  c.querySelectorAll<HTMLInputElement>('.pk-kit-pick').forEach(box => {
    box.addEventListener('change', async () => {
      await toggleKitInList(id, box.value, box.checked);
    });
  });

  /* Item qty */
  c.querySelectorAll<HTMLElement>('.pk-qty').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = l.items.find(i => i.id === btn.dataset.id);
      if (!item || item.locked) return;
      const qty = Math.max(1, item.qty + Number(btn.dataset.d));
      await packStore.updateItem(id, item.id, { qty });
    });
  });

  /* Item container move */
  c.querySelectorAll<HTMLSelectElement>('.pack-item-c').forEach(sel => {
    sel.addEventListener('change', async () => {
      await packStore.moveItem(id, sel.dataset.id!, sel.value || null);
    });
  });

  /* Item delete */
  c.querySelectorAll<HTMLElement>('.pk-del-item').forEach(b => {
    b.addEventListener('click', async () => { await packStore.removeItem(id, b.dataset.id!); });
  });

  /* Pack-check toggle */
  c.querySelectorAll<HTMLInputElement>('.pk-packed').forEach(box => {
    box.addEventListener('change', async () => { await packStore.togglePacked(id, box.dataset.id!); });
  });

  /* Manual add */
  const addItem = async () => {
    const name = (c.querySelector<HTMLInputElement>('#pk-add-name')?.value || '').trim();
    if (!name) return;
    const firstCarryOn = l.containers.find(x => x.slot === 'carryOn') ?? l.containers[0];
    await packStore.addItem(id, {
      name, category: 'Other', qty: 1,
      unitWeightG: num(c.querySelector<HTMLInputElement>('#pk-add-weight')?.value || '0'),
      containerId: firstCarryOn?.id ?? null,
      priority: 'essential', locked: false, packed: false, source: 'manual',
    });
  };
  c.querySelector('#pk-add-item')?.addEventListener('click', addItem);
  c.querySelector('#pk-add-name')?.addEventListener('keydown', e => {
    if ((e as KeyboardEvent).key === 'Enter') void addItem();
  });
}

/* ── Mutations that need cross-cutting logic ─────────────────────────────── */

async function applyFormula(id: string, profile: PackProfile) {
  const list = packStore.get(id);
  if (!list) return;
  const target = list.containers.find(c => c.slot === 'carryOn') ?? list.containers[0] ?? null;
  // Replace previous formula items; keep core + manual.
  const kept = list.items.filter(i => i.source !== 'formula');
  const specs = buildFormulaItems(profile);
  let fresh = specsToItems(specs, target?.id ?? null, kept.length).map(it => ({ ...it, id: genLocalId() }));

  // Auto-trim: if the target bag has a limit, shave low-priority formula counts
  // to fit the budget left after the bag's own weight and everything already in it.
  trimNotice = null;
  if (target) {
    const limit = containerLimitG(list, target);
    if (limit > 0) {
      const reserved = target.selfWeightG +
        kept.filter(i => i.containerId === target.id).reduce((s, i) => s + itemWeightG(i), 0);
      const budget = limit - reserved;
      const res = trimToBudget(fresh, budget);
      fresh = res.items;
      if (res.trimmed.length > 0) {
        const names = res.trimmed.map(t => `${t.name} ${t.from}→${t.to}`).join(', ');
        trimNotice = `Trimmed ${formatKg(res.removedG)} to fit ${escHtml(target.label)} — ${escHtml(names)}.`;
      }
    }
  }

  const items: PackItem[] = [...kept, ...fresh];
  await packStore.setProfile(id, profile);
  await packStore.setItems(id, items);
}

/** Move a bag's overflow to the first container with a checked slot. */
async function rebalanceToChecked(id: string, fromContainerId: string) {
  const list = packStore.get(id);
  if (!list) return;
  const from = list.containers.find(c => c.id === fromContainerId);
  const checked = list.containers.find(c => c.slot === 'checked');
  if (!from || !checked) return;
  const limit = containerLimitG(list, from);
  if (limit <= 0) return;

  // Move the lightest movable items (manual/formula, unlocked, non-core) until under limit.
  const items = list.items.map(i => ({ ...i }));
  const used = () => from.selfWeightG +
    items.filter(i => i.containerId === from.id).reduce((s, i) => s + itemWeightG(i), 0);
  const movable = () => items
    .filter(i => i.containerId === from.id && !i.locked && i.source !== 'core')
    .sort((a, b) => itemWeightG(b) - itemWeightG(a)); // move heaviest first to clear fast

  let guard = 0;
  while (used() > limit && guard++ < 200) {
    const cand = movable()[0];
    if (!cand) break;
    const idx = items.findIndex(i => i.id === cand.id);
    items[idx].containerId = checked.id;
  }
  await packStore.setItems(id, items);
}

async function toggleKitInList(id: string, kitId: string, on: boolean) {
  const list = packStore.get(id);
  const kitItem = _kit.find(k => k.id === kitId);
  if (!list || !kitItem) return;
  if (on) {
    if (list.items.some(i => i.source === 'core' && i.name === kitItem.name)) return;
    const target = list.containers.find(c => c.slot === kitItem.defaultSlot)
      ?? list.containers.find(c => c.slot === 'carryOn')
      ?? list.containers[0] ?? null;
    await packStore.addItem(id, {
      name: kitItem.name, category: kitItem.category, qty: 1,
      unitWeightG: kitItem.weightG, containerId: target?.id ?? null,
      priority: 'core', locked: true, packed: false, source: 'core',
    });
  } else {
    const found = list.items.find(i => i.source === 'core' && i.name === kitItem.name);
    if (found) await packStore.removeItem(id, found.id);
  }
}

function genLocalId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ── Init ────────────────────────────────────────────────────────────────── */

export function initPack() {
  screen = 'list';
  activeId = null;
  hideLuxury = false;
  packCheckMode = false;
  startSubscriptions();
}
