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

import { todayIso } from '../../data/trip-phase.ts';
import { routeStore } from '../../data/stores/route-store.ts';
import { planDaysFor, pickPlanDay, legForDate } from '../../data/plan-days.ts';
import type { PlanItem } from '../../data/schema.ts';
import { t } from '../../core/i18n.ts';

/* ── New to-do modal (with due date + reminder) ──────────────────────────── */
export function openDashboardTodoModal(defaultDate: string = todayIso()): void {
  const handle = openModal({
    title: `+ ${t('dash.todoModal.title')}`,
    body: `
      <div style="display:flex;flex-direction:column;gap:12px">
        <input class="input" id="db-todo-text" placeholder="${esc(t('dash.todoModal.text'))}" autofocus>
        <div style="display:flex;gap:8px;align-items:center">
          <label class="field-label" style="margin:0;white-space:nowrap;flex-shrink:0">${esc(t('dash.todoModal.due'))}</label>
          <input class="input" id="db-todo-due" type="date" value="${esc(defaultDate)}">
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <label class="field-label" style="margin:0;white-space:nowrap;flex-shrink:0">${esc(t('dash.todoModal.remind'))}</label>
          <input class="input" id="db-todo-remind" type="datetime-local">
        </div>
      </div>`,
    footer: `<button class="btn btn-ghost" id="db-todo-cancel">${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="db-todo-save">${esc(t('common.add'))}</button>`,
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
    title: t('dash.bagModal.title'),
    variant: 'sheet',
    body: `
      <label class="field-label">${esc(t('dash.bagModal.stop'))}</label>
      <select class="input" id="td-bc-leg">${legOptions}</select>

      <div style="display:flex;gap:0;margin-top:var(--sp-4);border:1.5px solid var(--rule-soft);border-radius:var(--r-md);overflow:hidden">
        <button class="td-bc-tab ${defaultAction === 'acquired' ? 'is-active' : ''}" data-tab="acquired"
          style="flex:1;border:none;padding:8px;font-size:var(--fs-sm);font-weight:600;cursor:pointer;
                 background:${defaultAction === 'acquired' ? 'var(--ink)' : 'var(--surface)'};
                 color:${defaultAction === 'acquired' ? '#fff' : 'var(--ink-soft)'}">+ ${esc(t('dash.pack.boughtIn'))}</button>
        <button class="td-bc-tab ${defaultAction === 'left' ? 'is-active' : ''}" data-tab="left"
          style="flex:1;border:none;border-left:1.5px solid var(--rule-soft);padding:8px;font-size:var(--fs-sm);font-weight:600;cursor:pointer;
                 background:${defaultAction === 'left' ? 'var(--ink)' : 'var(--surface)'};
                 color:${defaultAction === 'left' ? '#fff' : 'var(--ink-soft)'}">− ${esc(t('dash.pack.lostIn'))}</button>
      </div>

      <div id="td-bc-acquired-panel" ${defaultAction === 'left' ? 'hidden' : ''} style="margin-top:var(--sp-4)">
        <label class="field-label">${esc(t('dash.bagModal.itemName'))}</label>
        <input class="input" id="td-ac-name" placeholder="${esc(t('dash.bagModal.itemPh'))}">
        <div style="display:flex;gap:var(--sp-3);margin-top:var(--sp-3)">
          <div style="flex:1"><label class="field-label">${esc(t('dash.agenda.spendCategory'))}</label>
            <select class="input" id="td-ac-cat">${catOptions}</select></div>
          <div style="width:90px"><label class="field-label">${esc(t('dash.bagModal.weight'))}</label>
            <input class="input" id="td-ac-weight" type="number" min="0" step="any" placeholder="0"></div>
          <div style="width:72px"><label class="field-label">${esc(t('dash.bagModal.qty'))}</label>
            <input class="input" id="td-ac-qty" type="number" min="1" step="1" value="1"></div>
        </div>
        ${list.items.filter(it => !it.acquiredLegId && !it.droppedLegId).length ? `
          <div style="margin-top:var(--sp-4)">
            <label class="field-label">${esc(t('dash.bagModal.existing'))}</label>
            <select class="input" id="td-ac-existing">
              <option value="">${esc(t('dash.bagModal.select'))}</option>
              ${list.items.filter(it => !it.acquiredLegId && !it.droppedLegId).map(it =>
                `<option value="${it.id}">${esc(it.name)}</option>`).join('')}
            </select>
          </div>` : ''}
      </div>

      <div id="td-bc-left-panel" ${defaultAction === 'acquired' ? 'hidden' : ''} style="margin-top:var(--sp-4)">
        <label class="field-label">${esc(t('dash.bagModal.leftItems'))}</label>
        <div class="pk-drop-checklist" id="td-bc-drop-list">
          <div style="font-size:var(--fs-sm);color:var(--ink-muted);padding:var(--sp-2)">${esc(t('common.loading'))}</div>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-act="cancel">${esc(t('common.cancel'))}</button>
      <button class="btn btn-primary" data-act="confirm">${esc(t('common.save'))}</button>
    `,
  });

  let activeTab = defaultAction;

  function updateDropList() {
    const legId = m.root.querySelector<HTMLSelectElement>('#td-bc-leg')?.value;
    if (!legId) return;
    const present = itemsPresentAtLeg(list.items, sLegs, legId).filter(it => !it.droppedLegId);
    const el = m.root.querySelector<HTMLElement>('#td-bc-drop-list')!;
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
    el.innerHTML = present.length
      ? present.map(it => `
          <label class="pk-drop-check-row">
            <input type="checkbox" value="${it.id}">
            <span>${esc(it.name)}</span>
            <span class="pk-drop-weight">${(itemWeightG(it) / 1000).toFixed(1)}kg</span>
          </label>`).join('')
      : `<div style="font-size:var(--fs-sm);color:var(--ink-muted);padding:var(--sp-2)">${esc(t('dash.bagModal.none'))}</div>`;
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

/* ── Add a plan item to a date ───────────────────────────────────────────── */
/** "+ Add to itinerary": a title and a day, written straight onto the stop the
 *  date belongs to. Used by the agenda's + button and Where-to-go's card +. */
export function openAddPlanModal(legs: StoredLeg[], opts: { date: string; title?: string }): void {
  const sorted = [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const first = legForDate(sorted, opts.date);
  if (!first) return;

  const legOptions = sorted.map(l =>
    `<option value="${esc(l.id)}" ${l.id === first.id ? 'selected' : ''}>${esc(l.flag || '🗺️')} ${esc(l.city)}</option>`).join('');

  const m = openModal({
    title: `+ ${t('dash.plan.addTitle')}`,
    body: `
      <div style="display:flex;flex-direction:column;gap:12px">
        <input class="input" id="ap-title" value="${esc(opts.title ?? '')}" placeholder="${esc(t('dash.plan.name'))}">
        ${sorted.length > 1 ? `<select class="input" id="ap-leg">${legOptions}</select>` : ''}
        <div style="display:flex;gap:8px;align-items:center">
          <label class="field-label" style="margin:0;white-space:nowrap;flex-shrink:0">${esc(t('dash.plan.day'))}</label>
          <input class="input" id="ap-date" type="date" value="${esc(opts.date)}">
        </div>
        <div id="ap-err" class="field-label" style="color:var(--coral-500);margin:0" hidden>${esc(t('dash.plan.noDays'))}</div>
      </div>`,
    footer: `<button class="btn btn-ghost" data-act="cancel">${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" data-act="confirm">${esc(t('common.add'))}</button>`,
  });
  m.root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => m.close());
  m.root.querySelector('[data-act="confirm"]')?.addEventListener('click', async () => {
    const title = (m.root.querySelector<HTMLInputElement>('#ap-title')?.value ?? '').trim();
    if (!title) { m.root.querySelector<HTMLInputElement>('#ap-title')?.focus(); return; }
    const date = m.root.querySelector<HTMLInputElement>('#ap-date')?.value || opts.date;
    const legId = m.root.querySelector<HTMLSelectElement>('#ap-leg')?.value ?? first.id;
    const leg = sorted.find(l => l.id === legId) ?? first;
    const day = pickPlanDay(planDaysFor(leg), date);
    if (!day) { m.root.querySelector<HTMLElement>('#ap-err')?.removeAttribute('hidden'); return; }
    const plans = (leg.plans ?? []) as PlanItem[];
    const maxOrder = plans.filter(p => p.dayId === day.id).reduce((mx, p) => Math.max(mx, p.order ?? 0), -1);
    const item: PlanItem = { id: `plan-${Date.now()}`, dayId: day.id, title, category: '', done: false, order: maxOrder + 1 };
    // Persist the day container too when it was only implied, so the date sticks.
    const planDays = (leg.planDays ?? []).some(d => d.id === day.id) ? leg.planDays : [...(leg.planDays ?? []), day];
    await routeStore.update(leg.id, { plans: [...plans, item], planDays });
    m.close();
  });
  m.root.querySelector<HTMLInputElement>('#ap-title')?.select();
}
