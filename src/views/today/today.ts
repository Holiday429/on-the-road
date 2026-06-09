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
import { navigateTo, type ViewId, type NavIntent } from '../../core/app.ts';
import { currentUser } from '../../firebase/auth.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { openModal } from '../../core/modal.ts';
import type { PlanItem } from '../../data/schema.ts';
import { initDashboardMap, disposeDashboardMap } from './dashboard-map.ts';

/* ── State ───────────────────────────────────────────────────────────────── */
let _legs: StoredLeg[] = [];
let _expenses: StoredExpense[] = [];
let _checklists: ReturnType<typeof checklistStore.peek> = [];
let _journal: StoredJournalEntry[] = [];
let _todos:   StoredTodo[]         = [];
let _rates: RateTable = {};
let _rateInput = '';          // currency converter left-side amount
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
// Maps country name substring → ISO code for the likely local currency.
const COUNTRY_CURRENCY: Array<[string, string]> = [
  ['Denmark',     'DKK'], ['Sweden',     'SEK'], ['Norway',     'NOK'],
  ['Switzerland', 'CHF'], ['UK',         'GBP'], ['Britain',    'GBP'],
  ['Japan',       'JPY'], ['China',      'CNY'], ['US',         'USD'],
  ['Czech',       'CZK'],
];
function localCurrency(): string {
  const leg = currentLeg();
  if (!leg) return 'USD';
  // If base IS euro and leg is eurozone, show DKK as a useful pair instead.
  const match = COUNTRY_CURRENCY.find(([k]) => leg.country.includes(k));
  return match ? match[1] : (baseCurrency() === 'EUR' ? 'DKK' : 'EUR');
}

/* ══════════════════════════════════════════════════════════════════════════
   WIDGET RENDERERS
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Greeting headline (above hero) ──────────────────────────────────────── */
function renderGreeting(): string {
  return `<div class="td-greeting">${greetingWord()}, ${esc(firstName())}! 👋</div>`;
}

/* ── Hero banner ─────────────────────────────────────────────────────────── */
function renderHero(phase: Phase): string {
  const trip = currentTrip();
  const name = trip?.name ?? 'Your trip';
  const legs = sortedLegs();
  const leg  = currentLeg();
  const ART  = `${(import.meta as any).env.BASE_URL}art/`.replace(/\/{2,}/g, '/');

  let anchor = '';
  if (phase === 'before' && leg) {
    const d = daysBetween(todayIso(), leg.dateFrom);
    anchor = `<strong>${d}</strong> day${d === 1 ? '' : 's'} to go · next stop ${esc(leg.flag)} ${esc(leg.city)}`;
  } else if (phase === 'during' && leg) {
    const idx  = legs.findIndex(l => l.id === leg.id) + 1;
    const dayN = daysBetween(leg.dateFrom, todayIso()) + 1;
    const tot  = daysBetween(leg.dateFrom, leg.dateTo) + 1;
    anchor = `${esc(leg.flag)} ${esc(leg.city)} · stop ${idx}/${legs.length} · day ${dayN} of ${tot}`;
  } else if (phase === 'after') {
    const countries = new Set(legs.map(l => l.country)).size;
    const len = trip ? daysBetween(trip.startDate, trip.endDate) + 1 : null;
    anchor = `Trip complete${len ? ` · ${len} days` : ''}${countries ? ` · ${countries} countr${countries === 1 ? 'y' : 'ies'}` : ''}`;
  }

  const steps: Array<[Phase, string]> = [['before', 'Before'], ['during', 'On the road'], ['after', 'After']];
  const phaseRail = steps.map(([p, label], i) => {
    const active = p === phase;
    const done   = steps.findIndex(s => s[0] === phase) > i;
    return `${i > 0 ? '<span class="td-phase-rail"></span>' : ''}<span class="td-phase-step ${active ? 'is-on' : done ? 'is-done' : ''}"><i></i>${label}</span>`;
  }).join('');

  return `
    <div class="td-hero" data-phase="${phase}">
      <div class="td-hero-left">
        <div class="td-hero-name">${esc(name)}</div>
        ${anchor ? `<div class="td-hero-anchor">${anchor}</div>` : ''}
        <div class="td-phase">${phaseRail}</div>
      </div>
      <img class="td-hero-logo" src="${ART}logo.gif" alt="On the Road">
    </div>`;
}

