/* ==========================================================================
   On the Road · Prep Checklist (v2 — Firestore-backed)
   ========================================================================== */

import './prep.css';
import {
  checklistStore,
  templateStore,
  BUILT_IN_TEMPLATES,
  type StoredChecklist,
  type StoredTemplate,
} from '../../data/stores/checklist-store.ts';
import type { ChecklistGroup, ChecklistItem, ChecklistTag } from '../../data/schema.ts';
import { noteColor } from '../../data/palette.ts';

/* ── State ───────────────────────────────────────────────────────────────── */

type Screen = 'list' | 'detail' | 'celebrate';

let screen: Screen = 'list';
let activeChecklistId: string | null = null;
let editingGroupId: string | null = null;

// Live cache — kept fresh by subscriptions
let _checklists: StoredChecklist[] = [];
let _templates: StoredTemplate[] = [];

let _unsubChecklists: (() => void) | null = null;
let _unsubTemplates: (() => void) | null = null;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
  _unsubTemplates?.();

  _unsubChecklists = checklistStore.subscribe((rows) => {
    _checklists = rows;
    render();
  });

  _unsubTemplates = templateStore.subscribe((rows) => {
    _templates = rows;
    // Seed built-ins if Firestore returns empty on first load
    if (rows.length === 0) {
      templateStore.seed(BUILT_IN_TEMPLATES).catch(console.error);
    }
    render();
  });
}


/* ── Root ────────────────────────────────────────────────────────────────── */

function getRoot(): HTMLElement | null {
  return document.getElementById('view-prep');
}

function render() {
  const root = getRoot();
  if (!root) return;
  const body = root.querySelector<HTMLElement>('.prep-body');
  if (!body) return;

  if (screen === 'list') renderListScreen(body);
  else if (screen === 'detail') renderDetailScreen(body);
  else if (screen === 'celebrate') renderCelebrate(body);
}

/* ── List screen ─────────────────────────────────────────────────────────── */

function renderListScreen(container: HTMLElement) {
  const checklists = _checklists;
  const templates = _templates;

  container.innerHTML = `
    <div class="prep-list-screen">
      <!-- Action bar -->
      <div class="prep-action-bar">
        <button class="btn btn-primary" id="create-blank-btn">+ New Checklist</button>
        <button class="btn btn-ghost" id="open-template-picker-btn">📋 From Template</button>
      </div>

      <!-- Checklists -->
      ${checklists.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <p>No checklists yet.</p>
          <p style="font-size:var(--fs-sm);color:var(--ink-faint)">Create one from scratch or pick a template to get started.</p>
        </div>
      ` : `
        <div class="checklist-grid">
          ${checklists.map(cl => renderChecklistCard(cl)).join('')}
        </div>
      `}

      <!-- Templates section -->
      <div class="prep-templates-section">
        <div class="prep-section-header" style="margin-bottom:var(--sp-4)">
          <div class="prep-section-title" style="font-size:var(--fs-lg)">Templates</div>
          <button class="btn btn-ghost" id="new-template-btn" style="font-size:var(--fs-sm);padding:6px 14px">+ New</button>
        </div>
        <div class="templates-grid">
          ${templates.map(t => renderTemplateCard(t)).join('')}
        </div>
      </div>

      <!-- Template picker modal -->
      <div class="modal-overlay" id="template-picker-modal" hidden>
        <div class="modal-box">
          <div class="modal-header">
            <div class="modal-title">Choose a Template</div>
            <button class="modal-close" id="close-template-picker">✕</button>
          </div>
          <div class="modal-body">
            <div class="tag-filter-row" id="tag-filter-row">
              ${renderTagFilters(templates)}
            </div>
            <div class="template-picker-list" id="template-picker-list">
              ${templates.map(t => renderTemplatePickerItem(t)).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- New checklist modal -->
      <div class="modal-overlay" id="new-checklist-modal" hidden>
        <div class="modal-box">
          <div class="modal-header">
            <div class="modal-title">New Checklist</div>
            <button class="modal-close" id="close-new-checklist">✕</button>
          </div>
          <div class="modal-body">
            <label class="field-label">Name</label>
            <input class="input" id="new-checklist-name" placeholder="e.g. Paris Weekend Prep" autofocus>
            <div style="margin-top:var(--sp-5);display:flex;justify-content:flex-end;gap:var(--sp-3)">
              <button class="btn btn-ghost" id="cancel-new-checklist">Cancel</button>
              <button class="btn btn-primary" id="confirm-new-checklist">Create</button>
            </div>
          </div>
        </div>
      </div>

      <!-- New template modal -->
      <div class="modal-overlay" id="new-template-modal" hidden>
        <div class="modal-box">
          <div class="modal-header">
            <div class="modal-title">Save as Template</div>
            <button class="modal-close" id="close-new-template">✕</button>
          </div>
          <div class="modal-body">
            <label class="field-label">Template Name</label>
            <input class="input" id="new-template-name" placeholder="e.g. Summer Europe" autofocus>
            <label class="field-label" style="margin-top:var(--sp-4)">Description (optional)</label>
            <input class="input" id="new-template-desc" placeholder="Short note about this template">
            <div style="margin-top:var(--sp-5);display:flex;justify-content:flex-end;gap:var(--sp-3)">
              <button class="btn btn-ghost" id="cancel-new-template">Cancel</button>
              <button class="btn btn-primary" id="confirm-new-template">Create Template</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  bindListScreen(container, templates);
}

