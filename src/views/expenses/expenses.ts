/* ==========================================================================
   On the Road · Expenses tracker
   --------------------------------------------------------------------------
   Cloud-synced via expenseStore (Firestore source of truth; localStorage is an
   instant-paint cache inside the store layer). Every expense keeps the user's
   raw amount + currency, plus a snapshot of the conversion to the trip's base
   currency at record time (rate/baseAmount) so historical totals never drift.

   Smart defaults (in expense-defaults.ts, shared with the dashboard quick-add)
   remember the last currency / country / city you used, so logging a spend is
   usually just a number and a few words — you only touch the place when you
   actually move. Category may be left blank — those land in an "unclassified"
   pile you can tidy up afterwards.

   Layout: the landing surface is for *logging* (form) and *seeing* (summary +
   breakdown). The full transaction ledger lives behind a "All records" button
   as an in-view panel, so the landing stays light.
   ========================================================================== */

import './expenses.css';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import {
  baseCurrency, setBaseCurrency, tripBudget, setTripBudget,
  categoryBudgets, setCategoryBudget, countryBudgets, setCountryBudget,
  onTripChange, currentTripId,
} from '../../data/trip-context.ts';
import {
  expenseCategoryStore, type StoredExpenseCategory,
} from '../../data/stores/expense-category-store.ts';
import {
  CURRENCIES, currencySymbol, getRateTable, peekRateTable, type RateTable,
} from '../../data/rates.ts';
import { openModal } from '../../core/modal.ts';
import {
  lastUsed, legCountries, legCitiesFor, defaultPlace, defaultCurrency,
  convert, addExpenseWithDefaults, COUNTRY_CURRENCY,
} from './expense-defaults.ts';

interface Category { id: string; label: string; icon: string; color: string; builtin: boolean; }

const BUILTIN_CATEGORIES: Category[] = [
  { id: 'accommodation', label: 'Stay',      icon: '🏠', color: '#fde68a', builtin: true },
  { id: 'food',          label: 'Food',      icon: '🍜', color: '#bbf7d0', builtin: true },
  { id: 'transport',     label: 'Transport', icon: '🚆', color: '#bae6fd', builtin: true },
  { id: 'activities',    label: 'Activities',icon: '🎭', color: '#e9d5ff', builtin: true },
  { id: 'shopping',      label: 'Shopping',  icon: '🛍️', color: '#fecaca', builtin: true },
  { id: 'health',        label: 'Health',    icon: '💊', color: '#d1fae5', builtin: true },
  { id: 'misc',          label: 'Misc',      icon: '📌', color: '#f3f4f6', builtin: true },
];

/** Built-ins followed by the user's custom categories (sorted). */
function categories(): Category[] {
  const custom = [...customCategories]
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    .map((c) => ({ id: c.id, label: c.label, icon: c.icon, color: c.color, builtin: false }));
  return [...BUILTIN_CATEGORIES, ...custom];
}

function categoryById(id: string): Category | undefined {
  return categories().find((c) => c.id === id);
}

const UNCLASSIFIED = '';

let expenses: StoredExpense[] = [];
let legs: StoredLeg[] = [];
let customCategories: StoredExpenseCategory[] = [];
let rates: RateTable = {};
let selectedCategory = 'food';
// The place selected in the form right now (drives the country-budget reminder
// and what a new expense is tagged with). Seeded from remembered/leg defaults.
let formCountry = '';
let formCity = '';
let filterCategory = 'all';
let filterCity = 'all';
let analysisDim: AnalysisDim = 'category';
let showRecords = false;          // is the full-ledger panel open?
let unsub: (() => void) | null = null;
let unsubLegs: (() => void) | null = null;
let unsubCategories: (() => void) | null = null;
let unsubTripChange: (() => void) | null = null;

type AnalysisDim = 'category' | 'country' | 'city' | 'time';
const ANALYSIS_DIMS: { id: AnalysisDim; label: string }[] = [
  { id: 'category', label: 'Category' },
  { id: 'country',  label: 'Country' },
  { id: 'city',     label: 'City' },
  { id: 'time',     label: 'Time' },
];

/* ── Leg-aware helpers ───────────────────────────────────────────────────── */

/** Inclusive day-count between two ISO dates (>=1). */
function dayCount(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

/** Days the itinerary allocates to a country/city, from its legs. Falls back to
 *  the number of distinct days we have expenses for if the leg isn't known —
 *  so the per-day average stays meaningful even for ad-hoc places. */
function daysForPlace(key: 'country' | 'city', value: string): number {
  const matching = legs.filter((l) => l[key === 'country' ? 'country' : 'city'] === value);
  if (matching.length) {
    return matching.reduce((s, l) => s + dayCount(l.dateFrom, l.dateTo), 0);
  }
  const dates = new Set(expenses.filter((e) => e[key] === value).map((e) => e.date));
  return Math.max(1, dates.size);
}

/* ── CRUD ────────────────────────────────────────────────────────────────── */

function deleteExpense(id: string) {
  void expenseStore.remove(id);
}

/* ── Derived ─────────────────────────────────────────────────────────────── */

function getCities(): string[] {
  return [...new Set(expenses.map((e) => e.city).filter(Boolean))];
}

function filteredExpenses(): StoredExpense[] {
  return [...expenses]
    .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : b.createdAt - a.createdAt))
    .filter((e) =>
      (filterCategory === 'all' || e.category === filterCategory) &&
      (filterCity === 'all' || e.city === filterCity),
    );
}

