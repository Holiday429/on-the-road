/* ==========================================================================
   On the Road · Today — personal trip dashboard
   --------------------------------------------------------------------------
   The app's home screen and command centre. Not a list of jump-off buttons but
   an aggregated, time-aware board: it reads the trip's dates to decide which
   "phase" the traveller is in (before departure / on the road / after the trip)
   and lays out a bento grid of cards drawn from every module's "today slice".

   Three principles:
     · time-aware  — the Hero and card order change with the trip phase.
     · aggregation — every card is a read-only subscription to an existing
                     store; this view owns no data of its own.
     · actionable  — high-frequency actions happen inline (log a spend, tick a
                     plan/checklist item) without leaving the page; everything
                     else deep-links into its source view, with a nav-intent so
                     a card can open a specific leg/day rather than just a view.
   ========================================================================== */

import './today.css';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import { checklistStore, type StoredChecklist } from '../../data/stores/checklist-store.ts';
import { safetyStore, type StoredCitySafety } from '../../data/stores/safety-store.ts';
import { nomadStore, type StoredNomadSpot } from '../../data/stores/nomad-store.ts';
import { compareStore, type StoredGroup as StoredCompare } from '../../data/stores/compare-store.ts';
import { currentTrip, currentTripId, baseCurrency, tripBudget, onTripChange } from '../../data/trip-context.ts';
import { currencySymbol, getRateTable, peekRateTable, type RateTable } from '../../data/rates.ts';
import { navigateTo, type ViewId, type NavIntent } from '../../core/app.ts';
import { escHtml as esc, slugId } from '../../core/utils.ts';
import type { PlanItem, ChecklistItem } from '../../data/schema.ts';

/* ── State ───────────────────────────────────────────────────────────────── */
let _legs: StoredLeg[] = [];
let _expenses: StoredExpense[] = [];
let _checklists: StoredChecklist[] = [];
let _cards: StoredCitySafety[] = [];
let _nomad: StoredNomadSpot[] = [];
let _compare: StoredCompare[] = [];
let _rates: RateTable = {};
let _quickAddOpen = false;   // inline expense form toggle (preserved across re-paints)

let _unsubs: Array<() => void> = [];

/* ── Time helpers ────────────────────────────────────────────────────────── */
type Phase = 'before' | 'during' | 'after';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso + 'T00:00:00').getTime() - new Date(fromIso + 'T00:00:00').getTime();
  return Math.round(ms / 86400000);
}
function daysUntil(iso: string): number {
  return daysBetween(todayIso(), iso);
}

