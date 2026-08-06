/* ==========================================================================
   On the Road · Prep Checklist (v2 — Firestore-backed)
   ========================================================================== */

import './styles/checklist.css';
import {
  checklistStore,
  templateStore,
  STANDALONE_TRIP_ID,
  type StoredChecklist,
  type StoredTemplate,
} from '../../data/stores/checklist-store.ts';
import { currentTrip, currentTripId } from '../../data/trip-context.ts';
import type { ChecklistGroup, ChecklistItem, ChecklistTag } from '../../data/schema.ts';
import { noteColor } from '../../data/palette.ts';
import { escHtml } from '../../core/utils.ts';
import { postJson } from '../../core/api.ts';
import { aiLanguage, t } from '../../core/i18n.ts';
import { handleAiError } from '../../core/paywall.ts';
import { openModal } from '../../core/modal.ts';
import { addToUnassigned, hasPackList } from './pack-section.ts';
import { categoryForGroupName } from '../pack/pack-helpers.ts';

/* ── State ───────────────────────────────────────────────────────────────── */

type Screen = 'list' | 'detail' | 'celebrate';

let screen: Screen = 'list';
let activeChecklistId: string | null = null;
let editingGroupId: string | null = null;

// Live cache — kept fresh by subscriptions
let _checklists: StoredChecklist[] = [];
let _tripChecklists: StoredChecklist[] = [];
let _standaloneChecklists: StoredChecklist[] = [];
let _templates: StoredTemplate[] = [];

let _unsubChecklists: (() => void) | null = null;
let _unsubStandaloneChecklists: (() => void) | null = null;
let _unsubTemplates: (() => void) | null = null;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function progress(groups: ChecklistGroup[]): { done: number; total: number; pct: number } {
  let done = 0, total = 0;
  groups.forEach(g => { done += g.items.filter(i => i.done).length; total += g.items.length; });
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}

function tagLabel(tag: ChecklistTag): string {
  const icons: Record<string, string> = { season: '🌤', duration: '📅', region: '🌍', custom: '🏷' };
  return `${icons[tag.type] ?? '🏷'} ${escHtml(tag.value)}`;
}

/* ── Subscriptions ───────────────────────────────────────────────────────── */

function startSubscriptions() {
  _unsubChecklists?.();
  _unsubStandaloneChecklists?.();
  _unsubTemplates?.();

  const push = () => { render(); _onDataChange?.(); };

  _unsubChecklists = checklistStore.subscribe((rows) => {
    _tripChecklists = rows;
    _checklists = [..._tripChecklists, ..._standaloneChecklists];
    push();
  });

  _unsubStandaloneChecklists = checklistStore.subscribe((rows) => {
    _standaloneChecklists = rows;
    _checklists = [..._tripChecklists, ..._standaloneChecklists];
    push();
  }, STANDALONE_TRIP_ID);

  _unsubTemplates = templateStore.subscribe((rows) => {
    _templates = rows;
    push();
  });
}


/* ── Root ────────────────────────────────────────────────────────────────── */
// Renders into a zone handed in by the Prepare orchestrator (prepare.ts)
// rather than owning the whole #view-prep body, so the landing page can show
// this section's list alongside Pack's. onScreenChange lets the orchestrator
// know when this section enters/leaves its own detail view, so it can hide
// the other section's zone while this one takes over the full page (a normal
// list→detail drill-down, not a second navigation layer).

let _zone: HTMLElement | null = null;
let _onScreenChange: ((s: Screen) => void) | null = null;
// Fires after any store push, so the Prepare landing can repaint its rail
// without opening a second set of subscriptions on the same collections.
let _onDataChange: (() => void) | null = null;

function getRoot(): HTMLElement | null {
  return _zone;
}

function render() {
  const body = getRoot();
  if (!body) return;

  // A detail/celebrate screen whose checklist vanished falls back to 'list'
  // BEFORE notifying, so the orchestrator restores the landing.
  if (screen !== 'list' && !_checklists.some(c => c.id === activeChecklistId)) {
    screen = 'list';
    activeChecklistId = null;
  }

  _onScreenChange?.(screen);

  if (screen === 'detail') renderDetailScreen(body);
  else if (screen === 'celebrate') renderCelebrate(body);
  else body.replaceChildren(); // 'list' → the Prepare landing owns this state
}

