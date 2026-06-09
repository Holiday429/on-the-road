/* ==========================================================================
   On the Road · Today — personal dashboard
   --------------------------------------------------------------------------
   The app's home screen: a flexible bento grid of widgets.
   Every widget subscribes to an existing store; this view owns no data itself.
   ========================================================================== */

import './today.css';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import { checklistStore } from '../../data/stores/checklist-store.ts';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { todoStore, type StoredTodo } from '../../data/stores/todo-store.ts';
import { currentTrip, baseCurrency, tripBudget, onTripChange } from '../../data/trip-context.ts';
import { currencySymbol, getRateTable, peekRateTable, type RateTable, CURRENCIES } from '../../data/rates.ts';
import { navigateTo, type ViewId, type NavIntent, openNewTrip } from '../../core/app.ts';
import { currentUser } from '../../firebase/auth.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { openModal } from '../../core/modal.ts';
import type { PlanItem } from '../../data/schema.ts';
import { initDashboardMap, disposeDashboardMap, dashboardMapZoom } from './dashboard-map.ts';

/* ── State ───────────────────────────────────────────────────────────────── */
let _legs: StoredLeg[] = [];
let _expenses: StoredExpense[] = [];
let _checklists: ReturnType<typeof checklistStore.peek> = [];
let _journal: StoredJournalEntry[] = [];
let _todos:   StoredTodo[]         = [];
let _rates: RateTable = {};
let _rateInput = '';          // currency converter amount
let _rateFrom  = '';          // selected "from" currency (empty = baseCurrency())
let _rateTo    = '';          // selected "to" currency (empty = auto localCurrency())
let _mapBooted = false;       // init dashboard map only once per view mount
let _unsubs: Array<() => void> = [];

