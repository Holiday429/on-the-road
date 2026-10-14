/* ==========================================================================
   On the Road · Prepare — readiness workspace
   --------------------------------------------------------------------------
   One page that answers "am I ready to leave?". A banner (countdown, both
   sections' standing, and one alert when a bag needs attention) over two equal
   panels — Checklist and Pack — each a header with a single "+ New" menu and one
   fixed-size scene that is itself the way in (a clipboard, a floor with a scale).

   Clicking a scene hands the whole page to that section's own editor (checklist
   detail, pack detail with its drag-and-drop bags, or the Core Kit table), which
   renders full-width; its breadcrumb returns here.
   ========================================================================== */

import './styles/prepare.css';
import './styles/prepare-scenes.css';
import {
  initPrep, openChecklistDetail, openNewChecklistModal, openTemplatePickerModal,
  peekChecklistRows, peekChecklistPreview, checklistTotals,
  type ChecklistScreen,
} from './checklist-section.ts';
import {
  initPack, openPackDetail, openNewPackListModal, openPackFormula, openCoreKit,
  peekPackRows, packTotals, packFormulaAvailable, focusPackAction,
  peekPackScene, packAlert, openPackWeigh, formatKg, type PackScreen,
} from './pack-section.ts';
import { resolvePhase, renderHero, heroChipAction, resolveAlert } from './phase-strip.ts';
import { renderClipboardScene, renderPackScene, renderSwitcher, CLIP_SLOTS } from './prepare-scenes.ts';
import { renderMenu, wireMenus } from './prepare-ui.ts';
import { daysToGo, tripPhase, peekLegs } from '../../data/trip-phase.ts';
import { routeStore } from '../../data/stores/route-store.ts';
import { t } from '../../core/i18n.ts';

let _root: HTMLElement | null = null;
let _landing: HTMLElement | null = null;
let _legsUnsub: (() => void) | null = null;
// Which list each scene features (the user switches with the ‹ › chip; null = the default pick).
const _feat: { cl: string | null; pk: string | null } = { cl: null, pk: null };

function getRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#view-prep .prepare-root');
}

/* ── Landing ─────────────────────────────────────────────────────────────── */

type ChecklistRow = ReturnType<typeof peekChecklistRows>[number];
type PackRow = ReturnType<typeof peekPackRows>[number];

/** The row a scene features: the one chosen (or switched to) if it still exists, else `pick`'s choice. */
function featured<T extends { id: string }>(rows: T[], id: string | null, pick: (rows: T[]) => T): T | null {
  return rows.find(r => r.id === id) ?? (rows.length ? pick(rows) : null);
}

/** Checklist: the list with the most left to do (the one that most needs you), else the first. */
const mostLeft = (rows: ChecklistRow[]) => rows.reduce((best, r) => (r.left > best.left ? r : best), rows[0]);

function clFeatured(rows: ChecklistRow[]): ChecklistRow | null {
  return featured(rows, _feat.cl, mostLeft);
}

function pkFeatured(rows: PackRow[]): PackRow | null {
  // Pack: the list the banner is flagging, else the first.
  const flagged = packAlert()?.listId;
  return featured(rows, _feat.pk, (r) => r.find(x => x.id === flagged) ?? r[0]);
}

function clSceneHtml(rows: ChecklistRow[]): string {
  const f = clFeatured(rows);
  if (!f) return renderClipboardScene(null);
  const i = rows.findIndex(r => r.id === f.id);
  return renderClipboardScene({
    id: f.id, name: f.name, done: f.done, total: f.total, pct: f.pct, left: f.left,
    preview: peekChecklistPreview(f.id, CLIP_SLOTS), behind: rows.length - 1,
  }, renderSwitcher('cl', f.name, i, rows.length));
}

function pkSceneHtml(rows: PackRow[]): string {
  const f = pkFeatured(rows);
  const scene = f ? peekPackScene(f.id) : null;
  if (!f || !scene) return renderPackScene(null, formatKg);
  const i = rows.findIndex(r => r.id === f.id);
  return renderPackScene({ id: f.id, name: f.name, bags: scene.bags, totalLabel: formatKg(f.weightG) }, formatKg,
    renderSwitcher('pk', f.name, i, rows.length));
}