function renderTagFilters(templates: StoredTemplate[]): string {
  const seen = new Set<string>();
  const tags: ChecklistTag[] = [];
  templates.forEach(t => t.tags.forEach(tag => {
    const key = `${tag.type}:${tag.value}`;
    if (!seen.has(key)) { seen.add(key); tags.push(tag); }
  }));
  if (tags.length === 0) return '';
  return `
    <span class="tag-filter active" data-tag="all">${t('prep.filterAll')}</span>
    ${tags.map(t => `<span class="tag-filter" data-tag="${escHtml(t.type + ':' + t.value)}">${tagLabel(t)}</span>`).join('')}
  `;
}

function renderTemplatePickerItem(tpl: StoredTemplate): string {
  const tagKeys = tpl.tags.map(tag => `${tag.type}:${tag.value}`).join(' ');
  return `
    <div class="template-picker-item" data-id="${tpl.id}" data-tags="${escHtml(tagKeys)}">
      <button class="icon-btn tpl-del-btn" data-id="${tpl.id}" title="${t('prep.deleteTemplate')}">✕</button>
      <div class="template-picker-name">${escHtml(tpl.name)}</div>
      ${tpl.description ? `<div class="template-picker-desc">${escHtml(tpl.description)}</div>` : ''}
      <div class="template-picker-meta">
        ${tpl.groups.length} groups · ${tpl.groups.reduce((n, g) => n + g.items.length, 0)} items
      </div>
    </div>
  `;
}

/* ── Landing (prepare.ts) entry points ───────────────────────────────────────
   All of these open self-contained openModal() flows or switch this section
   to a focused screen. openModal() appends to document.body, so a store
   refresh mid-edit (Firestore snapshots fire often; Prepare keeps this
   section mounted continuously) can't wipe a dialog out from under the user
   the way the old in-container modals did. */

/** Open one checklist's full-width detail editor (a Prepare rail row tap). */
export function openChecklistDetail(id: string): void {
  activeChecklistId = id;
  screen = 'detail';
  render();
}

export { openNewChecklistModal, openTemplatePickerModal };

/** Live checklists for the Prepare landing's rail, with progress folded in. */
export function peekChecklistRows(): { id: string; name: string; done: number; total: number; pct: number }[] {
  return _checklists.map(cl => ({ id: cl.id, name: cl.name, ...progress(cl.groups) }));
}

/** Aggregate checklist progress across every list — the hero's readout. */
export function checklistTotals(): { done: number; total: number; pct: number; lists: number } {
  let done = 0, total = 0;
  _checklists.forEach(cl => {
    const p = progress(cl.groups);
    done += p.done; total += p.total;
  });
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0, lists: _checklists.length };
}

export async function deleteChecklist(id: string): Promise<void> {
  await checklistStore.remove(id);
}

function openNewChecklistModal() {
  const trip = currentTrip();
  const tripOption = trip
    ? `<label class="pk-scope-option">
        <input type="radio" name="cl-scope" value="trip" checked>
        <span class="pk-scope-label">
          <span class="pk-scope-title">${t('prep.scopeTripPrefix')}<em>${escHtml(trip.name)}</em></span>
          <span class="pk-scope-desc">${t('prep.scopeTripDesc')}</span>
        </span>
      </label>` : '';

  const m = openModal({
    title: t('prep.newChecklistTitle'),
    variant: 'sheet',
    body: `
      <label class="field-label">Name</label>
      <input class="input" id="new-checklist-name" placeholder="e.g. Paris Weekend Prep">
      ${trip ? `<div class="pk-scope-group">
        ${tripOption}
        <label class="pk-scope-option">
          <input type="radio" name="cl-scope" value="standalone">
          <span class="pk-scope-label">
            <span class="pk-scope-title">${t('prep.scopeStandalone')}</span>
            <span class="pk-scope-desc">${t('prep.scopeStandaloneDesc')}</span>
          </span>
        </label>
      </div>` : ''}
    `,
    footer: `
      <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="confirm">Create</button>
    `,
  });

  requestAnimationFrame(() => m.root.querySelector<HTMLInputElement>('#new-checklist-name')?.focus());

  m.root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => m.close());
  const submit = async () => {
    const name = m.root.querySelector<HTMLInputElement>('#new-checklist-name')?.value.trim();
    if (!name) return;
    const scope = (m.root.querySelector<HTMLInputElement>('input[name="cl-scope"]:checked')?.value) ?? 'trip';
    const tripId = scope === 'standalone' ? STANDALONE_TRIP_ID : undefined;
    const id = await checklistStore.create({ name, tripId });
    m.close();
    activeChecklistId = id;
    screen = 'detail';
    render();
  };
  m.root.querySelector('[data-act="confirm"]')?.addEventListener('click', submit);
  m.root.querySelector<HTMLInputElement>('#new-checklist-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submit();
  });
}

