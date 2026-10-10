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
import {
  type Phase, todayIso as sharedTodayIso, daysBetween as sharedDaysBetween,
  tripPhase as sharedTripPhase, currentLeg as sharedCurrentLeg,
} from '../../data/trip-phase.ts';
import { addExpenseWithDefaults, defaultPlace, defaultCurrency, suggestedCurrency, BUILTIN_CATEGORIES as EXPENSE_CATEGORIES } from '../expenses/expense-defaults.ts';
import { currencySymbol, getRateTable, peekRateTable, type RateTable, allCurrencies, currencyFlag, isKnownCurrency, isApproxCurrency } from '../../data/rates.ts';
import { currencyForCountry } from '../../data/country-currency.ts';
import { navigateTo, type ViewId, type NavIntent, openNewTrip, openTripSwitcher } from '../../core/app.ts';
import { currentUser } from '../../firebase/auth.ts';
import { escHtml as esc } from '../../core/utils.ts';
import type { PlanItem, PlanDay } from '../../data/schema.ts';
import { initDashboardMap, disposeDashboardMap, dashboardMapZoom } from './dashboard-map.ts';
import { renderAlertBell, wireAlertBell } from './dashboard-alert-bell.ts';
import { PIN_COLORS } from '../map/map-status.ts';
import { renderAgendaWidget, wireAgenda, resetAgenda } from './dashboard-agenda.ts';
import { captureUiState, restoreUiState, swapHtml, createRenderScheduler, mapSignature } from './dashboard-render.ts';
import { renderJournalWidget, wireJournalAlbum, resetJournalAlbum } from './dashboard-journal.ts';
import { nomadStore, type StoredNomadSpot } from '../../data/stores/nomad-store.ts';
import { cityStore, type StoredCityIntel } from '../../data/stores/city-store.ts';
import { openModal } from '../../core/modal.ts';
import { t, onLocaleChange } from '../../core/i18n.ts';
import { mountPrefControls } from '../../core/pref-mounts.ts';
// Lazy (see call site below) — journal/index.ts pulls in Leaflet via capture.ts,
// which Dashboard shouldn't eagerly load just to wire up a click handler.
import { packStore, type StoredPackList } from '../../data/stores/pack-store.ts';
import { baggageRemainG } from '../../data/packing-formula.ts';
// From pack-helpers.ts (not pack.ts) so Dashboard's eager bundle doesn't pull
// in the full pack view module.
import { listTotalWeight } from '../pack/pack-helpers.ts';
import { openDashboardTodoModal, openPackBagChangeModal } from './dashboard-modals.ts';

/* ── State ───────────────────────────────────────────────────────────────── */
let _legs: StoredLeg[] = [];
let _expenses: StoredExpense[] = [];
let _journal: StoredJournalEntry[] = [];
let _todos:   StoredTodo[]         = [];
let _rates: RateTable = {};
let _rateInput = '';          // currency converter amount
let _rateFrom  = '';          // selected "from" currency (empty = baseCurrency())
let _rateTo    = '';          // selected "to" currency (empty = auto suggestedCurrency)
let _rateOpen  = false;       // converter panel expanded (not persisted — collapses on reload)
let _mapCanvas: HTMLElement | null = null; // tracks which canvas element the map was booted on
let _unsubs: Array<() => void> = [];
let _weather: { icon: string; tempHigh: string; tempLow: string; rainChance: number } | null = null;
let _weatherCity = '';
let _nomadSpots: StoredNomadSpot[] = [];
let _cityIntel: StoredCityIntel[] = [];
let _packLists: StoredPackList[] = [];

/* ── Helpers ─────────────────────────────────────────────────────────────── */
// Phase/countdown math now lives in data/trip-phase.ts (shared with the
// Prepare view's phase strip) — these wrap it against this module's own
// _legs so the ~20 zero-arg call sites below don't all need touching.
function todayIso(): string { return sharedTodayIso(); }
function daysBetween(a: string, b: string): number { return sharedDaysBetween(a, b); }
function tripPhase(): Phase { return sharedTripPhase(_legs); }
function currentLeg(): StoredLeg | null { return sharedCurrentLeg(_legs); }
function sortedLegs(): StoredLeg[] {
  return [..._legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
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
    const hourly: Array<{ chanceofrain?: string }> = todayForecast?.hourly ?? [];
    const rainChance = hourly.reduce((m, h) => Math.max(m, Number(h.chanceofrain) || 0), 0);
    _weather = { icon, tempHigh, tempLow, rainChance };
    scheduleRender();
  } catch { /* silent — weather is decorative */ }
}