function renderLanding() {
  const host = _landing;
  if (!host) return;

  const legs = peekLegs();
  const days = daysToGo(legs);
  const focus = resolvePhase(days, tripPhase(legs));
  const cl = checklistTotals();
  const pk = packTotals();
  const clRows = peekChecklistRows();
  const pkRows = peekPackRows();

  // Weight against the bags' limits, over the lists that set one (a list without limits has nothing to compare).
  const limited = pkRows.filter(r => r.limitG > 0);
  const limitSum = limited.reduce((n, r) => n + r.limitG, 0);
  const pct = limitSum > 0 ? Math.min(1, limited.reduce((n, r) => n + r.weightG, 0) / limitSum) : null;

  const hero = renderHero(focus, days, {
    checklist: cl,
    pack: { lists: pk.lists, bags: pk.bags, weightLabel: formatKg(pk.weightG), over: pk.over, pct },
  }, resolveAlert(packAlert(), days));

  // One "+ New" menu per panel, in the same place with the same look — the only action in either header.
  const clMenu = renderMenu(t('prep.menuNew'), [
    { act: 'new-cl', label: t('prep.menuNewChecklist'), icon: '📋' },
    { act: 'tpl', label: t('prep.menuFromTemplate'), icon: '🗂️' },
  ], { variant: 'primary' });
  const pkMenu = renderMenu(t('prep.menuNew'), [
    { act: 'new-pk', label: t('prep.menuNewPackList'), icon: '🎒' },
    ...(packFormulaAvailable() ? [{ act: 'formula', label: t('prep.menuPackFormula'), icon: '✨' }] : []),
    { act: 'kit', label: t('prep.btnCoreKit', { count: pk.kit }), icon: '🧰' },
  ], { variant: 'primary' });

  // eslint-disable-next-line no-restricted-syntax -- audited: escHtml on every interpolation here, in renderHero, prepare-ui.ts and prepare-scenes.ts (N5)
  host.innerHTML = `
    ${hero}

    <div class="prep-split">
      <section class="prep-rail prep-rail--checklist" id="prep-rail-checklist">
        <div class="prep-rail-head">
          <h2 class="prep-rail-title"><span class="prep-rail-icon">📋</span>${t('prep.checklistSectionTitle')}</h2>
          ${clMenu}
        </div>
        <div class="prep-scene-host" data-scene-host="cl">${clSceneHtml(clRows)}</div>
      </section>

      <section class="prep-rail prep-rail--pack" id="prep-rail-pack">
        <div class="prep-rail-head">
          <h2 class="prep-rail-title"><span class="prep-rail-icon">🎒</span>${t('nav.pack')}</h2>
          ${pkMenu}
        </div>
        <div class="prep-scene-host" data-scene-host="pk">${pkSceneHtml(pkRows)}</div>
      </section>
    </div>
  `;

  bindLanding(host);
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

/** Moves a panel to the previous/next list and repaints just that scene. */
function step(host: HTMLElement, kind: 'cl' | 'pk', by: number) {
  const rows: { id: string }[] = kind === 'cl' ? peekChecklistRows() : peekPackRows();
  if (rows.length < 2) return;
  const cur = (kind === 'cl' ? clFeatured(peekChecklistRows()) : pkFeatured(peekPackRows()))?.id ?? rows[0].id;
  const i = rows.findIndex(r => r.id === cur);
  _feat[kind] = rows[(i + by + rows.length) % rows.length].id;
  const slot = host.querySelector<HTMLElement>(`[data-scene-host="${kind}"]`);
  if (!slot) return;
  // eslint-disable-next-line no-restricted-syntax -- audited: scene markup escapes every interpolation
  slot.innerHTML = kind === 'cl' ? clSceneHtml(peekChecklistRows()) : pkSceneHtml(peekPackRows());
  bindScenes(host, slot);
}

/** Each action can appear in a menu and in an empty scene — bind every match in `scope` (once per element). */
function bindActs(scope: HTMLElement) {
  const on = (act: string, fn: () => void) =>
    scope.querySelectorAll(`[data-act="${act}"]`).forEach(el => el.addEventListener('click', fn));
  on('new-cl', () => openNewChecklistModal());
  on('tpl', () => openTemplatePickerModal());
  on('new-pk', () => openNewPackListModal());
  on('formula', () => openPackFormula());
  on('kit', () => openCoreKit());
}

/** Wires the scenes (used on the whole landing and again when a scene is swapped). */
function bindScenes(host: HTMLElement, root: HTMLElement = host) {
  const keyOpen = (el: HTMLElement, fn: () => void) => el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
  });
  root.querySelectorAll<HTMLElement>('[data-open-cl]').forEach(el => {
    const go = () => enter(el.closest<HTMLElement>('.prep-scene') ?? el, () => openChecklistDetail(el.dataset.openCl!));
    el.addEventListener('click', go);
    keyOpen(el, go);
  });
  root.querySelectorAll<HTMLElement>('[data-open-pk]').forEach(el => {
    const go = () => enter(el.closest<HTMLElement>('.prep-scene') ?? el, () => openPackDetail(el.dataset.openPk!));
    el.addEventListener('click', go);
    keyOpen(el, go);
  });
  // The empty scenes are themselves the "new" button.
  root.querySelectorAll<HTMLElement>('.prep-clip[data-act], .prep-floor[data-act]').forEach(el => keyOpen(el, () => el.click()));
  // The scale on the floor starts the weigh-in.
  root.querySelectorAll<HTMLElement>('[data-weigh-pk]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); openPackWeigh(el.dataset.weighPk!); });
  });
  root.querySelectorAll<HTMLElement>('[data-switch]').forEach(sw => {
    const kind = sw.dataset.switch as 'cl' | 'pk';
    sw.querySelectorAll<HTMLElement>('[data-switch-step]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      step(host, kind, Number(b.dataset.switchStep));
    }));
  });
  bindActs(root);
}

function bindLanding(host: HTMLElement) {
  const legs = peekLegs();
  const focus = resolvePhase(daysToGo(legs), tripPhase(legs));
  host.querySelector('#prep-hero-action')?.addEventListener('click', () => {
    const action = heroChipAction(focus);
    if (action) focusPackAction(action);
  });
  // The banner's alert: over the limit → fix it in the list; not weighed → start the weigh-in.
  host.querySelector<HTMLElement>('#prep-hero-alert')?.addEventListener('click', (e) => {
    const el = e.currentTarget as HTMLElement;
    const id = el.dataset.alertList!;
    if (el.dataset.alert === 'over') openPackDetail(id); else openPackWeigh(id);
  });
  wireMenus();
  bindScenes(host);
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