/** Template picker — also where templates are managed (created/deleted), so
 *  the landing doesn't need a permanent templates grid taking up space for a
 *  feature most users touch once. Repaints itself after any template edit. */
function openTemplatePickerModal() {
  const m = openModal({
    title: t('prep.pickerTitle'),
    body: `<div id="tpl-picker-body"></div>`,
    footer: `<button class="btn btn-ghost" data-act="new-tpl">${t('prep.btnNewTemplate')}</button>`,
  });

  const paint = () => {
    const body = m.root.querySelector<HTMLElement>('#tpl-picker-body');
    if (!body) return;
    const templates = _templates;

    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
    body.innerHTML = templates.length === 0
      ? `<div class="empty-state">
           <div class="empty-icon">📋</div>
           <p>${t('prep.noTemplates')}</p>
         </div>`
      : `<div class="tag-filter-row">${renderTagFilters(templates)}</div>
         <div class="template-picker-list">
           ${templates.map(tpl => renderTemplatePickerItem(tpl)).join('')}
         </div>`;

    body.querySelectorAll<HTMLElement>('.tag-filter').forEach(chip => {
      chip.addEventListener('click', () => {
        body.querySelectorAll('.tag-filter').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const tag = chip.dataset.tag!;
        body.querySelectorAll<HTMLElement>('.template-picker-item').forEach(item => {
          item.style.display = (tag === 'all' || item.dataset.tags?.includes(tag)) ? '' : 'none';
        });
      });
    });

    body.querySelectorAll<HTMLElement>('.tpl-del-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(t('prep.confirmDelete'))) return;
        await templateStore.remove(btn.dataset.id!);
        paint();
      });
    });

    body.querySelectorAll<HTMLElement>('.template-picker-item').forEach(item => {
      item.addEventListener('click', async () => {
        const tpl = _templates.find(tp => tp.id === item.dataset.id!);
        if (!tpl) return;
        const name = prompt(t('prep.namePrompt'), tpl.name);
        if (!name?.trim()) return;
        m.close();
        const id = await checklistStore.create({ name: name.trim(), templateId: tpl.id, tags: tpl.tags, groups: tpl.groups });
        activeChecklistId = id;
        screen = 'detail';
        render();
      });
    });
  };

  paint();
  m.root.querySelector('[data-act="new-tpl"]')?.addEventListener('click', () => {
    openNewTemplateModal(paint);
  });
}

/** Save the open checklist as a reusable template. Reads the checklist fresh
 *  at submit time so a concurrent edit isn't captured stale. */
function openSaveTemplateModal(checklistId: string, defaultName: string) {
  const m = openModal({
    title: t('prep.saveAsTemplateTitle'),
    variant: 'sheet',
    body: `
      <label class="field-label">Template Name</label>
      <input class="input" id="save-tpl-name" value="${escHtml(defaultName)}" placeholder="Template name">
      <label class="field-label" style="margin-top:var(--sp-4)">Description (optional)</label>
      <input class="input" id="save-tpl-desc" placeholder="Short description">
    `,
    footer: `
      <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="confirm">Save Template</button>
    `,
  });

  requestAnimationFrame(() => m.root.querySelector<HTMLInputElement>('#save-tpl-name')?.select());

  m.root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => m.close());
  m.root.querySelector('[data-act="confirm"]')?.addEventListener('click', async () => {
    const name = m.root.querySelector<HTMLInputElement>('#save-tpl-name')?.value.trim();
    const desc = m.root.querySelector<HTMLInputElement>('#save-tpl-desc')?.value.trim();
    if (!name) return;
    const fresh = _checklists.find(c => c.id === checklistId);
    if (fresh) await templateStore.create({ name, description: desc, tags: fresh.tags, groups: fresh.groups });
    m.close();
    showToast(t('prep.templateSaved'));
  });
}

