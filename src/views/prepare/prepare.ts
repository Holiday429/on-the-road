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
import './styles/prepare-scenes.css';
import {
  initPrep, openChecklistDetail, openNewChecklistModal, openTemplatePickerModal,
  peekChecklistRows, peekChecklistPreview, checklistTotals, deleteChecklist,
  type ChecklistScreen,
} from './checklist-section.ts';
import {
  initPack, openPackDetail, openNewPackListModal, openPackFormula, openCoreKit,
  peekPackRows, packTotals, packFormulaAvailable, deletePackList, focusPackAction,
  peekPackScene, packWeighNeeds, openPackWeigh, formatKg, type PackScreen,
} from './pack-section.ts';
import { resolvePhase, renderHero, heroChipAction } from './phase-strip.ts';
import {
  renderClipboardScene, renderPackScene, renderWeighCard, renderChecklistCard, renderWeighNotice,
} from './prepare-scenes.ts';
import { noteVar } from '../../data/palette.ts';
import { daysToGo, tripPhase, peekLegs } from '../../data/trip-phase.ts';
import { routeStore } from '../../data/stores/route-store.ts';
import { escHtml } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';

let _root: HTMLElement | null = null;
let _landing: HTMLElement | null = null;
let _legsUnsub: (() => void) | null = null;
// Which list each scene features (hovering a list's row brings it to the front).
const _feat: { cl: string | null; pk: string | null } = { cl: null, pk: null };
const NOTICE_KEY = 'otr:prep:weigh-notice-dismissed';
/** The weigh-before-you-fly strip shows in the last two weeks before departure. */
const NOTICE_DAYS = 14;

function getRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#view-prep .prepare-root');
}

/* ── Landing ─────────────────────────────────────────────────────────────── */

type ChecklistRow = ReturnType<typeof peekChecklistRows>[number];
type PackRow = ReturnType<typeof peekPackRows>[number];

/** The row a scene features: the one hovered/last chosen if it still exists, else the first. */
function featured<T extends { id: string }>(rows: T[], id: string | null): T | null {
  return rows.find(r => r.id === id) ?? rows[0] ?? null;
}

function clipSceneHtml(rows: ChecklistRow[]): string {
  const f = featured(rows, _feat.cl);
  if (!f) return '';
  return renderClipboardScene({
    id: f.id, name: f.name, done: f.done, total: f.total, pct: f.pct,
    preview: peekChecklistPreview(f.id, 4), behind: rows.length - 1,
  });
}

function packSceneHtml(rows: PackRow[]): string {
  const f = featured(rows, _feat.pk);
  const scene = f ? peekPackScene(f.id) : null;
  if (!f || !scene) return '';
  return renderPackScene(f.id, scene.bags, formatKg(f.weightG), formatKg);
}

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

  // With nothing in a panel, its actions move into the empty card's call to
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

  // Departure is close and a bag has not been weighed (or has changed, or is over): say so up top.
  const need = packWeighNeeds();
  const dismissed = (() => { try { return sessionStorage.getItem(NOTICE_KEY) === '1'; } catch { return false; } })();
  const notice = need && !dismissed && days !== null && days >= 0 && days <= NOTICE_DAYS
    ? renderWeighNotice(need.listId, days, need.status) : '';

  // eslint-disable-next-line no-restricted-syntax -- audited: escHtml on every interpolation here, in renderHero and in prepare-scenes.ts (N5)
  host.innerHTML = `
    ${hero}
    ${notice}

    <div class="prep-split">
      <section class="prep-rail prep-rail--checklist" id="prep-rail-checklist">
        <div class="prep-rail-head">
          <h2 class="prep-rail-title"><span class="prep-rail-icon">📋</span>${t('prep.checklistSectionTitle')}</h2>
          ${clActions}
        </div>
        <div class="prep-scene-host" data-scene-host="cl">${clTopHtml(clRows)}</div>
        ${renderChecklistRows(clRows)}
      </section>

      <section class="prep-rail prep-rail--pack" id="prep-rail-pack">
        <div class="prep-rail-head">
          <h2 class="prep-rail-title"><span class="prep-rail-icon">🎒</span>${t('nav.pack')}</h2>
          ${pkActions}
        </div>
        <div class="prep-scene-host" data-scene-host="pk">${pkTopHtml(pkRows)}</div>
        ${renderPackRows(pkRows)}
      </section>
    </div>
  `;

  bindLanding(host);
}

/** Status card + scene for the checklist panel (re-rendered as a unit when the featured list changes). */
function clTopHtml(rows: ChecklistRow[]): string {
  const f = featured(rows, _feat.cl);
  return `${f ? renderChecklistCard(f.id, f.done, f.total, f.name) : ''}${clSceneOrEmpty(rows)}`;
}

function pkTopHtml(rows: PackRow[]): string {
  const f = featured(rows, _feat.pk);
  const scene = f ? peekPackScene(f.id) : null;
  const card = !f ? '' : scene && scene.bags.length ? renderWeighCard(f.id, scene.status) : renderPackHintCard(f);
  return `${card}${pkSceneOrEmpty(rows)}`;
}

function clSceneOrEmpty(rows: ChecklistRow[]): string {
  return rows.length ? clipSceneHtml(rows) : emptyCard('📋', t('prep.railChecklistEmptyTitle'), t('prep.railChecklistEmpty'), `
      <button class="btn btn-primary" data-act="new-cl">${t('prep.btnNewChecklist')}</button>
      <button class="btn btn-ghost" data-act="tpl">${t('prep.btnFromTemplate')}</button>
    `);
}

