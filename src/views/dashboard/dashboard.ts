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
  type Phase, todayIso as sharedTodayIso,
  tripPhase as sharedTripPhase, currentLeg as sharedCurrentLeg,
} from '../../data/trip-phase.ts';
import { addExpenseWithDefaults, defaultPlace, defaultCurrency, suggestedCurrency, BUILTIN_CATEGORIES as EXPENSE_CATEGORIES } from '../expenses/expense-defaults.ts';
import { currencySymbol, getRateTable, peekRateTable, type RateTable, allCurrencies, currencyFlag, isKnownCurrency, isApproxCurrency } from '../../data/rates.ts';
import { currencyForCountry } from '../../data/country-currency.ts';
import { navigateTo, type ViewId, type NavIntent, openNewTrip, openTripSwitcher } from '../../core/app.ts';
import { currentUser } from '../../firebase/auth.ts';
import { escHtml as esc } from '../../core/utils.ts';
import type { PlanItem } from '../../data/schema.ts';
import { initDashboardMap, disposeDashboardMap, dashboardMapZoom } from './dashboard-map.ts';
import { dayMapModel, type DayMapPoint } from '../../data/day-map.ts';
import { agendaForDay } from '../../data/day-agenda.ts';
import { geocode, geocodeLocal } from '../map/geocode.ts';
import { openStaysDrawer } from './banner-drawers.ts';
import { openAgendaItemDrawer } from './agenda-drawer.ts';
import { openSpendDrawer } from './spend-drawer.ts';
import { renderAlertBell, wireAlertBell } from './dashboard-alert-bell.ts';
import { PIN_COLORS } from '../map/map-status.ts';
import { AGENDA_COLORS } from '../../data/day-agenda.ts';
import { renderAgendaWidget, wireAgenda, resetAgenda, shownAgendaDay } from './dashboard-agenda.ts';
import { renderTodoWidget } from './dashboard-todo.ts';
import { renderPackWidget, wirePack } from './dashboard-pack.ts';
import { renderWhereTo, wireWhereTo, resetWhereTo } from './dashboard-whereto.ts';
import { captureUiState, restoreUiState, swapHtml, createRenderScheduler, mapSignature } from './dashboard-render.ts';
import { renderJournalWidget, wireJournal } from './dashboard-journal.ts';
import { nomadStore, type StoredNomadSpot } from '../../data/stores/nomad-store.ts';
import { cityStore, type StoredCityIntel } from '../../data/stores/city-store.ts';
import { t, onLocaleChange, getLocale } from '../../core/i18n.ts';
import { appNow, onSimChange, isSimulating } from '../../data/sim-clock.ts';
import { expensesAsOf, todosAsOf, daySpend } from '../../data/as-of.ts';
import { renderSimControl, wireSimControl } from './dashboard-simclock.ts';
import { mountPrefControls } from '../../core/pref-mounts.ts';
// Lazy (see call site below) — journal/index.ts pulls in Leaflet via capture.ts,
// which Dashboard shouldn't eagerly load just to wire up a click handler.
import { packStore, type StoredPackList } from '../../data/stores/pack-store.ts';
import { openDashboardTodoModal, openAddPlanModal } from './dashboard-modals.ts';
import { renderBanner, wireBanner, startBannerClock, type BannerData } from './dashboard-banner.ts';
import { userPrefsStore } from '../../data/stores/user-prefs-store.ts';
import { resolveHomeTimezone } from '../../data/home-timezone.ts';

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
let _mapMode: 'day' | 'trip' | null = null; // user's pick; null = automatic (day, or whole trip once it's over)
let _mapBootMode: 'day' | 'trip' | null = null; // which mode the current canvas was booted for
const _geoTried = new Set<string>();         // place lookups already attempted this session
let _unsubs: Array<() => void> = [];
let _weather: { icon: string; tempHigh: string; tempLow: string; rainChance: number } | null = null;
let _weatherCity = '';
let _nomadSpots: StoredNomadSpot[] = [];
let _cityIntel: StoredCityIntel[] = [];
let _packLists: StoredPackList[] = [];
let _homeTzPref = '';           // Profile → Home time zone ('' = infer)

