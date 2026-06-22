/* ==========================================================================
   On the Road · Dashboard — personal dashboard
   --------------------------------------------------------------------------
   The app's home screen: a flexible bento grid of widgets.
   Every widget subscribes to an existing store; this view owns no data itself.
   ========================================================================== */

import './dashboard.css';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { todoStore, type StoredTodo } from '../../data/stores/todo-store.ts';
import { currentTrip, baseCurrency, tripBudget, countryBudgets, onTripChange, currentTripId } from '../../data/trip-context.ts';
import { addExpenseWithDefaults, defaultPlace, defaultCurrency, BUILTIN_CATEGORIES as EXPENSE_CATEGORIES } from '../expenses/expense-defaults.ts';
import { currencySymbol, getRateTable, peekRateTable, type RateTable, CURRENCIES } from '../../data/rates.ts';
import { navigateTo, type ViewId, type NavIntent, openNewTrip } from '../../core/app.ts';
import { currentUser } from '../../firebase/auth.ts';
import { escHtml as esc } from '../../core/utils.ts';
import type { PlanItem, PlanDay, ClipCategory } from '../../data/schema.ts';
import { initDashboardMap, disposeDashboardMap, dashboardMapZoom } from './dashboard-map.ts';
import { nomadStore, type StoredNomadSpot } from '../../data/stores/nomad-store.ts';
import { cityStore, type StoredCityIntel } from '../../data/stores/city-store.ts';
import { safetyStore, type StoredCitySafety } from '../../data/stores/safety-store.ts';
import { BUILTIN_CATEGORIES } from '../itinerary/itinerary.ts';
import { openModal } from '../../core/modal.ts';
import { t, onLocaleChange } from '../../core/i18n.ts';
import { createLanguagePicker, type LanguagePickerInstance } from '../../core/language-picker.ts';
import { openJournalComposerOverlay } from '../journal/index.ts';
import { scheduleAllNotifications } from '../../core/notifications.ts';
import { packStore, type StoredPackList } from '../../data/stores/pack-store.ts';
import { baggageRemainG, itemWeightG, itemsPresentAtLeg } from '../../data/packing-formula.ts';
import { PACK_CATEGORIES, listTotalWeight } from '../pack/pack.ts';

/* ── State ───────────────────────────────────────────────────────────────── */
let _legs: StoredLeg[] = [];
let _expenses: StoredExpense[] = [];
let _journal: StoredJournalEntry[] = [];
let _todos:   StoredTodo[]         = [];
let _rates: RateTable = {};
let _rateInput = '';          // currency converter amount
let _rateFrom  = '';          // selected "from" currency (empty = baseCurrency())
let _rateTo    = '';          // selected "to" currency (empty = auto localCurrency())
let _mapCanvas: HTMLElement | null = null; // tracks which canvas element the map was booted on
let _unsubs: Array<() => void> = [];
let _langPicker: LanguagePickerInstance | null = null;
let _weather: { icon: string; tempHigh: string; tempLow: string } | null = null;
let _weatherCity = '';
let _nomadSpots: StoredNomadSpot[] = [];
let _cityIntel: StoredCityIntel[] = [];
let _citySafety: StoredCitySafety[] = [];
let _packLists: StoredPackList[] = [];

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
  // The trip's own start/end are the single source of truth for the phase —
  // legs only fill in when there's no trip loaded yet (guest/boot). Mixing the
  // two (trip start + leg end) produced before/during/after disagreeing with
  // the itinerary when a user moved trip dates without re-touching the legs.
  let start: string | undefined;
  let end: string | undefined;
  if (trip) {
    start = trip.startDate;
    end = trip.endDate;
  } else {
    const legs = sortedLegs();
    start = legs[0]?.dateFrom;
    end = legs[legs.length - 1]?.dateTo;
  }
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
  if (h < 5)  return t('dash.greeting.night');
  if (h < 12) return t('dash.greeting.morning');
  if (h < 18) return t('dash.greeting.afternoon');
  return t('dash.greeting.evening');
}