/** Total in the *current* base currency. Each expense was snapshotted against
 *  whatever base was active then; if the user later switched base, re-express
 *  the snapshot via the live cross-rate (snapshot base → current base). */
function inBase(e: StoredExpense): number {
  const target = baseCurrency();
  if (e.baseCurrency === target) return e.baseAmount;
  const crossRate = rates[e.baseCurrency]; // current-base units per 1 snapshot-base unit
  return crossRate ? e.baseAmount * crossRate : e.baseAmount;
}

function total(list: StoredExpense[]): number {
  return list.reduce((s, e) => s + inBase(e), 0);
}

/** Total spent in a given country, in the current base currency. */
function countrySpend(country: string): number {
  return expenses.filter((e) => e.country === country).reduce((s, e) => s + inBase(e), 0);
}

function fmt(n: number): string {
  return `${currencySymbol(baseCurrency())}${Math.round(n).toLocaleString()}`;
}

function fmtRaw(amount: number, currency: string): string {
  return `${currencySymbol(currency)}${amount.toFixed(2)}`;
}

/* ── Render: summary ─────────────────────────────────────────────────────── */

function renderSummary(el: HTMLElement) {
  const sum = total(expenses);
  const days = new Set(expenses.map((e) => e.date)).size || 1;
  const dailyAvg = sum / days;
  const unclassified = expenses.filter((e) => e.category === UNCLASSIFIED).length;
  const budget = tripBudget();
  const sym = currencySymbol(baseCurrency());

  const budgetBlock = budget
    ? (() => {
        const remaining = budget - sum;
        const pct = Math.min(100, Math.round((sum / budget) * 100));
        const over = remaining < 0;
        const barColor = pct >= 100 ? 'var(--coral-500)' : pct >= 80 ? '#f59e0b' : 'var(--sage-500)';
        return `
          <button class="exp-budget-card" id="exp-budget-edit" title="Edit budgets">
            <div class="exp-budget-top">
              <div class="exp-budget-label">Budget</div>
              <span class="exp-budget-edit">✎</span>
            </div>
            <div class="exp-budget-amounts">
              <span class="exp-budget-spent">${fmt(sum)}</span>
              <span class="exp-budget-sep">/</span>
              <span class="exp-budget-total">${sym}${Math.round(budget).toLocaleString()}</span>
            </div>
            <div class="exp-budget-bar-track">
              <div class="exp-budget-bar-fill" style="width:${pct}%;background:${barColor}"></div>
            </div>
            <div class="exp-budget-footer">
              <span class="${over ? 'exp-budget-over' : 'exp-budget-remain'}">
                ${over ? `▲ ${fmt(-remaining)} over` : `${fmt(remaining)} remaining`}
              </span>
              <span class="exp-budget-pct">${pct}%</span>
            </div>
          </button>`;
      })()
    : `
      <button class="exp-budget-card exp-budget-empty" id="exp-budget-edit">
        <div class="exp-budget-label">Budget</div>
        <span class="exp-budget-set">Set a budget</span>
      </button>`;

  // Total card carries the "to sort" nudge as a corner chip rather than its own
  // stat slot, so we keep just three cards.
  const toSortChip = unclassified
    ? `<span class="exp-stat-chip" id="exp-tosort-chip">🗂️ ${unclassified} to sort</span>`
    : '';

  el.innerHTML = `
    <button class="exp-stat-card accent exp-stat-total" id="exp-open-records" title="See all records">
      ${toSortChip}
      <div class="exp-stat-num">${fmt(sum)}</div>
      <div class="exp-stat-label">Total spent <span class="exp-stat-cta">View all ›</span></div>
    </button>
    <div class="exp-stat-card">
      <div class="exp-stat-num">${fmt(dailyAvg)}</div>
      <div class="exp-stat-label">Daily avg</div>
    </div>
    ${budgetBlock}
  `;

  el.querySelector('#exp-budget-edit')?.addEventListener('click', () => openBudgetModal());
  el.querySelector('#exp-open-records')?.addEventListener('click', () => openRecords());
  el.querySelector('#exp-tosort-chip')?.addEventListener('click', (e) => {
    e.stopPropagation();
    filterCategory = UNCLASSIFIED;
    openRecords();
  });
}

/* ── Render: form ────────────────────────────────────────────────────────── */

function currencyOptions(selected: string): string {
  return CURRENCIES.map((c) =>
    `<option value="${c.code}" ${c.code === selected ? 'selected' : ''}>${c.flag} ${c.code} ${c.symbol}</option>`,
  ).join('');
}

const CUSTOM_PLACE = '__custom__';