/** True while the time-travel control has the Dashboard looking at another day. */
function lookingBack(): boolean { return isSimulating(); }

/* ── Helpers ─────────────────────────────────────────────────────────────── */
// Phase/countdown math now lives in data/trip-phase.ts (shared with the
// Prepare view's phase strip) — these wrap it against this module's own
// _legs so the ~20 zero-arg call sites below don't all need touching.
function todayIso(): string { return sharedTodayIso(); }
function tripPhase(): Phase { return sharedTripPhase(_legs); }
function currentLeg(): StoredLeg | null { return sharedCurrentLeg(_legs); }
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
  const h = appNow().getHours();
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
        ${renderSimControl()}
        ${renderAlertBell({ expenses: _expenses, legs: _legs, todos: _todos, today: todayIso(), inBase })}
        <button class="btn btn-ghost td-new-trip-btn" data-action="new-trip">${esc(t('common.newTrip'))}</button>
        <div class="td-lang-mount" data-lang-mount></div>
      </div>
    </div>`;
}

/* ── Hero banner ─────────────────────────────────────────────────────────── */
function bannerData(phase: Phase): BannerData {
  const trip = currentTrip();
  return {
    phase,
    legs: _legs,
    trip: trip ? { startDate: trip.startDate, endDate: trip.endDate } : null,
    today: todayIso(),
    homeTz: resolveHomeTimezone(_homeTzPref, trip?.homeCity, _legs),
  };
}

function renderHero(phase: Phase): string {
  const trip = currentTrip();
  const name = trip?.name ?? 'Your trip';
  const leg  = currentLeg();
  const ART  = `${(import.meta as any).env.BASE_URL}art/`.replace(/\/{2,}/g, '/');

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
        ${_weather.rainChance >= 40 ? `<div class="td-hero-weather-rain" title="${esc(t('dash.hero.rain'))}">☔ ${_weather.rainChance}%</div>` : ''}
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
        <button type="button" class="td-hero-name td-hero-name--mobile" data-trip-switch aria-haspopup="true" title="${esc(t('app.currentTripPill'))}">
          <span class="td-hero-name-text">${esc(name)}</span>
          <span class="td-hero-name-caret" aria-hidden="true">▾</span>
        </button>
        ${weatherBlock}
        ${renderBanner(bannerData(phase))}
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

/** One line under the Spend progress bar: "1 EUR = 7.46 DKK ▾". Click opens the converter dropdown. */
function renderRateLine(): string {
  const base = baseCurrency();
  const [left, right] = strongerFirst(base, localCurrency());
  const l = unitValueInBase(left), r = unitValueInBase(right);
  const known = isKnownCurrency(right) && l > 0 && r > 0;
  const eq = known ? `1 ${flagFor(left)} ${esc(left)} = <strong>${(l / r).toFixed(2)}</strong> ${flagFor(right)} ${esc(right)}` 
                   : `${flagFor(left)} ${esc(left)} → ${esc(right)} · ${esc(t('currency.rateUnavailable'))}`;
  return `
    <button type="button" class="td-rate-line${_rateOpen ? ' is-open' : ''}" data-rate-toggle aria-expanded="${_rateOpen}" title="${esc(t('dash.widget.currency'))}">
      <span>${eq}${known && isApproxCurrency(right) ? ` <em title="${esc(t('currency.approx'))}">≈</em>` : ''}</span>
      <span class="td-rate-caret" aria-hidden="true">▾</span>
    </button>`;
}

/** Converter dropdown anchored under the rate line (switch currencies + calculate). */
function renderRatePopover(): string {
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
    <div class="td-rate-pop" role="dialog" aria-label="${esc(t('dash.widget.currency'))}">
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
  const today     = todayIso();
  // Looking back at a day: spend counts up to and on that day only.
  const asOf      = lookingBack() ? today : null;
  const rows      = expensesAsOf(_expenses, asOf);
  const total     = rows.reduce((s, e) => s + inBase(e), 0);
  const todaySpend = rows.filter(e => e.date === today).reduce((s, e) => s + inBase(e), 0);
  const budget    = tripBudget();
  const day       = daySpend(rows, today, inBase);
  const dayLine   = day.count
    ? `${t(day.count === 1 ? 'dash.spend.entry1' : 'dash.spend.entries', { n: day.count })} · ${day.top.map(c => `${EXPENSE_CATEGORIES.find(k => k.id === c.category)?.icon ?? '💶'} ${fmt(c.amount)}`).join(' · ')}`
    : t('dash.spend.dayNone');
  const dayLabel  = asOf ? new Date(`${today}T00:00:00`).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' }) : t('dash.spend.today');

  // Prefer the current country's budget when one is set — it's the more
  // actionable number while you're there; otherwise fall back to the total.
  const curCountry = currentLeg()?.country ?? '';
  const countryCap = curCountry ? countryBudgets()[curCountry] : undefined;
  let budgetLine = '';
  if (countryCap) {
    const spent = rows.filter(e => e.country === curCountry).reduce((s, e) => s + inBase(e), 0);
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
        <button type="button" class="td-plus" data-spend-open="form" title="${esc(t('dash.spend.addTitle'))}" aria-label="${esc(t('dash.spend.addTitle'))}">+</button>
      </div>
      <div class="td-spend-top">
        <button type="button" class="td-spend-total" data-spend-open="list" title="${esc(t('dash.spend.recent'))}"><div class="td-spend-label">${esc(t('dash.spend.total'))}</div><div class="td-spend-big">${fmt(total)}</div></button>
        <div class="td-spend-today"><div class="td-spend-label">${esc(dayLabel)}</div><div class="td-spend-mid">${fmt(todaySpend)}</div></div>
      </div>
      ${budgetLine}
      <div class="td-spend-day" title="${esc(dayLine)}">${esc(dayLine)}</div>
      <div class="td-rate-anchor">
        ${renderRateLine()}
        ${_rateOpen ? renderRatePopover() : ''}
      </div>
      <form class="td-quickadd td-quickadd-v" data-quickadd>
        <div class="td-quickadd-hint">📍 ${esc(leg?.country || '—')}${leg?.city ? ' · ' + esc(leg.city) : ''} · ${currencySymbol(defaultCurrency(_legs, today))}${defaultCurrency(_legs, today)}</div>
        <div class="td-quickadd-row2">
          <div class="td-quickadd-amt-wrap">
            <span class="td-quickadd-sym">${sym}</span>
            <input class="td-quickadd-amt" type="text" inputmode="decimal" placeholder="0.00" required>
          </div>
          <select class="td-quickadd-cat select" aria-label="${esc(t('dash.agenda.spendCategory'))}">
            <option value="">${esc(t('dash.agenda.spendCategory'))}…</option>
            ${EXPENSE_CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('')}
          </select>
          <button class="td-quickadd-save btn btn-primary" type="submit" title="${esc(t('common.save'))}" aria-label="${esc(t('common.save'))}">✓</button>
        </div>
      </form>
    </div>`;
}