/* ── Weather (wttr.in JSON) ──────────────────────────────────────────────── */
const WEATHER_ICONS: Record<string, string> = {
  '113': '☀️', '116': '⛅', '119': '☁️', '122': '☁️',
  '143': '🌫️', '176': '🌦️', '179': '🌨️', '182': '🌧️',
  '185': '🌧️', '200': '⛈️', '227': '🌨️', '230': '❄️',
  '248': '🌫️', '260': '🌫️', '263': '🌦️', '266': '🌦️',
  '281': '🌧️', '284': '🌧️', '293': '🌦️', '296': '🌦️',
  '299': '🌧️', '302': '🌧️', '305': '🌧️', '308': '🌧️',
  '311': '🌧️', '314': '🌧️', '317': '🌧️', '320': '🌨️',
  '323': '🌨️', '326': '🌨️', '329': '❄️', '332': '❄️',
  '335': '❄️', '338': '❄️', '350': '🌧️', '353': '🌦️',
  '356': '🌧️', '359': '🌧️', '362': '🌧️', '365': '🌧️',
  '368': '🌨️', '371': '❄️', '374': '🌧️', '377': '🌧️',
  '386': '⛈️', '389': '⛈️', '392': '⛈️', '395': '⛈️',
};
async function fetchWeather(city: string): Promise<void> {
  if (!city || city === _weatherCity) return;
  _weatherCity = city;
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const data = await res.json();
    const cur  = data?.current_condition?.[0];
    if (!cur) return;
    const code = String(cur.weatherCode ?? '113');
    const icon = WEATHER_ICONS[code] ?? '🌡️';
    const todayForecast = data?.weather?.[0];
    const tempHigh = todayForecast?.maxtempC != null ? `${todayForecast.maxtempC}°` : `${cur.temp_C ?? '?'}°`;
    const tempLow  = todayForecast?.mintempC != null ? `${todayForecast.mintempC}°` : '';
    _weather = { icon, tempHigh, tempLow };
    render();
  } catch { /* silent — weather is decorative */ }
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
      <div class="td-greeting-actions">
        <button class="btn btn-ghost td-new-trip-btn" data-action="new-trip">${esc(t('common.newTrip'))}</button>
        <div class="td-lang-mount" data-lang-mount></div>
      </div>
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
    // Show upcoming transport + accommodation chips
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
  } else if (phase === 'during' && leg) {
    const idx  = legs.findIndex(l => l.id === leg.id) + 1;
    const dayN = daysBetween(leg.dateFrom, todayIso()) + 1;
    const tot  = daysBetween(leg.dateFrom, leg.dateTo) + 1;
    anchor = `${esc(leg.flag)} ${esc(leg.city)} · stop ${idx}/${legs.length} · day ${dayN} of ${tot}`;
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

  // Kick off weather fetch for current/next city
  const weatherCity = leg?.city ?? '';
  if (weatherCity) void fetchWeather(weatherCity);

  // Weather square (no background, just icon + temps)
  const weatherBlock = _weather
    ? `<div class="td-hero-weather-sq">
        <div class="td-hero-weather-icon">${_weather.icon}</div>
        <div class="td-hero-weather-temps">
          <span class="td-hero-weather-high">${esc(_weather.tempHigh)}</span>
          ${_weather.tempLow ? `<span class="td-hero-weather-low">/ ${esc(_weather.tempLow)}</span>` : ''}
        </div>
      </div>`
    : (weatherCity
        ? `<div class="td-hero-weather-sq td-hero-weather-sq--loading">
            <div class="td-hero-weather-icon">🌡️</div>
            <div class="td-hero-weather-temps"><span class="td-hero-weather-high">…</span></div>
          </div>`
        : '');

  return `
    <div class="td-hero" data-phase="${phase}">
      <div class="td-hero-inner">
        ${weatherBlock}
        <div class="td-hero-left">
          <div class="td-hero-name">${esc(name)}</div>
          ${anchor ? `<div class="td-hero-anchor">${anchor}</div>` : ''}
          ${details}
        </div>
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

  const baseFlag = CURRENCIES.find(c => c.code === base)?.flag ?? '';

  // 3 rate info rows: always show 3 different non-base currencies
  // Priority: localCurrency, then trip leg currencies, then common fallbacks
  const fallbacks = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'DKK', 'SEK'];
  const candidates = [
    ...tripCurrencies(),
    ...fallbacks,
  ];
  const seen3 = new Set<string>();
  for (const c of candidates) {
    if (c !== base && !seen3.has(c)) seen3.add(c);
    if (seen3.size === 3) break;
  }
  const rateRowCodes = Array.from(seen3);
  const rateRowsHtml = rateRowCodes.map(code => {
    const flag = CURRENCIES.find(c => c.code === code)?.flag ?? '';
    return `<div class="td-cur-rate-row"><span>${baseFlag} ${esc(base)}</span><span class="td-cur-rate-eq">=</span><span><strong>${rateDisplay(code)}</strong> ${flag} ${esc(code)}</span></div>`;
  }).join('');

  return `
    <div class="td-widget td-w-currency">
      <div class="td-widget-label">💱 Currency</div>
      <div class="td-cur-converter">
        <div class="td-cur-conv-row">
          <div class="td-cur-conv-side">
            <input class="td-currency-input" data-rate-input type="text" inputmode="decimal" placeholder="1" value="${esc(_rateInput)}">
            <select class="td-cur-select" data-rate-from>${currencyOptions(fromCur)}</select>
          </div>
          <button class="td-currency-swap" data-rate-swap title="Swap">⇄</button>
          <div class="td-cur-conv-side td-cur-conv-result">
            <span class="td-currency-value">${esc(converted || (crossRate != null ? crossRate.toFixed(4) : '—'))}</span>
            <select class="td-cur-select" data-rate-to>${currencyOptions(toCur)}</select>
          </div>
        </div>
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
  // Plan items assigned to a day (dayId encodes date as "day-YYYY-MM-DD")
  const planDayRe = /^day-(\d{4}-\d{2}-\d{2})$/;
  for (const leg of _legs) {
    for (const p of (leg.plans ?? []) as PlanItem[]) {
      if (!p.dayId) continue;
      const m = planDayRe.exec(p.dayId);
      if (m) addDot(m[1], '#a78bfa'); // violet dot for plan items
    }
  }

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
        <span><span class="td-cal-dot" style="background:#a78bfa"></span>Plan</span>
      </div>
    </div>`;
}

/* ── Budget alerts ───────────────────────────────────────────────────────── */
function renderBudgetAlerts(): string {
  const caps = countryBudgets();
  const sym  = currencySymbol(baseCurrency());
  const alerts: string[] = [];

  for (const [country, cap] of Object.entries(caps)) {
    if (!cap) continue;
    const spent = _expenses.filter(e => e.country === country).reduce((s, e) => s + inBase(e), 0);
    const pct = spent / cap;
    if (pct < 0.8) continue;
    const over = spent > cap;
    const flag = _legs.find(l => l.country === country)?.flag ?? '';
    alerts.push(`
      <div class="td-budget-alert ${over ? 'is-over' : 'is-warning'}" data-nav="expenses">
        <span class="td-ba-flag">${flag}</span>
        <span class="td-ba-text">
          ${over
            ? `<strong>${country}</strong> over budget — ${sym}${Math.round(spent - cap)} over`
            : `<strong>${country}</strong> at ${Math.round(pct * 100)}% of ${sym}${Math.round(cap)} budget`}
        </span>
        <span class="td-ba-arrow">›</span>
      </div>`);
  }

  if (!alerts.length) return '';
  return `<div class="td-budget-alerts">${alerts.join('')}</div>`;
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

  // Prefer the current country's budget when one is set — it's the more
  // actionable number while you're there; otherwise fall back to the total.
  const curCountry = currentLeg()?.country ?? '';
  const countryCap = curCountry ? countryBudgets()[curCountry] : undefined;
  let budgetLine = '';
  if (countryCap) {
    const spent = _expenses.filter(e => e.country === curCountry).reduce((s, e) => s + inBase(e), 0);
    const pct  = Math.min(100, Math.round((spent / countryCap) * 100));
    const over = spent > countryCap;
    const color = pct >= 100 ? 'var(--coral-500)' : pct >= 80 ? '#f59e0b' : 'var(--sage-500)';
    budgetLine = `
      <div class="td-spend-bar-track"><div class="td-spend-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="td-spend-bar-foot">
        <span class="${over ? 'td-over' : 'td-remain'}">${over ? `${fmt(spent-countryCap)} over` : `${fmt(countryCap-spent)} left`}</span>
        <span class="td-pct">${curCountry} · ${pct}% of ${fmt(countryCap)}</span>
      </div>`;
  } else if (budget) {
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
      <div class="td-barchart-wrap">
        <div class="td-barchart" title="Last 30 days">${bars}</div>
        <div class="td-barchart-label">Last 30 days</div>
      </div>
      <form class="td-quickadd td-quickadd-v" data-quickadd>
        <div class="td-quickadd-hint">📍 ${leg?.country || '—'}${leg?.city ? ' · ' + leg.city : ''} · ${currencySymbol(defaultCurrency(_legs, today))}${defaultCurrency(_legs, today)}</div>
        <div class="td-quickadd-row2">
          <div class="td-quickadd-amt-wrap">
            <span class="td-quickadd-sym">${sym}</span>
            <input class="td-quickadd-amt" type="text" inputmode="decimal" placeholder="0.00" required>
          </div>
          <select class="td-quickadd-cat select">
            <option value="">Category…</option>
            ${EXPENSE_CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('')}
          </select>
        </div>
        <div class="td-quickadd-row2">
          <input class="td-quickadd-desc" type="text" placeholder="What for? (optional)">
          <button class="td-quickadd-save btn btn-primary" type="submit">Save</button>
        </div>
      </form>
    </div>`;
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
          <button class="td-map-zoom-btn" id="tdMapZoomFit" title="Fit to route">⊡</button>
          <button class="td-map-zoom-btn" id="tdMapZoomOut" title="Zoom out">−</button>
        </div>
        <div class="td-map-legend">
          <span><span class="td-map-dot" style="background:#22c55e"></span>Now</span>
          <span><span class="td-map-dot" style="background:#f9b830"></span>Upcoming</span>
          <span><span class="td-map-dot" style="background:#a8a29e"></span>Past</span>
        </div>
      </div>
    </div>`;
}

/* ── Upcoming itinerary widget — feed view mirroring itinerary Feed tab ───── */

function categoryByIdLocal(leg: StoredLeg, id: string): ClipCategory | undefined {
  const custom = (leg as any).clipCategories ?? [];
  const all: ClipCategory[] = [
    ...BUILTIN_CATEGORIES.filter((b: ClipCategory) => !custom.find((c: ClipCategory) => c.id === b.id)),
    ...custom,
  ];
  return all.find((c: ClipCategory) => c.id === id);
}

function ensurePlanDaysLocal(leg: StoredLeg): PlanDay[] {
  const total = daysBetween(leg.dateFrom, leg.dateTo);
  const existing = [...(leg.planDays ?? [])].sort((a, b) => a.order - b.order);
  const pad = (n: number) => String(n).padStart(2, '0');
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(leg.dateFrom + 'T00:00:00');
    d.setDate(d.getDate() + i);
    // Build the iso in *local* time (matches route.ts ensurePlanDays). Using
    // toISOString() here would shift to UTC and roll the date back a day in
    // negative-offset timezones, mismatching stored planDay dates.
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return existing.find(e => e.date === iso) ?? { id: `day-${iso}`, date: iso, order: i, label: '', notes: '' };
  });
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
            <div class="td-widget-label">📍 Upcoming</div>
            <button class="td-link" data-nav="route">Itinerary ›</button>
          </div>
          <div class="td-upcoming-empty">No itinerary yet — add stops in the Route view.</div>
        </div>`;
    }
    return renderPlanFeed(next);
  }

  return renderPlanFeed(leg);
}

