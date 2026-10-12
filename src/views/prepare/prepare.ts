/* ==========================================================================
   On the Road · Prepare — readiness workspace
   --------------------------------------------------------------------------
   One page that answers "am I ready to leave?". The hero merges both
   sections' state (countdown + checklist progress + packed weight); below it
   two rails list the actual checklists and pack lists — real rows with
   progress and weight, not buttons that gate a subpage.

   Tapping any row hands the whole page to that section's own editor
   (checklist detail, pack detail with its drag-and-drop bags, or the Core
   Kit table), which then renders full-width exactly as it did when Pack and
   Checklist were separate views. Back returns here.
   ========================================================================== */

import './styles/prepare.css';
import './styles/stage.css';
import {
  initPrep, openChecklistDetail, openNewChecklistModal, openTemplatePickerModal,
  peekChecklistRows, checklistTotals, deleteChecklist, peekNextUp, tickNextUp,
  type ChecklistScreen, type NextUpItem,
} from './checklist-section.ts';
import {
  initPack, openPackDetail, openNewPackListModal, openPackFormula, openCoreKit,
  peekPackRows, packTotals, packFormulaAvailable, deletePackList, focusPackAction,
  formatKg, type PackScreen,
} from './pack-section.ts';
import { resolvePhase, renderHero, heroChipAction } from './phase-strip.ts';
import { renderNotesStage, renderPackStage, bindStages, playStages, resetStages, ticksFor } from './prepare-stage.ts';
import { noteVar } from '../../data/palette.ts';
import { daysToGo, tripPhase, peekLegs } from '../../data/trip-phase.ts';
import { routeStore } from '../../data/stores/route-store.ts';
import { escHtml } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';

let _root: HTMLElement | null = null;
let _landing: HTMLElement | null = null;
let _legsUnsub: (() => void) | null = null;
// The stages play when first seen and again when tick progress moves; any other
// repaint (a store push while editing elsewhere) leaves them at rest.
let _notesKey = '';
let _next: NextUpItem[] = [];

function getRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#view-prep .prepare-root');
}

/* ── Landing ─────────────────────────────────────────────────────────────── */

function renderLanding() {
  const host = _landing;
  if (!host) return;

  const legs = peekLegs();
  const days = daysToGo(legs);
  const focus = resolvePhase(days, tripPhase(legs));
  const cl = checklistTotals();
  const pk = packTotals();

  const hero = renderHero(focus, days, {
    checklist: cl,
    pack: { lists: pk.lists, bags: pk.bags, weightLabel: formatKg(pk.weightG), over: pk.over },
  });

  const clRows = peekChecklistRows();
  const pkRows = peekPackRows();

  // With nothing in a rail, its actions move into the empty card's call to
  // action — repeating them in the header would put "there's nothing here"
  // and "here's how to start" at opposite corners of the row.
  const clActions = clRows.length ? `
    <div class="prep-rail-actions">
      <button class="btn btn-ghost prep-rail-btn" data-act="tpl">${t('prep.btnFromTemplate')}</button>
      <button class="btn btn-primary prep-rail-btn" data-act="new-cl">${t('prep.btnNewChecklist')}</button>
    </div>` : '';

  const pkActions = pkRows.length ? `
    <div class="prep-rail-actions">
      <button class="btn btn-ghost prep-rail-btn" data-act="kit">${t('prep.btnCoreKit', { count: pk.kit })}</button>
      ${packFormulaAvailable() ? `<button class="btn btn-ghost prep-rail-btn" data-act="formula">${t('pack.btnFormula')}</button>` : ''}
      <button class="btn btn-primary prep-rail-btn" data-act="new-pk">${t('pack.btnNewList')}</button>
    </div>` : '';

  _next = peekNextUp(3);

  // eslint-disable-next-line no-restricted-syntax -- audited: escHtml on every interpolation here and in renderHero (N5)
  host.innerHTML = `
    ${hero}

    <div class="prep-split">
      <section class="prep-rail prep-rail--checklist" id="prep-rail-checklist">
        <div class="prep-rail-head">
          <h2 class="prep-rail-title"><span class="prep-rail-icon">📋</span>${t('prep.checklistSectionTitle')}</h2>
          ${clActions}
        </div>
        ${renderNotesStage(cl.done, cl.total)}
        ${renderNextUp(_next, cl.total > 0)}
        ${renderChecklistRows(clRows)}
      </section>

      <section class="prep-rail prep-rail--pack" id="prep-rail-pack">
        <div class="prep-rail-head">
          <h2 class="prep-rail-title"><span class="prep-rail-icon">🎒</span>${t('nav.pack')}</h2>
          ${pkActions}
        </div>
        ${renderPackStage(pkRows.reduce((n, r) => n + r.items, 0))}
        ${renderPackRows(pkRows)}
      </section>
    </div>
  `;

  const key = `${ticksFor(cl.done, cl.total)}:${cl.total > 0 && cl.done >= cl.total}`;
  playStages(host, _notesKey !== '' && key !== _notesKey);
  _notesKey = key;

  bindLanding(host);
}

