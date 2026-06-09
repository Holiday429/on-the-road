/* ==========================================================================
   On the Road · Today — trip-at-a-glance dashboard
   --------------------------------------------------------------------------
   A read-only landing page that stitches together the day's slice of every
   other module: where you are right now (route), spend vs budget (expenses),
   prep progress (checklist), and one-tap safety. Every card deep-links into
   its source view via navigateTo — this page owns no data of its own, it just
   subscribes to the existing stores and re-paints.
   ========================================================================== */

import './today.css';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import { checklistStore, type StoredChecklist } from '../../data/stores/checklist-store.ts';
import { safetyStore, type StoredCitySafety } from '../../data/stores/safety-store.ts';
import { currentTrip, baseCurrency, tripBudget, onTripChange } from '../../data/trip-context.ts';
import { currencySymbol, getRateTable, peekRateTable, type RateTable } from '../../data/rates.ts';
import { navigateTo } from '../../core/app.ts';
import { escHtml as esc, slugId } from '../../core/utils.ts';

/* ── State ───────────────────────────────────────────────────────────────── */
let _legs: StoredLeg[] = [];
let _expenses: StoredExpense[] = [];
let _checklists: StoredChecklist[] = [];
let _cards: StoredCitySafety[] = [];
let _rates: RateTable = {};