function renderPlanFeed(leg: StoredLeg): string {
  const today = todayIso();
  const plans = (leg.plans ?? []) as PlanItem[];
  const days  = ensurePlanDaysLocal(leg);

  if (!plans.length) {
    return `
      <div class="td-widget td-w-upcoming" data-widget-id="upcoming">
        <div class="td-widget-header">
          <div class="td-widget-label">📍 Upcoming</div>
          <button class="td-link" data-nav="route" data-intent='${esc(JSON.stringify({ legId: leg.id } satisfies NavIntent))}'>Open ›</button>
        </div>
        <div class="td-plan-city">${esc(leg.flag)} ${esc(leg.city)}</div>
        <div class="td-upcoming-empty">No plan items for this stop yet.</div>
      </div>`;
  }

  // Only show days that have assigned items — skip unassigned
  const assigned = days
    .map(day => ({ day, items: plans.filter(p => p.dayId === day.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) }))
    .filter(g => g.items.length > 0);

  function dayStatus(date: string): 'active' | 'past' | 'upcoming' {
    if (date === today) return 'active';
    if (date < today) return 'past';
    return 'upcoming';
  }

  const feedItem = (p: PlanItem, status: 'active' | 'past' | 'upcoming') => {
    const cat = p.category ? categoryByIdLocal(leg, p.category) : undefined;
    const color = cat?.color ?? '#ebebeb';
    return `
      <div class="td-feed-item ${p.done ? 'is-done' : ''} td-feed-item--${status}" data-toggle-plan="${esc(leg.id)}:${esc(p.id)}">
        <div class="td-feed-item-dot" style="background:${p.done ? 'var(--ink-faint)' : status === 'active' ? '#22c55e' : status === 'past' ? '#a8a29e' : '#f9b830'}"></div>
        <div class="td-feed-item-body">
          ${cat ? `<span class="td-cat-badge" style="background:${esc(color)}">${esc(cat.label)}</span>` : ''}
          <span class="td-feed-item-title ${p.done ? 'is-done' : ''}">${esc(p.title)}</span>
        </div>
      </div>`;
  };

  const dayGroups = assigned.map(({ day, items }) => {
    const status = dayStatus(day.date);
    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    const dayIdx = days.findIndex(d => d.id === day.id);
    const dotColor = status === 'active' ? '#22c55e' : status === 'past' ? '#a8a29e' : '#f9b830';
    return `
      <div class="td-feed-day-group td-feed-day--${status}">
        <div class="td-feed-day-head">
          <span class="td-feed-day-dot" style="background:${dotColor}"></span>
          <span class="td-feed-day-num">DAY ${dayIdx + 1}${status === 'active' ? ' · Today' : ''}</span>
          <span class="td-feed-day-date">${esc(dateLabel)}</span>
          ${day.label ? `<span class="td-feed-day-label">${esc(day.label)}</span>` : ''}
        </div>
        <div class="td-feed-items">${items.map(p => feedItem(p, status)).join('')}</div>
      </div>`;
  }).join('');

  return `
    <div class="td-widget td-w-upcoming" data-widget-id="upcoming">
      <div class="td-widget-header">
        <div class="td-widget-label">📍 Upcoming</div>
        <button class="td-link" data-nav="route" data-intent='${esc(JSON.stringify({ legId: leg.id } satisfies NavIntent))}'>Open ›</button>
      </div>
      <div class="td-plan-city">${esc(leg.flag)} ${esc(leg.city)}</div>
      <div class="td-feed-list">${dayGroups}</div>
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

/* ── Todo modal (add with due date) ─────────────────────────────────────── */
function openDashboardTodoModal(defaultDate: string = todayIso()): void {
  const handle = openModal({
    title: '+ New to-do',
    body: `
      <div style="display:flex;flex-direction:column;gap:12px">
        <input class="input" id="db-todo-text" placeholder="What do you need to do?" autofocus>
        <div style="display:flex;gap:8px;align-items:center">
          <label class="field-label" style="margin:0;white-space:nowrap;flex-shrink:0">Due date</label>
          <input class="input" id="db-todo-due" type="date" value="${esc(defaultDate)}">
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <label class="field-label" style="margin:0;white-space:nowrap;flex-shrink:0">Remind me</label>
          <input class="input" id="db-todo-remind" type="datetime-local">
        </div>
      </div>`,
    footer: `<button class="btn btn-ghost" id="db-todo-cancel">Cancel</button>
             <button class="btn btn-primary" id="db-todo-save">Add</button>`,
  });

  handle.root.querySelector('#db-todo-cancel')?.addEventListener('click', () => handle.close());
  handle.root.querySelector('#db-todo-save')?.addEventListener('click', async () => {
    const text = (handle.root.querySelector<HTMLInputElement>('#db-todo-text'))?.value.trim() ?? '';
    const due  = (handle.root.querySelector<HTMLInputElement>('#db-todo-due'))?.value || null;
    const remindStr = (handle.root.querySelector<HTMLInputElement>('#db-todo-remind'))?.value || '';
    let remindAt: number | null = null;
    if (remindStr) {
      const ms = new Date(remindStr).getTime();
      if (!isNaN(ms)) remindAt = ms;
    }
    if (!text) { handle.root.querySelector<HTMLInputElement>('#db-todo-text')?.focus(); return; }
    if (remindAt && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    await todoStore.add({ text, dueDate: due, remindAt });
    handle.close();
    scheduleAllNotifications();
  });

  handle.root.querySelector<HTMLInputElement>('#db-todo-text')?.focus();
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
    .slice(0, 3);
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
      <div class="td-todo-list">${rows}${empty}</div>
      <form class="td-todo-add" data-todo-add>
        <button class="td-todo-add-cal" type="button" data-todo-add-modal title="Add with due date">📅</button>
        <input class="td-todo-add-input" type="text" placeholder="+ Quick add task…">
        <button class="btn btn-ghost td-todo-add-btn" type="submit">Add</button>
      </form>
    </div>`;
}

