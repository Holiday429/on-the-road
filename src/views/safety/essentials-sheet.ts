/* ==========================================================================
   On the Road · Safety essentials sheet — "Before you go" checkable drawer
   Content comes from Firestore (safetyContentStore), seeds from essentials.ts.
   Check state is user-scoped and persists across sessions.
   ========================================================================== */

import {
  safetyContentStore,
  checklistStateStore,
  type StoredEssentialGroup,
} from '../../data/stores/safety-content-store.ts';
import { t } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';

function renderGroup(group: StoredEssentialGroup, checks: Record<string, boolean>): string {
  const total = group.items.length;
  const done = group.items.filter((i) => checks[i.id]).length;

  return `
    <div class="sfye-group">
      <div class="sfye-group-head">
        <span class="sfye-group-icon">${esc(group.icon)}</span>
        <span class="sfye-group-title">${esc(group.title)}</span>
        <span class="sfye-group-progress">${done}/${total}</span>
      </div>
      <ul class="sfye-list">
        ${group.items.map((item) => `
          <li class="sfye-item${checks[item.id] ? ' sfye-item-done' : ''}">
            <label class="sfye-check-label">
              <input
                type="checkbox"
                class="sfye-checkbox"
                data-item-id="${esc(item.id)}"
                ${checks[item.id] ? 'checked' : ''}
              >
              <span class="sfye-check-text">${esc(item.text)}</span>
            </label>
          </li>`).join('')}
      </ul>
    </div>`;
}

function renderBody(groups: StoredEssentialGroup[], checks: Record<string, boolean>): string {
  if (!groups.length) return `<div class="sfye-loading"><span class="sfy-spinner"></span> Loading…</div>`;

  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
  const doneItems = groups.reduce((n, g) => n + g.items.filter((i) => checks[i.id]).length, 0);
  const pct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;

  return `
    <div class="sfye-progress-bar-wrap">
      <div class="sfye-progress-bar" style="width:${pct}%"></div>
    </div>
    <div class="sfye-progress-label">${t('safety.essentialsProgress', { done: doneItems, total: totalItems })}</div>
    <div class="sfye-groups">
      ${groups.map((g) => renderGroup(g, checks)).join('')}
    </div>
    <button class="btn btn-ghost sfye-clear" id="sfye-clear">${t('safety.btnClearAll')}</button>`;
}

/* ── Sheet shell ──────────────────────────────────────────────────────────── */

let _sheet: HTMLElement | null = null;
let _unsubContent: (() => void) | null = null;
let _unsubChecks: (() => void) | null = null;
let _groups: StoredEssentialGroup[] = [];
let _checks: Record<string, boolean> = {};

function bodyEl(): HTMLElement | null {
  return document.getElementById('sfye-body');
}

function paint() {
  const body = bodyEl();
  if (!body) return;
  body.innerHTML = renderBody(_groups, _checks);
  wireSheet();
}

function wireSheet() {
  const body = bodyEl();
  if (!body) return;

  body.querySelectorAll<HTMLInputElement>('.sfye-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.itemId!;
      void checklistStateStore.toggle(id, cb.checked);
      // Optimistic local update
      _checks = { ..._checks, [id]: cb.checked };
      const item = cb.closest<HTMLElement>('.sfye-item');
      if (item) item.classList.toggle('sfye-item-done', cb.checked);
      // Update progress counters (re-render header only)
      const group = cb.closest<HTMLElement>('.sfye-group');
      if (group) {
        const allCbs = group.querySelectorAll<HTMLInputElement>('.sfye-checkbox');
        const done = Array.from(allCbs).filter((c) => c.checked).length;
        const total = allCbs.length;
        const prog = group.querySelector('.sfye-group-progress');
        if (prog) prog.textContent = `${done}/${total}`;
      }
      // Update total progress bar
      const totalItems = _groups.reduce((n, g) => n + g.items.length, 0);
      const doneItems = Object.values(_checks).filter(Boolean).length;
      const pct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;
      const bar = body.querySelector<HTMLElement>('.sfye-progress-bar');
      if (bar) bar.style.width = `${pct}%`;
      const label = body.querySelector('.sfye-progress-label');
      if (label) label.textContent = t('safety.essentialsProgress', { done: doneItems, total: totalItems });
    });
  });

  body.querySelector('#sfye-clear')?.addEventListener('click', async () => {
    _checks = {};
    await checklistStateStore.clear();
    paint();
  });
}

function createSheetDOM(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'sfy-essentials-sheet';
  el.className = 'sfy-sheet-overlay';
  el.innerHTML = `
    <div class="sfy-sheet" role="dialog" aria-modal="true">
      <div class="sfy-sheet-header">
        <div class="sfy-sheet-title">${t('safety.essentialsHeader')}</div>
        <button class="sfy-sheet-close" id="sfye-close" aria-label="Close">×</button>
      </div>
      <div class="sfy-sheet-body" id="sfye-body"></div>
    </div>`;
  return el;
}

export function openEssentialsSheet(): void {
  if (_sheet) return;

  _sheet = createSheetDOM();
  document.body.appendChild(_sheet);

  _unsubContent = safetyContentStore.subscribe((groups) => {
    _groups = groups;
    paint();
  });

  _unsubChecks = checklistStateStore.subscribe((checks) => {
    _checks = checks;
    paint();
  });

  _sheet.querySelector('#sfye-close')?.addEventListener('click', closeEssentialsSheet);
  _sheet.addEventListener('click', (e) => { if (e.target === _sheet) closeEssentialsSheet(); });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { closeEssentialsSheet(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
}

export function closeEssentialsSheet(): void {
  _unsubContent?.();
  _unsubChecks?.();
  _unsubContent = null;
  _unsubChecks = null;
  _sheet?.remove();
  _sheet = null;
}