type ChecklistRow = ReturnType<typeof peekChecklistRows>[number];
type PackRow = ReturnType<typeof peekPackRows>[number];

function renderChecklistRows(rows: ChecklistRow[]): string {
  if (!rows.length) {
    return emptyCard('📋', t('prep.railChecklistEmptyTitle'), t('prep.railChecklistEmpty'), `
      <button class="btn btn-primary" data-act="new-cl">${t('prep.btnNewChecklist')}</button>
      <button class="btn btn-ghost" data-act="tpl">${t('prep.btnFromTemplate')}</button>
    `);
  }

  return `<div class="prep-rows">${rows.map((r, i) => {
    const complete = r.total > 0 && r.done === r.total;
    return `
      <div class="prep-row prep-row--note${complete ? ' is-complete' : ''}" data-cl="${escHtml(r.id)}" role="button" tabindex="0" style="--row-note:${noteVar(i)}">
        <div class="prep-row-main">
          <div class="prep-row-name">${escHtml(r.name)}</div>
          <div class="prep-row-bar"><div class="prep-row-bar-fill${complete ? ' is-complete' : ''}" style="width:${r.pct}%"></div></div>
        </div>
        <div class="prep-row-meta">${r.total > 0 ? `${r.done}/${r.total}` : t('prep.rowNoItems')}</div>
        ${complete
          ? `<span class="prep-row-badge">${t('prep.rowDone')}</span>`
          : `<span class="prep-row-badge is-empty" aria-hidden="true"></span>`}
        <button class="prep-row-del" data-del-cl="${escHtml(r.id)}" title="${t('prep.rowDelete')}">✕</button>
      </div>`;
  }).join('')}</div>`;
}

function renderPackRows(rows: PackRow[]): string {
  if (!rows.length) {
    return emptyCard('🎒', t('prep.railPackEmptyTitle'), t('prep.railPackEmpty'), `
      <button class="btn btn-primary" data-act="new-pk">${t('pack.btnNewList')}</button>
      ${packFormulaAvailable() ? `<button class="btn btn-ghost" data-act="formula">${t('pack.btnFormula')}</button>` : ''}
      <button class="btn btn-ghost" data-act="kit">${t('prep.btnCoreKitShort')}</button>
    `);
  }

  return `<div class="prep-rows">${rows.map(r => `
    <div class="prep-row${r.over ? ' is-over' : ''}" data-pk="${escHtml(r.id)}" role="button" tabindex="0">
      <div class="prep-row-main">
        <div class="prep-row-name">${escHtml(r.name)}</div>
        <div class="prep-row-sub">${t('prep.rowPackMeta', { bags: r.bags, items: r.items })}</div>
        ${r.limitG > 0 ? `<div class="prep-row-bar"><div class="prep-row-bar-fill${r.over ? ' is-over' : ''}" style="width:${Math.min(100, Math.round((r.weightG / r.limitG) * 100))}%"></div></div>` : ''}
      </div>
      <div class="prep-row-meta${r.over ? ' is-over' : ''}">${escHtml(r.limitG > 0
        ? t('prep.rowPackFill', { used: formatKg(r.weightG), limit: formatKg(r.limitG) })
        : formatKg(r.weightG))}</div>
      ${r.over
        ? `<span class="prep-row-badge is-warn">${t('pack.overLimit')}</span>`
        : `<span class="prep-row-badge is-empty" aria-hidden="true"></span>`}
      <button class="prep-row-del" data-del-pk="${escHtml(r.id)}" title="${t('prep.rowDelete')}">✕</button>
    </div>`).join('')}</div>`;
}

function renderNextUp(items: NextUpItem[], hasItems: boolean): string {
  if (!hasItems) return '';
  if (!items.length) return `<div class="prep-next prep-next--clear">${escHtml(t('prep.nextUpClear'))}</div>`;
  return `
    <div class="prep-next">
      <div class="prep-next-head">${escHtml(t('prep.nextUp'))}</div>
      ${items.map((it, i) => `
        <button type="button" class="prep-next-item" data-next="${i}">
          <span class="prep-next-box"><svg viewBox="0 0 16 16"><path d="M3 8.5 l3.2 3.4 l6.6 -8" pathLength="24"/></svg></span>
          <span class="prep-next-text">${escHtml(it.text)}</span>
          <span class="prep-next-src">${escHtml(it.icon)} ${escHtml(it.listName)}</span>
        </button>`).join('')}
    </div>`;
}

function emptyCard(icon: string, title: string, text: string, actions: string): string {
  return `
    <div class="prep-empty">
      <span class="prep-empty-icon">${icon}</span>
      <div class="prep-empty-title">${escHtml(title)}</div>
      <p class="prep-empty-text">${escHtml(text)}</p>
      <div class="prep-empty-actions">${actions}</div>
    </div>`;
}