function openNewTemplateModal(onDone?: () => void) {
  const m = openModal({
    title: t('prep.saveAsTemplateTitle'),
    variant: 'sheet',
    body: `
      <label class="field-label">Template Name</label>
      <input class="input" id="new-template-name" placeholder="e.g. Summer Europe">
      <label class="field-label" style="margin-top:var(--sp-4)">Description (optional)</label>
      <input class="input" id="new-template-desc" placeholder="Short note about this template">
    `,
    footer: `
      <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="confirm">Create Template</button>
    `,
  });

  requestAnimationFrame(() => m.root.querySelector<HTMLInputElement>('#new-template-name')?.focus());

  m.root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => m.close());
  m.root.querySelector('[data-act="confirm"]')?.addEventListener('click', async () => {
    const name = m.root.querySelector<HTMLInputElement>('#new-template-name')?.value.trim();
    const desc = m.root.querySelector<HTMLInputElement>('#new-template-desc')?.value.trim();
    if (!name) return;
    await templateStore.create({ name, description: desc });
    m.close();
    onDone?.();
  });
}

/* ── Detail screen ───────────────────────────────────────────────────────── */

function renderDetailScreen(container: HTMLElement) {
  const cl = activeChecklistId ? _checklists.find(c => c.id === activeChecklistId) : null;
  if (!cl) { screen = 'list'; render(); return; }

  const { done, total, pct } = progress(cl.groups);
  const allDone = total > 0 && done === total;

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  container.innerHTML = `
    <div class="prep-detail-screen">
      <!-- Add group (presets + custom) — placed above the title -->
      <div class="add-group-section">
        <div class="add-group-presets">
          ${[
            { icon: '📄', name: 'Documents' },
            { icon: '💳', name: 'Money & Cards' },
            { icon: '🛡️', name: 'Insurance' },
            { icon: '💊', name: 'Health' },
            { icon: '📱', name: 'Tech & Comms' },
            { icon: '✈️', name: 'Logistics' },
            { icon: '🎒', name: 'Packing' },
            { icon: '🛍️', name: 'Shopping' },
            { icon: '🏨', name: 'Accommodation' },
            { icon: '⏰', name: 'Last-minute' },
          ].map(p => `
            <button class="group-preset-chip" data-icon="${p.icon}" data-name="${p.name}">
              <span>${p.icon}</span>${p.name}
            </button>
          `).join('')}
        </div>
        <div class="add-group-custom-row">
          <button class="add-group-emoji-btn" id="add-group-emoji-btn" title="Pick icon">📋</button>
          <input class="input add-group-input" id="add-group-input" placeholder="Custom group name…" style="flex:1;min-width:0">
          <button class="btn btn-primary" id="add-group-btn">+ Add</button>
        </div>
        <!-- Emoji picker popover -->
        <div class="emoji-picker-popover" id="emoji-picker-popover" hidden>
          ${['📋','📄','💳','🛡️','💊','📱','✈️','🎒','🛍️','✅','⏰','🌍','📌','🏨','🚂','🚌','⛴️','🎫','💰','🔑','📸','🌞','❄️','🌧️','🎒','👔','👗','🧴','💡','📝','🔐','🏥','🚑','🦺','🧳'].map(e =>
            `<button class="emoji-option" data-emoji="${e}">${e}</button>`
          ).join('')}
        </div>
      </div>

      <!-- Back + title -->
      <div class="detail-topbar">
        <button class="btn btn-ghost back-btn" id="back-to-list">← Back</button>
        <div class="detail-title-wrap">
          <input class="detail-title-input" id="detail-title-input" value="${escHtml(cl.name)}">
        </div>
        <div class="detail-actions">
          <button class="btn btn-ghost ai-check-btn" id="ai-check-btn" title="AI Review">✨ AI Check</button>
          <button class="btn btn-ghost save-as-template-btn" id="save-as-template-btn" title="Save as template">📋 Save as Template</button>
        </div>
      </div>

      <!-- Progress bar -->
      <div class="detail-progress">
        <div class="detail-progress-track">
          <div class="detail-progress-fill ${allDone ? 'complete' : ''}" style="width:${pct}%"></div>
        </div>
        <span class="detail-progress-label">${done} / ${total} done</span>
        ${allDone ? '<button class="btn btn-primary celebrate-btn" id="celebrate-btn">🎉 View completion</button>' : ''}
      </div>

      <!-- Groups -->
      <div class="groups-list" id="groups-list">
        ${cl.groups.sort((a, b) => a.order - b.order).map(g => renderGroup(cl.id, g)).join('')}
      </div>

      <!-- AI panel -->
      <div class="ai-panel" id="ai-panel" hidden>
        <div class="ai-panel-header">
          <div class="ai-panel-title">${t('prep.aiCheckTitle')}</div>
          <button class="icon-btn" id="close-ai-panel">✕</button>
        </div>
        <div class="ai-panel-body" id="ai-panel-body">
          <div class="ai-loading" id="ai-loading">${t('prep.aiAnalyzing')}</div>
          <div id="ai-result" hidden></div>
        </div>
      </div>

    </div>
  `;

  bindDetailScreen(container, cl);
}