let _unsubLegs: (() => void) | null = null;
let _unsubExp: (() => void) | null = null;
let _unsubChecklists: (() => void) | null = null;
let _unsubCards: (() => void) | null = null;
let _unsubTrip: (() => void) | null = null;

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The leg covering today, else the next upcoming one, else the last past one. */
function currentLeg(): StoredLeg | null {
  if (!_legs.length) return null;
  const today = todayIso();
  const sorted = [..._legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const here = sorted.find((l) => l.dateFrom <= today && l.dateTo >= today);
  return here ?? sorted.find((l) => l.dateFrom >= today) ?? sorted[sorted.length - 1];
}

/** Re-express a snapshotted expense in the current base currency. */
function inBase(e: StoredExpense): number {
  const target = baseCurrency();
  if (e.baseCurrency === target) return e.baseAmount;
  const cross = _rates[e.baseCurrency];
  return cross ? e.baseAmount * cross : e.baseAmount;
}

function fmt(n: number): string {
  return `${currencySymbol(baseCurrency())}${Math.round(n).toLocaleString()}`;
}

function legStatus(leg: StoredLeg): 'upcoming' | 'active' | 'past' {
  const today = todayIso();
  if (leg.dateTo < today) return 'past';
  if (leg.dateFrom > today) return 'upcoming';
  return 'active';
}

function daysUntil(iso: string): number {
  const ms = new Date(iso + 'T00:00:00').getTime() - new Date(todayIso() + 'T00:00:00').getTime();
  return Math.round(ms / 86400000);
}

/* ── Card: where am I now ────────────────────────────────────────────────── */
function renderLocationCard(): string {
  const leg = currentLeg();
  if (!leg) {
    return `
      <button class="today-card today-card-loc today-card-empty" data-nav="route">
        <div class="today-card-icon">🗺️</div>
        <div class="today-card-body">
          <div class="today-card-title">No itinerary yet</div>
          <div class="today-card-sub">Add your destinations to get started</div>
        </div>
        <span class="today-card-arrow">›</span>
      </button>`;
  }

  const status = legStatus(leg);
  const statusLabel = status === 'active'
    ? 'You are here'
    : status === 'upcoming'
    ? `Next stop · in ${daysUntil(leg.dateFrom)}d`
    : 'Last stop';

  return `
    <button class="today-card today-card-loc" data-nav="route">
      <div class="today-loc-flag">${esc(leg.flag) || '📍'}</div>
      <div class="today-card-body">
        <div class="today-loc-status today-loc-status-${status}">${statusLabel}</div>
        <div class="today-card-title">${esc(leg.city)}</div>
        <div class="today-card-sub">${esc(leg.country)} · ${esc(leg.dateFrom)} – ${esc(leg.dateTo)}</div>
      </div>
      <span class="today-card-arrow">›</span>
    </button>`;
}

/* ── Card: budget / spend ────────────────────────────────────────────────── */
function renderBudgetCard(): string {
  const total = _expenses.reduce((s, e) => s + inBase(e), 0);
  const today = todayIso();
  const todaySpend = _expenses.filter((e) => e.date === today).reduce((s, e) => s + inBase(e), 0);
  const budget = tripBudget();

  let bar = '';
  if (budget) {
    const pct = Math.min(100, Math.round((total / budget) * 100));
    const over = total > budget;
    const color = pct >= 100 ? 'var(--coral-500)' : pct >= 80 ? '#f59e0b' : 'var(--sage-500)';
    bar = `
      <div class="today-budget-bar-track">
        <div class="today-budget-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="today-budget-foot">
        <span class="${over ? 'today-budget-over' : 'today-budget-remain'}">
          ${over ? `${fmt(total - budget)} over` : `${fmt(budget - total)} left`}
        </span>
        <span class="today-budget-pct">${pct}% of ${fmt(budget)}</span>
      </div>`;
  } else {
    bar = `<div class="today-budget-foot"><span class="today-budget-hint">Tap to set a budget</span></div>`;
  }

  return `
    <button class="today-card today-card-budget" data-nav="expenses">
      <div class="today-card-row">
        <div>
          <div class="today-card-label">Spent so far</div>
          <div class="today-card-big">${fmt(total)}</div>
        </div>
        <div class="today-card-aside">
          <div class="today-card-label">Today</div>
          <div class="today-card-mid">${fmt(todaySpend)}</div>
        </div>
      </div>
      ${bar}
    </button>`;
}

/* ── Card: checklist progress ────────────────────────────────────────────── */
function renderChecklistCard(): string {
  let done = 0, total = 0;
  for (const cl of _checklists) {
    for (const g of cl.groups) {
      done += g.items.filter((i) => i.done).length;
      total += g.items.length;
    }
  }
  const pct = total ? Math.round((done / total) * 100) : 0;
  const remaining = total - done;

  const sub = total === 0
    ? 'No checklist items yet'
    : remaining === 0
    ? 'All done — you’re ready 🎉'
    : `${remaining} item${remaining === 1 ? '' : 's'} left to pack & prep`;

  return `
    <button class="today-card today-card-check" data-nav="prep">
      <div class="today-check-ring" style="--pct:${pct}">
        <span>${pct}%</span>
      </div>
      <div class="today-card-body">
        <div class="today-card-title">Prep checklist</div>
        <div class="today-card-sub">${sub}</div>
      </div>
      <span class="today-card-arrow">›</span>
    </button>`;
}

/* ── Card: safety quick-access ───────────────────────────────────────────── */
function renderSafetyCard(): string {
  const leg = currentLeg();
  const card = leg ? _cards.find((c) => c.id === slugId(leg.city)) : null;
  const general = card?.generalEmergency || '112';
  const cityName = leg?.city || 'your destination';

  return `
    <div class="today-card today-card-safety">
      <div class="today-card-body">
        <div class="today-card-label">Emergency · ${esc(cityName)}</div>
        <a class="today-sos-dial" href="tel:${general.replace(/[^+0-9]/g, '')}">
          <span class="today-sos-icon">☎</span>
          <span class="today-sos-num">${esc(general)}</span>
        </a>
      </div>
      <button class="today-sos-more" data-nav="safety">Safety details ›</button>
    </div>`;
}

/* ── Orchestration ───────────────────────────────────────────────────────── */
function render(): void {
  const body = document.querySelector<HTMLElement>('#view-today .today-body');
  if (!body) return;

  const trip = currentTrip();
  const greeting = trip ? `${esc(trip.name)}` : 'Your trip';

  body.innerHTML = `
    <div class="today-greeting">${greeting}</div>
    <div class="today-grid">
      ${renderLocationCard()}
      ${renderBudgetCard()}
      ${renderChecklistCard()}
      ${renderSafetyCard()}
    </div>`;

  body.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      // Don't hijack the tel: link inside the safety card.
      if ((e.target as HTMLElement).closest('a')) return;
      navigateTo(el.dataset.nav as Parameters<typeof navigateTo>[0]);
    });
  });
}

export function initToday(): void {
  const root = document.getElementById('view-today');
  if (!root) return;

  _rates = peekRateTable(baseCurrency());
  _legs = routeStore.peek();
  _expenses = expenseStore.peek();
  _checklists = checklistStore.peek();
  _cards = safetyStore.peek();
  render();

  _unsubLegs?.();
  _unsubExp?.();
  _unsubChecklists?.();
  _unsubCards?.();
  _unsubTrip?.();

  _unsubLegs = routeStore.subscribe((rows) => { _legs = rows; render(); });
  _unsubExp = expenseStore.subscribe((rows) => { _expenses = rows; render(); });
  _unsubChecklists = checklistStore.subscribe((rows) => { _checklists = rows; render(); });
  _unsubCards = safetyStore.subscribe((rows) => { _cards = rows; render(); });
  _unsubTrip = onTripChange(() => render());

  void getRateTable(baseCurrency()).then((table) => { _rates = table; render(); });
}