function bindLanding(host: HTMLElement) {
  const legs = peekLegs();
  const focus = resolvePhase(daysToGo(legs), tripPhase(legs));
  host.querySelector('#prep-hero-action')?.addEventListener('click', () => {
    const action = heroChipAction(focus);
    if (action) focusPackAction(action);
  });

  // Each action can appear twice — in a rail header and in that rail's empty
  // card — so bind every match, not just the first.
  const on = (act: string, fn: () => void) =>
    host.querySelectorAll(`[data-act="${act}"]`).forEach(el => el.addEventListener('click', fn));

  on('new-cl', () => openNewChecklistModal());
  on('tpl', () => openTemplatePickerModal());
  on('new-pk', () => openNewPackListModal());
  on('formula', () => openPackFormula());
  on('kit', () => openCoreKit());

  bindStages(host);
  host.querySelectorAll<HTMLElement>('[data-next]').forEach(btn => {
    btn.addEventListener('click', () => {
      const it = _next[Number(btn.dataset.next)];
      if (!it || btn.classList.contains('is-ticking')) return;
      // Let the tick draw before the store push re-renders the strip.
      btn.classList.add('is-ticking');
      window.setTimeout(() => { void tickNextUp(it); }, 480);
    });
  });

  host.querySelectorAll<HTMLElement>('[data-cl]').forEach(row => {
    const open = () => openChecklistDetail(row.dataset.cl!);
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.prep-row-del')) return;
      open();
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
  host.querySelectorAll<HTMLElement>('[data-pk]').forEach(row => {
    const open = () => openPackDetail(row.dataset.pk!);
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.prep-row-del')) return;
      open();
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });

  host.querySelectorAll<HTMLElement>('[data-del-cl]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(t('prep.confirmDelete'))) await deleteChecklist(btn.dataset.delCl!);
    });
  });
  host.querySelectorAll<HTMLElement>('[data-del-pk]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(t('prep.confirmDeletePackList'))) await deletePackList(btn.dataset.delPk!);
    });
  });
}

/* ── Landing ↔ focused-screen switching ──────────────────────────────────── */

// Each section reports its own screen; the landing shows only when both are
// idle. Tracked separately so one section returning to its list doesn't
// reveal the landing while the other is still mid-edit.
let _clFocused = false;
let _pkFocused = false;

function applyMode() {
  const root = _root;
  if (!root) return;
  const wasFocused = root.classList.contains('is-focused');
  const focused = _clFocused || _pkFocused;

  root.classList.toggle('is-focused', focused);
  _landing?.classList.toggle('is-hidden', focused);
  root.querySelector('#prepare-checklist-zone')?.classList.toggle('is-hidden', !_clFocused);
  root.querySelector('#prepare-pack-zone')?.classList.toggle('is-hidden', !_pkFocused);

  // Returning from an editor: repaint so edits made in there (renamed list,
  // items ticked off) show in the rails and hero straight away.
  if (wasFocused && !focused) renderLanding();
}

function onChecklistScreen(screen: ChecklistScreen) {
  _clFocused = screen !== 'list';
  applyMode();
}
function onPackScreen(screen: PackScreen) {
  _pkFocused = screen !== 'list';
  applyMode();
}

export function initPrepare(): void {
  const root = getRoot();
  if (!root) return;
  _root = root;

  // eslint-disable-next-line no-restricted-syntax -- static shell markup, no interpolation
  root.innerHTML = `
    <div class="prepare-landing" id="prepare-landing"></div>
    <div class="prepare-zone is-hidden" id="prepare-checklist-zone"></div>
    <div class="prepare-zone is-hidden" id="prepare-pack-zone"></div>
  `;
  _landing = root.querySelector<HTMLElement>('#prepare-landing');

  const checklistZone = root.querySelector<HTMLElement>('#prepare-checklist-zone')!;
  const packZone = root.querySelector<HTMLElement>('#prepare-pack-zone')!;

  // A re-init (trip switch) always starts on the landing. Both sections reset
  // their own screen too, but clearing here means this doesn't depend on that
  // — otherwise stale focus flags could hide the landing behind a blank zone.
  _clFocused = false;
  _pkFocused = false;
  resetStages();
  _notesKey = '';

  // Sections own the store subscriptions; they ping us on every push so the
  // rails and hero repaint from the same data without double-subscribing.
  initPrep(checklistZone, onChecklistScreen, renderLanding);
  initPack(packZone, onPackScreen, renderLanding);

  renderLanding();
  applyMode();

  // Trip/leg edits shift the countdown and the Pack Formula availability.
  _legsUnsub?.();
  _legsUnsub = routeStore.subscribe(() => renderLanding());
}