/* ── Helpers ─────────────────────────────────────────────────────────────── */
type Phase = 'before' | 'during' | 'after';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
}
function sortedLegs(): StoredLeg[] {
  return [..._legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
}
function tripPhase(): Phase {
  const trip = currentTrip();
  const today = todayIso();
  const legs = sortedLegs();
  const start = trip?.startDate ?? legs[0]?.dateFrom;
  const end   = trip?.endDate   ?? legs[legs.length - 1]?.dateTo;
  if (!start) return 'before';
  if (today < start) return 'before';
  if (end && today > end) return 'after';
  return 'during';
}
function currentLeg(): StoredLeg | null {
  const sorted = sortedLegs();
  if (!sorted.length) return null;
  const today = todayIso();
  return sorted.find(l => l.dateFrom <= today && l.dateTo >= today)
    ?? sorted.find(l => l.dateFrom >= today)
    ?? sorted[sorted.length - 1];
}
function inBase(e: StoredExpense): number {
  const target = baseCurrency();
  if (e.baseCurrency === target) return e.baseAmount;
  const cross = _rates[e.baseCurrency];
  return cross ? e.baseAmount * cross : e.baseAmount;
}
function fmt(n: number, decimals = 0): string {
  return `${currencySymbol(baseCurrency())}${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
function firstName(): string {
  const user = currentUser();
  if (!user) return 'Traveller';
  const name = user.displayName?.trim() || user.email?.split('@')[0] || 'Traveller';
  return name.split(/\s+/)[0];
}
function greetingWord(): string {
  const h = new Date().getHours();
  if (h < 5)  return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/* ── Currency pair for rate widget ───────────────────────────────────────── */
const COUNTRY_CURRENCY: Array<[string, string]> = [
  ['Denmark',     'DKK'], ['Sweden',     'SEK'], ['Norway',     'NOK'],
  ['Switzerland', 'CHF'], ['UK',         'GBP'], ['Britain',    'GBP'],
  ['Japan',       'JPY'], ['China',      'CNY'], ['US',         'USD'],
  ['Czech',       'CZK'],
];
function localCurrency(): string {
  const leg = currentLeg();
  if (!leg) return 'USD';
  const match = COUNTRY_CURRENCY.find(([k]) => leg.country.includes(k));
  return match ? match[1] : (baseCurrency() === 'EUR' ? 'DKK' : 'EUR');
}
function tripCurrencies(): string[] {
  const base = baseCurrency();
  // Always show CNY (user's home currency) + base + trip-leg currencies, deduped
  const seen = new Set<string>(['CNY', base]);
  for (const leg of _legs) {
    const match = COUNTRY_CURRENCY.find(([k]) => leg.country.includes(k));
    if (match) seen.add(match[1]);
  }
  // Max 4 currencies to avoid overflow
  return Array.from(seen).slice(0, 4);
}

/* ══════════════════════════════════════════════════════════════════════════
   WIDGET RENDERERS
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Greeting headline (above hero) ──────────────────────────────────────── */
function renderGreeting(): string {
  return `
    <div class="td-greeting-row">
      <div class="td-greeting">${greetingWord()}, ${esc(firstName())}! 👋</div>
      <button class="btn btn-ghost td-new-trip-btn" data-action="new-trip">+ New trip</button>
    </div>`;
}

/* ── Hero banner ─────────────────────────────────────────────────────────── */
function renderHero(phase: Phase): string {
  const trip = currentTrip();
  const name = trip?.name ?? 'Your trip';
  const legs = sortedLegs();
  const leg  = currentLeg();
  const ART  = `${(import.meta as any).env.BASE_URL}art/`.replace(/\/{2,}/g, '/');

  const TICON: Record<string, string> = { flight: '✈️', train: '🚂', bus: '🚌', ferry: '⛴️' };

  let anchor = '';
  let details = '';

  if (phase === 'before' && leg) {
    const d = daysBetween(todayIso(), leg.dateFrom);
    anchor = `<strong>${d}</strong> day${d === 1 ? '' : 's'} to go · next stop ${esc(leg.flag)} ${esc(leg.city)}`;
  } else if (phase === 'during' && leg) {
    const idx  = legs.findIndex(l => l.id === leg.id) + 1;
    const dayN = daysBetween(leg.dateFrom, todayIso()) + 1;
    const tot  = daysBetween(leg.dateFrom, leg.dateTo) + 1;
    anchor = `${esc(leg.flag)} ${esc(leg.city)} · stop ${idx}/${legs.length} · day ${dayN} of ${tot}`;
    // Transport + accommodation info chips
    const chips: string[] = [];
    const t = leg.arrivalTransport;
    if (t) {
      const icon = TICON[t.type] ?? '🚀';
      const time = t.time ? ` ${t.time}` : '';
      chips.push(`<span class="td-hero-chip td-hero-chip-transport">${icon} ${esc(t.from)} → ${esc(t.to)}${esc(time)}</span>`);
    }
    const accs = leg.accommodations?.length ? leg.accommodations : leg.accommodation ? [leg.accommodation] : [];
    if (accs[0]) {
      chips.push(`<span class="td-hero-chip td-hero-chip-acc">🏠 ${esc(accs[0].name)}</span>`);
    }
    if (chips.length) details = `<div class="td-hero-chips">${chips.join('')}</div>`;
  } else if (phase === 'after') {
    const countries = new Set(legs.map(l => l.country)).size;
    const len = trip ? daysBetween(trip.startDate, trip.endDate) + 1 : null;
    anchor = `Trip complete${len ? ` · ${len} days` : ''}${countries ? ` · ${countries} countr${countries === 1 ? 'y' : 'ies'}` : ''}`;
  }

  return `
    <div class="td-hero" data-phase="${phase}">
      <div class="td-hero-left">
        <div class="td-hero-name">${esc(name)}</div>
        ${anchor ? `<div class="td-hero-anchor">${anchor}</div>` : ''}
        ${details}
      </div>
      <img class="td-hero-logo" src="${ART}logo.gif" alt="On the Road">
    </div>`;
}

/* ── Currency widget ──────────────────────────────────────────────────────── */
function currencyOptions(selected: string): string {
  return CURRENCIES.map(c =>
    `<option value="${esc(c.code)}" ${c.code === selected ? 'selected' : ''}>${c.flag} ${c.code}</option>`
  ).join('');
}

function renderCurrencyWidget(): string {
  const base   = baseCurrency();
  const fromCur = _rateFrom || base;
  const toCur   = _rateTo   || localCurrency();

  // Converter: from → to
  const rateToBase   = fromCur === base ? 1 : (_rates[fromCur] ? (1 / _rates[fromCur]) : null);
  const rateFromBase = toCur === base ? 1 : (_rates[toCur] ? (1 / _rates[toCur]) : null);
  const crossRate = (rateToBase != null && rateFromBase != null) ? rateFromBase / rateToBase : null;
  // For rates table: 1 base = ? currency (rates[c] = how many base per 1 unit of c, so 1/rates[c])
  function rateDisplay(code: string): string {
    if (code === base) return '1.0000';
    const r = _rates[code];
    return r ? (1 / r).toFixed(4) : '—';
  }

  const inputAmt = _rateInput !== '' ? parseFloat(_rateInput) : null;
  const converted = (inputAmt != null && crossRate != null) ? (inputAmt * crossRate).toFixed(2) : '';

  const fromFlag = CURRENCIES.find(c => c.code === fromCur)?.flag ?? '';
  const toFlag   = CURRENCIES.find(c => c.code === toCur)?.flag ?? '';

  // 3 rate info rows: base + 2 trip currencies (excluding base)
  const tripCurs = tripCurrencies().filter(c => c !== base).slice(0, 2);
  const baseFlag = CURRENCIES.find(c => c.code === base)?.flag ?? '';
  const rateRows = [base, ...tripCurs].map(code => {
    const flag = CURRENCIES.find(c => c.code === code)?.flag ?? '';
    void tripCurs.find(c => c === code);
    if (code === base) {
      // Show base vs first trip currency
      const peer = tripCurs[0];
      if (!peer) return '';
      const pFlag = CURRENCIES.find(c => c.code === peer)?.flag ?? '';
      return `<div class="td-cur-rate-row"><span>${baseFlag} ${esc(base)}</span><span class="td-cur-rate-eq">=</span><span><strong>${rateDisplay(peer)}</strong> ${pFlag} ${esc(peer)}</span></div>`;
    }
    // Each trip currency vs base
    return `<div class="td-cur-rate-row"><span>${baseFlag} ${esc(base)}</span><span class="td-cur-rate-eq">=</span><span><strong>${rateDisplay(code)}</strong> ${flag} ${esc(code)}</span></div>`;
  }).filter(Boolean);

  // Build 3 unique rows: base→tripCur1, base→tripCur2, base→localCurrency (if different)
  const allTrip = tripCurrencies();
  const rateRowCodes = allTrip.filter(c => c !== base).slice(0, 3);
  const rateRowsHtml = rateRowCodes.map(code => {
    const flag = CURRENCIES.find(c => c.code === code)?.flag ?? '';
    return `<div class="td-cur-rate-row"><span>${baseFlag} ${esc(base)}</span><span class="td-cur-rate-eq">=</span><span><strong>${rateDisplay(code)}</strong> ${flag} ${esc(code)}</span></div>`;
  }).join('');

  void rateRows;

  return `
    <div class="td-widget td-w-currency">
      <div class="td-widget-label">💱 Currency</div>
      <div class="td-cur-converter">
        <div class="td-cur-conv-row">
          <div class="td-cur-conv-side">
            <input class="td-currency-input" data-rate-input type="number" inputmode="decimal" placeholder="1" value="${esc(_rateInput)}">
            <select class="td-cur-select" data-rate-from>${currencyOptions(fromCur)}</select>
          </div>
          <button class="td-currency-swap" data-rate-swap title="Swap">⇄</button>
          <div class="td-cur-conv-side td-cur-conv-result">
            <span class="td-currency-value">${esc(converted || (crossRate != null ? crossRate.toFixed(4) : '—'))}</span>
            <select class="td-cur-select" data-rate-to>${currencyOptions(toCur)}</select>
          </div>
        </div>
        <div class="td-cur-conv-hint">${fromFlag} 1 ${esc(fromCur)} = ${esc(crossRate != null ? crossRate.toFixed(4) : '—')} ${toFlag} ${esc(toCur)}</div>
      </div>
      <div class="td-cur-rates">${rateRowsHtml}</div>
    </div>`;
}

/* ── Calendar mini widget ─────────────────────────────────────────────────── */
function renderCalendarWidget(): string {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const today = todayIso();

  // Build event map: date → colours (leg=amber, journal=sky, todo=future)
  const events: Record<string, string[]> = {};
  const addDot = (date: string, color: string) => {
    if (!events[date]) events[date] = [];
    if (!events[date].includes(color)) events[date].push(color);
  };
  // Leg date ranges
  for (const leg of _legs) {
    let d = new Date(leg.dateFrom + 'T00:00:00');
    const end = new Date(leg.dateTo + 'T00:00:00');
    while (d <= end) {
      addDot(d.toISOString().slice(0, 10), 'var(--amber-400)');
      d.setDate(d.getDate() + 1);
    }
  }
  // Journal entries
  for (const e of _journal) addDot(e.happenedOn, 'var(--sky-400)');
  // Todos with due date
  for (const t of _todos) if (t.dueDate) addDot(t.dueDate, t.done ? 'var(--surface-4)' : '#f87171');

  // Calendar grid
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7; // Mon-first
  const monthName = now.toLocaleString('en', { month: 'long' });
  const dayHeaders = ['M','T','W','T','F','S','S'].map(d => `<span class="td-cal-hdr">${d}</span>`).join('');

  let cells = '';
  for (let i = 0; i < startOffset; i++) cells += `<span class="td-cal-cell td-cal-empty"></span>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = iso === today;
    const dots = (events[iso] ?? []).map(c => `<span class="td-cal-dot" style="background:${c}"></span>`).join('');
    cells += `<span class="td-cal-cell ${isToday ? 'is-today' : ''}">${d}${dots ? `<span class="td-cal-dots">${dots}</span>` : ''}</span>`;
  }

  return `
    <div class="td-widget td-w-calendar" data-nav="calendar">
      <div class="td-widget-label">🗓️ ${monthName} ${year}</div>
      <div class="td-cal-grid">${dayHeaders}${cells}</div>
      <div class="td-cal-legend">
        <span><span class="td-cal-dot" style="background:var(--amber-400)"></span>Itinerary</span>
        <span><span class="td-cal-dot" style="background:var(--sky-400)"></span>Journal</span>
        <span><span class="td-cal-dot" style="background:#f87171"></span>To-do</span>
      </div>
    </div>`;
}