function countryOptions(selected: string): string {
  const opts = legCountries(legs);
  const known = opts.map((c) =>
    `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
  // If the remembered/edited country isn't on the itinerary, keep it selectable.
  const extra = selected && !opts.includes(selected)
    ? `<option value="${selected}" selected>${selected}</option>` : '';
  return `<option value="">— Country —</option>${known}${extra}<option value="${CUSTOM_PLACE}">＋ Other…</option>`;
}

function cityOptions(country: string, selected: string): string {
  const opts = legCitiesFor(legs, country);
  const known = opts.map((c) =>
    `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
  const extra = selected && !opts.includes(selected)
    ? `<option value="${selected}" selected>${selected}</option>` : '';
  return `<option value="">— City —</option>${known}${extra}<option value="${CUSTOM_PLACE}">＋ Other…</option>`;
}

/** Inline reminder of country-budget standing, shown above the form when the
 *  selected country has a cap set. */
function countryReminderHtml(): string {
  if (!formCountry) return '';
  const cap = countryBudgets()[formCountry];
  if (!cap) return '';
  const spent = countrySpend(formCountry);
  const remaining = cap - spent;
  const pct = Math.min(100, Math.round((spent / cap) * 100));
  const over = remaining < 0;
  const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
  return `
    <div class="exp-country-reminder ${cls}">
      <span class="exp-country-reminder-place">📍 ${formCountry}</span>
      <span class="exp-country-reminder-figs">
        ${fmt(spent)} / ${fmt(cap)} ·
        <strong>${over ? `${fmt(-remaining)} over` : `${fmt(remaining)} left`}</strong>
      </span>
    </div>`;
}

function renderForm(el: HTMLElement) {
  const todayIso = new Date().toISOString().split('T')[0];
  const defCur = defaultCurrency(legs, todayIso);
  const base = baseCurrency();

  // Seed the form's place from remembered/leg defaults (only when unset, so a
  // re-render after store updates doesn't clobber an in-progress selection).
  if (!formCountry && !formCity) {
    const place = defaultPlace(legs, todayIso);
    formCountry = place.country;
    formCity = place.city;
  }

  el.innerHTML = `
    <div class="exp-form">
      <div class="exp-form-head">
        <div class="exp-form-title">Add expense</div>
        <label class="exp-base-picker">
          <span>Show totals in</span>
          <select class="input select" id="exp-base">
            ${currencyOptions(base)}
          </select>
        </label>
      </div>
      <div class="exp-cat-chips" id="exp-cat-chips">
        ${categories().map((c) => `
          <button class="exp-cat-chip ${c.id === selectedCategory ? 'selected' : ''}" data-cat="${c.id}">
            ${c.icon} ${c.label}
          </button>
        `).join('')}
        <button class="exp-cat-chip exp-cat-manage" id="exp-cat-manage" type="button" title="Manage categories">＋ New</button>
      </div>
      <div class="exp-country-reminder-slot">${countryReminderHtml()}</div>
      <div class="exp-form-grid">
        <div>
          <label class="field-label">Amount</label>
          <input class="input" type="number" id="exp-amount" placeholder="0.00" min="0" step="0.01">
        </div>
        <div>
          <label class="field-label">Currency</label>
          <select class="input select" id="exp-currency">
            ${currencyOptions(defCur)}
          </select>
        </div>
        <div class="field-full">
          <label class="field-label">What for?</label>
          <input class="input" id="exp-desc" placeholder="e.g. Dinner at Boqueria market">
        </div>
        <div>
          <label class="field-label">Country</label>
          <select class="input select" id="exp-country">${countryOptions(formCountry)}</select>
        </div>
        <div>
          <label class="field-label">City</label>
          <select class="input select" id="exp-city">${cityOptions(formCountry, formCity)}</select>
        </div>
        <div class="field-full">
          <label class="field-label">Date</label>
          <input class="input" type="date" id="exp-date" value="${todayIso}">
        </div>
      </div>
      <button class="btn btn-primary" id="exp-add-btn" style="width:100%;justify-content:center">Add expense</button>
    </div>
  `;

  const curInput = el.querySelector('#exp-currency') as HTMLSelectElement;
  const countrySel = el.querySelector('#exp-country') as HTMLSelectElement;
  const citySel = el.querySelector('#exp-city') as HTMLSelectElement;

  // Country change → refresh city options, update the reminder, and (if the
  // user hasn't manually picked a currency this session) seed the currency.
  countrySel.addEventListener('change', () => {
    if (countrySel.value === CUSTOM_PLACE) {
      const name = prompt('Country name?')?.trim();
      formCountry = name || '';
    } else {
      formCountry = countrySel.value;
    }
    formCity = '';
    if (!lastUsed().currency) {
      // No remembered currency yet — follow the chosen country.
      curInput.value = COUNTRY_CURRENCY[formCountry] ?? base;
    }
    renderForm(el);
  });

  citySel.addEventListener('change', () => {
    if (citySel.value === CUSTOM_PLACE) {
      const name = prompt('City name?')?.trim();
      formCity = name || '';
      renderForm(el);
    } else {
      formCity = citySel.value;
    }
  });

  bindBasePicker(el);

  el.querySelectorAll('.exp-cat-chip[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedCategory = (btn as HTMLElement).dataset.cat!;
      el.querySelectorAll('.exp-cat-chip').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  el.querySelector('#exp-cat-manage')?.addEventListener('click', () => openCategoryManager(el));

  el.querySelector('#exp-add-btn')?.addEventListener('click', async () => {
    const amount = parseFloat((el.querySelector('#exp-amount') as HTMLInputElement).value);
    const currency = curInput.value;
    const desc = (el.querySelector('#exp-desc') as HTMLInputElement).value;
    const date = (el.querySelector('#exp-date') as HTMLInputElement).value;

    const ok = await addExpenseWithDefaults({
      amount, currency, description: desc, date,
      category: selectedCategory, country: formCountry, city: formCity, rates,
    });
    if (ok) {
      (el.querySelector('#exp-amount') as HTMLInputElement).value = '';
      (el.querySelector('#exp-desc') as HTMLInputElement).value = '';
    }
  });
}

/* ── Category manager ────────────────────────────────────────────────────── */

const EMOJI_CHOICES = ['🏷️', '🎁', '🛂', '🛡️', '📱', '☕', '🍷', '🎟️', '🧺', '💈', '🐾', '⛽'];

/** Inline panel to add a custom category and delete existing custom ones.
 *  Built-ins are listed but not deletable. */
function openCategoryManager(formEl: HTMLElement) {
  const existing = formEl.querySelector('.exp-cat-manager');
  if (existing) { existing.remove(); return; }

  const panel = document.createElement('div');
  panel.className = 'exp-cat-manager';
  panel.innerHTML = `
    <div class="exp-cat-manager-title">Your categories</div>
    <div class="exp-cat-manager-list">
      ${categories().map((c) => `
        <span class="exp-cat-manager-item ${c.builtin ? 'builtin' : ''}">
          ${c.icon} ${c.label}
          ${c.builtin ? '' : `<button class="exp-cat-del" data-id="${c.id}" title="Delete">✕</button>`}
        </span>
      `).join('')}
    </div>
    <div class="exp-cat-manager-add">
      <select class="input select exp-cat-emoji" id="exp-new-icon">
        ${EMOJI_CHOICES.map((e) => `<option value="${e}">${e}</option>`).join('')}
      </select>
      <input class="input" id="exp-new-label" placeholder="New category name" maxlength="24">
      <button class="btn btn-primary" id="exp-new-add">Add</button>
    </div>
  `;
  formEl.querySelector('.exp-cat-chips')!.after(panel);

  const labelInput = panel.querySelector('#exp-new-label') as HTMLInputElement;
  const iconInput = panel.querySelector('#exp-new-icon') as HTMLSelectElement;

  const addCat = async () => {
    const label = labelInput.value.trim();
    if (!label) return;
    const id = await expenseCategoryStore.add({
      label, icon: iconInput.value, color: '#e5e7eb', order: customCategories.length,
    });
    selectedCategory = id;
    labelInput.value = '';
    // The store subscription will refresh `customCategories` and re-render the form.
  };
  panel.querySelector('#exp-new-add')?.addEventListener('click', addCat);
  labelInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCat(); });

  panel.querySelectorAll('.exp-cat-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      void expenseCategoryStore.remove((btn as HTMLElement).dataset.id!);
    });
  });
}

