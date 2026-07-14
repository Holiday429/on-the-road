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
import { t } from '../../core/i18n.ts';
import { escHtml } from '../../core/utils.ts';
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
import {
  type Category, BUILTIN_CATEGORIES, UNCLASSIFIED,
  type AnalysisDim, type BudgetTab, ANALYSIS_DIMS, nightCount,
} from './expense-helpers.ts';

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

let expenses: StoredExpense[] = [];
let legs: StoredLeg[] = [];
let customCategories: StoredExpenseCategory[] = [];
let rates: RateTable = {};
let selectedCategory = 'food';
// The place selected in the form right now (drives the country-budget reminder
// and what a new expense is tagged with). Seeded from remembered/leg defaults.
let formCountry = '';
let formCity = '';
// In-progress values for the transient form fields. Persisting them across the
// re-render that a country/city change triggers is what keeps those edits from
// being wiped. `undefined` means "not yet touched → use the computed default".
let draftAmount = '';
let draftDesc = '';
let draftCurrency: string | undefined;
let draftDate: string | undefined;
let filterCategory = 'all';
let filterCity = 'all';
let analysisDim: AnalysisDim = 'category';
let calViewYear  = new Date().getFullYear();
let calViewMonth = new Date().getMonth(); // 0-indexed
let showRecords = false;          // is the full-ledger panel open?
let showBudget = false;           // is the budget overlay page open?
let budgetTab: BudgetTab = 'total';
let unsub: (() => void) | null = null;
let unsubLegs: (() => void) | null = null;
let unsubCategories: (() => void) | null = null;
let unsubTripChange: (() => void) | null = null;

/* ── Leg-aware helpers ───────────────────────────────────────────────────── */

/** Nights the itinerary allocates to a country/city, from its legs. Falls back to
 *  the number of distinct expense dates for the place if no leg covers it. */