/* ── Map ──────────────────────────────────────────────────────────────────── */
function mapMode(): 'day' | 'trip' {
  return _mapMode ?? (tripPhase() === 'after' ? 'trip' : 'day');
}

function renderMapWidget(): string {
  const mode = mapMode();
  const seg = (id: 'day' | 'trip', label: string) =>
    `<button type="button" class="ag-tab${mode === id ? ' is-active' : ''}" data-map-mode="${id}" aria-pressed="${mode === id}">${esc(label)}</button>`;
  const legend = mode === 'trip'
    ? `<span><span class="td-map-dot" style="background:${PIN_COLORS.current}"></span>${esc(t('dash.map.now'))}</span>
       <span><span class="td-map-dot" style="background:${PIN_COLORS.future}"></span>${esc(t('dash.map.upcoming'))}</span>
       <span><span class="td-map-dot" style="background:${PIN_COLORS.past}"></span>${esc(t('dash.map.past'))}</span>`
    : `<span>🏠 ${esc(t('dash.map.stay'))}</span><span><span class="td-map-dot" style="background:${AGENDA_COLORS.plan}"></span>${esc(t('dash.map.plans'))}</span>`;
  return `
    <div class="td-widget td-w-map">
      <div class="td-widget-header">
        <div class="td-widget-label">🗺️ ${esc(t('dash.widget.map'))}</div>
        <div class="ag-tabs">${seg('day', t('dash.map.day'))}${seg('trip', t('dash.map.trip'))}</div>
        <button class="td-link" data-nav="map">${esc(t('dash.link.fullMap'))}</button>
      </div>
      <div class="td-map-wrap" data-map-mode-now="${mode}">
        <div class="td-map-container" id="td-map-canvas"></div>
        <div class="td-map-note td-map-note--empty">${esc(t('dash.map.noPlaces'))}</div>
        <div class="td-map-note td-map-note--locating">${esc(t('dash.map.locating'))}</div>
        <div class="td-map-zoom-controls">
          <button class="td-map-zoom-btn" id="tdMapZoomIn"  title="${esc(t('dash.map.zoomIn'))}">+</button>
          <button class="td-map-zoom-btn" id="tdMapZoomFit" title="${esc(t('dash.map.fit'))}">⊡</button>
          <button class="td-map-zoom-btn" id="tdMapZoomOut" title="${esc(t('dash.map.zoomOut'))}">−</button>
        </div>
        <div class="td-map-legend">${legend}</div>
      </div>
    </div>`;
}

