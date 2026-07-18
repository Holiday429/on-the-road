/* ==========================================================================
   On the Road · Dashboard · modal builders
   --------------------------------------------------------------------------
   Self-contained modal flows lifted out of dashboard.ts. They take whatever
   state they need as explicit parameters, so they hold no module state.
   ========================================================================== */

import { openModal } from '../../core/modal.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { todoStore } from '../../data/stores/todo-store.ts';
import { packStore, type StoredPackList } from '../../data/stores/pack-store.ts';
import { type StoredLeg } from '../../data/stores/route-store.ts';
import { itemWeightG, itemsPresentAtLeg } from '../../data/packing-formula.ts';
import { scheduleAllNotifications } from '../../core/notifications.ts';
// From pack-helpers.ts (not pack.ts) — keeps Dashboard's eager bundle from
// pulling in the full pack view module.
import { PACK_CATEGORIES } from '../pack/pack-helpers.ts';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ── New to-do modal (with due date + reminder) ──────────────────────────── */
export function openDashboardTodoModal(defaultDate: string = todayIso()): void {
  const handle = openModal({
    title: '+ New to-do',
    body: `
      <div style="display:flex;flex-direction:column;gap:12px">
        <input class="input" id="db-todo-text" placeholder="What do you need to do?" autofocus>
        <div style="display:flex;gap:8px;align-items:center">
          <label class="field-label" style="margin:0;white-space:nowrap;flex-shrink:0">Due date</label>
          <input class="input" id="db-todo-due" type="date" value="${esc(defaultDate)}">
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <label class="field-label" style="margin:0;white-space:nowrap;flex-shrink:0">Remind me</label>
          <input class="input" id="db-todo-remind" type="datetime-local">
        </div>
      </div>`,
    footer: `<button class="btn btn-ghost" id="db-todo-cancel">Cancel</button>
             <button class="btn btn-primary" id="db-todo-save">Add</button>`,
  });

  handle.root.querySelector('#db-todo-cancel')?.addEventListener('click', () => handle.close());
  handle.root.querySelector('#db-todo-save')?.addEventListener('click', async () => {
    const text = (handle.root.querySelector<HTMLInputElement>('#db-todo-text'))?.value.trim() ?? '';
    const due  = (handle.root.querySelector<HTMLInputElement>('#db-todo-due'))?.value || null;
    const remindStr = (handle.root.querySelector<HTMLInputElement>('#db-todo-remind'))?.value || '';
    let remindAt: number | null = null;
    if (remindStr) {
      const ms = new Date(remindStr).getTime();
      if (!isNaN(ms)) remindAt = ms;
    }
    if (!text) { handle.root.querySelector<HTMLInputElement>('#db-todo-text')?.focus(); return; }
    if (remindAt && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    await todoStore.add({ text, dueDate: due, remindAt });
    handle.close();
    scheduleAllNotifications();
  });

  handle.root.querySelector<HTMLInputElement>('#db-todo-text')?.focus();
}

/* ── Pack bag-change modal (dashboard shortcut) ──────────────────────────── */
export function openPackBagChangeModal(list: StoredPackList, defaultAction: 'acquired' | 'left', legs: StoredLeg[]) {
  const sLegs = [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  if (!sLegs.length) return;

  const today = todayIso();
  const defaultLeg = sLegs.find(l => l.dateFrom <= today && l.dateTo >= today)
    ?? sLegs.find(l => l.dateFrom >= today)
    ?? sLegs[sLegs.length - 1];

  const legOptions = sLegs.map(lg =>
    `<option value="${lg.id}" ${lg.id === defaultLeg?.id ? 'selected' : ''}>${lg.flag || '🗺️'} ${esc(lg.city)}</option>`
  ).join('');

  const catOptions = PACK_CATEGORIES.map(c =>
    `<option value="${c.value}" ${c.value === 'gifts' ? 'selected' : ''}>${c.label}</option>`
  ).join('');

  const m = openModal({
    title: 'Record bag change',
    variant: 'sheet',
    body: `
      <label class="field-label">City / stop</label>
      <select class="input" id="td-bc-leg">${legOptions}</select>

      <div style="display:flex;gap:0;margin-top:var(--sp-4);border:1.5px solid var(--rule-soft);border-radius:var(--r-md);overflow:hidden">
        <button class="td-bc-tab ${defaultAction === 'acquired' ? 'is-active' : ''}" data-tab="acquired"
          style="flex:1;border:none;padding:8px;font-size:var(--fs-sm);font-weight:600;cursor:pointer;
                 background:${defaultAction === 'acquired' ? 'var(--ink)' : 'var(--surface)'};
                 color:${defaultAction === 'acquired' ? '#fff' : 'var(--ink-soft)'}">+ Acquired</button>
        <button class="td-bc-tab ${defaultAction === 'left' ? 'is-active' : ''}" data-tab="left"
          style="flex:1;border:none;border-left:1.5px solid var(--rule-soft);padding:8px;font-size:var(--fs-sm);font-weight:600;cursor:pointer;
                 background:${defaultAction === 'left' ? 'var(--ink)' : 'var(--surface)'};
                 color:${defaultAction === 'left' ? '#fff' : 'var(--ink-soft)'}">− Left behind</button>
      </div>

      <div id="td-bc-acquired-panel" ${defaultAction === 'left' ? 'hidden' : ''} style="margin-top:var(--sp-4)">
        <label class="field-label">New item name</label>
        <input class="input" id="td-ac-name" placeholder="e.g. Souvenir scarf">
        <div style="display:flex;gap:var(--sp-3);margin-top:var(--sp-3)">
          <div style="flex:1"><label class="field-label">Category</label>
            <select class="input" id="td-ac-cat">${catOptions}</select></div>
          <div style="width:90px"><label class="field-label">Weight (kg)</label>
            <input class="input" id="td-ac-weight" type="number" min="0" step="any" placeholder="0"></div>
          <div style="width:72px"><label class="field-label">Qty</label>
            <input class="input" id="td-ac-qty" type="number" min="1" step="1" value="1"></div>
        </div>
        ${list.items.filter(it => !it.acquiredLegId && !it.droppedLegId).length ? `
          <div style="margin-top:var(--sp-4)">
            <label class="field-label">Or tag existing item</label>
            <select class="input" id="td-ac-existing">
              <option value="">— select item —</option>
              ${list.items.filter(it => !it.acquiredLegId && !it.droppedLegId).map(it =>
                `<option value="${it.id}">${esc(it.name)}</option>`).join('')}
            </select>
          </div>` : ''}
      </div>

      <div id="td-bc-left-panel" ${defaultAction === 'acquired' ? 'hidden' : ''} style="margin-top:var(--sp-4)">
        <label class="field-label">Items left behind</label>
        <div class="pk-drop-checklist" id="td-bc-drop-list">
          <div style="font-size:var(--fs-sm);color:var(--ink-muted);padding:var(--sp-2)">Loading…</div>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="confirm">Save</button>
    `,
  });

  let activeTab = defaultAction;

  function updateDropList() {
    const legId = m.root.querySelector<HTMLSelectElement>('#td-bc-leg')?.value;
    if (!legId) return;
    const present = itemsPresentAtLeg(list.items, sLegs, legId).filter(it => !it.droppedLegId);
    const el = m.root.querySelector<HTMLElement>('#td-bc-drop-list')!;
    el.innerHTML = present.length
      ? present.map(it => `
          <label class="pk-drop-check-row">
            <input type="checkbox" value="${it.id}">
            <span>${esc(it.name)}</span>
            <span class="pk-drop-weight">${(itemWeightG(it) / 1000).toFixed(1)}kg</span>
          </label>`).join('')
      : `<div style="font-size:var(--fs-sm);color:var(--ink-muted);padding:var(--sp-2)">No items at this stop.</div>`;
  }

  function switchTab(tab: 'acquired' | 'left') {
    activeTab = tab;
    m.root.querySelectorAll<HTMLElement>('.td-bc-tab').forEach(btn => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('is-active', active);
      btn.style.background = active ? 'var(--ink)' : 'var(--surface)';
      btn.style.color      = active ? '#fff' : 'var(--ink-soft)';
    });
    const acq  = m.root.querySelector<HTMLElement>('#td-bc-acquired-panel')!;
    const left = m.root.querySelector<HTMLElement>('#td-bc-left-panel')!;
    if (tab === 'acquired') { acq.removeAttribute('hidden'); left.setAttribute('hidden', ''); }
    else { left.removeAttribute('hidden'); acq.setAttribute('hidden', ''); updateDropList(); }
  }

  m.root.querySelectorAll<HTMLElement>('.td-bc-tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab as 'acquired' | 'left')));
  m.root.querySelector<HTMLSelectElement>('#td-bc-leg')?.addEventListener('change', () => { if (activeTab === 'left') updateDropList(); });

  if (defaultAction === 'left') updateDropList();
  else requestAnimationFrame(() => m.root.querySelector<HTMLInputElement>('#td-ac-name')?.focus());

  m.root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => m.close());
  m.root.querySelector('[data-act="confirm"]')?.addEventListener('click', async () => {
    const legId = m.root.querySelector<HTMLSelectElement>('#td-bc-leg')?.value || '';
    if (!legId) return;
    if (activeTab === 'acquired') {
      const existingId = m.root.querySelector<HTMLSelectElement>('#td-ac-existing')?.value;
      if (existingId) { await packStore.updateItem(list.id, existingId, { acquiredLegId: legId }); m.close(); return; }
      const name = (m.root.querySelector<HTMLInputElement>('#td-ac-name')?.value || '').trim();
      if (!name) { m.root.querySelector<HTMLInputElement>('#td-ac-name')?.focus(); return; }
      const cat = m.root.querySelector<HTMLSelectElement>('#td-ac-cat')?.value || 'gifts';
      const wG  = Math.max(0, parseFloat(m.root.querySelector<HTMLInputElement>('#td-ac-weight')?.value || '0') || 0) * 1000;
      const qty = Math.max(1, parseInt(m.root.querySelector<HTMLInputElement>('#td-ac-qty')?.value || '1', 10) || 1);
      await packStore.addItem(list.id, {
        name, category: cat, qty, unitWeightG: wG,
        containerId: null, priority: 'nice' as const,
        locked: false, packed: false, source: 'manual',
        acquiredLegId: legId, droppedLegId: null, consumable: false,
      });
    } else {
      const checked = [...m.root.querySelectorAll<HTMLInputElement>('#td-bc-drop-list input:checked')];
      await Promise.all(checked.map(cb => packStore.updateItem(list.id, cb.value, { droppedLegId: legId })));
    }
    m.close();
  });
}