function daysForPlace(key: 'country' | 'city', value: string): number {
  const matching = legs.filter((l) => l[key === 'country' ? 'country' : 'city'] === value);
  if (matching.length) {
    return matching.reduce((s, l) => s + nightCount(l.dateFrom, l.dateTo), 0);
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

/* ── Render: summary (2 equal hero buttons) ──────────────────────────────── */

function renderSummary(el: HTMLElement) {
  const sum = total(expenses);
  const budget = tripBudget();
  const sym = currencySymbol(baseCurrency());
  const unclassified = expenses.filter((e) => e.category === UNCLASSIFIED).length;
  const toSortChip = unclassified
    ? `<span class="exp-stat-chip" id="exp-tosort-chip">🗂️ ${unclassified} to sort</span>`
    : '';

  // Right button: if budget set, show spent/total + bar; else invite to set one.
  const budgetRight = budget
    ? (() => {
        const pct = Math.min(100, Math.round((sum / budget) * 100));
        const over = sum > budget;
        const barColor = pct >= 100 ? 'var(--coral-500)' : pct >= 80 ? '#f59e0b' : 'var(--sage-500)';
        return `
          <div class="exp-hero-eyebrow">Budget</div>
          <div class="exp-hero-num">${sym}${Math.round(budget).toLocaleString()}</div>
          <div class="exp-hero-bar-track">
            <div class="exp-hero-bar-fill" style="width:${pct}%;background:${barColor}"></div>
          </div>
          <div class="exp-hero-label ${over ? 'exp-hero-label-over' : ''}">
            ${over ? `▲ ${fmt(sum - budget)} ${t('expenses.over')}` : `${fmt(budget - sum)} ${t('expenses.remaining')} ›`}
          </div>`;
      })()
    : `<div class="exp-hero-eyebrow">Budget</div>
       <div class="exp-hero-num exp-hero-empty">—</div>
       <div class="exp-hero-label">Tap to set ›</div>`;

  el.innerHTML = `
    <button class="exp-hero-btn exp-hero-spend" id="exp-open-records">
      <div class="exp-hero-eyebrow">Total spent ${toSortChip ? '· ' + unclassified + ' to sort' : ''}</div>
      <div class="exp-hero-num">${fmt(sum)}</div>
      <div class="exp-hero-label">${t('expenses.viewAllRecords')}</div>
    </button>
    <button class="exp-hero-btn exp-hero-budget" id="exp-open-budget">
      ${budgetRight}
    </button>
  `;

  el.querySelector('#exp-open-records')?.addEventListener('click', () => openRecords());
  el.querySelector('#exp-open-budget')?.addEventListener('click', () => openBudgetPage());
  el.querySelector('#exp-tosort-chip')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
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

const WHOLE_TRIP = '__whole__';

function flagForCountry(country: string): string {
  return legs.find((l) => l.country === country)?.flag ?? '';
}

function countryOptions(selected: string): string {
  const opts = legCountries(legs);
  const isWholeTrip = !selected || selected === WHOLE_TRIP;
  const known = opts.map((c) => {
    const flag = flagForCountry(c);
    return `<option value="${c}" ${c === selected ? 'selected' : ''}>${flag ? flag + ' ' : ''}${c}</option>`;
  }).join('');
  const extra = selected && selected !== WHOLE_TRIP && !opts.includes(selected)
    ? `<option value="${selected}" selected>${selected}</option>` : '';
  return `<option value="${WHOLE_TRIP}" ${isWholeTrip ? 'selected' : ''}>🌍 Whole trip</option>${known}${extra}<option value="${CUSTOM_PLACE}">＋ Other…</option>`;
}

function cityOptions(country: string, selected: string): string {
  if (!country || country === WHOLE_TRIP) return '';
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
  if (!formCountry || formCountry === WHOLE_TRIP) return '';
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
        <strong>${over ? `${fmt(-remaining)} ${t('expenses.over')}` : `${fmt(remaining)} ${t('expenses.left')}`}</strong>
      </span>
    </div>`;
}

function renderForm(el: HTMLElement) {
  const todayIso = new Date().toISOString().split('T')[0];
  const defCur = defaultCurrency(legs, todayIso);
  const base = baseCurrency();

  // Before rebuilding the form, capture whatever is currently typed so this
  // re-render — whether from a country/city change or an external store update —
  // never wipes an in-progress entry. Only runs when the form already exists.
  const liveAmount = el.querySelector<HTMLInputElement>('#exp-amount');
  if (liveAmount) {
    draftAmount   = liveAmount.value;
    draftDesc     = (el.querySelector('#exp-desc') as HTMLInputElement).value;
    draftCurrency = (el.querySelector('#exp-currency') as HTMLSelectElement).value;
    draftDate     = (el.querySelector('#exp-date') as HTMLInputElement).value;
  }

  // Seed the form's place from remembered/leg defaults (only when unset, so a
  // re-render after store updates doesn't clobber an in-progress selection).
  if (!formCountry && !formCity) {
    const place = defaultPlace(legs, todayIso);
    formCountry = place.country || WHOLE_TRIP;
    formCity = place.city;
  }

  const isWholeTrip = !formCountry || formCountry === WHOLE_TRIP;
  const cityOpts = cityOptions(formCountry, formCity);

  // Resolve the field values: a touched draft wins over the computed default,
  // so re-rendering (e.g. after a country/city change) preserves what was typed.
  const curValue  = draftCurrency ?? defCur;
  const dateValue = draftDate ?? todayIso;

  el.innerHTML = `
    <div class="exp-form">
      <div class="exp-form-head">
        <div class="exp-form-title">${t('expenses.formTitle')}</div>
        <label class="exp-base-picker">
          <span>${t('expenses.showTotalsIn')}</span>
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
          <input class="input" type="number" id="exp-amount" placeholder="0.00" min="0" step="0.01" value="${escHtml(draftAmount)}">
        </div>
        <div>
          <label class="field-label">Currency</label>
          <select class="input select" id="exp-currency">
            ${currencyOptions(curValue)}
          </select>
        </div>
        <div>
          <label class="field-label">What for?</label>
          <input class="input" id="exp-desc" placeholder="${t('expenses.descPh')}" value="${escHtml(draftDesc)}">
        </div>
        <div>
          <label class="field-label">Date</label>
          <input class="input" type="date" id="exp-date" value="${dateValue}">
        </div>
        <div>
          <label class="field-label">Country</label>
          <select class="input select" id="exp-country">${countryOptions(formCountry)}</select>
        </div>
        ${!isWholeTrip && cityOpts ? `
        <div>
          <label class="field-label">City</label>
          <select class="input select" id="exp-city">${cityOpts}</select>
        </div>` : '<div></div>'}
      </div>
      <button class="btn btn-primary" id="exp-add-btn" style="width:100%;justify-content:center">${t('expenses.btnAdd')}</button>
    </div>
  `;

  const curInput = el.querySelector('#exp-currency') as HTMLSelectElement;
  const countrySel = el.querySelector('#exp-country') as HTMLSelectElement;

  countrySel.addEventListener('change', () => {
    if (countrySel.value === CUSTOM_PLACE) {
      const name = prompt('Country name?')?.trim();
      formCountry = name || WHOLE_TRIP;
    } else {
      formCountry = countrySel.value;
    }
    formCity = '';
    // Auto-pick the country's currency only if the user never chose one. Written
    // to the live select so renderForm's snapshot carries it into the redraw.
    if (!lastUsed().currency && formCountry !== WHOLE_TRIP) {
      curInput.value = COUNTRY_CURRENCY[formCountry] ?? base;
    }
    renderForm(el);
  });

  el.querySelector('#exp-city')?.addEventListener('change', (ev) => {
    const val = (ev.target as HTMLSelectElement).value;
    if (val === CUSTOM_PLACE) {
      const name = prompt('City name?')?.trim();
      formCity = name || '';
      renderForm(el);
    } else {
      formCity = val;
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
    const amountInput = el.querySelector('#exp-amount') as HTMLInputElement;
    const amount = parseFloat(amountInput.value);
    const currency = curInput.value;
    const desc = (el.querySelector('#exp-desc') as HTMLInputElement).value;
    const date = (el.querySelector('#exp-date') as HTMLInputElement).value;
    const country = formCountry === WHOLE_TRIP ? '' : formCountry;
    const btn = el.querySelector('#exp-add-btn') as HTMLButtonElement;

    // Only the amount is required — an empty amount just refocuses the field.
    if (!amount) { amountInput.focus(); return; }

    btn.disabled = true;
    try {
      const ok = await addExpenseWithDefaults({
        amount, currency, description: desc, date,
        category: selectedCategory, country, city: formCity, rates,
      });
      if (ok) {
        // Reset the one-off fields (keep currency/date as sticky defaults).
        draftAmount = '';
        draftDesc = '';
        amountInput.value = '';
        (el.querySelector('#exp-desc') as HTMLInputElement).value = '';
      }
    } catch (err) {
      // A rejected write (not signed in, offline-then-denied, rules) used to
      // fail silently and look like a dead button. Surface it instead.
      console.error('Failed to add expense:', err);
      alert(t('expenses.addFailed'));
    } finally {
      btn.disabled = false;
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
    <div class="exp-cat-manager-title">${t('expenses.managerTitle')}</div>
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

function filterBtnStyle(catId: string | null): string {
  if (catId === null || catId === 'all') return '';
  const cat = categoryById(catId);
  return cat?.color ? `background:${cat.color};border-color:${cat.color}` : '';
}

function renderRecordsScrollContent(scroll: HTMLElement) {
  const cities = getCities();
  const list = filteredExpenses();
  const grouped = groupByDate(list);
  const unsortedCount = expenses.filter((e) => e.category === UNCLASSIFIED).length;
  const shownTotal = total(list);

  // Update stats in bar
  const panel = scroll.closest('.exp-records-panel') as HTMLElement | null;
  if (panel) {
    const countEl = panel.querySelector('.exp-records-count');
    if (countEl) countEl.textContent = `${list.length} items · ${fmt(shownTotal)}`;
  }

  scroll.innerHTML = `
    ${unsortedCount > 0 && filterCategory !== UNCLASSIFIED ? `
      <button class="exp-sort-banner" id="exp-sort-banner">
        🗂️ <strong>${unsortedCount}</strong> ${unsortedCount === 1 ? t('expenses.expenseNeedsCategory') : t('expenses.expensesNeedCategory')}
      </button>` : ''}
    ${cities.length > 1 ? `
    <div class="exp-city-pills">
      <div class="exp-city-pill ${filterCity === 'all' ? 'active' : ''}" data-city="all">${t('expenses.filterAllCities')}</div>
      ${cities.map((c) => `<div class="exp-city-pill ${filterCity === c ? 'active' : ''}" data-city="${c}">${c}</div>`).join('')}
    </div>` : ''}
    <div class="exp-filter-row">
      <button class="exp-filter-btn ${filterCategory === 'all' ? 'active' : ''}" data-filter="all">${t('expenses.filterAll')}</button>
      ${categories().map((c) => {
        const isActive = filterCategory === c.id;
        const style = isActive ? `style="${filterBtnStyle(c.id)}"` : '';
        return `<button class="exp-filter-btn ${isActive ? 'active' : ''}" data-filter="${c.id}" ${style}>${c.icon} ${c.label}</button>`;
      }).join('')}
      <button class="exp-filter-btn ${filterCategory === UNCLASSIFIED ? 'active' : ''}" data-filter="">${t('expenses.filterToSort')}</button>
    </div>
    ${list.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">💸</div>
        <p>${t('expenses.emptyRecords')}</p>
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
  `;

  scroll.querySelectorAll('.exp-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterCategory = (btn as HTMLElement).dataset.filter!;
      renderRecordsScrollContent(scroll);
    });
  });

  scroll.querySelectorAll('.exp-city-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      filterCity = (pill as HTMLElement).dataset.city!;
      renderRecordsScrollContent(scroll);
    });
  });

  scroll.querySelector('#exp-sort-banner')?.addEventListener('click', () => {
    filterCategory = UNCLASSIFIED;
    renderRecordsScrollContent(scroll);
  });

  scroll.querySelectorAll<HTMLElement>('.exp-tag-item').forEach((tag) => {
    tag.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('.exp-tag-del')) return;
      openExpenseEditor(tag.dataset.id!);
    });
  });
  scroll.querySelectorAll('.exp-tag-del').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      deleteExpense((btn as HTMLElement).dataset.id!);
    });
  });
}

function renderRecordsPanel() {
  const panel = document.querySelector('.exp-records-panel') as HTMLElement | null;
  if (!panel) return;
  panel.classList.toggle('open', showRecords);
  if (!showRecords) { panel.innerHTML = ''; return; }

  // If the overlay shell already exists, just refresh the scroll content.
  const existingScroll = panel.querySelector<HTMLElement>('.exp-records-scroll');
  if (existingScroll) {
    renderRecordsScrollContent(existingScroll);
    return;
  }

  const days = new Set(expenses.map((e) => e.date)).size || 1;
  const dailyAvg = total(expenses) / days;
  const list = filteredExpenses();
  const shownTotal = total(list);

  panel.innerHTML = `
    <div class="exp-records-overlay">
      <div class="exp-records-bar">
        <button class="exp-records-back" id="exp-records-back">${t('expenses.btnBack')}</button>
        <div class="exp-records-bar-title">${t('expenses.recordsTitle')}</div>
        <div class="exp-records-bar-stats">
          <span class="exp-records-count">${list.length} items · ${fmt(shownTotal)}</span>
          <span class="exp-records-avg">${t('expenses.avgLabel')}${fmt(dailyAvg)}${t('expenses.perDay')}</span>
        </div>
      </div>
      <div class="exp-records-scroll"></div>
    </div>
  `;

  panel.querySelector('#exp-records-back')?.addEventListener('click', () => closeRecords());

  const scroll = panel.querySelector<HTMLElement>('.exp-records-scroll')!;
  renderRecordsScrollContent(scroll);
}

/** A compact, category-tinted record chip — mirrors the route plan-tag logic:
 *  colour-filled by category, click to open, ✕ to delete. */
function renderRecordTag(e: StoredExpense): string {
  const cat = categoryById(e.category);
  const color = cat?.color ?? '#f3f4f6';
  const baseStr = e.currency !== baseCurrency() ? ` · ${fmt(inBase(e))}` : '';
  const place = [e.city, e.country].filter(Boolean).join(', ');
  const tip = [cat?.label ?? 'Unsorted', place].filter(Boolean).join(' · ');
  const tagsHtml = (e.tags ?? []).length
    ? `<span class="exp-tag-labels">${(e.tags ?? []).map((t) => `<span class="exp-tag-label">${t}</span>`).join('')}</span>`
    : '';
  return `
    <div class="exp-tag-item ${e.category === UNCLASSIFIED ? 'unsorted' : ''}"
         data-id="${e.id}" style="background:${color}"${tip ? ` data-tooltip="${tip}"` : ''}>
      <span class="exp-tag-icon">${cat?.icon ?? '🗂️'}</span>
      <span class="exp-tag-name">${e.description}${tagsHtml}</span>
      <span class="exp-tag-amount">${fmtRaw(e.amount, e.currency)}${baseStr}</span>
      <button class="exp-tag-del" data-id="${e.id}" title="Delete">✕</button>
    </div>`;
}

/* ── Per-item editor (overlay, mirrors the route plan-item editors) ──────── */

function openExpenseEditor(id: string) {
  const e = expenses.find((x) => x.id === id);
  if (!e) return;

  const editorCountry = e.country || WHOLE_TRIP;
  const editorCityOpts = cityOptions(e.country, e.city);

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
        <div class="field-full">
          <label class="field-label">Tags <span style="font-weight:400;color:var(--ink-faint)">(comma-separated, e.g. #ramen, souvenir)</span></label>
          <input class="input" id="ee-tags" placeholder="e.g. #ramen, business" value="${(e.tags ?? []).join(', ')}">
        </div>
        <div>
          <label class="field-label">Country</label>
          <select class="input select" id="ee-country">${countryOptions(editorCountry)}</select>
        </div>
        <div id="ee-city-wrap">${editorCityOpts ? `
          <label class="field-label">City</label>
          <select class="input select" id="ee-city">${editorCityOpts}</select>` : ''}
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
  const cityWrap = m.root.querySelector('#ee-city-wrap') as HTMLElement;
  let editCountry = e.country;
  let editCity = e.city;

  function refreshEditorCity() {
    const opts = cityOptions(editCountry, editCity);
    cityWrap.innerHTML = opts ? `
      <label class="field-label">City</label>
      <select class="input select" id="ee-city">${opts}</select>` : '';
    cityWrap.querySelector('#ee-city')?.addEventListener('change', (ev) => {
      const val = (ev.target as HTMLSelectElement).value;
      if (val === CUSTOM_PLACE) {
        editCity = prompt('City name?')?.trim() || '';
        refreshEditorCity();
      } else {
        editCity = val;
      }
    });
  }

  countrySel.addEventListener('change', () => {
    if (countrySel.value === CUSTOM_PLACE) {
      editCountry = prompt('Country name?')?.trim() || '';
    } else if (countrySel.value === WHOLE_TRIP) {
      editCountry = '';
    } else {
      editCountry = countrySel.value;
    }
    editCity = '';
    refreshEditorCity();
  });

  // Wire initial city select if present
  cityWrap.querySelector('#ee-city')?.addEventListener('change', (ev) => {
    const val = (ev.target as HTMLSelectElement).value;
    if (val === CUSTOM_PLACE) {
      editCity = prompt('City name?')?.trim() || '';
      refreshEditorCity();
    } else {
      editCity = val;
    }
  });

  m.root.querySelector('[data-act="save"]')?.addEventListener('click', async () => {
    const amount = parseFloat((m.root.querySelector('#ee-amount') as HTMLInputElement).value);
    const currency = (m.root.querySelector('#ee-currency') as HTMLSelectElement).value;
    const desc = (m.root.querySelector('#ee-desc') as HTMLInputElement).value.trim();
    const date = (m.root.querySelector('#ee-date') as HTMLInputElement).value;
    const tagsRaw = (m.root.querySelector('#ee-tags') as HTMLInputElement).value;
    const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
    if (!amount || !desc) return;
    const { rate, baseAmount } = convert(rates, amount, currency);
    await expenseStore.update(id, {
      amount, currency, rate, baseAmount, baseCurrency: baseCurrency(),
      description: desc, category: editCat, country: editCountry, city: editCity, date, tags,
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

  // 'place' dim: group by country, then gather city breakdown within each.
  // Country rows carry budget caps.
  const caps = countryBudgets();
  const countryGroups = new Map<string, number>();
  for (const e of expenses) {
    if (!e.country) continue;
    countryGroups.set(e.country, (countryGroups.get(e.country) ?? 0) + inBase(e));
  }
  for (const c of Object.keys(caps)) if (!countryGroups.has(c)) countryGroups.set(c, 0);
  return [...countryGroups.entries()]
    .map(([country, sum]) => {
      const days = daysForPlace('country', country);
      return {
        label: country, sum, color: 'var(--accent)',
        sub: `${fmt(sum / days)}/day · ${days}d`,
        country,
        budget: caps[country],
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

/* ── SVG donut chart for category breakdown ──────────────────────────────── */
function renderDonut(rows: Row[]): string {
  const totalSum = rows.reduce((s, r) => s + r.sum, 0);
  if (totalSum === 0) return '';
  const R = 54; const cx = 68; const cy = 68; const stroke = 18;
  let offset = 0;
  const circ = 2 * Math.PI * R;
  const slices = rows.map((r) => {
    const frac = r.sum / totalSum;
    const dash = frac * circ;
    const gap = circ - dash;
    const slice = `<circle cx="${cx}" cy="${cy}" r="${R}"
      fill="none" stroke="${r.color}" stroke-width="${stroke}"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
      stroke-dashoffset="${(-offset * circ / 1).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})" />`;
    offset += frac;
    return slice;
  }).join('');
  return `
    <svg class="exp-donut" viewBox="0 0 136 136" width="136" height="136">
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>
      ${slices}
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
        class="exp-donut-label">${fmt(totalSum)}</text>
    </svg>`;
}

/* ── Expense calendar (month view with daily spend) ──────────────────────── */
function renderExpenseCalendar(): string {
  const year = calViewYear;
  const month = calViewMonth;
  const todayIso = new Date().toISOString().slice(0, 10);
  const dailyBudget = dailyBudgetAmount();

  // Build daily spend map for all expenses
  const byDay = new Map<string, number>();
  for (const e of expenses) byDay.set(e.date, (byDay.get(e.date) ?? 0) + inBase(e));

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const startOffset = (firstDay + 6) % 7; // Mon-first
  const monthLabel = new Date(year, month, 1).toLocaleString('en', { month: 'long', year: 'numeric' });

  const dayHeaders = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    .map((d) => `<span class="exp-cal-hdr">${d}</span>`).join('');

  let cells = '';
  for (let i = 0; i < startOffset; i++) cells += `<span class="exp-cal-cell exp-cal-empty"></span>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const spend = byDay.get(iso) ?? 0;
    const isToday = iso === todayIso;
    const hasSpend = spend > 0;
    const over = dailyBudget && spend > dailyBudget;
    const dotColor = over ? 'var(--coral-500)' : 'var(--amber-400)';
    cells += `
      <span class="exp-cal-cell${isToday ? ' exp-cal-today' : ''}${hasSpend ? ' exp-cal-has-spend' : ''}"
        data-iso="${iso}" title="${hasSpend ? fmt(spend) : ''}">
        <span class="exp-cal-day">${d}</span>
        ${hasSpend ? `<span class="exp-cal-amt" style="color:${dotColor}">${fmt(spend)}</span>` : ''}
      </span>`;
  }

  return `
    <div class="exp-cal-wrap">
      <div class="exp-cal-bar">
        <button class="exp-cal-nav" data-cal-prev>‹</button>
        <span class="exp-cal-month">${monthLabel}</span>
        <button class="exp-cal-nav" data-cal-next>›</button>
      </div>
      <div class="exp-cal-grid">${dayHeaders}${cells}</div>
    </div>`;
}

function renderBreakdown(el: HTMLElement) {
  const rows = analysisRows();
  const dimLabels: Record<AnalysisDim, string> = {
    category: t('expenses.dimCategory'),
    place:    t('expenses.dimPlace'),
    time:     t('expenses.dimTime'),
  };
  const tabs = ANALYSIS_DIMS.map((d) => `
    <button class="exp-analysis-tab ${d.id === analysisDim ? 'active' : ''}" data-dim="${d.id}">${dimLabels[d.id]}</button>
  `).join('');
  const empty = `<p class="exp-breakdown-empty">${t('expenses.breakdownEmpty')}</p>`;

  let content = '';

  if (analysisDim === 'category') {
    if (rows.length === 0) {
      content = empty;
    } else {
      const donut = renderDonut(rows);
      const totalSum2 = rows.reduce((s, x) => s + x.sum, 0);
      const legend = rows.map((r) => {
        const hasBudget = (r.budget ?? 0) > 0;
        const pct = Math.round((r.sum / Math.max(totalSum2, 1)) * 100);
        const budgetStr = hasBudget
          ? `<span class="exp-legend-budget">${fmt(r.sum)} / ${fmt(r.budget!)}${r.sum > r.budget! ? ' ' + t('expenses.over') : ''}</span>`
          : '';
        const setBtn = r.catId
          ? `<button class="exp-cat-budget-btn" data-budget-key="cat:${r.catId}" title="${hasBudget ? 'Edit budget' : 'Set budget'}">${hasBudget ? '✎' : '＋'}</button>`
          : '';
        return `
          <div class="exp-legend-row">
            <span class="exp-legend-dot" style="background:${r.color}"></span>
            <span class="exp-legend-name">${r.label} ${setBtn}</span>
            <span class="exp-legend-pct">${pct}%</span>
            <span class="exp-legend-amt">${fmt(r.sum)}</span>
            ${budgetStr}
          </div>`;
      }).join('');
      content = `
        <div class="exp-donut-wrap">
          ${donut}
          <div class="exp-legend">${legend}</div>
        </div>`;
    }
  }

  else if (analysisDim === 'time') {
    if (rows.length === 0) {
      content = empty + renderExpenseCalendar();
    } else {
      const dailyBudget = dailyBudgetAmount();
      const maxAmt = Math.max(...rows.map((r) => r.sum), dailyBudget ?? 0, 1);
      // Most-recent 30 days, oldest left to right
      const recent = [...rows].reverse().slice(-30);
      const W = 400; const H = 110; const labelH = 18;
      const chartH = H - labelH;
      // Cap bar width so a single bar isn't the full chart width
      const maxBarW = 40;
      const rawBarW = W / Math.max(recent.length, 1);
      const barW = Math.min(rawBarW, maxBarW);
      const totalBarSpan = barW * recent.length;
      const xOffset = (W - totalBarSpan) / 2; // centre the bars
      const bars = recent.map((r, i) => {
        const barPx = Math.max(3, (r.sum / maxAmt) * chartH);
        const over = dailyBudget ? r.sum > dailyBudget : false;
        const color = over ? 'var(--coral-500)' : 'var(--amber-400)';
        const label = r.label.slice(5); // strip YYYY-
        const x = xOffset + i * barW;
        return `
          <g>
            <rect x="${(x + 1).toFixed(1)}" y="${(chartH - barPx).toFixed(1)}"
              width="${(barW - 2).toFixed(1)}" height="${barPx.toFixed(1)}"
              fill="${color}" rx="2"/>
            ${recent.length <= 14 ? `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 2}"
              text-anchor="middle" class="exp-bar-label">${label}</text>` : ''}
          </g>`;
      }).join('');
      const budgetY = dailyBudget ? (chartH - (dailyBudget / maxAmt) * chartH).toFixed(1) : null;
      const budgetLine = budgetY
        ? `<line x1="0" y1="${budgetY}" x2="${W}" y2="${budgetY}"
               stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4 3"/>`
        : '';
      content = `
        <div class="exp-barchart-wrap">
          <svg class="exp-barchart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax meet">
            ${budgetLine}${bars}
          </svg>
          ${dailyBudget ? `<div class="exp-bar-legend"><span class="exp-daily-budget-swatch"></span>${t('expenses.budgetTarget')} ${fmt(dailyBudget)}${t('expenses.perDay')}</div>` : ''}
        </div>
        ${renderExpenseCalendar()}`;
    }
  }

  else { // place
    if (rows.length === 0) {
      content = empty;
    } else {
      const maxAmt = Math.max(...rows.map((r) => r.sum), 1);
      content = rows.map((r) => {
        const flag = legs.find((l) => l.country === r.country)?.flag ?? '';
        const hasBudget = (r.budget ?? 0) > 0;
        const pct = hasBudget ? Math.min(100, (r.sum / r.budget!) * 100) : (r.sum / maxAmt) * 100;
        const usage = hasBudget ? r.sum / r.budget! : 0;
        const barColor = hasBudget
          ? (usage >= 1 ? 'var(--coral-500)' : usage >= 0.8 ? '#f59e0b' : 'var(--sage-500)')
          : 'var(--amber-300)';
        const budgetStr = hasBudget
          ? `${fmt(r.sum)} / ${fmt(r.budget!)}${r.sum > r.budget! ? ' · ' + t('expenses.over') : ''}`
          : (r.sub ?? '');

        // City breakdown nested under country
        const cityGroups = new Map<string, number>();
        for (const e of expenses) {
          if (e.country !== r.country || !e.city) continue;
          cityGroups.set(e.city, (cityGroups.get(e.city) ?? 0) + inBase(e));
        }
        const cityRows = [...cityGroups.entries()].sort((a, b) => b[1] - a[1]);
        const cityHtml = cityRows.map(([city, citySum]) => `
          <div class="exp-place-city">
            <span class="exp-place-city-name">${city}</span>
            <span class="exp-place-city-amt">${fmt(citySum)}</span>
          </div>`).join('');

        return `
          <div class="exp-place-row">
            <div class="exp-place-header">
              <span class="exp-place-flag">${flag}</span>
              <span class="exp-place-name">${r.country}</span>
              <button class="exp-cat-budget-btn" data-budget-key="country:${r.country}"
                title="${hasBudget ? 'Edit budget' : 'Set budget'}">${hasBudget ? '✎' : '＋'}</button>
              <span class="exp-place-total">${fmt(r.sum)}</span>
            </div>
            <div class="exp-cat-bar-track" style="margin:4px 0 6px">
              <div class="exp-cat-bar-fill" style="width:${pct}%;background:${barColor}"></div>
            </div>
            ${budgetStr ? `<div class="exp-place-sub">${budgetStr}</div>` : ''}
            ${cityHtml ? `<div class="exp-place-cities">${cityHtml}</div>` : ''}
          </div>`;
      }).join('');
    }
  }

  el.innerHTML = `
    <div class="exp-breakdown">
      <div class="exp-form-title" style="margin-bottom:var(--sp-4)">${t('expenses.analysisTitle')}</div>
      <div class="exp-analysis-tabs">${tabs}</div>
      ${content}
    </div>`;

  el.querySelectorAll('.exp-analysis-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      analysisDim = (btn as HTMLElement).dataset.dim as AnalysisDim;
      renderBreakdown(el);
    });
  });

  el.querySelectorAll<HTMLElement>('.exp-cat-budget-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const [kind] = btn.dataset.budgetKey!.split(/:(.+)/);
      openBudgetPage(kind === 'country' ? 'country' : 'category');
    });
  });

  // Expense calendar nav
  el.querySelector('[data-cal-prev]')?.addEventListener('click', () => {
    calViewMonth--;
    if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
    renderBreakdown(el);
  });
  el.querySelector('[data-cal-next]')?.addEventListener('click', () => {
    calViewMonth++;
    if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
    renderBreakdown(el);
  });
}