/* ── Layout ───────────────────────────────────────────────────────────────── */
function layout(_phase: Phase): string {
  const src = agendaSources();
  const today = todayIso();
  const selected = shownAgendaDay(src, today);
  const agendaWidget = renderAgendaWidget(src, today);
  const todoWidget  = renderTodoWidget(todosAsOf(_todos, lookingBack() ? today : null), selected, today);
  const packWidget  = renderPackWidget(_packLists[0], _legs, today);
  const spendWidget = renderSpendWidget();
  const mapWidget   = renderMapWidget();
  const jrnWidget   = renderJournalWidget(_journal, _legs, lookingBack() ? today : null);
  const whereHtml   = renderWhereTo({ legs: _legs, iso: selected, intel: _cityIntel, spots: _nomadSpots });

  return `<div class="td-grid" id="td-grid">
    ${agendaWidget}
    ${todoWidget}
    ${packWidget}
    ${mapWidget}
    ${spendWidget}
    ${jrnWidget}
    ${whereHtml}
  </div>`;
}

function agendaSources() {
  return { legs: _legs, journal: _journal, todos: _todos, expenses: _expenses };
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
  swapHtml(body, `${renderGreeting()}${renderHero(phase)}${layout(phase)}`, '#td-map-canvas');
  wire(body);
  restoreUiState(body, ui);
  bootMap();
}

/** Store callbacks go through this so a burst (eight listeners all fire once at
 *  start-up, then weather/FX land) renders once. User actions call render() directly. */
const scheduleRender = createRenderScheduler(render);
let _mapSig = '';


let _rateDismissWired = false;
/** Close the converter dropdown on an outside click or Escape. Attached once at
 *  document level because render() replaces the markup the handlers would live on. */
function wireRateDismiss(): void {
  if (_rateDismissWired) return;
  _rateDismissWired = true;
  document.addEventListener('click', (e) => {
    if (!_rateOpen) return;
    if ((e.target as HTMLElement | null)?.closest('.td-rate-anchor')) return;
    _rateOpen = false;
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _rateOpen) { _rateOpen = false; render(); }
  });
}