/* ── Currency widget ──────────────────────────────────────────────────────── */
function renderCurrencyWidget(): string {
  const base  = baseCurrency();
  const local = localCurrency();
  const rate  = _rates[local] ? (1 / _rates[local]) : null; // 1 base = ? local
  const displayRate = rate != null ? rate.toFixed(4) : '—';
  const inputAmt = _rateInput !== '' ? parseFloat(_rateInput) : null;
  const converted = (inputAmt != null && rate != null) ? (inputAmt * rate).toFixed(2) : '';
  const localFlag = CURRENCIES.find(c => c.code === local)?.flag ?? '';
  const baseFlag  = CURRENCIES.find(c => c.code === base)?.flag ?? '';

  return `
    <div class="td-widget td-w-currency">
      <div class="td-widget-label">💱 Currency</div>
      <div class="td-currency-rate">1 ${baseFlag} ${esc(base)} = <strong>${displayRate}</strong> ${localFlag} ${esc(local)}</div>
      <div class="td-currency-row">
        <div class="td-currency-side">
          <span class="td-currency-flag">${baseFlag}</span>
          <input class="td-currency-input" data-rate-input type="number" inputmode="decimal" placeholder="100" value="${esc(_rateInput)}">
          <span class="td-currency-code">${esc(base)}</span>
        </div>
        <span class="td-currency-swap">⇄</span>
        <div class="td-currency-side td-currency-result">
          <span class="td-currency-flag">${localFlag}</span>
          <span class="td-currency-value">${esc(converted || '—')}</span>
          <span class="td-currency-code">${esc(local)}</span>
        </div>
      </div>
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
      <div class="td-map-container" id="td-map-canvas"></div>
      <div class="td-map-legend">
        <span class="td-map-dot" style="background:#22c55e"></span>Now
        <span class="td-map-dot" style="background:#f9b830"></span>Upcoming
        <span class="td-map-dot" style="background:#a8a29e"></span>Past
      </div>
    </div>`;
}