function sortedLegs(): StoredLeg[] {
  return [..._legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
}

/** Which phase the trip is in today, from the trip dates (legs as fallback). */
function tripPhase(): Phase {
  const trip = currentTrip();
  const today = todayIso();
  const legs = sortedLegs();
  const start = trip?.startDate || legs[0]?.dateFrom;
  const end = trip?.endDate || legs[legs.length - 1]?.dateTo;
  if (!start || !end) return 'before';
  if (today < start) return 'before';
  if (today > end) return 'after';
  return 'during';
}

/** The leg covering today, else the next upcoming one, else the last past one. */
function currentLeg(): StoredLeg | null {
  const sorted = sortedLegs();
  if (!sorted.length) return null;
  const today = todayIso();
  const here = sorted.find((l) => l.dateFrom <= today && l.dateTo >= today);
  return here ?? sorted.find((l) => l.dateFrom >= today) ?? sorted[sorted.length - 1];
}

function legStatus(leg: StoredLeg): Phase {
  const today = todayIso();
  if (leg.dateTo < today) return 'after';
  if (leg.dateFrom > today) return 'before';
  return 'during';
}

/* ── Money helpers ───────────────────────────────────────────────────────── */
function inBase(e: StoredExpense): number {
  const target = baseCurrency();
  if (e.baseCurrency === target) return e.baseAmount;
  const cross = _rates[e.baseCurrency];
  return cross ? e.baseAmount * cross : e.baseAmount;
}
function fmt(n: number): string {
  return `${currencySymbol(baseCurrency())}${Math.round(n).toLocaleString()}`;
}

/* ── Greeting ────────────────────────────────────────────────────────────── */
function greetingWord(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/* ── Hero ────────────────────────────────────────────────────────────────── */
function renderHero(phase: Phase): string {
  const trip = currentTrip();
  const name = trip?.name || 'Your trip';
  const leg = currentLeg();
  const legs = sortedLegs();

  let anchor = '';
  if (phase === 'before') {
    const d = leg ? daysUntil(leg.dateFrom) : (trip ? daysUntil(trip.startDate) : null);
    const dest = leg ? `${esc(leg.flag)} ${esc(leg.city)}` : '';
    anchor = d != null
      ? `<strong>${d}</strong> day${d === 1 ? '' : 's'} to go${dest ? ` · next stop ${dest}` : ''}`
      : 'Start planning your trip';
  } else if (phase === 'during' && leg) {
    const idx = legs.findIndex((l) => l.id === leg.id) + 1;
    const dayN = daysBetween(leg.dateFrom, todayIso()) + 1;
    const totalDays = daysBetween(leg.dateFrom, leg.dateTo) + 1;
    anchor = `${esc(leg.flag)} ${esc(leg.city)} · stop ${idx} of ${legs.length} · day ${dayN} of ${totalDays}`;
  } else {
    const countries = new Set(legs.map((l) => l.country)).size;
    const len = trip ? daysBetween(trip.startDate, trip.endDate) + 1 : null;
    anchor = `Trip complete${len ? ` · ${len} days` : ''}${countries ? ` · ${countries} countr${countries === 1 ? 'y' : 'ies'}` : ''}`;
  }

  const steps: Array<[Phase, string]> = [['before', 'Before'], ['during', 'On the road'], ['after', 'After']];
  const dots = steps.map(([p, label]) => {
    const cls = p === phase ? 'is-on' : (steps.findIndex(s => s[0] === p) < steps.findIndex(s => s[0] === phase) ? 'is-done' : '');
    return `<span class="today-phase-step ${cls}"><i></i>${label}</span>`;
  }).join('<span class="today-phase-rail"></span>');

  return `
    <div class="today-hero">
      <div class="today-hero-main">
        <div class="today-hero-greet">${greetingWord()}, traveller 👋</div>
        <div class="today-hero-trip">${esc(name)}</div>
        <div class="today-hero-anchor">${anchor}</div>
        <div class="today-phase">${dots}</div>
      </div>
      <div class="today-hero-art" data-art="${phase}"></div>
    </div>`;
}

/* ── Card: where you are ─────────────────────────────────────────────────── */
function renderLocationCard(phase: Phase): string {
  const leg = currentLeg();
  if (!leg) {
    return card('loc today-span-2', 'route', `
      <div class="today-c-head"><span class="today-c-emoji">🗺️</span>
        <div><div class="today-c-title">No itinerary yet</div>
        <div class="today-c-sub">Add your destinations to get started</div></div></div>`);
  }

  const status = legStatus(leg);
  const label = phase === 'before'
    ? (status === 'during' ? 'You are here' : `Next stop · in ${daysUntil(leg.dateFrom)}d`)
    : phase === 'during' ? 'Where you are' : 'Last stop';

  const stay = leg.accommodations?.[0] ?? leg.accommodation;
  const stayLine = stay ? `<div class="today-loc-stay">🏨 ${esc(stay.name)}</div>` : '';

  // Today's plan items for this leg, for the "during" inline timeline.
  let timeline = '';
  if (phase === 'during') {
    const dayId = (leg.planDays ?? []).find((d) => d.date === todayIso())?.id ?? null;
    const items = (leg.plans ?? [])
      .filter((p) => dayId ? p.dayId === dayId : false)
      .sort((a, b) => a.order - b.order)
      .slice(0, 4);
    if (items.length) {
      timeline = `<div class="today-loc-timeline">${items.map((p) => `
        <button class="today-tl-row ${p.done ? 'is-done' : ''}" data-toggle-plan="${esc(leg.id)}:${esc(p.id)}">
          <span class="today-tl-check">${p.done ? '✓' : ''}</span>
          <span class="today-tl-text">${esc(p.title)}</span>
        </button>`).join('')}</div>`;
    }
  }

  return card(`loc today-span-2`, 'route', `
    <div class="today-c-head">
      <span class="today-loc-flag">${esc(leg.flag) || '📍'}</span>
      <div>
        <div class="today-loc-status today-loc-status-${status}">${label}</div>
        <div class="today-c-title">${esc(leg.city)}</div>
        <div class="today-c-sub">${esc(leg.country)} · ${esc(leg.dateFrom)} – ${esc(leg.dateTo)}</div>
      </div>
    </div>
    ${stayLine}
    ${timeline}`, { legId: leg.id });
}

/* ── Card: spend ─────────────────────────────────────────────────────────── */
function renderSpendCard(): string {
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
      <div class="today-bar-track"><div class="today-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="today-bar-foot">
        <span class="${over ? 'today-money-over' : 'today-money-remain'}">${over ? `${fmt(total - budget)} over` : `${fmt(budget - total)} left`}</span>
        <span class="today-money-pct">${pct}% of ${fmt(budget)}</span>
      </div>`;
  } else {
    bar = `<div class="today-bar-foot"><span class="today-money-hint">Tap “+ Log” to start tracking</span></div>`;
  }

  const sym = currencySymbol(baseCurrency());
  const form = _quickAddOpen ? `
    <form class="today-quickadd" data-quickadd>
      <span class="today-quickadd-sym">${sym}</span>
      <input class="today-quickadd-amt" type="number" inputmode="decimal" step="0.01" placeholder="0" required>
      <input class="today-quickadd-desc" type="text" placeholder="What for?">
      <button class="today-quickadd-save" type="submit">Save</button>
    </form>` : '';

  return `
    <div class="today-card today-c-spend">
      <button class="today-card-tap" data-nav="expenses" aria-label="Open expenses">
        <div class="today-c-row">
          <div><div class="today-c-label">Spent so far</div><div class="today-c-big">${fmt(total)}</div></div>
          <div class="today-c-aside"><div class="today-c-label">Today</div><div class="today-c-mid">${fmt(todaySpend)}</div></div>
        </div>
        ${bar}
      </button>
      <button class="today-quickadd-toggle ${_quickAddOpen ? 'is-open' : ''}" data-quickadd-toggle>
        ${_quickAddOpen ? 'Cancel' : '+ Log a spend'}
      </button>
      ${form}
    </div>`;
}

/* ── Card: checklist / prep progress ─────────────────────────────────────── */
function checklistTotals() {
  let done = 0, total = 0;
  for (const cl of _checklists) for (const g of cl.groups) {
    done += g.items.filter((i) => i.done).length;
    total += g.items.length;
  }
  return { done, total, remaining: total - done, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** The next unchecked item across all checklists, with its address for toggling. */
function nextChecklistItem(): { clId: string; groupId: string; item: ChecklistItem } | null {
  for (const cl of _checklists) for (const g of cl.groups) {
    const item = g.items.find((i) => !i.done);
    if (item) return { clId: cl.id, groupId: g.id, item };
  }
  return null;
}

function renderChecklistCard(): string {
  const { total, remaining, pct } = checklistTotals();
  const sub = total === 0 ? 'No checklist items yet'
    : remaining === 0 ? 'All done — you’re ready 🎉'
    : `${remaining} item${remaining === 1 ? '' : 's'} left`;

  const next = nextChecklistItem();
  const nextRow = next ? `
    <button class="today-tl-row" data-toggle-check="${esc(next.clId)}:${esc(next.groupId)}:${esc(next.item.id)}">
      <span class="today-tl-check"></span>
      <span class="today-tl-text">${esc(next.item.text)}</span>
    </button>` : '';

  return `
    <div class="today-card today-c-check">
      <button class="today-card-tap" data-nav="prep" aria-label="Open checklist">
        <div class="today-c-head">
          <div class="today-ring" style="--pct:${pct}"><span>${pct}%</span></div>
          <div><div class="today-c-title">Prep checklist</div><div class="today-c-sub">${sub}</div></div>
        </div>
      </button>
      ${nextRow}
    </div>`;
}

/* ── Card: decisions pending (compare) ───────────────────────────────────── */
function renderCompareCard(): string {
  const pending = _compare.filter((g) => g.candidates.length >= 2);
  if (!pending.length) {
    return card('mini', 'budget', `
      <div class="today-c-head"><span class="today-c-emoji">⚖️</span>
        <div><div class="today-c-title">Compare</div><div class="today-c-sub">Weigh flights, stays & more</div></div></div>`);
  }
  const names = pending.slice(0, 3).map((g) => g.title || g.compareType).join(', ');
  return card('mini', 'budget', `
    <div class="today-c-head"><span class="today-c-emoji">⚖️</span>
      <div><div class="today-c-title">${pending.length} decision${pending.length === 1 ? '' : 's'} pending</div>
      <div class="today-c-sub">${esc(names)}</div></div></div>`);
}

/* ── Card: nomad nearby ──────────────────────────────────────────────────── */
function renderNomadCard(): string {
  const leg = currentLeg();
  const here = leg ? _nomad.filter((s) => slugId(s.city) === slugId(leg.city)) : [];
  const score = (s: StoredNomadSpot) => {
    const r = s.ratings; return (r.wifi + r.power + r.restroom + r.coffee + r.service) / 5;
  };
  const top = here.sort((a, b) => score(b) - score(a))[0];
  if (!top) {
    return card('mini', 'nomad', `
      <div class="today-c-head"><span class="today-c-emoji">☕</span>
        <div><div class="today-c-title">Work spots</div><div class="today-c-sub">Find a café to get online</div></div></div>`);
  }
  return card('mini', 'nomad', `
    <div class="today-c-head"><span class="today-c-emoji">☕</span>
      <div><div class="today-c-title">${esc(top.name)}</div>
      <div class="today-c-sub">${esc(top.type)} · ★ ${score(top).toFixed(1)} · ${esc(top.city)}</div></div></div>`);
}

/* ── Card: guide picks ───────────────────────────────────────────────────── */
function renderGuideCard(): string {
  const leg = currentLeg();
  const cityName = leg?.city || 'your destination';
  return card('mini', 'cities', `
    <div class="today-c-head"><span class="today-c-emoji">🧭</span>
      <div><div class="today-c-title">Guide · ${esc(cityName)}</div>
      <div class="today-c-sub">Things to do, eat & know</div></div></div>`);
}

/* ── Card: journal nudge ─────────────────────────────────────────────────── */
function renderJournalCard(phase: Phase): string {
  const title = phase === 'after' ? 'Make your trip recap' : 'Capture today';
  const sub = phase === 'after' ? 'Turn your entries into a story' : 'Jot a moment before it fades';
  return card('mini', 'journal', `
    <div class="today-c-head"><span class="today-c-emoji">📔</span>
      <div><div class="today-c-title">${title}</div><div class="today-c-sub">${sub}</div></div></div>`);
}

/* ── Card: safety / SOS ──────────────────────────────────────────────────── */
function renderSafetyCard(phase: Phase): string {
  const leg = currentLeg();
  const csafety = leg ? _cards.find((c) => c.id === slugId(leg.city)) : null;
  const general = csafety?.generalEmergency || '112';
  const cityName = leg?.city || 'your destination';

  // Before departure it's a slim reminder; on the road it's a prominent SOS.
  if (phase === 'before') {
    return `
      <div class="today-card today-c-safety-slim">
        <button class="today-card-tap" data-nav="safety">
          <div class="today-c-head"><span class="today-c-emoji">🛡️</span>
            <div><div class="today-c-title">Safety setup</div><div class="today-c-sub">Fill your profile & emergency info</div></div>
          </div>
        </button>
      </div>`;
  }

  return `
    <div class="today-card today-c-safety today-span-2">
      <div class="today-c-label">Emergency · ${esc(cityName)}</div>
      <a class="today-sos-dial" href="tel:${general.replace(/[^+0-9]/g, '')}">
        <span class="today-sos-icon">☎</span><span class="today-sos-num">${esc(general)}</span>
      </a>
      <button class="today-sos-more" data-nav="safety">Safety details ›</button>
    </div>`;
}

/* ── Small card factory ──────────────────────────────────────────────────── */
function card(extraClass: string, nav: ViewId, inner: string, intent?: NavIntent): string {
  const intentAttr = intent ? ` data-intent='${esc(JSON.stringify(intent))}'` : '';
  return `<button class="today-card today-c-${extraClass}" data-nav="${nav}"${intentAttr}>${inner}</button>`;
}

/* ── Layout: which cards, in which order, per phase ──────────────────────── */
function layout(phase: Phase): string {
  if (phase === 'before') {
    return [
      renderLocationCard(phase),
      renderChecklistCard(),
      renderCompareCard(),
      renderGuideCard(),
      renderSpendCard(),
      renderSafetyCard(phase),
    ].join('');
  }
  if (phase === 'during') {
    return [
      renderLocationCard(phase),
      renderSpendCard(),
      renderGuideCard(),
      renderNomadCard(),
      renderJournalCard(phase),
      renderSafetyCard(phase),
    ].join('');
  }
  // after
  return [
    renderJournalCard(phase),
    renderSpendCard(),
    renderLocationCard(phase),
    renderGuideCard(),
    renderSafetyCard(phase),
  ].join('');
}

/* ── Inline actions ──────────────────────────────────────────────────────── */
function togglePlan(legId: string, planId: string): void {
  const leg = _legs.find((l) => l.id === legId);
  if (!leg) return;
  const plans = (leg.plans ?? []).map((p: PlanItem) => p.id === planId ? { ...p, done: !p.done } : p);
  void routeStore.update(legId, { plans });
}

function quickAddSpend(amount: number, desc: string): void {
  const base = baseCurrency();
  const leg = currentLeg();
  void expenseStore.add({
    amount, currency: base, rate: 1, baseAmount: amount, baseCurrency: base,
    description: desc || 'Quick add', category: '', tags: [],
    city: leg?.city ?? '', country: leg?.country ?? '', date: todayIso(),
  });
}

/* ── Orchestration ───────────────────────────────────────────────────────── */
function render(): void {
  const body = document.querySelector<HTMLElement>('#view-today .today-body');
  if (!body) return;

  const phase = tripPhase();
  body.innerHTML = `${renderHero(phase)}<div class="today-grid">${layout(phase)}</div>`;
  wire(body);
}

function wire(body: HTMLElement): void {
  // Navigation (cards + slim taps), with optional deep-link intent.
  body.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      // Don't hijack the tel: link, inline action rows, or the quick-add form.
      if (t.closest('a, [data-toggle-plan], [data-toggle-check], [data-quickadd], [data-quickadd-toggle]')) return;
      const intentRaw = el.dataset.intent;
      let intent: NavIntent | undefined;
      if (intentRaw) { try { intent = JSON.parse(intentRaw); } catch { /* ignore */ } }
      navigateTo(el.dataset.nav as ViewId, intent);
    });
  });

  // Inline plan toggle.
  body.querySelectorAll<HTMLElement>('[data-toggle-plan]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const [legId, planId] = el.dataset.togglePlan!.split(':');
      togglePlan(legId, planId);
    });
  });

  // Inline checklist toggle.
  body.querySelectorAll<HTMLElement>('[data-toggle-check]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const [clId, groupId, itemId] = el.dataset.toggleCheck!.split(':');
      void checklistStore.toggleItem(clId, groupId, itemId);
    });
  });

  // Quick-add expense: toggle + submit.
  body.querySelector<HTMLElement>('[data-quickadd-toggle]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _quickAddOpen = !_quickAddOpen;
    render();
    if (_quickAddOpen) body.querySelector<HTMLInputElement>('.today-quickadd-amt')?.focus();
  });
  body.querySelector<HTMLFormElement>('[data-quickadd]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const amount = parseFloat(form.querySelector<HTMLInputElement>('.today-quickadd-amt')!.value);
    const desc = form.querySelector<HTMLInputElement>('.today-quickadd-desc')!.value.trim();
    if (!Number.isFinite(amount) || amount <= 0) return;
    quickAddSpend(amount, desc);
    _quickAddOpen = false;
    render();
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
  _nomad = nomadStore.peek();
  _compare = compareStore.peek();
  _quickAddOpen = false;
  render();

  _unsubs.forEach((u) => u());
  _unsubs = [
    routeStore.subscribe((rows) => { _legs = rows; render(); }),
    expenseStore.subscribe((rows) => { _expenses = rows; render(); }),
    checklistStore.subscribe((rows) => { _checklists = rows; render(); }),
    safetyStore.subscribe((rows) => { _cards = rows; render(); }),
    nomadStore.subscribeForTrip(currentTripId(), (rows) => { _nomad = rows; render(); }),
    compareStore.subscribe((rows) => { _compare = rows; render(); }),
    onTripChange(() => render()),
  ];

  void getRateTable(baseCurrency()).then((table) => { _rates = table; render(); });
}