function wire(body: HTMLElement): void {
  wireRateDismiss();
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

  // Quick-add spend form.
  body.querySelector<HTMLFormElement>('[data-quickadd]')?.addEventListener('submit', e => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const amt  = parseFloat((form.querySelector('.td-quickadd-amt') as HTMLInputElement).value);
    const desc = '';
    const cat  = (form.querySelector('.td-quickadd-cat') as HTMLSelectElement).value;
    if (!Number.isFinite(amt) || amt <= 0) return;
    quickAddSpend(amt, desc, cat);
    (form.querySelector('.td-quickadd-amt') as HTMLInputElement).value  = '';
    (form.querySelector('.td-quickadd-cat') as HTMLSelectElement).value = '';
  });

  // Rate line (under the Spend bar) → open/close the converter dropdown.
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

  // Todo calendar-icon button → full modal with due date.
  body.querySelectorAll<HTMLButtonElement>('[data-todo-add-modal]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    openDashboardTodoModal(shownAgendaDay(agendaSources(), todayIso()));
  }));

  // Where-to-go: add to itinerary button
  body.querySelectorAll<HTMLButtonElement>('[data-wtg-add]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openAddPlanModal(_legs, { date: mapDay(), title: btn.dataset.wtgAdd ?? '' });
    });
  });

  // New trip button.
  body.querySelector<HTMLButtonElement>('[data-action="new-trip"]')?.addEventListener('click', () => {
    openNewTrip();
  });

  wireBanner(body, () => bannerData(tripPhase()), render);
  wireSimControl(body, () => { const tr = currentTrip(); return { trip: tr ? { startDate: tr.startDate, endDate: tr.endDate } : null, legs: _legs }; });
  wireWhereTo(body, render);
  wireAgenda(body, render, () => ({ src: agendaSources(), today: todayIso() }));
  wirePack(body, () => ({ list: _packLists[0], legs: _legs, today: todayIso() }));
  wireJournal(body, () => ({ entries: _journal, legs: _legs }));
  wireAlertBell(body, render);
  // Language + theme controls (top-right of the greeting row).
  const langMount = body.querySelector<HTMLElement>('[data-lang-mount]');
  if (langMount) mountPrefControls(langMount);

  // Spend: + → add form first; total → recent list first.
  body.querySelectorAll<HTMLElement>('[data-spend-open]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openSpendDrawer({ expenses: _expenses, asOf: lookingBack() ? todayIso() : null, legs: _legs, focus: btn.dataset.spendOpen as 'form' | 'list', trigger: btn });
    });
  });

  // Map: this day / whole trip.
  body.querySelectorAll<HTMLElement>('[data-map-mode]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const next = btn.dataset.mapMode as 'day' | 'trip';
      if (next === mapMode()) return;
      _mapMode = next;
      render();             // bootMap() sees the mode change and rebuilds the canvas
    });
  });
  const zoom = (a: 'in' | 'out' | 'fit') => (e: Event) => {
    e.stopPropagation();
    if (mapMode() === 'day') void import('./dashboard-daymap.ts').then(m => m.dayMapZoom(a));
    else dashboardMapZoom(a);
  };
  body.querySelector('#tdMapZoomIn')?.addEventListener('click', zoom('in'));
  body.querySelector('#tdMapZoomOut')?.addEventListener('click', zoom('out'));
  body.querySelector('#tdMapZoomFit')?.addEventListener('click', zoom('fit'));

}


function disposeMaps(): void {
  disposeDashboardMap();
  void import('./dashboard-daymap.ts').then(m => m.disposeDayMap());
}

/** The date the map is about: whatever the agenda is showing. */
function mapDay(): string {
  return shownAgendaDay(agendaSources(), todayIso());
}

function pickDayPoint(p: DayMapPoint): void {
  const iso = mapDay();
  const leg = _legs.find(l => l.id === p.legId);
  if (!leg) return;
  if (p.kind === 'stay') { openStaysDrawer(leg, iso, null); return; }
  const item = agendaForDay(iso, agendaSources()).items.find(i => i.id === p.id);
  if (item) openAgendaItemDrawer(item, { legs: _legs, iso, trigger: null });
}