/* ── Safety mini — shows city emergency numbers with call buttons ─────────── */
function renderSafetyMini(): string {
  const leg = currentLeg();
  if (!leg) {
    return `
      <div class="td-widget td-w-safety">
        <div class="td-widget-label">🛡️ Safety</div>
        <div class="td-safety-city">Setup emergency info</div>
        <div class="td-safety-hint">Add stops in Route view</div>
      </div>`;
  }

  const safetyCard = _citySafety.find(s =>
    s.city.toLowerCase() === leg.city.toLowerCase()
  );

  function callRow(label: string, number: string): string {
    return `<div class="td-safety-number-row">
      <span class="td-safety-number-label">${esc(label)}</span>
      <a class="td-safety-call-btn" href="tel:${esc(number)}">${esc(number)} 📞</a>
    </div>`;
  }

  if (!safetyCard) {
    return `
      <div class="td-widget td-w-safety">
        <div class="td-widget-label">🛡️ ${esc(leg.flag)} ${esc(leg.city)}</div>
        ${callRow('General', '112')}
      </div>`;
  }

  // Show only the single most important number (general emergency first)
  const topNumber = safetyCard.generalEmergency
    || safetyCard.emergencyNumbers?.find(n => n.number)?.number
    || '112';
  const topLabel = safetyCard.generalEmergency
    ? 'General'
    : (safetyCard.emergencyNumbers?.find(n => n.number)?.label ?? 'General');

  return `
    <div class="td-widget td-w-safety">
      <div class="td-widget-label">🛡️ ${esc(leg.flag)} ${esc(leg.city)}</div>
      ${callRow(topLabel, topNumber)}
    </div>`;
}