function renderChecklistCard(cl: StoredChecklist): string {
  const { done, total, pct } = progress(cl.groups);
  const isComplete = total > 0 && done === total;
  return `
    <div class="checklist-card ${isComplete ? 'is-complete' : ''}" data-id="${cl.id}">
      <div class="checklist-card-top">
        <div class="checklist-card-name">${escHtml(cl.name)}</div>
        <button class="icon-btn delete-cl-btn" data-id="${cl.id}" title="Delete">✕</button>
      </div>
      <div class="checklist-card-tags">
        ${cl.tags.map(t => `<span class="tag-chip">${tagLabel(t)}</span>`).join('')}
      </div>
      <div class="checklist-card-progress">
        <div class="mini-progress-track">
          <div class="mini-progress-fill ${isComplete ? 'complete' : ''}" style="width:${pct}%"></div>
        </div>
        <span class="mini-progress-label">${done}/${total}</span>
      </div>
      ${isComplete ? '<div class="complete-badge">All done ✓</div>' : ''}
    </div>
  `;
}

function renderTemplateCard(t: StoredTemplate): string {
  const groupCount = t.groups.length;
  const itemCount = t.groups.reduce((n, g) => n + g.items.length, 0);
  return `
    <div class="template-card">
      <div class="template-card-top">
        <div class="template-card-name">${escHtml(t.name)}</div>
        <button class="icon-btn delete-tpl-btn" data-id="${t.id}" title="Delete template">✕</button>
      </div>
      <div class="template-card-body">
        ${t.description ? `<div class="template-card-desc">${escHtml(t.description)}</div>` : ''}
        <div class="template-card-meta">${groupCount} groups · ${itemCount} items</div>
        <div class="template-card-tags">
          ${t.tags.map(tag => `<span class="tag-chip">${tagLabel(tag)}</span>`).join('')}
        </div>
      </div>
      <button class="btn btn-ghost use-template-btn" data-id="${t.id}" style="width:100%;justify-content:center">
        Use template
      </button>
    </div>
  `;
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
    <span class="tag-filter active" data-tag="all">All</span>
    ${tags.map(t => `<span class="tag-filter" data-tag="${escHtml(t.type + ':' + t.value)}">${tagLabel(t)}</span>`).join('')}
  `;
}

function renderTemplatePickerItem(t: StoredTemplate): string {
  const tagKeys = t.tags.map(t => `${t.type}:${t.value}`).join(' ');
  return `
    <div class="template-picker-item" data-id="${t.id}" data-tags="${escHtml(tagKeys)}">
      <div class="template-picker-name">${escHtml(t.name)}</div>
      ${t.description ? `<div class="template-picker-desc">${escHtml(t.description)}</div>` : ''}
      <div class="template-picker-meta">
        ${t.groups.length} groups · ${t.groups.reduce((n, g) => n + g.items.length, 0)} items
      </div>
    </div>
  `;
}

function bindListScreen(container: HTMLElement, templates: StoredTemplate[]) {
  // Open checklist
  container.querySelectorAll<HTMLElement>('.checklist-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.delete-cl-btn')) return;
      activeChecklistId = card.dataset.id!;
      screen = 'detail';
      render();
    });
  });

  // Delete checklist
  container.querySelectorAll<HTMLElement>('.delete-cl-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Delete this checklist?')) {
        await checklistStore.remove(btn.dataset.id!);
      }
    });
  });

  // Use template from card
  container.querySelectorAll<HTMLElement>('.use-template-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tpl = templates.find(t => t.id === btn.dataset.id!);
      if (!tpl) return;
      const name = prompt('Checklist name:', tpl.name);
      if (!name?.trim()) return;
      const id = await checklistStore.create({ name: name.trim(), templateId: tpl.id, tags: tpl.tags, groups: tpl.groups });
      activeChecklistId = id;
      screen = 'detail';
      render();
    });
  });

  // Delete template
  container.querySelectorAll<HTMLElement>('.delete-tpl-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Delete this template?')) {
        await templateStore.remove(btn.dataset.id!);
      }
    });
  });

  // New checklist (blank)
  const createBlankBtn = container.querySelector<HTMLElement>('#create-blank-btn');
  const newModal = container.querySelector<HTMLElement>('#new-checklist-modal');
  createBlankBtn?.addEventListener('click', () => { newModal?.removeAttribute('hidden'); container.querySelector<HTMLInputElement>('#new-checklist-name')?.focus(); });
  container.querySelector('#cancel-new-checklist')?.addEventListener('click', () => newModal?.setAttribute('hidden', ''));
  container.querySelector('#close-new-checklist')?.addEventListener('click', () => newModal?.setAttribute('hidden', ''));
  container.querySelector('#confirm-new-checklist')?.addEventListener('click', async () => {
    const name = container.querySelector<HTMLInputElement>('#new-checklist-name')?.value.trim();
    if (!name) return;
    const id = await checklistStore.create({ name });
    activeChecklistId = id;
    screen = 'detail';
    render();
  });
  container.querySelector<HTMLInputElement>('#new-checklist-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') container.querySelector<HTMLButtonElement>('#confirm-new-checklist')?.click();
  });

  // Template picker modal
  const pickerModal = container.querySelector<HTMLElement>('#template-picker-modal');
  container.querySelector('#open-template-picker-btn')?.addEventListener('click', () => pickerModal?.removeAttribute('hidden'));
  container.querySelector('#close-template-picker')?.addEventListener('click', () => pickerModal?.setAttribute('hidden', ''));
  pickerModal?.addEventListener('click', (e) => { if (e.target === pickerModal) pickerModal.setAttribute('hidden', ''); });

  // Tag filter
  container.querySelectorAll<HTMLElement>('.tag-filter').forEach(chip => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.tag-filter').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const tag = chip.dataset.tag!;
      container.querySelectorAll<HTMLElement>('.template-picker-item').forEach(item => {
        item.style.display = (tag === 'all' || item.dataset.tags?.includes(tag)) ? '' : 'none';
      });
    });
  });

  // Pick template from modal
  container.querySelectorAll<HTMLElement>('.template-picker-item').forEach(item => {
    item.addEventListener('click', async () => {
      const tpl = templates.find(t => t.id === item.dataset.id!);
      if (!tpl) return;
      pickerModal?.setAttribute('hidden', '');
      const name = prompt('Checklist name:', tpl.name);
      if (!name?.trim()) return;
      const id = await checklistStore.create({ name: name.trim(), templateId: tpl.id, tags: tpl.tags, groups: tpl.groups });
      activeChecklistId = id;
      screen = 'detail';
      render();
    });
  });

  // New template (blank)
  const tplModal = container.querySelector<HTMLElement>('#new-template-modal');
  container.querySelector('#new-template-btn')?.addEventListener('click', () => { tplModal?.removeAttribute('hidden'); container.querySelector<HTMLInputElement>('#new-template-name')?.focus(); });
  container.querySelector('#cancel-new-template')?.addEventListener('click', () => tplModal?.setAttribute('hidden', ''));
  container.querySelector('#close-new-template')?.addEventListener('click', () => tplModal?.setAttribute('hidden', ''));
  container.querySelector('#confirm-new-template')?.addEventListener('click', async () => {
    const name = container.querySelector<HTMLInputElement>('#new-template-name')?.value.trim();
    const desc = container.querySelector<HTMLInputElement>('#new-template-desc')?.value.trim();
    if (!name) return;
    await templateStore.create({ name, description: desc });
    tplModal?.setAttribute('hidden', '');
  });
}

/* ── Detail screen ───────────────────────────────────────────────────────── */

function renderDetailScreen(container: HTMLElement) {
  const cl = activeChecklistId ? _checklists.find(c => c.id === activeChecklistId) : null;
  if (!cl) { screen = 'list'; render(); return; }

  const { done, total, pct } = progress(cl.groups);
  const allDone = total > 0 && done === total;

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
          <div class="ai-panel-title">✨ AI Checklist Review</div>
          <button class="icon-btn" id="close-ai-panel">✕</button>
        </div>
        <div class="ai-panel-body" id="ai-panel-body">
          <div class="ai-loading" id="ai-loading">Analyzing your checklist…</div>
          <div id="ai-result" hidden></div>
        </div>
      </div>

      <!-- Save as template modal -->
      <div class="modal-overlay" id="save-tpl-modal" hidden>
        <div class="modal-box">
          <div class="modal-header">
            <div class="modal-title">Save as Template</div>
            <button class="modal-close" id="close-save-tpl">✕</button>
          </div>
          <div class="modal-body">
            <label class="field-label">Template Name</label>
            <input class="input" id="save-tpl-name" value="${escHtml(cl.name)}" placeholder="Template name">
            <label class="field-label" style="margin-top:var(--sp-4)">Description (optional)</label>
            <input class="input" id="save-tpl-desc" placeholder="Short description">
            <div style="margin-top:var(--sp-5);display:flex;justify-content:flex-end;gap:var(--sp-3)">
              <button class="btn btn-ghost" id="cancel-save-tpl">Cancel</button>
              <button class="btn btn-primary" id="confirm-save-tpl">Save Template</button>
            </div>
          </div>
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
        ${group.items.sort((a, b) => a.order - b.order).map(item => renderItem(item)).join('')}
      </div>
      <div class="add-item-row">
        <input class="input add-item-input" placeholder="Add item…" data-group-id="${group.id}">
        <button class="btn btn-primary add-item-btn" data-checklist-id="${checklistId}" data-group-id="${group.id}">+</button>
      </div>
    </div>
  `;
}