function syncDay(canvas: HTMLElement): void {
  const model = dayMapModel(mapDay(), agendaSources(), (q, hint) => geocodeLocal(q) ?? (hint ? geocodeLocal(`${q}, ${hint}`) : null));
  const wrap = canvas.closest<HTMLElement>('.td-map-wrap');
  if (wrap) {
    const unresolved = model.pending.some(p => !_geoTried.has(p.id + p.query));
    wrap.dataset.dayState = !model.points.length && unresolved ? 'locating' : !model.points.length ? 'empty' : '';
  }
  void import('./dashboard-daymap.ts').then(m => m.syncDayMap(canvas, model, pickDayPoint));
  // Look up whatever the bundled table and cache couldn't place — once each,
  // then redraw. (A miss is remembered so a failing lookup can't loop.)
  for (const p of model.pending) {
    const key = p.id + p.query;
    if (_geoTried.has(key)) continue;
    _geoTried.add(key);
    void geocode(p.query, p.hint).then(hit => { if (hit) scheduleRender(); });
  }
}

function bootMap(): void {
  const canvas = document.getElementById('td-map-canvas') as HTMLElement | null;
  if (!canvas) return;
  const mode = mapMode();
  // (Re)build when render() produced a new canvas element, or the mode changed.
  if (canvas !== _mapCanvas || mode !== _mapBootMode) {
    disposeMaps();
    canvas.replaceChildren();
    _mapCanvas = canvas;
    _mapBootMode = mode;
    if (mode === 'trip') {
      void initDashboardMap(canvas, _legs, (legId) => {
        const leg = _legs.find(l => l.id === legId);
        if (leg) openStaysDrawer(leg, todayIso(), null);
      });
    }
  }
  if (mode === 'day') syncDay(canvas);
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
  _homeTzPref  = userPrefsStore.peek()?.homeTimezone ?? '';
  _mapCanvas   = null;
  _mapSig      = mapSignature(_legs);
  _weather     = null;
  _weatherCity = '';
  resetAgenda();
  resetWhereTo();
  _mapMode = null; _mapBootMode = null;
  disposeMaps();
  render();

  _unsubs.forEach(u => u());
  _unsubs = [
    routeStore.subscribe(rows => {
      _legs = rows;
      // Only rebuild the map if what it draws changed — ticking a plan item or
      // editing a note also arrives as a route update.
      const sig = mapSignature(rows);
      if (sig !== _mapSig) { _mapSig = sig; _mapCanvas = null; disposeMaps(); }
      scheduleRender();
    }),
    expenseStore.subscribe(rows => { _expenses = rows; scheduleRender(); }),
    journalStore.subscribe(rows => { _journal = rows; scheduleRender(); }),
    todoStore.subscribe(rows => { _todos = rows; scheduleRender(); }),
    packStore.subscribe(rows => { _packLists = rows; scheduleRender(); }),
    nomadStore.subscribeForTrip(currentTripId(), rows => { _nomadSpots = rows; scheduleRender(); }),
    cityStore.subscribe(rows => { _cityIntel = rows; scheduleRender(); }),
    userPrefsStore.subscribe(p => { const tz = p?.homeTimezone ?? ''; if (tz !== _homeTzPref) { _homeTzPref = tz; scheduleRender(); } }),
    onTripChange(() => {
      _nomadSpots = nomadStore.peek();
      _cityIntel  = cityStore.peek();
      _mapCanvas = null; _mapSig = ''; _weather = null; _weatherCity = ''; _mapMode = null;
      resetAgenda();
      resetWhereTo();
      disposeMaps(); scheduleRender();
    }),
    // Re-render on language change so greeting/widget labels update in place
    // (the map has no localized text, so it is kept as-is).
    onLocaleChange(() => { scheduleRender(); }),
    // Time-travel (testing aid): "today" changed, so selections and map mode start over.
    onSimChange(() => { resetAgenda(); resetWhereTo(); _mapMode = null; scheduleRender(); }),
  ];

  startBannerClock(todayIso);
  void getRateTable(baseCurrency()).then(table => { _rates = table; scheduleRender(); });
}
