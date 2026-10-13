/* ==========================================================================
   On the Road · Global top bar
   --------------------------------------------------------------------------
   The controls that belong to the app rather than to one page — time travel,
   alerts, new trip, theme, language — pinned above every view. Used to live in
   the Dashboard's greeting row. The bell and the clock refresh on their own
   (they read the stores directly); the preference controls are built once so an
   open language menu is not torn down by a store update.
   ========================================================================== */

import './topbar.css';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import { todoStore, type StoredTodo } from '../../data/stores/todo-store.ts';
import { currentTrip, baseCurrency, onTripChange } from '../../data/trip-context.ts';
import { todayIso } from '../../data/trip-phase.ts';
import { getRateTable, peekRateTable, type RateTable } from '../../data/rates.ts';
import { onSimChange } from '../../data/sim-clock.ts';
import { t, onLocaleChange } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { openNewTrip, navigateTo, NAV_ITEMS, type ViewId } from '../../core/app.ts';
import { navLabel, renderNavIcon } from '../../core/sidebar.ts';
import { mountPrefControls } from '../../core/pref-mounts.ts';
import { renderSimControl, wireSimControl } from '../dashboard/dashboard-simclock.ts';
import { renderAlertBell, wireAlertBell } from '../dashboard/dashboard-alert-bell.ts';

let _legs: StoredLeg[] = [];
let _expenses: StoredExpense[] = [];
let _todos: StoredTodo[] = [];
let _rates: RateTable = {};
let _started = false;

function inBase(e: StoredExpense): number {
  if (e.baseCurrency === baseCurrency()) return e.baseAmount;
  const cross = _rates[e.baseCurrency];
  return cross ? e.baseAmount * cross : e.baseAmount;
}

/** The tabs of the "My world" page — the one sidebar entry that holds three views. */
const WORLD_VIEWS: ViewId[] = ['passport', 'atlas', 'wrap'];
let _viewId: ViewId = 'today';

function tripOver(): boolean {
  const tr = currentTrip();
  return !!tr?.endDate && todayIso() > tr.endDate;
}

function iconTitle(id: ViewId): string {
  const item = NAV_ITEMS.find((n) => n.id === id);
  return item ? `<span class="view-title-icon" aria-hidden="true">${renderNavIcon(item)}</span><span>${esc(navLabel(item))}</span>` : '';
}

/** The page title, left of the controls: the greeting on the Dashboard, the page's own title elsewhere. */
function titleHtml(id: ViewId): string {
  const view = document.getElementById(`view-${id}`);
  if (id === 'today') {
    const g = view?.querySelector('.td-greeting');
    return g ? `<span class="tb-greeting">${g.innerHTML}</span>` : '';
  }
  if (WORLD_VIEWS.includes(id)) return iconTitle('passport');
  const own = view?.querySelector('.view-title');
  return own?.innerHTML.trim() ? own.innerHTML : iconTitle(id);
}

function tabsHtml(id: ViewId): string {
  if (!WORLD_VIEWS.includes(id)) return '';
  const tabs = WORLD_VIEWS.filter((v) => v !== 'wrap' || tripOver() || id === 'wrap');
  return `<div class="tb-tabs" role="tablist">${tabs.map((v) =>
    `<button type="button" class="tb-tab${v === id ? ' is-active' : ''}" role="tab" aria-selected="${v === id}" data-tb-tab="${v}">${esc(t(`nav.${v}`))}</button>`).join('')}</div>`;
}

/** Title + tabs follow the active view. */
function paintTitle(): void {
  const slot = host()?.querySelector<HTMLElement>('[data-tb-title]');
  if (!slot) return;
  // eslint-disable-next-line no-restricted-syntax -- audited: copied from the view's own markup, which escapes its values
  slot.innerHTML = `<div class="tb-title">${titleHtml(_viewId)}</div>${tabsHtml(_viewId)}`;
  slot.querySelectorAll<HTMLElement>('[data-tb-tab]').forEach((b) =>
    b.addEventListener('click', () => { void navigateTo(b.dataset.tbTab as ViewId); }));
}

function host(): HTMLElement | null { return document.getElementById('app-topbar'); }

/** The pieces that follow the data: the time-travel control and the alert bell. */
function paintLive(): void {
  const bar = host();
  if (!bar) return;
  const sim = bar.querySelector<HTMLElement>('[data-tb-sim]');
  const bell = bar.querySelector<HTMLElement>('[data-tb-bell]');
  if (sim) {
    // eslint-disable-next-line no-restricted-syntax -- audited: renderSimControl escapes its interpolations
    sim.innerHTML = renderSimControl();
    wireSimControl(sim, () => { const tr = currentTrip(); return { trip: tr ? { startDate: tr.startDate, endDate: tr.endDate } : null, legs: _legs }; });
  }
  if (bell) {
    // eslint-disable-next-line no-restricted-syntax -- audited: renderAlertBell escapes its interpolations
    bell.innerHTML = renderAlertBell({ expenses: _expenses, legs: _legs, todos: _todos, today: todayIso(), inBase });
    wireAlertBell(bell, paintLive);
  }
}

/** The whole bar — on first paint and when the language changes. */
function paintAll(): void {
  const bar = host();
  if (!bar) return;
  // eslint-disable-next-line no-restricted-syntax -- audited: every interpolation goes through esc()
  bar.innerHTML = `
    <div class="tb-inner">
      <div class="tb-head" data-tb-title></div>
      <div class="tb-slot" data-tb-sim></div>
      <div class="tb-slot" data-tb-bell></div>
      <button type="button" class="btn btn-ghost tb-new-trip" data-tb-new-trip>${esc(t('common.newTrip'))}</button>
      <div class="tb-prefs" data-lang-mount></div>
    </div>`;
  bar.querySelector('[data-tb-new-trip]')?.addEventListener('click', () => openNewTrip());
  const prefs = bar.querySelector<HTMLElement>('[data-lang-mount]');
  if (prefs) mountPrefControls(prefs);
  paintLive();
  paintTitle();
}

let _queued = false;
function schedule(): void {
  if (_queued) return;
  _queued = true;
  queueMicrotask(() => { _queued = false; paintLive(); });
}

/** Idempotent: mounts the bar once and keeps it fresh for the life of the page. */
export function initTopbar(): void {
  if (_started) return;
  _started = true;
  _rates = peekRateTable(baseCurrency());
  _legs = routeStore.peek();
  _expenses = expenseStore.peek();
  _todos = todoStore.peek();
  const active = document.querySelector<HTMLElement>('.view.active')?.id.replace(/^view-/, '');
  if (active) _viewId = active as ViewId;
  paintAll();

  window.addEventListener('otr:view-change', (e) => {
    _viewId = (e as CustomEvent<{ id: ViewId }>).detail.id;
    paintTitle();
  });
  // The Dashboard re-renders its greeting (time of day, language, name).
  window.addEventListener('otr:title-refresh', paintTitle);

  routeStore.subscribe((rows) => { _legs = rows; schedule(); });
  expenseStore.subscribe((rows) => { _expenses = rows; schedule(); });
  todoStore.subscribe((rows) => { _todos = rows; schedule(); });
  onTripChange(() => { schedule(); paintTitle(); });
  onSimChange(schedule);
  onLocaleChange(() => { paintAll(); requestAnimationFrame(paintTitle); });   // the views retitle themselves in their own listeners
  void getRateTable(baseCurrency()).then((table) => { _rates = table; schedule(); });
}