/* ── Spend widget ─────────────────────────────────────────────────────────── */
function renderSpendWidget(): string {
  const base      = baseCurrency();
  const sym       = currencySymbol(base);
  const total     = _expenses.reduce((s, e) => s + inBase(e), 0);
  const todaySpend = _expenses.filter(e => e.date === todayIso()).reduce((s, e) => s + inBase(e), 0);
  const budget    = tripBudget();
  const today     = todayIso();

  // 30-day bar chart: last 30 days bucketed by date.
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  const dailyMap: Record<string, number> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo);
    d.setDate(d.getDate() + i);
    dailyMap[d.toISOString().slice(0, 10)] = 0;
  }
  for (const e of _expenses) {
    if (dailyMap[e.date] !== undefined) dailyMap[e.date] += inBase(e);
  }
  const daily = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b));
  const maxDay = Math.max(...daily.map(([, v]) => v), 1);

  const bars = daily.map(([date, amt]) => {
    const h = Math.max(4, Math.round((amt / maxDay) * 52));
    const isToday = date === today;
    return `<span class="td-bar ${isToday ? 'is-today' : ''}" style="height:${h}px" title="${sym}${Math.round(amt)}"></span>`;
  }).join('');

  let budgetLine = '';
  if (budget) {
    const pct  = Math.min(100, Math.round((total / budget) * 100));
    const over = total > budget;
    const color = pct >= 100 ? 'var(--coral-500)' : pct >= 80 ? '#f59e0b' : 'var(--sage-500)';
    budgetLine = `
      <div class="td-spend-bar-track"><div class="td-spend-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="td-spend-bar-foot">
        <span class="${over ? 'td-over' : 'td-remain'}">${over ? `${fmt(total-budget)} over` : `${fmt(budget-total)} left`}</span>
        <span class="td-pct">${pct}% of ${fmt(budget)}</span>
      </div>`;
  }

  const leg = currentLeg();

  return `
    <div class="td-widget td-w-spend">
      <div class="td-widget-header">
        <div class="td-widget-label">💶 Spend</div>
        <button class="td-link" data-nav="expenses">All expenses ›</button>
      </div>
      <div class="td-spend-top">
        <div><div class="td-spend-label">Total</div><div class="td-spend-big">${fmt(total)}</div></div>
        <div class="td-spend-today"><div class="td-spend-label">Today</div><div class="td-spend-mid">${fmt(todaySpend)}</div></div>
      </div>
      ${budgetLine}
      <form class="td-quickadd" data-quickadd>
        <span class="td-quickadd-sym">${sym}</span>
        <input class="td-quickadd-amt" type="number" inputmode="decimal" step="0.01" placeholder="Amount" required>
        <input class="td-quickadd-desc" type="text" placeholder="What for?">
        <button class="td-quickadd-save btn btn-primary" type="submit">Log</button>
      </form>
      <div class="td-barchart" title="Last 30 days">${bars}</div>
      <div class="td-barchart-label">Last 30 days</div>
    </div>`;
  void leg;
}