// Stable tilt per group id — deterministic so it doesn't change on re-render
function groupTilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return ((h % 400) - 200) / 100; // -2.00 to +2.00 degrees
}


function renderGroup(checklistId: string, group: ChecklistGroup): string {
  const done = group.items.filter(i => i.done).length;
  const total = group.items.length;
  const allDone = total > 0 && done === total;
  const isEditing = editingGroupId === group.id;
  const tilt = groupTilt(group.id);
  const color = allDone ? '#d6f5e3' : noteColor(group.id);

  return `
    <div class="prep-group ${allDone ? 'group-complete' : ''}"
         data-group-id="${group.id}"
         draggable="true"
         style="--tilt:${tilt}deg; --note-bg:${color}">
      <div class="prep-group-header">
        <span class="group-icon">${escHtml(group.icon)}</span>
        ${isEditing
          ? `<input class="input group-name-input" value="${escHtml(group.name)}" data-group-id="${group.id}" style="flex:1;font-weight:700">`
          : `<span class="group-name">${escHtml(group.name)}</span>`
        }
        <span class="group-progress-badge">${done}/${total}</span>
        <button class="icon-btn edit-group-btn" data-group-id="${group.id}" title="Rename">${isEditing ? '✓' : '✎'}</button>
        <button class="icon-btn delete-group-btn" data-group-id="${group.id}" title="Delete">✕</button>
      </div>
      <div class="prep-items" data-group-id="${group.id}">
        ${group.items.sort((a, b) => a.order - b.order).map(item => renderItem(item, group.name)).join('')}
      </div>
      <div class="add-item-row">
        <input class="input add-item-input" placeholder="Add item…" data-group-id="${group.id}">
        <button class="btn btn-primary add-item-btn" data-checklist-id="${checklistId}" data-group-id="${group.id}">+</button>
      </div>
    </div>
  `;
}

function renderItem(item: ChecklistItem, groupName: string): string {
  // "Send to Pack" only makes sense once there's a pack list to receive it,
  // and only for things still outstanding.
  const canPack = !item.done && hasPackList();
  return `
    <div class="prep-item ${item.done ? 'done' : ''}" data-item-id="${item.id}" draggable="true">
      <div class="item-checkbox">${item.done ? '✓' : ''}</div>
      <div class="item-body">
        <div class="item-text">${escHtml(item.text)}</div>
        ${item.note ? `<div class="item-note">${escHtml(item.note)}</div>` : ''}
      </div>
      <div class="item-actions">
        ${canPack
          ? `<button class="icon-btn send-to-pack-btn" data-group-name="${escHtml(groupName)}" title="${t('prep.sendToPack')}">🎒</button>`
          : ''}
        <button class="icon-btn delete-item-btn" title="Delete">✕</button>
      </div>
    </div>
  `;
}