/** Wire the "Show totals in" base-currency picker (shared by both form states). */
function bindBasePicker(el: HTMLElement) {
  el.querySelector('#exp-base')?.addEventListener('change', async (ev) => {
    const code = (ev.target as HTMLSelectElement).value;
    await setBaseCurrency(code);
    rates = peekRateTable(code);
    render();
    rates = await getRateTable(code); // refresh with live table
    render();
  });
}

/* ── Records overlay (full ledger, opened from "Total spent") ─────────────── */

function onRecordsKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape') closeRecords();
}

function openRecords() {
  showRecords = true;
  document.body.classList.add('exp-records-lock');
  document.addEventListener('keydown', onRecordsKey);
  renderRecordsPanel();
}

function closeRecords() {
  showRecords = false;
  document.body.classList.remove('exp-records-lock');
  document.removeEventListener('keydown', onRecordsKey);
  renderRecordsPanel();
}

/** Group the filtered list by ISO date, newest day first. */
function groupByDate(list: StoredExpense[]): [string, StoredExpense[]][] {
  const map = new Map<string, StoredExpense[]>();
  for (const e of list) (map.get(e.date) ?? map.set(e.date, []).get(e.date)!).push(e);
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

/** Tint a category colour into a soft fill (the route plan-tag look). */
function dayLabel(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function renderRecordsPanel() {
  const panel = document.querySelector('.exp-records-panel') as HTMLElement | null;
  if (!panel) return;
  panel.classList.toggle('open', showRecords);
  if (!showRecords) { panel.innerHTML = ''; return; }

  const cities = getCities();
  const list = filteredExpenses();
  const grouped = groupByDate(list);
  const unsortedCount = expenses.filter((e) => e.category === UNCLASSIFIED).length;
  const shownTotal = total(list);

  panel.innerHTML = `
    <div class="exp-records-overlay">
      <div class="exp-records-bar">
        <button class="exp-records-back" id="exp-records-back">‹ Back</button>
        <div class="exp-records-bar-title">All records</div>
        <span class="exp-records-count">${list.length} · ${fmt(shownTotal)}</span>
      </div>
      <div class="exp-records-scroll">
        ${unsortedCount > 0 && filterCategory !== UNCLASSIFIED ? `
          <button class="exp-sort-banner" id="exp-sort-banner">
            🗂️ <strong>${unsortedCount}</strong> ${unsortedCount === 1 ? 'expense needs' : 'expenses need'} a category — sort them now
          </button>` : ''}
        ${cities.length > 1 ? `
        <div class="exp-city-pills">
          <div class="exp-city-pill ${filterCity === 'all' ? 'active' : ''}" data-city="all">All cities</div>
          ${cities.map((c) => `<div class="exp-city-pill ${filterCity === c ? 'active' : ''}" data-city="${c}">${c}</div>`).join('')}
        </div>` : ''}
        <div class="exp-filter-row">
          <button class="exp-filter-btn ${filterCategory === 'all' ? 'active' : ''}" data-filter="all">All</button>
          ${categories().map((c) => `
            <button class="exp-filter-btn ${filterCategory === c.id ? 'active' : ''}" data-filter="${c.id}">${c.icon} ${c.label}</button>
          `).join('')}
          <button class="exp-filter-btn ${filterCategory === UNCLASSIFIED ? 'active' : ''}" data-filter="">🗂️ To sort</button>
        </div>
        ${list.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">💸</div>
            <p>No expenses here yet.</p>
          </div>
        ` : grouped.map(([date, items]) => `
          <div class="exp-day-group">
            <div class="exp-day-head">
              <span class="exp-day-date">${dayLabel(date)}</span>
              <span class="exp-day-sum">${fmt(total(items))}</span>
            </div>
            <div class="exp-tags">
              ${items.map((e) => renderRecordTag(e)).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  panel.querySelector('#exp-records-back')?.addEventListener('click', () => closeRecords());

  panel.querySelectorAll('.exp-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterCategory = (btn as HTMLElement).dataset.filter!;
      renderRecordsPanel();
    });
  });

  panel.querySelectorAll('.exp-city-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      filterCity = (pill as HTMLElement).dataset.city!;
      renderRecordsPanel();
    });
  });

  panel.querySelector('#exp-sort-banner')?.addEventListener('click', () => {
    filterCategory = UNCLASSIFIED;
    renderRecordsPanel();
  });

  // Whole tag opens the editor; the ✕ deletes without opening.
  panel.querySelectorAll<HTMLElement>('.exp-tag-item').forEach((tag) => {
    tag.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('.exp-tag-del')) return;
      openExpenseEditor(tag.dataset.id!);
    });
  });
  panel.querySelectorAll('.exp-tag-del').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      deleteExpense((btn as HTMLElement).dataset.id!);
    });
  });
}

/** A compact, category-tinted record chip — mirrors the route plan-tag logic:
 *  colour-filled by category, click to open, ✕ to delete. */
function renderRecordTag(e: StoredExpense): string {
  const cat = categoryById(e.category);
  const color = cat?.color ?? '#f3f4f6';
  const baseStr = e.currency !== baseCurrency() ? ` · ${fmt(inBase(e))}` : '';
  const place = [e.city, e.country].filter(Boolean).join(', ');
  const tip = [cat?.label ?? 'Unsorted', place].filter(Boolean).join(' · ');
  return `
    <div class="exp-tag-item ${e.category === UNCLASSIFIED ? 'unsorted' : ''}"
         data-id="${e.id}" style="background:${color}"${tip ? ` data-tooltip="${tip}"` : ''}>
      <span class="exp-tag-icon">${cat?.icon ?? '🗂️'}</span>
      <span class="exp-tag-name">${e.description}</span>
      <span class="exp-tag-amount">${fmtRaw(e.amount, e.currency)}${baseStr}</span>
      <button class="exp-tag-del" data-id="${e.id}" title="Delete">✕</button>
    </div>`;
}

/* ── Per-item editor (overlay, mirrors the route plan-item editors) ──────── */

function openExpenseEditor(id: string) {
  const e = expenses.find((x) => x.id === id);
  if (!e) return;

  const m = openModal({
    title: 'Edit expense',
    className: 'exp-editor-modal',
    body: `
      <div class="exp-cat-chips exp-editor-cats" id="exp-edit-cats">
        ${categories().map((c) => `
          <button class="exp-cat-chip ${c.id === e.category ? 'selected' : ''}" data-cat="${c.id}">${c.icon} ${c.label}</button>
        `).join('')}
      </div>
      <div class="exp-editor-grid">
        <div>
          <label class="field-label">Amount</label>
          <input class="input" type="number" id="ee-amount" min="0" step="0.01" value="${e.amount}">
        </div>
        <div>
          <label class="field-label">Currency</label>
          <select class="input select" id="ee-currency">${currencyOptions(e.currency)}</select>
        </div>
        <div class="field-full">
          <label class="field-label">What for?</label>
          <input class="input" id="ee-desc" value="${(e.description ?? '').replace(/"/g, '&quot;')}">
        </div>
        <div>
          <label class="field-label">Country</label>
          <select class="input select" id="ee-country">${countryOptions(e.country)}</select>
        </div>
        <div>
          <label class="field-label">City</label>
          <select class="input select" id="ee-city">${cityOptions(e.country, e.city)}</select>
        </div>
        <div class="field-full">
          <label class="field-label">Date</label>
          <input class="input" type="date" id="ee-date" value="${e.date}">
        </div>
      </div>`,
    footer: `
      <button class="btn btn-danger" data-act="delete">Delete</button>
      <button class="btn btn-primary" data-act="save">Save</button>`,
  });

  let editCat = e.category;
  m.root.querySelectorAll<HTMLElement>('#exp-edit-cats .exp-cat-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      editCat = btn.dataset.cat!;
      m.root.querySelectorAll('#exp-edit-cats .exp-cat-chip').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  const countrySel = m.root.querySelector('#ee-country') as HTMLSelectElement;
  const citySel = m.root.querySelector('#ee-city') as HTMLSelectElement;
  let editCountry = e.country;
  let editCity = e.city;
  countrySel.addEventListener('change', () => {
    if (countrySel.value === CUSTOM_PLACE) {
      editCountry = prompt('Country name?')?.trim() || '';
    } else {
      editCountry = countrySel.value;
    }
    editCity = '';
    citySel.innerHTML = cityOptions(editCountry, '');
  });
  citySel.addEventListener('change', () => {
    if (citySel.value === CUSTOM_PLACE) {
      editCity = prompt('City name?')?.trim() || '';
      citySel.innerHTML = cityOptions(editCountry, editCity);
    } else {
      editCity = citySel.value;
    }
  });

  m.root.querySelector('[data-act="save"]')?.addEventListener('click', async () => {
    const amount = parseFloat((m.root.querySelector('#ee-amount') as HTMLInputElement).value);
    const currency = (m.root.querySelector('#ee-currency') as HTMLSelectElement).value;
    const desc = (m.root.querySelector('#ee-desc') as HTMLInputElement).value.trim();
    const date = (m.root.querySelector('#ee-date') as HTMLInputElement).value;
    if (!amount || !desc) return;
    // Re-snapshot the conversion when amount or currency changed.
    const { rate, baseAmount } = convert(rates, amount, currency);
    await expenseStore.update(id, {
      amount, currency, rate, baseAmount, baseCurrency: baseCurrency(),
      description: desc, category: editCat, country: editCountry, city: editCity, date,
    });
    m.close();
  });

  m.root.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
    deleteExpense(id);
    m.close();
  });
}

/* ── Render: analysis ────────────────────────────────────────────────────── */

interface Row { label: string; sum: number; color: string; sub?: string; catId?: string; country?: string; budget?: number; isDay?: boolean; }

/** Group expenses for the active dimension into sorted, displayable rows. */
function analysisRows(): Row[] {
  if (analysisDim === 'category') {
    const caps = categoryBudgets();
    const rows: Row[] = categories()
      .map((cat) => ({
        label: `${cat.icon} ${cat.label}`,
        sum: expenses.filter((e) => e.category === cat.id).reduce((s, e) => s + inBase(e), 0),
        color: cat.color === '#f3f4f6' ? '#d1d5db' : cat.color,
        catId: cat.id,
        budget: caps[cat.id],
      }));
    const unsorted = expenses.filter((e) => e.category === UNCLASSIFIED).reduce((s, e) => s + inBase(e), 0);
    if (unsorted > 0) rows.push({ label: '🗂️ Unsorted', sum: unsorted, color: '#d1d5db' });
    // Keep a row if it has spend OR a budget cap (so you can watch an empty cap fill up).
    return rows
      .filter((r) => r.sum > 0 || (r.budget ?? 0) > 0)
      .sort((a, b) => b.sum - a.sum);
  }

  if (analysisDim === 'time') {
    // One row per day with spend, most recent first.
    const byDay = new Map<string, number>();
    for (const e of expenses) byDay.set(e.date, (byDay.get(e.date) ?? 0) + inBase(e));
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, sum]) => ({ label: date, sum, color: 'var(--accent)', isDay: true }));
  }

  // country | city — total plus a per-day average using days at that place.
  // Country rows also carry their budget cap so the bar can track against it.
  const key = analysisDim;
  const caps = key === 'country' ? countryBudgets() : {};
  const groups = new Map<string, number>();
  for (const e of expenses) {
    const v = e[key];
    if (!v) continue;
    groups.set(v, (groups.get(v) ?? 0) + inBase(e));
  }
  // Include countries that have a cap but no spend yet, so empty caps still show.
  for (const c of Object.keys(caps)) if (!groups.has(c)) groups.set(c, 0);
  return [...groups.entries()]
    .map(([value, sum]) => {
      const days = daysForPlace(key, value);
      return {
        label: value, sum, color: 'var(--accent)',
        sub: `${fmt(sum / days)}/day · ${days}d`,
        country: key === 'country' ? value : undefined,
        budget: caps[value],
      };
    })
    .filter((r) => r.sum > 0 || (r.budget ?? 0) > 0)
    .sort((a, b) => b.sum - a.sum);
}

function dailyBudgetAmount(): number | null {
  const budget = tripBudget();
  if (!budget) return null;
  const tripLegs = routeStore.peek().filter((l) => l.tripId === currentTripId());
  if (!tripLegs.length) return null;
  const dates = tripLegs.flatMap((l) => [l.dateFrom, l.dateTo]);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));
  const days = Math.max(1, Math.round((new Date(maxDate).getTime() - new Date(minDate).getTime()) / 86_400_000));
  return budget / days;
}

function renderBreakdown(el: HTMLElement) {
  const rows = analysisRows();
  const maxAmount = Math.max(...rows.map((r) => r.sum), 1);
  const dailyBudget = analysisDim === 'time' ? dailyBudgetAmount() : null;
  const dailyBudgetPct = dailyBudget ? Math.min(100, (dailyBudget / maxAmount) * 100) : null;

  el.innerHTML = `
    <div class="exp-breakdown">
      <div class="exp-analysis-tabs">
        ${ANALYSIS_DIMS.map((d) => `
          <button class="exp-analysis-tab ${d.id === analysisDim ? 'active' : ''}" data-dim="${d.id}">${d.label}</button>
        `).join('')}
      </div>
      ${dailyBudget && dailyBudgetPct ? `
        <div class="exp-daily-budget-legend">
          <span class="exp-daily-budget-swatch"></span>
          Budget target: ${fmt(dailyBudget)}/day
        </div>
      ` : ''}
      ${rows.map((r) => {
        const hasBudget = (r.budget ?? 0) > 0;
        // When a budget exists, the bar tracks spend against the cap (capped at
        // 100%) and recolours by usage; otherwise it's a relative spend bar.
        const pct = hasBudget
          ? Math.min(100, (r.sum / r.budget!) * 100)
          : (r.sum / maxAmount) * 100;
        const usage = hasBudget ? (r.sum / r.budget!) : 0;
        // For time rows: color by relation to daily budget if available.
        const isOver = r.isDay && dailyBudget ? r.sum > dailyBudget : hasBudget && r.sum > r.budget!;
        const barColor = hasBudget
          ? (usage >= 1 ? 'var(--coral-500)' : usage >= 0.8 ? '#f59e0b' : 'var(--sage-500)')
          : (r.isDay && dailyBudget
            ? (r.sum > dailyBudget * 1.2 ? 'var(--coral-500)' : r.sum > dailyBudget ? '#f59e0b' : r.color)
            : r.color);
        const budgetTag = hasBudget
          ? `<span class="exp-cat-name-sub">${fmt(r.sum)} / ${fmt(r.budget!)}${r.sum > r.budget! ? ' · over' : ''}</span>`
          : (r.sub ? `<span class="exp-cat-name-sub">${r.sub}</span>` : '');
        // Both category and country rows get a quick set/edit-budget button.
        const budgetKey = r.catId ? `cat:${r.catId}` : (r.country ? `country:${r.country}` : '');
        const setBtn = budgetKey
          ? `<button class="exp-cat-budget-btn" data-budget-key="${budgetKey}" title="${hasBudget ? 'Edit budget' : 'Set budget'}">${hasBudget ? '✎' : '＋'}</button>`
          : '';
        const dailyLine = (r.isDay && dailyBudgetPct)
          ? `<div class="exp-daily-budget-line" style="left:${dailyBudgetPct}%"></div>`
          : '';
        return `
          <div class="exp-cat-row${isOver ? ' exp-cat-row-over' : ''}">
            <div class="exp-cat-name">
              <span class="exp-cat-name-label">${r.label} ${setBtn}</span>
              ${budgetTag}
            </div>
            <div class="exp-cat-bar-track">
              <div class="exp-cat-bar-fill" style="width:${pct}%;background:${barColor}"></div>
              ${dailyLine}
            </div>
            <div class="exp-cat-amount">${fmt(r.sum)}</div>
          </div>
        `;
      }).join('')}
      ${rows.length === 0 ? '<p style="color:var(--ink-faint);font-size:13px;text-align:center;padding:16px 0">Add expenses to see breakdown</p>' : ''}
    </div>
  `;

  el.querySelectorAll('.exp-analysis-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      analysisDim = (btn as HTMLElement).dataset.dim as AnalysisDim;
      renderBreakdown(el);
    });
  });

  el.querySelectorAll<HTMLElement>('.exp-cat-budget-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const [kind, value] = btn.dataset.budgetKey!.split(/:(.+)/);
      openBudgetModal(kind === 'country' ? 'country' : 'category', value);
    });
  });
}

/* ── Budget overview modal (total / country / category) ──────────────────── */

type BudgetTab = 'total' | 'country' | 'category';

function openBudgetModal(initialTab: BudgetTab = 'total', focusKey?: string) {
  let tab: BudgetTab = initialTab;
  const sym = currencySymbol(baseCurrency());

  const m = openModal({
    title: 'Budgets',
    variant: 'sheet',
    className: 'exp-budget-modal',
    body: `<div class="exp-budget-tabs">
        <button class="exp-budget-tab" data-tab="total">Total</button>
        <button class="exp-budget-tab" data-tab="country">By country</button>
        <button class="exp-budget-tab" data-tab="category">By category</button>
      </div>
      <div class="exp-budget-pane" id="exp-budget-pane"></div>`,
    footer: `<button class="btn btn-primary" data-act="done">Done</button>`,
  });

  const pane = m.root.querySelector('#exp-budget-pane') as HTMLElement;

  const renderPane = () => {
    m.root.querySelectorAll<HTMLElement>('.exp-budget-tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === tab));

    if (tab === 'total') {
      const budget = tripBudget();
      pane.innerHTML = `
        <label class="field-label">Total trip budget (${sym}, ${baseCurrency()})</label>
        <input class="input" type="number" id="bm-total" min="0" step="1" placeholder="e.g. 5000" value="${budget ?? ''}">
        <p class="exp-modal-hint">Your overall ceiling. Shows as the budget bar on the summary and dashboard.</p>`;
      const input = pane.querySelector('#bm-total') as HTMLInputElement;
      const save = async () => {
        const val = parseFloat(input.value);
        await setTripBudget(val > 0 ? val : null);
        renderSummaryRoot();
      };
      input.addEventListener('change', save);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      return;
    }

    if (tab === 'country') {
      const caps = countryBudgets();
      const countriesList = [...new Set([...legCountries(legs), ...Object.keys(caps)])];
      const totalCap = Object.values(caps).reduce((s, v) => s + v, 0);
      const trip = tripBudget();
      const flex = trip ? trip - totalCap : null;
      pane.innerHTML = `
        ${countriesList.length === 0 ? '<p class="exp-modal-hint">No countries on the itinerary yet.</p>' : ''}
        <div class="exp-budget-rows">
          ${countriesList.map((c) => {
            const spent = countrySpend(c);
            return `
              <div class="exp-budget-row">
                <div class="exp-budget-row-name">${c}<span class="exp-budget-row-spent">${fmt(spent)} spent</span></div>
                <input class="input exp-budget-row-input" type="number" min="0" step="1" data-country="${c}" placeholder="cap" value="${caps[c] ?? ''}">
              </div>`;
          }).join('')}
        </div>
        ${flex != null ? `<p class="exp-budget-flex ${flex < 0 ? 'over' : ''}">Allocated ${fmt(totalCap)} · ${flex < 0 ? `${fmt(-flex)} over total budget` : `${fmt(flex)} unallocated`}</p>` : ''}`;
      pane.querySelectorAll<HTMLInputElement>('.exp-budget-row-input').forEach((input) => {
        input.addEventListener('change', async () => {
          const val = parseFloat(input.value);
          await setCountryBudget(input.dataset.country!, val > 0 ? val : null);
          renderPane();
          renderSummaryRoot();
          renderForm(document.querySelector('.exp-form-wrap') as HTMLElement);
        });
      });
      if (focusKey) (pane.querySelector(`[data-country="${focusKey}"]`) as HTMLInputElement)?.focus();
      return;
    }

    // category
    const caps = categoryBudgets();
    const totalCap = Object.values(caps).reduce((s, v) => s + v, 0);
    const trip = tripBudget();
    const flex = trip ? trip - totalCap : null;
    pane.innerHTML = `
      <div class="exp-budget-rows">
        ${categories().map((cat) => {
          const spent = expenses.filter((e) => e.category === cat.id).reduce((s, e) => s + inBase(e), 0);
          return `
            <div class="exp-budget-row">
              <div class="exp-budget-row-name">${cat.icon} ${cat.label}<span class="exp-budget-row-spent">${fmt(spent)} spent</span></div>
              <input class="input exp-budget-row-input" type="number" min="0" step="1" data-cat="${cat.id}" placeholder="cap" value="${caps[cat.id] ?? ''}">
            </div>`;
        }).join('')}
      </div>
      ${flex != null ? `<p class="exp-budget-flex ${flex < 0 ? 'over' : ''}">Allocated ${fmt(totalCap)} · ${flex < 0 ? `${fmt(-flex)} over total budget` : `${fmt(flex)} unallocated`}</p>` : ''}`;
    pane.querySelectorAll<HTMLInputElement>('.exp-budget-row-input').forEach((input) => {
      input.addEventListener('change', async () => {
        const val = parseFloat(input.value);
        await setCategoryBudget(input.dataset.cat!, val > 0 ? val : null);
        renderPane();
        renderSummaryRoot();
      });
    });
    if (focusKey) (pane.querySelector(`[data-cat="${focusKey}"]`) as HTMLInputElement)?.focus();
  };

  m.root.querySelectorAll<HTMLElement>('.exp-budget-tab').forEach((btn) => {
    btn.addEventListener('click', () => { tab = btn.dataset.tab as BudgetTab; renderPane(); });
  });
  m.root.querySelector('[data-act="done"]')?.addEventListener('click', () => {
    m.close();
    render();
  });

  renderPane();
}

/* ── Orchestration ───────────────────────────────────────────────────────── */

function renderSummaryRoot() {
  const root = document.getElementById('view-expenses');
  if (root) renderSummary(root.querySelector('.exp-summary')!);
}

function render() {
  const root = document.getElementById('view-expenses');
  if (!root) return;
  renderSummary(root.querySelector('.exp-summary')!);
  renderRecordsPanel();
  renderBreakdown(root.querySelector('.exp-breakdown-wrap')!);
}

export function initExpenses() {
  const root = document.getElementById('view-expenses');
  if (!root) return;

  // Leaving the view while the fixed records overlay is open would leave it
  // covering the next view — close it on any navigation away from expenses.
  window.addEventListener('hashchange', () => {
    if (showRecords && window.location.hash.replace('#', '') !== 'expenses') {
      closeRecords();
    }
  });

  rates = peekRateTable(baseCurrency());
  legs = routeStore.peek();
  customCategories = expenseCategoryStore.peek();

  const formEl = root.querySelector('.exp-form-wrap') as HTMLElement;
  renderForm(formEl);
  render();

  // Live data. Idempotent: clear prior subscriptions so a trip switch
  // re-subscribes under the new tripId without leaking/duplicating.
  unsub?.();
  unsubLegs?.();
  unsubCategories?.();
  unsubTripChange?.();
  // A trip switch changes base currency, total budget AND budget caps — repaint everything.
  unsubTripChange = onTripChange(() => { renderForm(formEl); render(); });
  unsub = expenseStore.subscribe((rows) => {
    expenses = rows;
    render();
  });
  unsubLegs = routeStore.subscribe((rows) => {
    legs = rows;
    render();
  });
  // Custom categories affect both the form chips and the analysis/filter panels.
  unsubCategories = expenseCategoryStore.subscribe((rows) => {
    customCategories = rows;
    renderForm(formEl);
    render();
  });

  // Refresh rates with the live table, then repaint.
  void getRateTable(baseCurrency()).then((table) => {
    rates = table;
    render();
  });
}