/* ── Map thumbnail ────────────────────────────────────────────────────────── */
function renderMapWidget(): string {
  return `
    <div class="td-widget td-w-map">
      <div class="td-widget-header">
        <div class="td-widget-label">🗺️ Route map</div>
        <button class="td-link" data-nav="map">Full map ›</button>
      </div>
      <div class="td-map-wrap">
        <div class="td-map-container" id="td-map-canvas"></div>
        <div class="td-map-zoom-controls">
          <button class="td-map-zoom-btn" id="tdMapZoomIn"  title="Zoom in">+</button>
          <button class="td-map-zoom-btn" id="tdMapZoomFit" title="Fit">⊡</button>
          <button class="td-map-zoom-btn" id="tdMapZoomOut" title="Zoom out">−</button>
        </div>
      </div>
      <div class="td-map-legend">
        <span><span class="td-map-dot" style="background:#22c55e"></span>Now</span>
        <span><span class="td-map-dot" style="background:#f9b830"></span>Upcoming</span>
        <span><span class="td-map-dot" style="background:#a8a29e"></span>Past</span>
      </div>
    </div>`;
}

/* ── Upcoming itinerary widget — plan-items feed for current destination ──── */
const PLAN_CATEGORY_ICON: Record<string, string> = {
  restaurant: '🍽️', food: '🍽️',
  attraction: '🎡', sightseeing: '🎡',
  museum: '🏛️',
  activity: '🎯',
  shopping: '🛍️',
  transport: '🚉',
  accommodation: '🏠',
  cafe: '☕', coffee: '☕',
  bar: '🍻', nightlife: '🎶',
  nature: '🌿', park: '🌳',
  event: '🎟️',
};
function planIcon(category: string): string {
  const lc = (category ?? '').toLowerCase();
  return PLAN_CATEGORY_ICON[lc] ?? '📌';
}

function renderUpcomingWidget(): string {
  const today = todayIso();
  const leg   = currentLeg();

  if (!leg) {
    const sorted = sortedLegs();
    const next = sorted.find(l => l.dateFrom >= today);
    if (!next) {
      return `
        <div class="td-widget td-w-upcoming" data-widget-id="upcoming">
          <div class="td-widget-header">
            <div class="td-widget-label">📍 Plans</div>
            <button class="td-link" data-nav="route">Itinerary ›</button>
          </div>
          <div class="td-upcoming-empty">No itinerary yet — add stops in the Route view.</div>
        </div>`;
    }
    // Show next leg's plan items
    return renderPlanFeed(next, false);
  }

  return renderPlanFeed(leg, true);
}

function renderPlanFeed(leg: StoredLeg, isCurrent: boolean): string {
  const today = todayIso();
  const plans = (leg.plans ?? []) as PlanItem[];
  const sorted = [...plans].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const pending = sorted.filter(p => !p.done);
  const done    = sorted.filter(p => p.done);
  const displayed = [...pending, ...done].slice(0, 8);

  const daysLeft = daysBetween(today, leg.dateTo);
  const daysAway = !isCurrent ? daysBetween(today, leg.dateFrom) : null;
  const subtitle = isCurrent
    ? `Day ${daysBetween(leg.dateFrom, today) + 1} · ${daysLeft + 1} day${daysLeft > 0 ? 's' : ''} left`
    : `In ${daysAway} day${daysAway !== 1 ? 's' : ''}`;

  const items = displayed.length
    ? displayed.map(p => {
        const icon = planIcon(p.category ?? '');
        return `
          <div class="td-plan-row ${p.done ? 'is-done' : ''}" data-toggle-plan="${esc(leg.id)}:${esc(p.id)}">
            <span class="td-plan-icon">${icon}</span>
            <span class="td-plan-title">${esc(p.title)}</span>
            <span class="td-plan-check">${p.done ? '✓' : ''}</span>
          </div>`;
      }).join('')
    : `<div class="td-upcoming-empty">No plan items for this stop yet.</div>`;

  return `
    <div class="td-widget td-w-upcoming" data-widget-id="upcoming">
      <div class="td-widget-header">
        <div class="td-widget-label">📍 ${esc(leg.flag)} ${esc(leg.city)}</div>
        <button class="td-link" data-nav="route" data-intent='${esc(JSON.stringify({ legId: leg.id } satisfies NavIntent))}'>Open ›</button>
      </div>
      <div class="td-plan-subtitle">${esc(subtitle)}</div>
      <div class="td-plan-feed">${items}</div>
      ${pending.length > 8 ? `<div class="td-plan-more">+${pending.length - 8} more tasks</div>` : ''}
    </div>`;
}