function bindDetailScreen(container: HTMLElement, cl: StoredChecklist) {
  // Back
  container.querySelector('#back-to-list')?.addEventListener('click', () => {
    screen = 'list';
    editingGroupId = null;
    render();
  });

  // Rename checklist
  container.querySelector<HTMLInputElement>('#detail-title-input')?.addEventListener('change', async (e) => {
    const val = (e.target as HTMLInputElement).value.trim();
    if (val) await checklistStore.rename(cl.id, val);
  });

  // Celebrate button
  container.querySelector('#celebrate-btn')?.addEventListener('click', () => {
    screen = 'celebrate';
    render();
  });

  // Preset group chips
  container.querySelectorAll<HTMLButtonElement>('.group-preset-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const icon = chip.dataset.icon!;
      const name = chip.dataset.name!;
      await checklistStore.addGroup(cl.id, name, icon);
    });
  });

  // Emoji picker
  const emojiBtn = container.querySelector<HTMLButtonElement>('#add-group-emoji-btn');
  const emojiPicker = container.querySelector<HTMLElement>('#emoji-picker-popover');
  emojiBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker?.toggleAttribute('hidden');
  });
  container.querySelectorAll<HTMLButtonElement>('.emoji-option').forEach(opt => {
    opt.addEventListener('click', () => {
      if (emojiBtn) emojiBtn.textContent = opt.dataset.emoji!;
      emojiPicker?.setAttribute('hidden', '');
    });
  });
  document.addEventListener('click', (e) => {
    if (!emojiPicker?.hasAttribute('hidden') && !emojiPicker?.contains(e.target as Node) && e.target !== emojiBtn) {
      emojiPicker?.setAttribute('hidden', '');
    }
  }, { once: false, capture: true });

  // Add group
  container.querySelector('#add-group-btn')?.addEventListener('click', async () => {
    const input = container.querySelector<HTMLInputElement>('#add-group-input');
    const icon = container.querySelector<HTMLButtonElement>('#add-group-emoji-btn')?.textContent?.trim() ?? '📋';
    const name = input?.value.trim();
    if (!name) return;
    await checklistStore.addGroup(cl.id, name, icon);
    if (input) input.value = '';
    if (emojiBtn) emojiBtn.textContent = '📋';
  });
  container.querySelector<HTMLInputElement>('#add-group-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') container.querySelector<HTMLButtonElement>('#add-group-btn')?.click();
  });

  // Toggle item
  container.querySelectorAll<HTMLElement>('.prep-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).closest('.item-actions')) return;
      const groupEl = el.closest<HTMLElement>('[data-group-id]');
      const groupId = groupEl?.dataset.groupId;
      const itemId = el.dataset.itemId;
      if (groupId && itemId) {
        const allDone = await checklistStore.toggleItem(cl.id, groupId, itemId);
        if (allDone) screen = 'celebrate';
      }
    });
  });

  // Send item to Pack: writes it into the pack list's Unassigned area, then
  // ticks it off here — the checklist's job ("decide to bring it") is done
  // once it's in the bag list.
  container.querySelectorAll<HTMLElement>('.send-to-pack-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const itemEl = btn.closest<HTMLElement>('[data-item-id]');
      const groupEl = btn.closest<HTMLElement>('[data-group-id]');
      if (!itemEl || !groupEl) return;
      const groupId = groupEl.dataset.groupId!;
      const itemId = itemEl.dataset.itemId!;
      const text = itemEl.querySelector('.item-text')?.textContent?.trim();
      if (!text) return;

      const listName = await addToUnassigned(text, categoryForGroupName(btn.dataset.groupName ?? ''));
      if (!listName) return;                       // no pack list to receive it
      const allDone = await checklistStore.toggleItem(cl.id, groupId, itemId);
      showToast(t('prep.sentToPack', { list: listName }));
      if (allDone) { screen = 'celebrate'; render(); }
    });
  });

  // Delete item
  container.querySelectorAll<HTMLElement>('.delete-item-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const itemEl = btn.closest<HTMLElement>('[data-item-id]');
      const groupEl = btn.closest<HTMLElement>('[data-group-id]');
      if (itemEl && groupEl) await checklistStore.removeItem(cl.id, groupEl.dataset.groupId!, itemEl.dataset.itemId!);
    });
  });

  // Edit group name
  container.querySelectorAll<HTMLElement>('.edit-group-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const gid = btn.dataset.groupId!;
      if (editingGroupId === gid) {
        const input = container.querySelector<HTMLInputElement>(`.group-name-input[data-group-id="${gid}"]`);
        const val = input?.value.trim();
        if (val) await checklistStore.updateGroup(cl.id, gid, { name: val });
        editingGroupId = null;
      } else {
        editingGroupId = gid;
      }
      render();
    });
  });

  // Delete group
  container.querySelectorAll<HTMLElement>('.delete-group-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Delete this group and all its items?')) {
        await checklistStore.removeGroup(cl.id, btn.dataset.groupId!);
      }
    });
  });

  // Add item — writes directly using the in-memory snapshot to avoid
  // a race where the Firestore snapshot hasn't yet populated the cache.
  async function doAddItem(groupId: string, text: string, inputEl: HTMLInputElement | null) {
    if (!text) return;
    const fresh = _checklists.find(c => c.id === cl.id);
    if (!fresh) return;
    const group = fresh.groups.find(g => g.id === groupId);
    if (!group) return;
    const { genId } = await import('../../firebase/db.ts');
    const newItem = { id: genId(), text, done: false, order: group.items.length };
    const groups = fresh.groups.map(g =>
      g.id === groupId ? { ...g, items: [...g.items, newItem] } : g
    );
    if (inputEl) inputEl.value = '';
    await checklistStore.put({ ...fresh, groups });
  }

  container.querySelectorAll<HTMLElement>('.add-item-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const gid = btn.dataset.groupId!;
      const input = container.querySelector<HTMLInputElement>(`.add-item-input[data-group-id="${gid}"]`);
      await doAddItem(gid, input?.value.trim() ?? '', input ?? null);
    });
  });

  container.querySelectorAll<HTMLInputElement>('.add-item-input').forEach(input => {
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        await doAddItem(input.dataset.groupId!, input.value.trim(), input);
      }
    });
  });

  // Group drag-to-reorder
  bindGroupDrag(container, cl.id);

  // Save as template
  container.querySelector('#save-as-template-btn')?.addEventListener('click', () => openSaveTemplateModal(cl.id, cl.name));

  // AI check
  container.querySelector('#ai-check-btn')?.addEventListener('click', () => {
    const panel = container.querySelector<HTMLElement>('#ai-panel');
    panel?.removeAttribute('hidden');
    runAiCheck(container, cl);
  });
  container.querySelector('#close-ai-panel')?.addEventListener('click', () => {
    container.querySelector('#ai-panel')?.setAttribute('hidden', '');
  });
}

