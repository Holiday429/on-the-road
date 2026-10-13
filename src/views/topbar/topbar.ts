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
import { openNewTrip } from '../../core/app.ts';
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
      <div class="tb-slot" data-tb-sim></div>
      <div class="tb-slot" data-tb-bell></div>
      <button type="button" class="btn btn-ghost tb-new-trip" data-tb-new-trip>${esc(t('common.newTrip'))}</button>
      <div class="tb-prefs" data-lang-mount></div>
    </div>`;
  bar.querySelector('[data-tb-new-trip]')?.addEventListener('click', () => openNewTrip());
  const prefs = bar.querySelector<HTMLElement>('[data-lang-mount]');
  if (prefs) mountPrefControls(prefs);
  paintLive();
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
  paintAll();

  routeStore.subscribe((rows) => { _legs = rows; schedule(); });
  expenseStore.subscribe((rows) => { _expenses = rows; schedule(); });
  todoStore.subscribe((rows) => { _todos = rows; schedule(); });
  onTripChange(schedule);
  onSimChange(schedule);
  onLocaleChange(paintAll);
  void getRateTable(baseCurrency()).then((table) => { _rates = table; schedule(); });
}