/* ── Budget overview modal (total / country / category) ──────────────────── */

/* ── Budget overlay page ─────────────────────────────────────────────────── */

function onBudgetKey(ev: KeyboardEvent) { if (ev.key === 'Escape') closeBudgetPage(); }

function openBudgetPage(tab: BudgetTab = 'total') {
  budgetTab = tab;
  showBudget = true;
  document.body.classList.add('exp-records-lock');
  document.addEventListener('keydown', onBudgetKey);
  renderBudgetPage();
}

function closeBudgetPage() {
  showBudget = false;
  document.body.classList.remove('exp-records-lock');
  document.removeEventListener('keydown', onBudgetKey);
  renderBudgetPage();
  renderSummaryRoot();
}

function renderBudgetPage() {
  const panel = document.querySelector('.exp-budget-panel') as HTMLElement | null;
  if (!panel) return;
  panel.classList.toggle('open', showBudget);
  if (!showBudget) { panel.innerHTML = ''; return; }

  const sym = currencySymbol(baseCurrency());
  const tripTotal = tripBudget();
  const sum = total(expenses);

  panel.innerHTML = `
    <div class="exp-records-overlay exp-budget-overlay">
      <div class="exp-records-bar">
        <button class="exp-records-back" id="exp-budget-back">${t('expenses.btnBack')}</button>
        <div class="exp-records-bar-title">${t('expenses.budgetTitle')}</div>
      </div>
      <div class="exp-records-scroll">
        <!-- Compare section -->
        <div class="exp-budget-compare">
          <div class="exp-budget-compare-total">
            ${tripTotal ? `
              <div class="exp-budget-compare-row">
                <span class="exp-bcp-label">${t('expenses.totalBudget')}</span>
                <span class="exp-bcp-val">${sym}${Math.round(tripTotal).toLocaleString()}</span>
              </div>
              <div class="exp-budget-compare-row">
                <span class="exp-bcp-label">${t('expenses.spentSoFar')}</span>
                <span class="exp-bcp-val">${fmt(sum)}</span>
              </div>
              <div class="exp-budget-bar-track exp-budget-compare-bar">
                ${(() => {
                  const pct = Math.min(100, Math.round((sum / tripTotal) * 100));
                  const color = pct >= 100 ? 'var(--coral-500)' : pct >= 80 ? '#f59e0b' : 'var(--sage-500)';
                  return `<div class="exp-budget-bar-fill" style="width:${pct}%;background:${color}"></div>`;
                })()}
              </div>
              <div class="exp-budget-compare-foot">
                ${sum > tripTotal
                  ? `<span class="exp-budget-over">▲ ${fmt(sum - tripTotal)} ${t('expenses.overBudget')}</span>`
                  : `<span class="exp-budget-remain">${fmt(tripTotal - sum)} ${t('expenses.remaining')} (${Math.round((sum / tripTotal) * 100)}%)</span>`}
              </div>` : `
              <p class="exp-modal-hint">${t('expenses.noBudgetHint')}</p>`}
          </div>

          <!-- Per-country compare rows -->
          ${(() => {
            const caps = countryBudgets();
            const countriesList = [...new Set([...legCountries(legs), ...Object.keys(caps)])];
            if (!countriesList.length) return '';
            const hasCaps = countriesList.some((c) => caps[c]);
            if (!hasCaps) return '';
            return `
              <div class="exp-budget-section-title">${t('expenses.byCountry')}</div>
              ${countriesList.filter((c) => caps[c]).map((c) => {
                const spent = countrySpend(c);
                const cap = caps[c];
                const pct = Math.min(100, Math.round((spent / cap) * 100));
                const over = spent > cap;
                const color = pct >= 100 ? 'var(--coral-500)' : pct >= 80 ? '#f59e0b' : 'var(--sage-500)';
                const flag = legs.find((l) => l.country === c)?.flag ?? '';
                return `
                  <div class="exp-budget-cmp-row">
                    <div class="exp-budget-cmp-name">${flag} ${c}</div>
                    <div class="exp-budget-cmp-bar-wrap">
                      <div class="exp-budget-bar-track" style="flex:1">
                        <div class="exp-budget-bar-fill" style="width:${pct}%;background:${color}"></div>
                      </div>
                    </div>
                    <div class="exp-budget-cmp-nums">
                      <span>${fmt(spent)}</span>
                      <span class="exp-budget-cmp-sep">/</span>
                      <span>${sym}${Math.round(cap).toLocaleString()}</span>
                      ${over ? `<span class="exp-budget-over">${t('expenses.over')}</span>` : ''}
                    </div>
                  </div>`;
              }).join('')}`;
          })()}

          <!-- Per-category compare rows -->
          ${(() => {
            const caps = categoryBudgets();
            const hasCaps = categories().some((c) => caps[c.id]);
            if (!hasCaps) return '';
            return `
              <div class="exp-budget-section-title">${t('expenses.byCategory')}</div>
              ${categories().filter((cat) => caps[cat.id]).map((cat) => {
                const spent = expenses.filter((e) => e.category === cat.id).reduce((s, e) => s + inBase(e), 0);
                const cap = caps[cat.id];
                const pct = Math.min(100, Math.round((spent / cap) * 100));
                const over = spent > cap;
                const color = pct >= 100 ? 'var(--coral-500)' : pct >= 80 ? '#f59e0b' : 'var(--sage-500)';
                return `
                  <div class="exp-budget-cmp-row">
                    <div class="exp-budget-cmp-name">${cat.icon} ${cat.label}</div>
                    <div class="exp-budget-cmp-bar-wrap">
                      <div class="exp-budget-bar-track" style="flex:1">
                        <div class="exp-budget-bar-fill" style="width:${pct}%;background:${color}"></div>
                      </div>
                    </div>
                    <div class="exp-budget-cmp-nums">
                      <span>${fmt(spent)}</span>
                      <span class="exp-budget-cmp-sep">/</span>
                      <span>${sym}${Math.round(cap).toLocaleString()}</span>
                      ${over ? `<span class="exp-budget-over">${t('expenses.over')}</span>` : ''}
                    </div>
                  </div>`;
              }).join('')}`;
          })()}
        </div>

        <!-- Settings section -->
        <div class="exp-budget-section-title exp-budget-settings-title">${t('expenses.settingsTitle')}</div>
        <div class="exp-budget-tabs">
          <button class="exp-budget-tab ${budgetTab === 'total' ? 'active' : ''}" data-tab="total">${t('expenses.budgetTabTotal')}</button>
          <button class="exp-budget-tab ${budgetTab === 'country' ? 'active' : ''}" data-tab="country">${t('expenses.budgetTabCountry')}</button>
          <button class="exp-budget-tab ${budgetTab === 'category' ? 'active' : ''}" data-tab="category">${t('expenses.budgetTabCategory')}</button>
        </div>
        <div class="exp-budget-settings-pane" id="exp-budget-settings-pane"></div>
      </div>
    </div>
  `;

  const settingsPane = panel.querySelector('#exp-budget-settings-pane') as HTMLElement;

  const renderSettings = () => {
    panel.querySelectorAll<HTMLElement>('.exp-budget-tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === budgetTab));

    if (budgetTab === 'total') {
      const budget = tripBudget();
      settingsPane.innerHTML = `
        <label class="field-label">Total trip budget (${sym}, ${baseCurrency()})</label>
        <input class="input" type="number" id="bm-total" min="0" step="1" placeholder="e.g. 5000" value="${budget ?? ''}">
        <p class="exp-modal-hint">${t('expenses.budgetTotalHint')}</p>`;
      const input = settingsPane.querySelector('#bm-total') as HTMLInputElement;
      const save = async () => {
        const val = parseFloat(input.value);
        await setTripBudget(val > 0 ? val : null);
        renderBudgetPage();
        renderSummaryRoot();
      };
      input.addEventListener('change', save);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      return;
    }

    if (budgetTab === 'country') {
      const caps = countryBudgets();
      const countriesList = [...new Set([...legCountries(legs), ...Object.keys(caps)])];
      const totalCap = Object.values(caps).reduce((s, v) => s + v, 0);
      const flex = tripTotal ? tripTotal - totalCap : null;

      // Per-country day count from itinerary
      const countryDays: Record<string, number> = {};
      for (const leg of legs) {
        if (!leg.country) continue;
        const from = new Date(leg.dateFrom);
        const to   = new Date(leg.dateTo);
        const d = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
        countryDays[leg.country] = (countryDays[leg.country] ?? 0) + d;
      }

      settingsPane.innerHTML = `
        ${countriesList.length === 0 ? `<p class="exp-modal-hint">${t('expenses.noCountriesHint')}</p>` : `
          <div class="exp-budget-auto-row">
            <div class="exp-budget-auto-hint">Auto-estimate by itinerary days ×</div>
            <input class="input exp-budget-daily-rate" type="number" id="bm-daily-rate" min="0" step="1" placeholder="daily rate" value="">
            <span class="exp-budget-auto-unit">${sym}/day</span>
            <button class="btn btn-ghost pk-sm" id="bm-apply-daily">Apply</button>
          </div>`}
        <div class="exp-budget-rows">
          ${countriesList.map((c) => {
            const flag = legs.find((l) => l.country === c)?.flag ?? '';
            const spent = countrySpend(c);
            const daysLabel = countryDays[c] ? ` · ${countryDays[c]}d` : '';
            return `
              <div class="exp-budget-row">
                <div class="exp-budget-row-name">${flag} ${c}<span class="exp-budget-row-spent">${fmt(spent)} ${t('expenses.spentLabel')}${daysLabel}</span></div>
                <input class="input exp-budget-row-input" type="number" min="0" step="1" data-country="${c}" data-days="${countryDays[c] ?? 0}" placeholder="no cap" value="${caps[c] ?? ''}">
              </div>`;
          }).join('')}
        </div>
        ${flex != null ? `<p class="exp-budget-flex ${flex < 0 ? 'over' : ''}">${t('expenses.allocatedLabel')} ${fmt(totalCap)} · ${flex < 0 ? `${fmt(-flex)} ${t('expenses.overTotal')}` : `${fmt(flex)} ${t('expenses.unallocated')}`}</p>` : ''}`;

      // Auto-estimate: fill all inputs with days × daily rate
      settingsPane.querySelector('#bm-apply-daily')?.addEventListener('click', async () => {
        const rateEl = settingsPane.querySelector<HTMLInputElement>('#bm-daily-rate');
        const rate = parseFloat(rateEl?.value ?? '');
        if (!rate || rate <= 0) { rateEl?.focus(); return; }
        const saves = [...settingsPane.querySelectorAll<HTMLInputElement>('.exp-budget-row-input')]
          .map(async (inp) => {
            const d = parseInt(inp.dataset.days ?? '0', 10);
            if (!d) return;
            const est = Math.round(d * rate);
            inp.value = String(est);
            await setCountryBudget(inp.dataset.country!, est);
          });
        await Promise.all(saves);
        renderBudgetPage();
        renderSummaryRoot();
        renderForm(document.querySelector('.exp-form-wrap') as HTMLElement);
      });

      settingsPane.querySelectorAll<HTMLInputElement>('.exp-budget-row-input').forEach((input) => {
        input.addEventListener('change', async () => {
          const val = parseFloat(input.value);
          await setCountryBudget(input.dataset.country!, val > 0 ? val : null);
          renderBudgetPage();
          renderSummaryRoot();
          renderForm(document.querySelector('.exp-form-wrap') as HTMLElement);
        });
      });
      return;
    }

    // category tab
    const caps = categoryBudgets();
    const totalCap = Object.values(caps).reduce((s, v) => s + v, 0);
    const flex = tripTotal ? tripTotal - totalCap : null;
    settingsPane.innerHTML = `
      <div class="exp-budget-rows">
        ${categories().map((cat) => {
          const spent = expenses.filter((e) => e.category === cat.id).reduce((s, e) => s + inBase(e), 0);
          return `
            <div class="exp-budget-row">
              <div class="exp-budget-row-name">${cat.icon} ${cat.label}<span class="exp-budget-row-spent">${fmt(spent)} ${t('expenses.spentLabel')}</span></div>
              <input class="input exp-budget-row-input" type="number" min="0" step="1" data-cat="${cat.id}" placeholder="no cap" value="${caps[cat.id] ?? ''}">
            </div>`;
        }).join('')}
      </div>
      ${flex != null ? `<p class="exp-budget-flex ${flex < 0 ? 'over' : ''}">${t('expenses.allocatedLabel')} ${fmt(totalCap)} · ${flex < 0 ? `${fmt(-flex)} ${t('expenses.overTotal')}` : `${fmt(flex)} ${t('expenses.unallocated')}`}</p>` : ''}`;
    settingsPane.querySelectorAll<HTMLInputElement>('.exp-budget-row-input').forEach((input) => {
      input.addEventListener('change', async () => {
        const val = parseFloat(input.value);
        await setCategoryBudget(input.dataset.cat!, val > 0 ? val : null);
        renderBudgetPage();
        renderSummaryRoot();
      });
    });
  };

  panel.querySelector('#exp-budget-back')?.addEventListener('click', () => closeBudgetPage());
  panel.querySelectorAll<HTMLElement>('.exp-budget-tab').forEach((btn) => {
    btn.addEventListener('click', () => { budgetTab = btn.dataset.tab as BudgetTab; renderSettings(); });
  });

  renderSettings();
}

/* ── Orchestration ───────────────────────────────────────────────────────── */

function renderSummaryRoot() {
  const root = document.getElementById('view-expenses');
  if (root) renderSummary(root.querySelector('.exp-summary')!);
  if (showBudget) renderBudgetPage();
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

  // Close fixed overlays when navigating away from expenses.
  window.addEventListener('hashchange', () => {
    const view = window.location.hash.replace('#', '');
    if (view !== 'expenses') {
      if (showRecords) closeRecords();
      if (showBudget) closeBudgetPage();
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