/* ── Drag-to-reorder (groups) ────────────────────────────────────────────── */

function bindGroupDrag(container: HTMLElement, checklistId: string) {
  const list = container.querySelector<HTMLElement>('#groups-list');
  if (!list) return;

  let dragSrc: HTMLElement | null = null;

  list.querySelectorAll<HTMLElement>('.prep-group').forEach(el => {
    el.addEventListener('dragstart', () => {
      dragSrc = el;
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragSrc = null;
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragSrc && dragSrc !== el) {
        const bounding = el.getBoundingClientRect();
        const offset = e.clientY - bounding.top;
        if (offset < bounding.height / 2) {
          list.insertBefore(dragSrc, el);
        } else {
          list.insertBefore(dragSrc, el.nextSibling);
        }
      }
    });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      const orderedIds = [...list.querySelectorAll<HTMLElement>('.prep-group')]
        .map(el => el.dataset.groupId!)
        .filter(Boolean);
      await checklistStore.reorderGroups(checklistId, orderedIds);
    });
  });
}

/* ── AI check ────────────────────────────────────────────────────────────── */

async function runAiCheck(container: HTMLElement, cl: StoredChecklist) {
  const loading = container.querySelector<HTMLElement>('#ai-loading');
  const result = container.querySelector<HTMLElement>('#ai-result');
  if (!loading || !result) return;

  loading.removeAttribute('hidden');
  result.setAttribute('hidden', '');

  const summary = cl.groups.map(g => {
    const items = g.items.map(i => `  - [${i.done ? 'x' : ' '}] ${i.text}`).join('\n');
    return `${g.icon} ${g.name}:\n${items || '  (empty)'}`;
  }).join('\n\n');

  try {
    const { suggestions } = await postJson<{ suggestions: string[] }>('/api/check', { summary, lang: aiLanguage(), tripId: currentTripId() });

    loading.setAttribute('hidden', '');
    result.removeAttribute('hidden');

    if (suggestions.length === 0) {
      // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
      result.innerHTML = `<div class="ai-no-suggestions">${t('prep.aiNoSuggestions')}</div>`;
    } else {
      // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
      result.innerHTML = `
        <div class="ai-suggestions-label">${t('prep.aiSuggestionsLabel')}</div>
        <ul class="ai-suggestions-list">
          ${suggestions.map(s => `<li class="ai-suggestion-item">${escHtml(s)}</li>`).join('')}
        </ul>
        <div class="ai-disclaimer">${t('prep.aiDisclaimer')}</div>
      `;
    }
  } catch (err) {
    loading.setAttribute('hidden', '');
    result.removeAttribute('hidden');
    if (handleAiError(err)) { result.textContent = ''; return; }
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
    result.innerHTML = `<div class="ai-error">${t('prep.aiError')}<br><small>${escHtml(String(err))}</small></div>`;
  }
}