/* ── Journal quick-entry widget ───────────────────────────────────────────── */
function renderJournalWidget(_phase: Phase): string {
  const ENTRY_TYPES: Array<{ template: string; icon: string; label: string; placeholder: string }> = [
    { template: 'moment',      icon: '✨', label: 'Moment',      placeholder: 'A feeling, a scene, a flash of something real…' },
    { template: 'note',        icon: '📝', label: 'Note',        placeholder: 'Practical info, tips, things to remember…' },
    { template: 'interesting', icon: '💡', label: 'Interesting', placeholder: 'Something that surprised you, made you think…' },
    { template: 'place',       icon: '📍', label: 'Place',       placeholder: 'What is this place beyond its name on a map…' },
  ];

  const buttons = ENTRY_TYPES.map(e => `
    <button class="td-jq-btn" data-journal-template="${esc(e.template)}" data-journal-placeholder="${esc(e.placeholder)}">
      <span class="td-jq-icon">${e.icon}</span>
      <span class="td-jq-label">${e.label}</span>
    </button>`).join('');

  return `
    <div class="td-widget td-w-journal" data-widget-id="journal">
      <div class="td-widget-header">
        <div class="td-widget-label">📔 Journal</div>
        <button class="td-link" data-nav="journal">All entries ›</button>
      </div>
      <div class="td-jq-grid">${buttons}</div>
    </div>`;
}

/* ── To-do widget ─────────────────────────────────────────────────────────── */
function renderTodoWidget(): string {
  const today   = todayIso();
  const pending = _todos
    .filter(t => !t.done)
    .sort((a, b) => {
      // Items with due dates first, sorted by date; no-due-date items last
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return a.order - b.order;
    })
    .slice(0, 5);
  const doneToday = _todos.filter(t => t.done && t.dueDate === today).length;

  const rows = pending.map(t => {
    const overdue = t.dueDate && t.dueDate < today;
    const dueLabel = t.dueDate === today ? 'Today'
      : overdue ? `Overdue · ${t.dueDate}`
      : t.dueDate ? t.dueDate
      : '';
    return `
      <div class="td-todo-row">
        <button class="td-todo-check" data-toggle-todo="${esc(t.id)}:false" title="Mark done"></button>
        <div class="td-todo-text">
          <span class="td-todo-label">${esc(t.text)}</span>
          ${dueLabel ? `<span class="td-todo-due ${overdue ? 'is-overdue' : ''}">${esc(dueLabel)}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  const empty = !pending.length
    ? `<div class="td-todo-empty">No open to-dos${doneToday ? ` · ${doneToday} done today 🎉` : ''}</div>` : '';

  return `
    <div class="td-widget td-w-todo">
      <div class="td-widget-header">
        <div class="td-widget-label">☑️ To-do</div>
        <button class="td-link" data-nav="calendar">All tasks ›</button>
      </div>
      ${rows}${empty}
      <form class="td-todo-add" data-todo-add>
        <input class="td-todo-add-input" type="text" placeholder="+ Quick add task…">
        <button class="btn btn-ghost td-todo-add-btn" type="submit">Add</button>
      </form>
    </div>`;
}

/* ── Prep mini bar ────────────────────────────────────────────────────────── */
function renderPrepMini(): string {
  let done = 0, total = 0;
  for (const cl of _checklists) for (const g of cl.groups) {
    done += g.items.filter(i => i.done).length;
    total += g.items.length;
  }
  const pct = total ? Math.round((done / total) * 100) : 0;
  const remaining = total - done;
  const sub = total === 0 ? 'No checklist yet' : remaining === 0 ? 'All done 🎉' : `${remaining} left`;

  return `
    <div class="td-widget td-w-prep" data-nav="prep">
      <div class="td-widget-label">✅ Prep</div>
      <div class="td-prep-row">
        <div class="td-prep-ring" style="--pct:${pct}"><span>${pct}%</span></div>
        <div><div class="td-prep-title">Checklist</div><div class="td-prep-sub">${sub}</div></div>
      </div>
    </div>`;
}

/* ── Safety mini ──────────────────────────────────────────────────────────── */
function renderSafetyMini(): string {
  const leg = currentLeg();
  return `
    <div class="td-widget td-w-safety" data-nav="safety">
      <div class="td-widget-label">🛡️ Safety</div>
      <div class="td-safety-city">${leg ? `${esc(leg.flag)} ${esc(leg.city)}` : 'Setup emergency info'}</div>
      <div class="td-safety-hint">Profile & emergency contacts</div>
    </div>`;
}

/* ── Widget order persistence ─────────────────────────────────────────────── */
const LAYOUT_KEY = 'otr:dashboard-layout';
const DEFAULT_ORDER = ['currency', 'calendar', 'todo', 'leftcol', 'map', 'upcoming', 'journal'];
function savedOrder(): string[] {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed) && parsed.length === DEFAULT_ORDER.length) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_ORDER;
}