/* ── Pack widget ─────────────────────────────────────────────────────────── */
function renderPackWidget(): string | null {
  const list = _packLists[0];
  if (!list) return null;

  const sLegs = [..._legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const today = todayIso();
  const curLeg = sLegs.find(l => l.dateFrom <= today && l.dateTo >= today)
    ?? sLegs.find(l => l.dateFrom >= today)
    ?? sLegs[sLegs.length - 1];

  const totalG = listTotalWeight(list);
  const remainG = curLeg ? baggageRemainG(list.items, sLegs, curLeg.id) : null;
  const nextLegWithAllowance = sLegs.find(l => l.dateFrom > today && l.arrivalTransport?.baggageAllowanceG);
  const allowanceG = nextLegWithAllowance?.arrivalTransport?.baggageAllowanceG;
  const isOver = remainG !== null && remainG < 0;
  const pct = allowanceG ? Math.min(100, (totalG / allowanceG) * 100) : 0;
  const barClass = isOver ? 'is-over' : pct > 85 ? 'is-warn' : '';

  const kgDisplay = (totalG / 1000).toFixed(totalG % 1000 === 0 ? 0 : 1) + 'kg';
  const hasLegs = sLegs.length > 0;

  const allowanceBar = allowanceG
    ? `<div class="td-pk-bar"><span class="${barClass}" style="width:${pct}%"></span></div>
       <div class="td-pk-allowance">${nextLegWithAllowance!.flag || ''} ${esc(nextLegWithAllowance!.city)} · ${allowanceG / 1000}kg limit${isOver ? ` · <strong style="color:var(--coral-500)">over by ${(Math.abs(remainG!) / 1000).toFixed(1)}kg</strong>` : ` · ${(remainG! / 1000).toFixed(1)}kg left`}</div>`
    : '';

  // Recent bag changes (last 3 acquired or dropped items)
  const recentAcq = list.items.filter(it => it.acquiredLegId).slice(-2);
  const recentDrop = list.items.filter(it => it.droppedLegId).slice(-1);
  const recentHtml = (recentAcq.length || recentDrop.length)
    ? `<div class="td-pk-recent">
        ${recentAcq.map(it => `<span class="pk-bl-chip pk-bl-chip--add">+ ${esc(it.name)}</span>`).join('')}
        ${recentDrop.map(it => `<span class="pk-bl-chip pk-bl-chip--drop">− ${esc(it.name)}</span>`).join('')}
      </div>`
    : '';

  return `
    <div class="td-widget td-w-pack">
      <div class="td-widget-header">
        <div class="td-widget-label">🎒 Pack <span class="td-pk-header-weight ${isOver ? 'is-over' : ''}">${kgDisplay}</span></div>
        <button class="td-link" data-nav="pack" data-intent='${esc(JSON.stringify({ listId: list.id }))}'>Open Pack ›</button>
      </div>
      ${allowanceBar}
      ${recentHtml}
      ${hasLegs ? `<div class="td-pk-actions">
        <button class="td-pk-action-btn" data-pk-action="acquired">+ Add</button>
        <button class="td-pk-action-btn" data-pk-action="left">− Left</button>
      </div>` : ''}
    </div>`;
}

/* ── Nomad widget — top 3 work-friendly spots for current city ────────────── */
function renderNomadWidget(): string | null {
  const leg = currentLeg();
  if (!leg) return null;

  const spots = _nomadSpots.filter(s =>
    s.city.toLowerCase() === leg.city.toLowerCase()
  ).slice(0, 3);

  if (!spots.length) return null;

  const TYPE_ICON: Record<string, string> = {
    'Café': '☕', 'Co-working': '💼', 'Library': '📚', 'Hotel lobby': '🏨',
  };

  const RATING_LABEL: Record<string, string> = {
    wifi: '📶', power: '🔌', noise: '🔊', coffee: '☕', value: '💰',
  };

  const cards = spots.map(s => {
    const icon = TYPE_ICON[s.type] ?? '📍';
    const ratings = s.ratings ?? {};
    const ratingPills = Object.entries(ratings)
      .filter(([, v]) => v != null && v > 0)
      .slice(0, 3)
      .map(([k, v]) => `<span class="td-nomad-rating">${RATING_LABEL[k] ?? k} ${v}/5</span>`)
      .join('');
    return `
      <div class="td-nomad-card">
        <div class="td-nomad-card-header">
          <span class="td-nomad-type-icon">${icon}</span>
          <span class="td-nomad-name">${esc(s.name)}</span>
          <span class="td-nomad-type">${esc(s.type)}</span>
        </div>
        ${ratingPills ? `<div class="td-nomad-ratings">${ratingPills}</div>` : ''}
        ${s.comment ? `<div class="td-nomad-comment">${esc(s.comment)}</div>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="td-widget td-w-nomad" data-widget-id="nomad">
      <div class="td-widget-header">
        <div class="td-widget-label">💻 Work spots · ${esc(leg.city)}</div>
        <button class="td-link" data-nav="nomad">All spots ›</button>
      </div>
      <div class="td-nomad-cards">${cards}</div>
    </div>`;
}

/* ── Where-to-Go widget — one pick per category, with add-to-itinerary ──────── */
function renderWhereToGoWidget(): string {
  const leg = currentLeg();
  if (!leg) {
    return `
      <div class="td-widget td-w-whereto">
        <div class="td-widget-label">✨ Where to go</div>
        <div class="td-whereto-empty">Add stops in Route view to get recommendations.</div>
      </div>`;
  }

  const intel = _cityIntel.find(c =>
    c.city.toLowerCase() === leg.city.toLowerCase()
  );

  if (!intel || (!intel.attractions?.length && !intel.restaurants?.length && !intel.experiences?.length && !intel.cafes?.length)) {
    return `
      <div class="td-widget td-w-whereto">
        <div class="td-widget-header">
          <div class="td-widget-label">✨ Where to go · ${esc(leg.flag)} ${esc(leg.city)}</div>
          <button class="td-link" data-nav="cities">Guide ›</button>
        </div>
        <div class="td-whereto-empty">No guide data for ${esc(leg.city)} yet.<br>Open Guide to generate recommendations.</div>
      </div>`;
  }

  const CATEGORIES: Array<{ key: string; icon: string; type: string }> = [
    { key: 'attractions', icon: '🏛️', type: 'attraction'  },
    { key: 'restaurants', icon: '🍽️', type: 'restaurant'  },
    { key: 'experiences', icon: '✨', type: 'experience'  },
    { key: 'cafes',       icon: '☕', type: 'cafe'        },
  ];
  const WTG_TINTS = ['#fef3c7','#dbeafe','#dcfce7','#fae8ff','#fee2e2','#ffedd5'];
  const WTG_TYPE_EMOJI: Record<string,string> = { attraction:'🏛️', restaurant:'🍽️', cafe:'☕', experience:'✨' };

  const picks: Array<{ icon: string; type: string; title: string; highlight?: string; cost?: string; imageUrl?: string; photographer?: string; photographerUrl?: string }> = [];
  for (const cat of CATEGORIES) {
    const arr = ((intel as any)[cat.key] as any[] | undefined) ?? [];
    for (const item of arr) {
      if (item.title) picks.push({
        icon: cat.icon, type: cat.type, title: item.title,
        highlight: item.highlight, cost: item.cost,
        imageUrl: item.imageUrl || '',
        photographer: item.photographer || '',
        photographerUrl: item.photographerUrl || '',
      });
      if (picks.length >= 6) break;
    }
    if (picks.length >= 6) break;
  }

  const cards = picks.map((c, idx) => {
    const hasImg = !!c.imageUrl;
    const tint = WTG_TINTS[idx % WTG_TINTS.length];
    const emoji = WTG_TYPE_EMOJI[c.type] ?? c.icon;
    const media = hasImg
      ? `<div class="td-whereto-photo" style="background-image:url('${esc(c.imageUrl!)}')">
          ${c.photographer ? `<a class="td-whereto-photo-credit" href="${esc(c.photographerUrl || '#')}" target="_blank" rel="noopener">${esc(c.photographer)} / Unsplash</a>` : ''}
         </div>`
      : `<div class="td-whereto-tint" style="--wtg-tint:${tint}"><span class="td-whereto-tint-emoji">${emoji}</span></div>`;
    return `
    <div class="td-whereto-card has-photo">
      ${media}
      <div class="td-whereto-card-body">
        <div class="td-whereto-card-top">
          <span class="td-whereto-type-icon">${c.icon}</span>
          <button class="td-whereto-add-btn" data-wtg-add="${esc(c.title)}" title="Add to itinerary">+</button>
        </div>
        <div class="td-whereto-name">${esc(c.title)}</div>
        ${c.cost ? `<div class="td-whereto-cost">${esc(c.cost)}</div>` : ''}
        ${c.highlight ? `<div class="td-whereto-highlight">${esc(c.highlight)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
    <div class="td-widget td-w-whereto">
      <div class="td-widget-header">
        <div class="td-widget-label">✨ Where to go · ${esc(leg.flag)} ${esc(leg.city)}</div>
        <button class="td-link" data-nav="cities">Guide ›</button>
      </div>
      <div class="td-whereto-cards">${cards}</div>
    </div>`;
}

/* ── Layout ───────────────────────────────────────────────────────────────── */
function layout(phase: Phase): string {
  const calWidget   = renderCalendarWidget();
  const todoWidget  = renderTodoWidget();
  const currWidget  = renderCurrencyWidget();
  const spendWidget = renderSpendWidget();
  const mapWidget   = renderMapWidget();
  const upWidget    = renderUpcomingWidget();
  const jrnWidget   = renderJournalWidget(phase);
  const nomadHtml   = renderNomadWidget();
  const whereHtml   = renderWhereToGoWidget();
  const packHtml    = renderPackWidget();
  const safetyHtml  = renderSafetyMini();

  return `<div class="td-grid" id="td-grid">
    ${currWidget}
    ${calWidget}
    ${todoWidget}
    ${spendWidget}
    ${mapWidget}
    ${jrnWidget}
    <div class="td-w-mini-col">
      ${packHtml ?? ''}
      ${safetyHtml}
    </div>
    ${upWidget}
    ${whereHtml}
    ${nomadHtml ?? ''}
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   ACTIONS
   ══════════════════════════════════════════════════════════════════════════ */

function quickAddSpend(amount: number, desc: string, category: string): void {
  const today = todayIso();
  const place = defaultPlace(_legs, today);
  const currency = defaultCurrency(_legs, today);
  void addExpenseWithDefaults({
    amount, currency, description: desc || 'Quick add', date: today,
    category, country: place.country, city: place.city, rates: _rates,
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
  body.innerHTML = `${renderGreeting()}${renderHero(phase)}${renderBudgetAlerts()}${layout(phase)}`;
  wire(body);
  bootMap();
}

/* ── Pack bag-change modal (dashboard shortcut) ───────────────────────────── */
function openPackBagChangeModal(list: StoredPackList, defaultAction: 'acquired' | 'left') {
  const sLegs = [..._legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  if (!sLegs.length) return;

  const today = todayIso();
  const defaultLeg = sLegs.find(l => l.dateFrom <= today && l.dateTo >= today)
    ?? sLegs.find(l => l.dateFrom >= today)
    ?? sLegs[sLegs.length - 1];

  const legOptions = sLegs.map(lg =>
    `<option value="${lg.id}" ${lg.id === defaultLeg?.id ? 'selected' : ''}>${lg.flag || '🗺️'} ${esc(lg.city)}</option>`
  ).join('');

  const catOptions = PACK_CATEGORIES.map(c =>
    `<option value="${c.value}" ${c.value === 'gifts' ? 'selected' : ''}>${c.label}</option>`
  ).join('');

  const m = openModal({
    title: 'Record bag change',
    variant: 'sheet',
    body: `
      <label class="field-label">City / stop</label>
      <select class="input" id="td-bc-leg">${legOptions}</select>

      <div style="display:flex;gap:0;margin-top:var(--sp-4);border:1.5px solid var(--rule-soft);border-radius:var(--r-md);overflow:hidden">
        <button class="td-bc-tab ${defaultAction === 'acquired' ? 'is-active' : ''}" data-tab="acquired"
          style="flex:1;border:none;padding:8px;font-size:var(--fs-sm);font-weight:600;cursor:pointer;
                 background:${defaultAction === 'acquired' ? 'var(--ink)' : 'var(--surface)'};
                 color:${defaultAction === 'acquired' ? '#fff' : 'var(--ink-soft)'}">+ Acquired</button>
        <button class="td-bc-tab ${defaultAction === 'left' ? 'is-active' : ''}" data-tab="left"
          style="flex:1;border:none;border-left:1.5px solid var(--rule-soft);padding:8px;font-size:var(--fs-sm);font-weight:600;cursor:pointer;
                 background:${defaultAction === 'left' ? 'var(--ink)' : 'var(--surface)'};
                 color:${defaultAction === 'left' ? '#fff' : 'var(--ink-soft)'}">− Left behind</button>
      </div>

      <div id="td-bc-acquired-panel" ${defaultAction === 'left' ? 'hidden' : ''} style="margin-top:var(--sp-4)">
        <label class="field-label">New item name</label>
        <input class="input" id="td-ac-name" placeholder="e.g. Souvenir scarf">
        <div style="display:flex;gap:var(--sp-3);margin-top:var(--sp-3)">
          <div style="flex:1"><label class="field-label">Category</label>
            <select class="input" id="td-ac-cat">${catOptions}</select></div>
          <div style="width:90px"><label class="field-label">Weight (kg)</label>
            <input class="input" id="td-ac-weight" type="number" min="0" step="any" placeholder="0"></div>
          <div style="width:72px"><label class="field-label">Qty</label>
            <input class="input" id="td-ac-qty" type="number" min="1" step="1" value="1"></div>
        </div>
        ${list.items.filter(it => !it.acquiredLegId && !it.droppedLegId).length ? `
          <div style="margin-top:var(--sp-4)">
            <label class="field-label">Or tag existing item</label>
            <select class="input" id="td-ac-existing">
              <option value="">— select item —</option>
              ${list.items.filter(it => !it.acquiredLegId && !it.droppedLegId).map(it =>
                `<option value="${it.id}">${esc(it.name)}</option>`).join('')}
            </select>
          </div>` : ''}
      </div>

      <div id="td-bc-left-panel" ${defaultAction === 'acquired' ? 'hidden' : ''} style="margin-top:var(--sp-4)">
        <label class="field-label">Items left behind</label>
        <div class="pk-drop-checklist" id="td-bc-drop-list">
          <div style="font-size:var(--fs-sm);color:var(--ink-muted);padding:var(--sp-2)">Loading…</div>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="confirm">Save</button>
    `,
  });

  let activeTab = defaultAction;

  function updateDropList() {
    const legId = m.root.querySelector<HTMLSelectElement>('#td-bc-leg')?.value;
    if (!legId) return;
    const present = itemsPresentAtLeg(list.items, sLegs, legId).filter(it => !it.droppedLegId);
    const el = m.root.querySelector<HTMLElement>('#td-bc-drop-list')!;
    el.innerHTML = present.length
      ? present.map(it => `
          <label class="pk-drop-check-row">
            <input type="checkbox" value="${it.id}">
            <span>${esc(it.name)}</span>
            <span class="pk-drop-weight">${(itemWeightG(it) / 1000).toFixed(1)}kg</span>
          </label>`).join('')
      : `<div style="font-size:var(--fs-sm);color:var(--ink-muted);padding:var(--sp-2)">No items at this stop.</div>`;
  }

  function switchTab(tab: 'acquired' | 'left') {
    activeTab = tab;
    m.root.querySelectorAll<HTMLElement>('.td-bc-tab').forEach(btn => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('is-active', active);
      btn.style.background = active ? 'var(--ink)' : 'var(--surface)';
      btn.style.color      = active ? '#fff' : 'var(--ink-soft)';
    });
    const acq  = m.root.querySelector<HTMLElement>('#td-bc-acquired-panel')!;
    const left = m.root.querySelector<HTMLElement>('#td-bc-left-panel')!;
    if (tab === 'acquired') { acq.removeAttribute('hidden'); left.setAttribute('hidden', ''); }
    else { left.removeAttribute('hidden'); acq.setAttribute('hidden', ''); updateDropList(); }
  }

  m.root.querySelectorAll<HTMLElement>('.td-bc-tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab as 'acquired' | 'left')));
  m.root.querySelector<HTMLSelectElement>('#td-bc-leg')?.addEventListener('change', () => { if (activeTab === 'left') updateDropList(); });

  if (defaultAction === 'left') updateDropList();
  else requestAnimationFrame(() => m.root.querySelector<HTMLInputElement>('#td-ac-name')?.focus());

  m.root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => m.close());
  m.root.querySelector('[data-act="confirm"]')?.addEventListener('click', async () => {
    const legId = m.root.querySelector<HTMLSelectElement>('#td-bc-leg')?.value || '';
    if (!legId) return;
    if (activeTab === 'acquired') {
      const existingId = m.root.querySelector<HTMLSelectElement>('#td-ac-existing')?.value;
      if (existingId) { await packStore.updateItem(list.id, existingId, { acquiredLegId: legId }); m.close(); return; }
      const name = (m.root.querySelector<HTMLInputElement>('#td-ac-name')?.value || '').trim();
      if (!name) { m.root.querySelector<HTMLInputElement>('#td-ac-name')?.focus(); return; }
      const cat = m.root.querySelector<HTMLSelectElement>('#td-ac-cat')?.value || 'gifts';
      const wG  = Math.max(0, parseFloat(m.root.querySelector<HTMLInputElement>('#td-ac-weight')?.value || '0') || 0) * 1000;
      const qty = Math.max(1, parseInt(m.root.querySelector<HTMLInputElement>('#td-ac-qty')?.value || '1', 10) || 1);
      await packStore.addItem(list.id, {
        name, category: cat, qty, unitWeightG: wG,
        containerId: null, priority: 'nice' as const,
        locked: false, packed: false, source: 'manual',
        acquiredLegId: legId, droppedLegId: null, consumable: false,
      });
    } else {
      const checked = [...m.root.querySelectorAll<HTMLInputElement>('#td-bc-drop-list input:checked')];
      await Promise.all(checked.map(cb => packStore.updateItem(list.id, cb.value, { droppedLegId: legId })));
    }
    m.close();
  });
}

function wire(body: HTMLElement): void {
  // Navigation clicks (widget tap-through).
  body.querySelectorAll<HTMLElement>('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('a, button:not([data-nav]), [data-quickadd], [data-rate-input], [data-journal-template], [data-todo-add-modal]')) return;
      const intent = el.dataset.intent ? (JSON.parse(el.dataset.intent) as NavIntent) : undefined;
      navigateTo(el.dataset.nav as ViewId, intent);
    });
  });

  // Pack widget: Acquired / Left behind quick actions → open bag change modal inline.
  body.querySelectorAll<HTMLElement>('[data-pk-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const list = _packLists[0];
      if (!list) return;
      const action = btn.dataset.pkAction as 'acquired' | 'left';
      openPackBagChangeModal(list, action);
    });
  });

  // Quick-add spend form.
  body.querySelector<HTMLFormElement>('[data-quickadd]')?.addEventListener('submit', e => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const amt  = parseFloat((form.querySelector('.td-quickadd-amt') as HTMLInputElement).value);
    const desc = (form.querySelector('.td-quickadd-desc') as HTMLInputElement).value.trim();
    const cat  = (form.querySelector('.td-quickadd-cat') as HTMLSelectElement).value;
    if (!Number.isFinite(amt) || amt <= 0) return;
    quickAddSpend(amt, desc, cat);
    (form.querySelector('.td-quickadd-amt') as HTMLInputElement).value  = '';
    (form.querySelector('.td-quickadd-desc') as HTMLInputElement).value = '';
    (form.querySelector('.td-quickadd-cat') as HTMLSelectElement).value = '';
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

  // Journal quick-entry template buttons — open the real journal composer.
  body.querySelectorAll<HTMLElement>('[data-journal-template]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openJournalComposerOverlay(btn.dataset.journalTemplate ?? 'moment');
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

  // Todo calendar-icon button → full modal with due date.
  body.querySelector<HTMLButtonElement>('[data-todo-add-modal]')?.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    openDashboardTodoModal(todayIso());
  });

  // Where-to-go: add to itinerary button
  body.querySelectorAll<HTMLButtonElement>('[data-wtg-add]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const title = btn.dataset.wtgAdd ?? '';
      const leg = currentLeg();
      if (!leg) return;
      const handle = openModal({
        title: '+ Add to itinerary',
        body: `
          <div style="display:flex;flex-direction:column;gap:12px">
            <input class="input" id="wtg-plan-title" value="${esc(title)}" placeholder="Activity name">
            <div style="display:flex;gap:8px;align-items:center">
              <label class="field-label" style="margin:0;white-space:nowrap;flex-shrink:0">Day</label>
              <input class="input" id="wtg-plan-date" type="date" value="${esc(todayIso())}">
            </div>
          </div>`,
        footer: `<button class="btn btn-ghost" data-act="cancel">Cancel</button>
                 <button class="btn btn-primary" data-act="confirm">Add</button>`,
      });
      handle.root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => handle.close());
      handle.root.querySelector('[data-act="confirm"]')?.addEventListener('click', async () => {
        const itemTitle = (handle.root.querySelector<HTMLInputElement>('#wtg-plan-title')?.value ?? '').trim();
        const dateVal   = handle.root.querySelector<HTMLInputElement>('#wtg-plan-date')?.value ?? todayIso();
        if (!itemTitle) return;
        const days = ensurePlanDaysLocal(leg);
        const targetDay = days.find(d => d.date === dateVal) ?? days[0];
        if (!targetDay) return;
        const existingPlans = (leg.plans ?? []) as PlanItem[];
        const maxOrder = existingPlans.filter(p => p.dayId === targetDay.id).reduce((m, p) => Math.max(m, p.order ?? 0), -1);
        const newItem: PlanItem = {
          id: `plan-${Date.now()}`,
          dayId: targetDay.id,
          title: itemTitle,
          category: '',
          done: false,
          order: maxOrder + 1,
        };
        await routeStore.update(leg.id, { plans: [...existingPlans, newItem] });
        handle.close();
      });
      handle.root.querySelector<HTMLInputElement>('#wtg-plan-title')?.select();
    });
  });

  // New trip button.
  body.querySelector<HTMLButtonElement>('[data-action="new-trip"]')?.addEventListener('click', () => {
    openNewTrip();
  });

  // Language picker (top-right of the greeting row). innerHTML wiped the old
  // node, so dispose the previous instance before mounting a fresh one.
  const langMount = body.querySelector<HTMLElement>('[data-lang-mount]');
  if (langMount) {
    _langPicker?.destroy();
    _langPicker = createLanguagePicker(langMount);
  }

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

}


function bootMap(): void {
  const canvas = document.getElementById('td-map-canvas') as HTMLElement | null;
  // Re-init whenever render() produces a new canvas element (innerHTML replacement).
  if (!canvas || canvas === _mapCanvas) return;
  _mapCanvas = canvas;
  void initDashboardMap(canvas, _legs);
}

/* ══════════════════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════════════════ */

export function initDashboard(): void {
  const root = document.getElementById('view-today');
  if (!root) return;

  _rates       = peekRateTable(baseCurrency());
  _legs        = routeStore.peek();
  _expenses    = expenseStore.peek();
  _journal     = journalStore.peek();
  _todos       = todoStore.peek();
  _nomadSpots  = nomadStore.peek();
  _cityIntel   = cityStore.peek();
  _citySafety  = safetyStore.peek();
  _mapCanvas   = null;
  _weather     = null;
  _weatherCity = '';
  disposeDashboardMap();
  render();

  _unsubs.forEach(u => u());
  _unsubs = [
    routeStore.subscribe(rows => { _legs = rows; _mapCanvas = null; disposeDashboardMap(); render(); }),
    expenseStore.subscribe(rows => { _expenses = rows; render(); }),
    journalStore.subscribe(rows => { _journal = rows; render(); }),
    todoStore.subscribe(rows => { _todos = rows; render(); }),
    packStore.subscribe(rows => { _packLists = rows; render(); }),
    nomadStore.subscribeForTrip(currentTripId(), rows => { _nomadSpots = rows; render(); }),
    cityStore.subscribe(rows => { _cityIntel = rows; render(); }),
    safetyStore.subscribe(rows => { _citySafety = rows; render(); }),
    onTripChange(() => {
      _nomadSpots = nomadStore.peek();
      _cityIntel  = cityStore.peek();
      _citySafety = safetyStore.peek();
      _mapCanvas = null; _weather = null; _weatherCity = '';
      disposeDashboardMap(); render();
    }),
    // Re-render on language change so greeting/widget labels update in place.
    onLocaleChange(() => { _mapCanvas = null; disposeDashboardMap(); render(); }),
  ];

  void getRateTable(baseCurrency()).then(table => { _rates = table; render(); });
}