/* ── Currency pair for the rate line / converter ─────────────────────────── */
/** The currency worth showing against base right now: geography corrected by
 *  recent spending (see suggestedCurrency). If it collapses to the base
 *  itself, fall back to the first other currency on the trip. */
function localCurrency(): string {
  const base = baseCurrency();
  const cur = suggestedCurrency(_legs, _expenses, todayIso());
  if (cur !== base) return cur;
  return tripCurrencies().find(c => c !== base) ?? (base === 'EUR' ? 'USD' : 'EUR');
}
function tripCurrencies(): string[] {
  const base = baseCurrency();
  // Always show CNY (user's home currency) + base + trip-leg currencies, deduped
  const seen = new Set<string>(['CNY', base]);
  for (const leg of _legs) {
    const c = currencyForCountry(leg.country);
    if (c && isKnownCurrency(c)) seen.add(c);
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
        ${renderAlertBell({ expenses: _expenses, legs: _legs, todos: _todos, today: todayIso(), inBase })}
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

  // The hero's wording carries the trip's stage — layout stays identical.
  let anchor = '';
  let cta = '';
  const today = todayIso();

  if (phase === 'before' && leg) {
    const d = daysBetween(today, leg.dateFrom);
    const lead = d <= 0 ? esc(t('dash.hero.departToday'))
      : t(d === 1 ? 'dash.dayToGo' : 'dash.daysToGo', { n: `<strong>${d}</strong>` });
    anchor = `${lead} · ${esc(t('dash.hero.nextStop', { place: `${leg.flag} ${leg.city}` }))}`;
  } else if (phase === 'during' && leg) {
    const idx  = legs.findIndex(l => l.id === leg.id) + 1;
    const dayN = daysBetween(leg.dateFrom, today) + 1;
    const tot  = daysBetween(leg.dateFrom, leg.dateTo) + 1;
    const lastDay = legs.length > 0 && today === legs[legs.length - 1].dateTo;
    anchor = [
      `${esc(leg.flag)} ${esc(leg.city)}`,
      esc(t('dash.hero.stop', { i: idx, n: legs.length })),
      esc(t('dash.agenda.dayOf', { n: dayN, total: tot })),
      lastDay ? `🏁 ${esc(t('dash.agenda.hint.lastDay'))}` : '',
    ].filter(Boolean).join(' · ');
  } else if (phase === 'after') {
    const countries = new Set(legs.map(l => l.country)).size;
    const len = trip ? daysBetween(trip.startDate, trip.endDate) + 1 : null;
    anchor = [
      esc(t('dash.hero.complete')),
      len ? esc(t('dash.hero.days', { n: len })) : '',
      countries ? esc(t('dash.hero.countries', { n: countries })) : '',
      legs.length ? esc(t('dash.hero.stops', { n: legs.length })) : '',
    ].filter(Boolean).join(' · ');
    cta = `<button type="button" class="td-hero-cta" data-nav="journal">${esc(t('dash.hero.recap'))}</button>`;
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
        ${_weather.rainChance >= 40 ? `<div class="td-hero-weather-rain" title="Chance of rain today">☔ ${_weather.rainChance}%</div>` : ''}
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
          <button type="button" class="td-hero-name" data-trip-switch aria-haspopup="true" title="${esc(t('app.currentTripPill'))}">
            <span class="td-hero-name-text">${esc(name)}</span>
            <span class="td-hero-name-caret" aria-hidden="true">▾</span>
          </button>
          ${anchor ? `<div class="td-hero-anchor">${anchor}</div>` : ''}
          ${cta}
          ${renderRateLine()}
        </div>
      </div>
      <img class="td-hero-logo" src="${ART}logo-sm.webp" alt="On the Road" loading="lazy" decoding="async">
    </div>`;
}

/* ── Currency widget ──────────────────────────────────────────────────────── */
function currencyOptions(selected: string): string {
  return allCurrencies().map(c =>
    `<option value="${esc(c.code)}" ${c.code === selected ? 'selected' : ''}>${c.flag} ${c.code}</option>`
  ).join('');
}

/** Base-units worth of 1 unit of `code` (i.e. how "valuable" a currency is vs base). */
function unitValueInBase(code: string): number {
  const base = baseCurrency();
  if (code === base) return 1;
  return _rates[code] ?? 0;
}

/** Order a pair so the stronger (more valuable) currency sits on the left,
 *  matching convention: 1 EUR = 7.95 CNY, 1 CNY = 24 JPY. */
function strongerFirst(a: string, b: string): [string, string] {
  return unitValueInBase(a) >= unitValueInBase(b) ? [a, b] : [b, a];
}

function flagFor(code: string): string {
  return currencyFlag(code);
}

/** One line in the hero: "1 EUR = 7.46 DKK ▾". Click toggles the converter. */
function renderRateLine(): string {
  const base = baseCurrency();
  const [left, right] = strongerFirst(base, localCurrency());
  const l = unitValueInBase(left), r = unitValueInBase(right);
  const known = isKnownCurrency(right) && l > 0 && r > 0;
  const eq = known ? `1 ${flagFor(left)} ${esc(left)} = <strong>${(l / r).toFixed(2)}</strong> ${flagFor(right)} ${esc(right)}` 
                   : `${flagFor(left)} ${esc(left)} → ${esc(right)} · ${esc(t('currency.rateUnavailable'))}`;
  return `
    <button type="button" class="td-hero-rate${_rateOpen ? ' is-open' : ''}" data-rate-toggle aria-expanded="${_rateOpen}" title="${esc(t('dash.widget.currency'))}">
      <span>${eq}${known && isApproxCurrency(right) ? ` <em title="${esc(t('currency.approx'))}">≈</em>` : ''}</span>
      <span class="td-hero-rate-caret" aria-hidden="true">▾</span>
    </button>`;
}

/** Expanded converter + a few reference rates, shown under the hero. */
function renderRatePanel(): string {
  if (!_rateOpen) return '';
  const base = baseCurrency();
  // Default the converter with the stronger currency on the left.
  const [defFrom, defTo] = strongerFirst(base, localCurrency());
  const fromCur = _rateFrom || defFrom;
  const toCur   = _rateTo   || defTo;

  const cross = crossRate();
  const inputAmt = _rateInput !== '' ? parseFloat(_rateInput) : null;
  const converted = (inputAmt != null && cross != null) ? (inputAmt * cross).toFixed(2) : '';

  // 3 rate info rows: always show 3 different non-base currencies.
  // Priority: trip leg currencies, then common fallbacks.
  const fallbacks = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'DKK', 'SEK'];
  const candidates = [localCurrency(), ...tripCurrencies(), ...fallbacks];
  const seen3 = new Set<string>();
  for (const c of candidates) {
    if (c !== base && isKnownCurrency(c) && unitValueInBase(c) > 0 && !seen3.has(c)) seen3.add(c);
    if (seen3.size === 3) break;
  }
  // Each row: put the stronger currency on the left, show "1 STRONG = N.NN WEAK".
  const rateRowsHtml = Array.from(seen3).map(code => {
    const [left, right] = strongerFirst(base, code);
    const perLeft = (unitValueInBase(left) / unitValueInBase(right)).toFixed(2);
    return `<div class="td-cur-rate-row"><span>${flagFor(left)} ${esc(left)}</span><span class="td-cur-rate-eq">=</span><span><strong>${perLeft}</strong> ${flagFor(right)} ${esc(right)}</span></div>`;
  }).join('');

  return `
    <div class="td-widget td-rate-panel">
      <div class="td-widget-header">
        <div class="td-widget-label">💱 ${esc(t('dash.widget.currency'))}</div>
        <span class="td-cur-source">${esc(t('dash.currency.source'))}</span>
      </div>
      <div class="td-cur-converter">
        <div class="td-cur-conv-row">
          <div class="td-cur-conv-side">
            <input class="td-currency-input" data-rate-input type="text" inputmode="decimal" placeholder="1" value="${esc(_rateInput)}">
            <select class="td-cur-select" data-rate-from>${currencyOptions(fromCur)}</select>
          </div>
          <button class="td-currency-swap" data-rate-swap title="${esc(t('dash.currency.swap'))}">⇄</button>
          <div class="td-cur-conv-side td-cur-conv-result">
            <span class="td-currency-value">${esc(converted || (cross != null ? cross.toFixed(2) : '—'))}</span>
            <select class="td-cur-select" data-rate-to>${currencyOptions(toCur)}</select>
          </div>
        </div>
      </div>
      <div class="td-cur-rates">${rateRowsHtml}</div>
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
        <div class="td-widget-label">💶 ${esc(t('dash.widget.spend'))}</div>
        <button class="td-link" data-nav="expenses">${esc(t('dash.link.allExpenses'))}</button>
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
        <div class="td-quickadd-hint">📍 ${esc(leg?.country || '—')}${leg?.city ? ' · ' + esc(leg.city) : ''} · ${currencySymbol(defaultCurrency(_legs, today))}${defaultCurrency(_legs, today)}</div>
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
        <div class="td-widget-label">🗺️ ${esc(t('dash.widget.routeMap'))}</div>
        <button class="td-link" data-nav="map">${esc(t('dash.link.fullMap'))}</button>
      </div>
      <div class="td-map-wrap">
        <div class="td-map-container" id="td-map-canvas"></div>
        <div class="td-map-zoom-controls">
          <button class="td-map-zoom-btn" id="tdMapZoomIn"  title="Zoom in">+</button>
          <button class="td-map-zoom-btn" id="tdMapZoomFit" title="Fit to route">⊡</button>
          <button class="td-map-zoom-btn" id="tdMapZoomOut" title="Zoom out">−</button>
        </div>
        <div class="td-map-legend">
          <span><span class="td-map-dot" style="background:${PIN_COLORS.current}"></span>${esc(t('dash.map.now'))}</span>
          <span><span class="td-map-dot" style="background:${PIN_COLORS.future}"></span>${esc(t('dash.map.upcoming'))}</span>
          <span><span class="td-map-dot" style="background:${PIN_COLORS.past}"></span>${esc(t('dash.map.past'))}</span>
        </div>
      </div>
    </div>`;
}

/* Plan days for a leg (padded from its date range) — used by Where-to-go → add to itinerary. */
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
        <div class="td-widget-label">☑️ ${esc(t('dash.widget.todo'))}</div>
        <button class="td-link" data-nav="calendar">${esc(t('dash.link.allTasks'))}</button>
      </div>
      <div class="td-todo-list">${rows}${empty}</div>
      <form class="td-todo-add" data-todo-add>
        <button class="td-todo-add-cal" type="button" data-todo-add-modal title="Add with due date">📅</button>
        <input class="td-todo-add-input" type="text" placeholder="+ Quick add task…">
        <button class="btn btn-primary td-todo-add-btn" type="submit">Add</button>
      </form>
    </div>`;
}

/* Pack only matters near a flight: show it when the next leg with a baggage
   allowance starts within 2 days (or today). */
function packVisible(): boolean {
  if (!_packLists[0]) return false;
  const today = todayIso();
  const next = sortedLegs().find(l => l.dateFrom >= today && l.arrivalTransport?.baggageAllowanceG);
  return !!next && daysBetween(today, next.dateFrom) <= 2;
}

/* ── Pack widget ─────────────────────────────────────────────────────────── */
function renderPackWidget(): string | null {
  const list = _packLists[0];
  if (!list || !packVisible()) return null;

  const sLegs = [..._legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const today = todayIso();
  const curLeg = sLegs.find(l => l.dateFrom <= today && l.dateTo >= today)
    ?? sLegs.find(l => l.dateFrom >= today)
    ?? sLegs[sLegs.length - 1];

  const totalG = listTotalWeight(list);
  const remainG = curLeg ? baggageRemainG(list.items, sLegs, curLeg.id) : null;
  const nextLegWithAllowance = sLegs.find(l => l.dateFrom >= today && l.arrivalTransport?.baggageAllowanceG);
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
        <div class="td-widget-label">🎒 ${esc(t('dash.widget.pack'))} <span class="td-pk-header-weight ${isOver ? 'is-over' : ''}">${kgDisplay}</span></div>
        <button class="td-link" data-nav="prep" data-intent='${esc(JSON.stringify({ listId: list.id }))}'>${esc(t('dash.link.openPack'))}</button>
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
        <div class="td-widget-label">💻 ${esc(t('dash.widget.workSpots'))} · ${esc(leg.city)}</div>
        <button class="td-link" data-nav="nomad">${esc(t('dash.link.allSpots'))}</button>
      </div>
      <div class="td-nomad-cards">${cards}</div>
    </div>`;
}

/* ── Where-to-Go widget — one pick per category, with add-to-itinerary ──────── */
function renderWhereToGoWidget(withPack: boolean): string {
  const cls = `td-w-whereto${withPack ? '' : ' td-w-whereto--solo'}`;
  const leg = currentLeg();
  if (!leg) {
    return `
      <div class="td-widget ${cls}">
        <div class="td-widget-label">✨ ${esc(t('dash.widget.whereToGo'))}</div>
        <div class="td-whereto-empty">Add stops in Route view to get recommendations.</div>
      </div>`;
  }

  const intel = _cityIntel.find(c =>
    c.city.toLowerCase() === leg.city.toLowerCase()
  );

  if (!intel || (!intel.attractions?.length && !intel.restaurants?.length && !intel.experiences?.length && !intel.cafes?.length)) {
    return `
      <div class="td-widget ${cls}">
        <div class="td-widget-header">
          <div class="td-widget-label">✨ ${esc(t('dash.widget.whereToGo'))} · ${esc(leg.flag)} ${esc(leg.city)}</div>
          <button class="td-link" data-nav="cities">${esc(t('dash.link.guide'))}</button>
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
    <div class="td-widget ${cls}">
      <div class="td-widget-header">
        <div class="td-widget-label">✨ ${esc(t('dash.widget.whereToGo'))} · ${esc(leg.flag)} ${esc(leg.city)}</div>
        <button class="td-link" data-nav="cities">${esc(t('dash.link.guide'))}</button>
      </div>
      <div class="td-whereto-cards">${cards}</div>
    </div>`;
}

/* ── Layout ───────────────────────────────────────────────────────────────── */
function layout(_phase: Phase): string {
  const agendaWidget = renderAgendaWidget({ legs: _legs, journal: _journal, todos: _todos, expenses: _expenses }, todayIso());
  const todoWidget  = renderTodoWidget();
  const spendWidget = renderSpendWidget();
  const mapWidget   = renderMapWidget();
  const jrnWidget   = renderJournalWidget(_journal, _legs);
  const nomadHtml   = renderNomadWidget();
  const whereHtml   = renderWhereToGoWidget(!!renderPackWidget());
  const packHtml    = renderPackWidget();

  return `<div class="td-grid" id="td-grid">
    ${agendaWidget}
    ${mapWidget}
    ${spendWidget}
    ${jrnWidget}
    ${todoWidget}
    ${packHtml ? `<div class="td-w-mini-col">${packHtml}</div>` : ''}
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
  const [defFrom, defTo] = strongerFirst(base, localCurrency());
  const fromCur = _rateFrom || defFrom;
  const toCur   = _rateTo   || defTo;
  const rateToBase   = fromCur === base ? 1 : (_rates[fromCur] ? (1 / _rates[fromCur]) : null);
  const rateFromBase = toCur === base ? 1 : (_rates[toCur] ? (1 / _rates[toCur]) : null);
  return (rateToBase != null && rateFromBase != null) ? rateFromBase / rateToBase : null;
}

function updateConverterResult(body: HTMLElement): void {
  const rate = crossRate();
  const amt  = parseFloat(_rateInput);
  const result = (rate != null && Number.isFinite(amt) && amt > 0)
    ? (amt * rate).toFixed(2)
    : (rate != null ? rate.toFixed(2) : '—');
  const span = body.querySelector<HTMLElement>('.td-currency-value');
  if (span) span.textContent = result;
}

function render(): void {
  const body = document.querySelector<HTMLElement>('#view-today .today-body');
  if (!body) return;
  const phase = tripPhase();
  // A rebuild must be invisible: carry typed text + focus across, and keep the
  // (expensive, async-built) map canvas node instead of recreating the map.
  const ui = captureUiState(body);
  swapHtml(body, `${renderGreeting()}${renderHero(phase)}${renderRatePanel()}${layout(phase)}`, '#td-map-canvas');
  wire(body);
  restoreUiState(body, ui);
  bootMap();
}

/** Store callbacks go through this so a burst (eight listeners all fire once at
 *  start-up, then weather/FX land) renders once. User actions call render() directly. */
const scheduleRender = createRenderScheduler(render);
let _mapSig = '';


function wire(body: HTMLElement): void {
  // Hero trip name → trip switcher / share menu. This is the only way to switch
  // or share trips on mobile/PWA, where the sidebar (and its trip pill) is hidden.
  body.querySelector<HTMLElement>('[data-trip-switch]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openTripSwitcher(e.currentTarget as HTMLElement);
  });

  // Navigation clicks (widget tap-through).
  body.querySelectorAll<HTMLElement>('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('a, button:not([data-nav]), [data-quickadd], [data-rate-input], [data-journal-new], [data-todo-add-modal]')) return;
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
      openPackBagChangeModal(list, action, _legs);
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

  // Hero rate line → expand/collapse the converter.
  body.querySelector<HTMLElement>('[data-rate-toggle]')?.addEventListener('click', () => {
    _rateOpen = !_rateOpen;
    render();
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
    const [defFrom, defTo] = strongerFirst(baseCurrency(), localCurrency());
    const tmp = _rateFrom || defFrom;
    _rateFrom = _rateTo   || defTo;
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

  // Journal quick-entry button — opens the real journal composer as an overlay.
  body.querySelectorAll<HTMLElement>('[data-journal-new]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      import('../journal/index.ts').then(m => m.openJournalComposerOverlay());
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

  wireAgenda(body, render);
  wireJournalAlbum(body);
  wireAlertBell(body, render);
  // Language + theme controls (top-right of the greeting row).
  const langMount = body.querySelector<HTMLElement>('[data-lang-mount]');
  if (langMount) mountPrefControls(langMount);

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
  _mapCanvas   = null;
  _mapSig      = mapSignature(_legs);
  _weather     = null;
  _weatherCity = '';
  resetAgenda();
  resetJournalAlbum();
  disposeDashboardMap();
  render();

  _unsubs.forEach(u => u());
  _unsubs = [
    routeStore.subscribe(rows => {
      _legs = rows;
      // Only rebuild the map if what it draws changed — ticking a plan item or
      // editing a note also arrives as a route update.
      const sig = mapSignature(rows);
      if (sig !== _mapSig) { _mapSig = sig; _mapCanvas = null; disposeDashboardMap(); }
      scheduleRender();
    }),
    expenseStore.subscribe(rows => { _expenses = rows; scheduleRender(); }),
    journalStore.subscribe(rows => { _journal = rows; scheduleRender(); }),
    todoStore.subscribe(rows => { _todos = rows; scheduleRender(); }),
    packStore.subscribe(rows => { _packLists = rows; scheduleRender(); }),
    nomadStore.subscribeForTrip(currentTripId(), rows => { _nomadSpots = rows; scheduleRender(); }),
    cityStore.subscribe(rows => { _cityIntel = rows; scheduleRender(); }),
    onTripChange(() => {
      _nomadSpots = nomadStore.peek();
      _cityIntel  = cityStore.peek();
      _mapCanvas = null; _mapSig = ''; _weather = null; _weatherCity = '';
      resetAgenda();
      resetJournalAlbum();
      disposeDashboardMap(); scheduleRender();
    }),
    // Re-render on language change so greeting/widget labels update in place
    // (the map has no localized text, so it is kept as-is).
    onLocaleChange(() => { scheduleRender(); }),
  ];

  void getRateTable(baseCurrency()).then(table => { _rates = table; scheduleRender(); });
}