function renderItem(item: ChecklistItem): string {
  return `
    <div class="prep-item ${item.done ? 'done' : ''}" data-item-id="${item.id}" draggable="true">
      <div class="item-checkbox">${item.done ? '✓' : ''}</div>
      <div class="item-body">
        <div class="item-text">${escHtml(item.text)}</div>
        ${item.note ? `<div class="item-note">${escHtml(item.note)}</div>` : ''}
      </div>
      <div class="item-actions">
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
  const saveTplModal = container.querySelector<HTMLElement>('#save-tpl-modal');
  container.querySelector('#save-as-template-btn')?.addEventListener('click', () => saveTplModal?.removeAttribute('hidden'));
  container.querySelector('#close-save-tpl')?.addEventListener('click', () => saveTplModal?.setAttribute('hidden', ''));
  container.querySelector('#cancel-save-tpl')?.addEventListener('click', () => saveTplModal?.setAttribute('hidden', ''));
  container.querySelector('#confirm-save-tpl')?.addEventListener('click', async () => {
    const name = container.querySelector<HTMLInputElement>('#save-tpl-name')?.value.trim();
    const desc = container.querySelector<HTMLInputElement>('#save-tpl-desc')?.value.trim();
    if (!name) return;
    const fresh = _checklists.find(c => c.id === cl.id);
    if (fresh) await templateStore.create({ name, description: desc, tags: fresh.tags, groups: fresh.groups });
    saveTplModal?.setAttribute('hidden', '');
    showToast('Template saved!');
  });

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

  const prompt = `You are a travel preparation assistant. Review this trip preparation checklist and identify the most important items that might be missing. Be concise — list at most 5 suggestions, each in one short sentence. Only flag genuinely critical items most travelers overlook.

Checklist:
${summary}

Respond with a JSON array of strings, e.g. ["Consider getting an international driving permit if planning to rent a car", "..."]`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': (window as any).__ANTHROPIC_KEY__ ?? '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) throw new Error(`API error ${resp.status}`);
    const data = await resp.json();
    const text: string = data.content?.[0]?.text ?? '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const suggestions: string[] = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    loading.setAttribute('hidden', '');
    result.removeAttribute('hidden');

    if (suggestions.length === 0) {
      result.innerHTML = '<div class="ai-no-suggestions">Looks good! No major items seem to be missing.</div>';
    } else {
      result.innerHTML = `
        <div class="ai-suggestions-label">Possible missing items:</div>
        <ul class="ai-suggestions-list">
          ${suggestions.map(s => `<li class="ai-suggestion-item">${escHtml(s)}</li>`).join('')}
        </ul>
        <div class="ai-disclaimer">Suggestions are AI-generated — verify before acting.</div>
      `;
    }
  } catch (err) {
    loading.setAttribute('hidden', '');
    result.removeAttribute('hidden');
    result.innerHTML = `<div class="ai-error">Could not reach AI. Check your API key or network.<br><small>${String(err)}</small></div>`;
  }
}

/* ── Celebrate screen ────────────────────────────────────────────────────── */

function renderCelebrate(container: HTMLElement) {
  const cl = activeChecklistId ? _checklists.find(c => c.id === activeChecklistId) : null;
  const name = cl?.name ?? 'your checklist';

  container.innerHTML = `
    <div class="celebrate-screen" id="celebrate-screen">
      <div class="celebrate-confetti" id="celebrate-confetti"></div>
      <div class="celebrate-content">
        <div class="celebrate-emoji">🎉</div>
        <h2 class="celebrate-title">You're ready to go!</h2>
        <p class="celebrate-sub">Everything in <strong>${escHtml(name)}</strong> is checked off.</p>
        <p class="celebrate-msg">Pack your bags, it's time to explore.</p>
        <button class="btn btn-primary celebrate-back-btn" id="celebrate-back-btn" style="margin-top:var(--sp-8);font-size:var(--fs-md);padding:14px 28px">
          Back to Checklists
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

export function initPrep() {
  screen = 'list';
  activeChecklistId = null;
  editingGroupId = null;
  startSubscriptions();
}