/* ── Upcoming itinerary widget ────────────────────────────────────────────── */
function renderUpcomingWidget(): string {
  const today  = todayIso();
  const leg    = currentLeg();
  const sorted = sortedLegs();

  // Show current leg + next 2 upcoming
  const display = leg
    ? [leg, ...sorted.filter(l => l.dateFrom > today).slice(0, 2)]
    : sorted.filter(l => l.dateFrom >= today).slice(0, 3);

  if (!display.length) {
    return `
      <div class="td-widget td-w-upcoming">
        <div class="td-widget-header">
          <div class="td-widget-label">📍 Upcoming</div>
          <button class="td-link" data-nav="route">Itinerary ›</button>
        </div>
        <div class="td-upcoming-empty">No itinerary yet — add stops in the Route view.</div>
      </div>`;
  }

  const cards = display.map((l, i) => {
    const isCurrent = l.id === leg?.id;
    const daysLeft  = daysBetween(today, l.dateTo);
    const daysAway  = !isCurrent ? daysBetween(today, l.dateFrom) : null;
    const accs = l.accommodations?.length ? l.accommodations : l.accommodation ? [l.accommodation] : [];
    const accName = accs[0]?.name ?? '';
    const t = l.arrivalTransport;
    const transportChip = t && i > 0
      ? `<span class="td-up-chip td-up-transport">${
          t.type === 'flight' ? '✈️' : t.type === 'train' ? '🚂' : t.type === 'bus' ? '🚌' : '⛴️'
        } ${esc(t.from)} → ${esc(t.to)}</span>`
      : '';
    const plans = (l.plans ?? []).filter(p => !p.done);
    const planChip = plans.length
      ? `<span class="td-up-chip td-up-plans">${plans.length} plan item${plans.length > 1 ? 's' : ''}</span>` : '';

    return `
      <div class="td-up-card ${isCurrent ? 'is-current' : ''}" data-nav="route" data-intent='${esc(JSON.stringify({ legId: l.id } satisfies NavIntent))}'>
        <div class="td-up-flag">${esc(l.flag)}</div>
        <div class="td-up-body">
          <div class="td-up-city">${esc(l.city)}</div>
          <div class="td-up-dates">${esc(l.dateFrom)} – ${esc(l.dateTo)}${
            isCurrent ? ` · <strong>${daysLeft + 1} day${daysLeft > 0 ? 's' : ''} left</strong>` :
            daysAway !== null ? ` · in ${daysAway} day${daysAway !== 1 ? 's' : ''}` : ''
          }</div>
          ${accName ? `<div class="td-up-acc">🏠 ${esc(accName)}</div>` : ''}
          <div class="td-up-chips">${transportChip}${planChip}</div>
        </div>
        <span class="td-up-arrow">›</span>
      </div>`;
  }).join('');

  return `
    <div class="td-widget td-w-upcoming">
      <div class="td-widget-header">
        <div class="td-widget-label">📍 Upcoming</div>
        <button class="td-link" data-nav="route">Full itinerary ›</button>
      </div>
      ${cards}
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
    <div class="td-widget td-w-journal">
      <div class="td-widget-header">
        <div class="td-widget-label">📔 Journal</div>
        <button class="td-link" data-nav="journal">All entries ›</button>
      </div>
      <div class="td-jq-hint">Capture this moment</div>
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

/* ── Layout ───────────────────────────────────────────────────────────────── */
function layout(phase: Phase): string {
  // Row 1: currency | calendar | todo  (3 equal cols)
  // Row 2: [spend / prep / safety stacked left] + [map tall right]
  // Row 3: upcoming (left) | journal quick-entry (right)
  return `
    <div class="td-grid">
      ${renderCurrencyWidget()}
      ${renderCalendarWidget()}
      ${renderTodoWidget()}
      <div class="td-left-col">
        ${renderSpendWidget()}
        <div class="td-mini-row">
          ${renderPrepMini()}
          ${renderSafetyMini()}
        </div>
      </div>
      ${renderMapWidget()}
      ${renderUpcomingWidget()}
      ${renderJournalWidget(phase)}
    </div>`;
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
  const handle = openModal({
    title: `${icon} ${template.charAt(0).toUpperCase() + template.slice(1)}`,
    body: `
      <div class="td-compose-body">
        <input class="input" id="td-cmp-title" placeholder="Title (optional)">
        <textarea class="input td-cmp-text" id="td-cmp-body" placeholder="${esc(placeholder)}" rows="5"></textarea>
      </div>`,
    footer: `
      <button class="btn btn-ghost" id="td-cmp-cancel">Cancel</button>
      <button class="btn btn-primary" id="td-cmp-save">Save</button>`,
  });

  handle.root.querySelector('#td-cmp-cancel')?.addEventListener('click', () => handle.close());
  handle.root.querySelector('#td-cmp-save')?.addEventListener('click', async () => {
    const titleEl = handle.root.querySelector<HTMLInputElement>('#td-cmp-title');
    const bodyEl  = handle.root.querySelector<HTMLTextAreaElement>('#td-cmp-body');
    const title   = titleEl?.value.trim() ?? '';
    const body    = bodyEl?.value.trim() ?? '';
    if (!body) { bodyEl?.focus(); return; }
    await journalStore.save({
      title, body, template,
      destination: leg?.city ?? '',
      tags: [], happenedOn: today,
    });
    handle.close();
    render();
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   RENDER + WIRE
   ══════════════════════════════════════════════════════════════════════════ */

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

  // Currency converter input.
  body.querySelector<HTMLInputElement>('[data-rate-input]')?.addEventListener('input', e => {
    _rateInput = (e.target as HTMLInputElement).value;
    // Re-render only the result span to avoid full re-render on keypress.
    const local = localCurrency();
    const rate  = _rates[local] ? (1 / _rates[local]) : null;
    const amt   = parseFloat(_rateInput);
    const result = (rate != null && Number.isFinite(amt)) ? (amt * rate).toFixed(2) : '—';
    const span = body.querySelector<HTMLElement>('.td-currency-value');
    if (span) span.textContent = result;
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