function pkSceneOrEmpty(rows: PackRow[]): string {
  return rows.length ? packSceneHtml(rows) : emptyCard('🎒', t('prep.railPackEmptyTitle'), t('prep.railPackEmpty'), `
      <button class="btn btn-primary" data-act="new-pk">${t('pack.btnNewList')}</button>
      ${packFormulaAvailable() ? `<button class="btn btn-ghost" data-act="formula">${t('pack.btnFormula')}</button>` : ''}
      <button class="btn btn-ghost" data-act="kit">${t('prep.btnCoreKitShort')}</button>
    `);
}

/** A list with no bags yet has nothing to weigh: the card nudges toward adding one instead. */
function renderPackHintCard(f: PackRow): string {
  return `
    <button type="button" class="prep-status prep-status--weigh is-none" data-open-pk="${escHtml(f.id)}">
      <span class="prep-status-dot" aria-hidden="true"></span>
      <span class="prep-status-text">
        <span class="prep-status-title">${escHtml(t('prep.packNoBagsTitle'))}</span>
        <span class="prep-status-sub">${escHtml(t('pack.noBagsYet'))}</span>
      </span>
      <span class="prep-status-go" aria-hidden="true">→</span>
    </button>`;
}

/** Every list as a compact row: tap to open, hover to bring it to the front of the scene. */
function renderChecklistRows(rows: ChecklistRow[]): string {
  if (!rows.length) return '';
  return `<div class="prep-rows prep-rows--compact">${rows.map((r, i) => {
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
  if (!rows.length) return '';
  return `<div class="prep-rows prep-rows--compact">${rows.map(r => `
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

function emptyCard(icon: string, title: string, text: string, actions: string): string {
  return `
    <div class="prep-empty">
      <span class="prep-empty-icon">${icon}</span>
      <div class="prep-empty-title">${escHtml(title)}</div>
      <p class="prep-empty-text">${escHtml(text)}</p>
      <div class="prep-empty-actions">${actions}</div>
    </div>`;
}

/** The scene is the way in: it zooms toward you, then the editor takes the page. */
function enter(el: HTMLElement, go: () => void): void {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || typeof el.animate !== 'function') { go(); return; }
  void el.animate(
    [{ transform: 'scale(1)', opacity: 1 }, { transform: 'translateY(-6px) scale(1.07)', opacity: 0 }],
    { duration: 260, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'forwards' },
  ).finished.then(go, go);
}

/** Wires the scenes and their cards (used on the whole landing and again when a scene is swapped). */
function bindScenes(root: HTMLElement) {
  // The scenes: a clipboard and a floor of bags. Either opens the featured list.
  const keyOpen = (el: HTMLElement, fn: () => void) => el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
  });
  root.querySelectorAll<HTMLElement>('[data-open-cl]').forEach(el => {
    const go = () => enter(el.closest<HTMLElement>('.prep-scene') ?? el, () => openChecklistDetail(el.dataset.openCl!));
    el.addEventListener('click', go);
    if (el.classList.contains('prep-clip')) keyOpen(el, go);
  });
  root.querySelectorAll<HTMLElement>('[data-open-pk]').forEach(el => {
    const go = () => enter(el.closest<HTMLElement>('.prep-scene') ?? el, () => openPackDetail(el.dataset.openPk!));
    el.addEventListener('click', go);
    if (el.classList.contains('prep-floor')) keyOpen(el, go);
  });
  // The scale on the floor, the status card and the pre-trip strip all start the weigh-in.
  root.querySelectorAll<HTMLElement>('[data-weigh-pk]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); openPackWeigh(el.dataset.weighPk!); });
  });
}

function bindLanding(host: HTMLElement) {
  const legs = peekLegs();
  const focus = resolvePhase(daysToGo(legs), tripPhase(legs));
  host.querySelector('#prep-hero-action')?.addEventListener('click', () => {
    const action = heroChipAction(focus);
    if (action) focusPackAction(action);
  });

  // Each action can appear twice — in a panel header and in that panel's empty
  // card — so bind every match, not just the first.
  const on = (act: string, fn: () => void) =>
    host.querySelectorAll(`[data-act="${act}"]`).forEach(el => el.addEventListener('click', fn));

  on('new-cl', () => openNewChecklistModal());
  on('tpl', () => openTemplatePickerModal());
  on('new-pk', () => openNewPackListModal());
  on('formula', () => openPackFormula());
  on('kit', () => openCoreKit());

  bindScenes(host);
  host.querySelector('[data-dismiss-notice]')?.addEventListener('click', () => {
    try { sessionStorage.setItem(NOTICE_KEY, '1'); } catch { /* fine: it just comes back */ }
    host.querySelector('[data-notice]')?.remove();
  });

  // Hovering a list's row brings that list to the front of its scene.
  const feature = (kind: 'cl' | 'pk', id: string) => {
    if (_feat[kind] === id) return;
    _feat[kind] = id;
    const slot = host.querySelector<HTMLElement>(`[data-scene-host="${kind}"]`);
    if (!slot) return;
    // eslint-disable-next-line no-restricted-syntax -- audited: scene markup escapes every interpolation
    slot.innerHTML = kind === 'cl' ? clTopHtml(peekChecklistRows()) : pkTopHtml(peekPackRows());
    bindScenes(slot);
  };

  host.querySelectorAll<HTMLElement>('[data-cl]').forEach(row => {
    const open = () => openChecklistDetail(row.dataset.cl!);
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.prep-row-del')) return;
      open();
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    row.addEventListener('mouseenter', () => feature('cl', row.dataset.cl!));
    row.addEventListener('focus', () => feature('cl', row.dataset.cl!));
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
    row.addEventListener('mouseenter', () => feature('pk', row.dataset.pk!));
    row.addEventListener('focus', () => feature('pk', row.dataset.pk!));
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
  _feat.cl = null;
  _feat.pk = null;

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