/* ── Celebrate screen ────────────────────────────────────────────────────── */

function renderCelebrate(container: HTMLElement) {
  const cl = activeChecklistId ? _checklists.find(c => c.id === activeChecklistId) : null;
  const name = cl?.name ?? 'your checklist';

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  container.innerHTML = `
    <div class="celebrate-screen" id="celebrate-screen">
      <div class="celebrate-confetti" id="celebrate-confetti"></div>
      <div class="celebrate-content">
        <div class="celebrate-emoji">🎉</div>
        <h2 class="celebrate-title">${t('prep.celebrateTitle')}</h2>
        <p class="celebrate-sub">${t('prep.celebrateMsg', { name: escHtml(name) })}</p>
        <button class="btn btn-primary celebrate-back-btn" id="celebrate-back-btn" style="margin-top:var(--sp-8);font-size:var(--fs-md);padding:14px 28px">
          ${t('prep.btnBackChecklists')}
        </button>
      </div>
    </div>
  `;

  launchConfetti(container.querySelector<HTMLElement>('#celebrate-confetti')!);

  container.querySelector('#celebrate-back-btn')?.addEventListener('click', () => {
    screen = 'list';
    activeChecklistId = null;
    render();
  });
}

function launchConfetti(container: HTMLElement) {
  const colors = ['#f9b830', '#ef4444', '#22c55e', '#38bdf8', '#a78bfa', '#f472b6'];
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `
      left: ${Math.random() * 100}%;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      width: ${4 + Math.random() * 8}px;
      height: ${8 + Math.random() * 12}px;
      animation-delay: ${Math.random() * 2}s;
      animation-duration: ${2 + Math.random() * 2}s;
      transform: rotate(${Math.random() * 360}deg);
    `;
    container.appendChild(el);
  }
}

/* ── Toast ───────────────────────────────────────────────────────────────── */

function showToast(msg: string) {
  const existing = document.querySelector('.otr-toast');
  existing?.remove();
  const el = document.createElement('div');
  el.className = 'otr-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

/* ── Init ────────────────────────────────────────────────────────────────── */

/** Mount this section into `zone` (a container the Prepare orchestrator
 *  owns). `onScreenChange` fires whenever this section's internal screen
 *  changes, so the orchestrator can hide the Pack zone while this one shows
 *  its own detail/celebrate screen. */
export function initPrep(
  zone: HTMLElement,
  onScreenChange?: (s: Screen) => void,
  onDataChange?: () => void,
): void {
  _zone = zone;
  _onScreenChange = onScreenChange ?? null;
  _onDataChange = onDataChange ?? null;
  screen = 'list';
  activeChecklistId = null;
  editingGroupId = null;
  startSubscriptions();
}

export type { Screen as ChecklistScreen };