/* ── Layout ───────────────────────────────────────────────────────────────── */
function layout(phase: Phase): string {
  // Row 1: currency | calendar | todo  (3 equal cols)
  // Row 2: [spend / prep / safety stacked left] + [map tall right]
  // Row 3: upcoming (left) | journal quick-entry (right)
  const calWidget = renderCalendarWidget();
  const todoWidget = renderTodoWidget();
  const currWidget = renderCurrencyWidget();
  const leftCol = `
    <div class="td-left-col td-draggable" data-widget-id="leftcol" draggable="true">
      ${renderSpendWidget()}
      <div class="td-mini-row">
        ${renderPrepMini()}
        ${renderSafetyMini()}
      </div>
    </div>`;
  const mapWidget = renderMapWidget();
  const upWidget  = renderUpcomingWidget();
  const jrnWidget = renderJournalWidget(phase);

  // Inject data-widget-id and draggable on widget divs
  function tag(html: string, id: string): string {
    return html.replace(/^(\s*<div class="td-widget)/, `$1 td-draggable" data-widget-id="${id}" draggable="true`);
  }

  const widgetMap: Record<string, string> = {
    currency: tag(currWidget, 'currency'),
    calendar: tag(calWidget,  'calendar'),
    todo:     tag(todoWidget, 'todo'),
    leftcol:  leftCol,
    map:      tag(mapWidget,  'map'),
    upcoming: tag(upWidget,   'upcoming'),
    journal:  tag(jrnWidget,  'journal'),
  };

  const order = savedOrder();
  const widgets = order.map(id => widgetMap[id] ?? '').join('\n');

  return `<div class="td-grid" id="td-grid">${widgets}</div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   ACTIONS
   ══════════════════════════════════════════════════════════════════════════ */

function quickAddSpend(amount: number, desc: string): void {
  const base = baseCurrency();
  const leg  = currentLeg();
  void expenseStore.add({
    amount, currency: base, rate: 1, baseAmount: amount, baseCurrency: base,
    description: desc || 'Quick add', category: '', tags: [],
    city: leg?.city ?? '', country: leg?.country ?? '', date: todayIso(),
  });
}

function openJournalComposer(template = 'moment', placeholder = 'What happened today? A thought, a scene, a feeling…'): void {
  const ICON: Record<string, string> = { moment: '✨', note: '📝', interesting: '💡', place: '📍' };
  const icon = ICON[template] ?? '📔';
  const leg = currentLeg();
  const today = todayIso();

  // Destination options from legs
  const legCities = sortedLegs().map(l => `<option value="${esc(l.city)}">${esc(l.flag)} ${esc(l.city)}</option>`).join('');

  const handle = openModal({
    title: `${icon} ${template.charAt(0).toUpperCase() + template.slice(1)}`,
    body: `
      <div class="td-compose-body">
        <textarea class="input td-cmp-text" id="td-cmp-body" placeholder="${esc(placeholder)}" rows="5" autofocus></textarea>
        <input class="input" id="td-cmp-title" placeholder="Title (optional)">
        <div class="td-compose-row">
          <input class="input" id="td-cmp-date" type="date" value="${esc(today)}">
          <select class="input" id="td-cmp-dest">
            <option value="">Destination…</option>
            ${legCities}
            <option value="__custom__">Other…</option>
          </select>
        </div>
        <input class="input" id="td-cmp-tags" placeholder="Tags (comma-separated)">
      </div>`,
    footer: `
      <button class="btn btn-ghost" id="td-cmp-cancel">Cancel</button>
      <button class="btn btn-primary" id="td-cmp-save">Save</button>`,
  });

  // Pre-select current leg city if available
  const destEl = handle.root.querySelector<HTMLSelectElement>('#td-cmp-dest');
  if (destEl && leg) {
    const opt = Array.from(destEl.options).find(o => o.value === leg.city);
    if (opt) destEl.value = leg.city;
  }

  handle.root.querySelector('#td-cmp-cancel')?.addEventListener('click', () => handle.close());
  handle.root.querySelector('#td-cmp-save')?.addEventListener('click', async () => {
    const bodyEl  = handle.root.querySelector<HTMLTextAreaElement>('#td-cmp-body');
    const titleEl = handle.root.querySelector<HTMLInputElement>('#td-cmp-title');
    const dateEl  = handle.root.querySelector<HTMLInputElement>('#td-cmp-date');
    const tagsEl  = handle.root.querySelector<HTMLInputElement>('#td-cmp-tags');
    const body    = bodyEl?.value.trim() ?? '';
    if (!body) { bodyEl?.focus(); return; }
    const tags = tagsEl?.value.split(',').map(t => t.trim()).filter(Boolean) ?? [];
    let destination = destEl?.value ?? '';
    if (destination === '__custom__') destination = '';
    await journalStore.save({
      title:       titleEl?.value.trim() ?? '',
      body, template,
      destination,
      tags,
      happenedOn: dateEl?.value || today,
    });
    handle.close();
    render();
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   RENDER + WIRE
   ══════════════════════════════════════════════════════════════════════════ */

function crossRate(): number | null {
  const base    = baseCurrency();
  const fromCur = _rateFrom || base;
  const toCur   = _rateTo   || localCurrency();
  const rateToBase   = fromCur === base ? 1 : (_rates[fromCur] ? (1 / _rates[fromCur]) : null);
  const rateFromBase = toCur === base ? 1 : (_rates[toCur] ? (1 / _rates[toCur]) : null);
  return (rateToBase != null && rateFromBase != null) ? rateFromBase / rateToBase : null;
}

function updateConverterResult(body: HTMLElement): void {
  const rate = crossRate();
  const amt  = parseFloat(_rateInput);
  const result = (rate != null && Number.isFinite(amt) && amt > 0)
    ? (amt * rate).toFixed(2)
    : (rate != null ? rate.toFixed(4) : '—');
  const span = body.querySelector<HTMLElement>('.td-currency-value');
  if (span) span.textContent = result;
}

function render(): void {
  const body = document.querySelector<HTMLElement>('#view-today .today-body');
  if (!body) return;
  const phase = tripPhase();
  body.innerHTML = `${renderGreeting()}${renderHero(phase)}${layout(phase)}`;
  wire(body);
  bootMap();
}

function wire(body: HTMLElement): void {
  // Navigation clicks (widget tap-through).
  body.querySelectorAll<HTMLElement>('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('a, button:not([data-nav]), [data-quickadd], [data-rate-input]')) return;
      const intent = el.dataset.intent ? (JSON.parse(el.dataset.intent) as NavIntent) : undefined;
      navigateTo(el.dataset.nav as ViewId, intent);
    });
  });

  // Quick-add spend form.
  body.querySelector<HTMLFormElement>('[data-quickadd]')?.addEventListener('submit', e => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const amt  = parseFloat((form.querySelector('.td-quickadd-amt') as HTMLInputElement).value);
    const desc = (form.querySelector('.td-quickadd-desc') as HTMLInputElement).value.trim();
    if (!Number.isFinite(amt) || amt <= 0) return;
    quickAddSpend(amt, desc);
    (form.querySelector('.td-quickadd-amt') as HTMLInputElement).value  = '';
    (form.querySelector('.td-quickadd-desc') as HTMLInputElement).value = '';
  });

  // Currency converter — amount input.
  body.querySelector<HTMLInputElement>('[data-rate-input]')?.addEventListener('input', e => {
    _rateInput = (e.target as HTMLInputElement).value;
    updateConverterResult(body);
  });

  // Currency from/to selects.
  body.querySelector<HTMLSelectElement>('[data-rate-from]')?.addEventListener('change', e => {
    _rateFrom = (e.target as HTMLSelectElement).value;
    updateConverterResult(body);
  });
  body.querySelector<HTMLSelectElement>('[data-rate-to]')?.addEventListener('change', e => {
    _rateTo = (e.target as HTMLSelectElement).value;
    updateConverterResult(body);
  });
  // Swap button.
  body.querySelector<HTMLButtonElement>('[data-rate-swap]')?.addEventListener('click', () => {
    const tmp = _rateFrom || baseCurrency();
    _rateFrom = _rateTo   || localCurrency();
    _rateTo   = tmp;
    render();
  });

  // Plan item inline toggle (during phase, location card).
  body.querySelectorAll<HTMLElement>('[data-toggle-plan]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const [legId, planId] = el.dataset.togglePlan!.split(':');
      const leg = _legs.find(l => l.id === legId);
      if (!leg) return;
      const plans = (leg.plans ?? []).map((p: PlanItem) => p.id === planId ? { ...p, done: !p.done } : p);
      void routeStore.update(legId, { plans });
    });
  });

  // Journal quick-entry template buttons.
  body.querySelectorAll<HTMLElement>('[data-journal-template]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const template    = btn.dataset.journalTemplate ?? 'moment';
      const placeholder = btn.dataset.journalPlaceholder ?? '';
      openJournalComposer(template, placeholder);
    });
  });

  // Todo inline toggle.
  body.querySelectorAll<HTMLElement>('[data-toggle-todo]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const [id, doneStr] = btn.dataset.toggleTodo!.split(':');
      void todoStore.toggle(id, doneStr === 'true');
    });
  });

  // Todo quick-add form.
  body.querySelector<HTMLFormElement>('[data-todo-add]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form  = e.currentTarget as HTMLFormElement;
    const input = form.querySelector<HTMLInputElement>('.td-todo-add-input');
    const text  = input?.value.trim() ?? '';
    if (!text) return;
    await todoStore.add({ text, dueDate: null });
    if (input) input.value = '';
  });

  // New trip button.
  body.querySelector<HTMLButtonElement>('[data-action="new-trip"]')?.addEventListener('click', () => {
    openNewTrip();
  });

  // Dashboard map zoom controls.
  body.querySelector('#tdMapZoomIn')?.addEventListener('click', e => {
    e.stopPropagation();
    dashboardMapZoom('in');
  });
  body.querySelector('#tdMapZoomOut')?.addEventListener('click', e => {
    e.stopPropagation();
    dashboardMapZoom('out');
  });
  body.querySelector('#tdMapZoomFit')?.addEventListener('click', e => {
    e.stopPropagation();
    dashboardMapZoom('fit');
  });

  // Drag-and-drop widget reordering.
  wireDragDrop(body);
}

function wireDragDrop(body: HTMLElement): void {
  const gridEl = body.querySelector<HTMLElement>('#td-grid');
  if (!gridEl) return;
  const grid = gridEl; // non-null alias for closures

  // Insert-line indicator element
  const indicator = document.createElement('div');
  indicator.className = 'td-drop-indicator';
  indicator.style.display = 'none';

  let dragId: string | null = null;
  let _insertBefore: HTMLElement | null = null; // null = append

  function getWidgets(): HTMLElement[] {
    return Array.from(grid.querySelectorAll<HTMLElement>('[data-widget-id]'));
  }

  function clearIndicator() {
    indicator.style.display = 'none';
    indicator.remove();
    _insertBefore = null;
  }

  function showIndicator(before: HTMLElement | null) {
    if (before) {
      grid.insertBefore(indicator, before);
    } else {
      grid.appendChild(indicator);
    }
    indicator.style.display = 'block';
    _insertBefore = before;
  }

  // Show drag handle on hover (added dynamically to avoid cluttering HTML)
  getWidgets().forEach(w => {
    if (w.querySelector('.td-drag-handle')) return;
    const handle = document.createElement('div');
    handle.className = 'td-drag-handle';
    handle.setAttribute('draggable', 'false');
    handle.innerHTML = '⠿';
    w.prepend(handle);
    handle.addEventListener('mousedown', () => { w.setAttribute('draggable', 'true'); });
    handle.addEventListener('mouseup', () => { w.setAttribute('draggable', 'false'); });
  });

  grid.addEventListener('dragstart', e => {
    const widget = (e.target as HTMLElement).closest<HTMLElement>('[data-widget-id]');
    if (!widget) { e.preventDefault(); return; }
    dragId = widget.dataset.widgetId ?? null;
    widget.classList.add('td-dragging');
    e.dataTransfer!.effectAllowed = 'move';
    // Small delay so the drag image doesn't include the indicator
    requestAnimationFrame(() => { indicator.style.display = 'none'; });
  });

  grid.addEventListener('dragend', () => {
    getWidgets().forEach(el => el.classList.remove('td-dragging'));
    clearIndicator();
    dragId = null;
  });

  grid.addEventListener('dragover', e => {
    e.preventDefault();
    if (!dragId) return;
    e.dataTransfer!.dropEffect = 'move';

    const widgets = getWidgets().filter(el => el.dataset.widgetId !== dragId);
    if (!widgets.length) { showIndicator(null); return; }

    // Find closest widget by vertical midpoint
    let closest: HTMLElement | null = null;
    let closestDist = Infinity;
    let insertBefore: HTMLElement | null = null;

    for (const w of widgets) {
      const rect = w.getBoundingClientRect();
      const mid  = rect.top + rect.height / 2;
      const dist = Math.abs(e.clientY - mid);
      if (dist < closestDist) {
        closestDist = dist;
        closest = w;
        insertBefore = e.clientY < mid ? w : (w.nextElementSibling as HTMLElement | null);
      }
    }

    if (closest) showIndicator(insertBefore);
  });

  grid.addEventListener('dragleave', e => {
    if (!grid.contains(e.relatedTarget as Node)) clearIndicator();
  });

  grid.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragId) return;

    const items = getWidgets();
    const dragged = items.find(el => el.dataset.widgetId === dragId);
    if (!dragged) { clearIndicator(); return; }

    const before = _insertBefore;
    clearIndicator();

    if (before && before !== dragged) {
      grid.insertBefore(dragged, before);
    } else if (!before) {
      grid.appendChild(dragged);
    }

    // Persist
    const newOrder = getWidgets().map(el => el.dataset.widgetId ?? '');
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(newOrder)); } catch { /* ignore */ }

    dragId = null;
  });
}

function bootMap(): void {
  const canvas = document.getElementById('td-map-canvas');
  if (!canvas || _mapBooted) return;
  _mapBooted = true;
  // Pass legs (may be empty — map still renders Europe outline + pins when legs exist)
  void initDashboardMap(canvas, _legs);
}

/* ══════════════════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════════════════ */

export function initToday(): void {
  const root = document.getElementById('view-today');
  if (!root) return;

  _rates      = peekRateTable(baseCurrency());
  _legs       = routeStore.peek();
  _expenses   = expenseStore.peek();
  _checklists = checklistStore.peek();
  _journal    = journalStore.peek();
  _todos      = todoStore.peek();
  _mapBooted  = false;
  disposeDashboardMap();
  render();

  _unsubs.forEach(u => u());
  _unsubs = [
    routeStore.subscribe(rows => { _legs = rows; _mapBooted = false; disposeDashboardMap(); render(); }),
    expenseStore.subscribe(rows => { _expenses = rows; render(); }),
    checklistStore.subscribe(rows => { _checklists = rows; render(); }),
    journalStore.subscribe(rows => { _journal = rows; render(); }),
    todoStore.subscribe(rows => { _todos = rows; render(); }),
    onTripChange(() => { _mapBooted = false; disposeDashboardMap(); render(); }),
  ];

  void getRateTable(baseCurrency()).then(table => { _rates = table; render(); });
}
