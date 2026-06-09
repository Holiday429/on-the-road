/* ==========================================================================
   On the Road · Expenses tracker
   --------------------------------------------------------------------------
   Cloud-synced via expenseStore (Firestore source of truth; localStorage is an
   instant-paint cache inside the store layer). Every expense keeps the user's
   raw amount + currency, plus a snapshot of the conversion to the trip's base
   currency at record time (rate/baseAmount) so historical totals never drift.

   Smart defaults pull from the itinerary: the leg covering today seeds the
   city, country and local currency, so logging a spend is usually just a number
   and a few words. Category may be left blank — those land in an "unclassified"
   pile you can tidy up afterwards.
   ========================================================================== */

import './expenses.css';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import {
  baseCurrency, setBaseCurrency, tripBudget, setTripBudget,
  categoryBudgets, setCategoryBudget, onTripChange, currentTripId,
} from '../../data/trip-context.ts';
import {
  expenseCategoryStore, type StoredExpenseCategory,
} from '../../data/stores/expense-category-store.ts';
import {
  CURRENCIES, currencySymbol, getRateTable, peekRateTable, type RateTable,
} from '../../data/rates.ts';
import { openModal } from '../../core/modal.ts';

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

// Used only to default the currency from the leg's country. Not exhaustive —
// anything unmapped just falls back to the trip base currency.
const COUNTRY_CURRENCY: Record<string, string> = {
  Denmark: 'DKK', Sweden: 'SEK', Norway: 'NOK', Switzerland: 'CHF',
  'United Kingdom': 'GBP', 'Czech Republic': 'CZK', Czechia: 'CZK',
  Japan: 'JPY', 'United States': 'USD', China: 'CNY',
  Germany: 'EUR', France: 'EUR', Spain: 'EUR', Portugal: 'EUR',
  Italy: 'EUR', Netherlands: 'EUR', Belgium: 'EUR', Austria: 'EUR',
  Ireland: 'EUR', Greece: 'EUR',
};

const UNCLASSIFIED = '';

let expenses: StoredExpense[] = [];
let legs: StoredLeg[] = [];
let customCategories: StoredExpenseCategory[] = [];
let rates: RateTable = {};
let selectedCategory = 'food';
let filterCategory = 'all';
let filterCity = 'all';
let analysisDim: AnalysisDim = 'category';
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

function parseTags(text: string): string[] {
  return text.split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
}

/* ── Leg-aware defaults ──────────────────────────────────────────────────── */

function legForDate(iso: string): StoredLeg | undefined {
  return legs.find((l) => iso >= l.dateFrom && iso <= l.dateTo);
}

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

function defaultCurrency(iso: string): string {
  const leg = legForDate(iso);
  if (leg) return COUNTRY_CURRENCY[leg.country] ?? baseCurrency();
  return baseCurrency();
}

/* ── Conversion ──────────────────────────────────────────────────────────── */

/** Convert a raw amount in `currency` to the current base currency using the
 *  live rate table. Used at record time to snapshot rate + baseAmount. */
function convert(amount: number, currency: string): { rate: number; baseAmount: number } {
  const rate = rates[currency] ?? 1;
  return { rate, baseAmount: amount * rate };
}

/* ── CRUD ────────────────────────────────────────────────────────────────── */

async function addExpense(
  amount: number, currency: string, description: string, date: string,
  category: string, tags: string[],
) {
  if (!amount || !description.trim()) return false;
  const leg = legForDate(date);
  const { rate, baseAmount } = convert(amount, currency);
  await expenseStore.add({
    amount, currency, rate, baseAmount,
    baseCurrency: baseCurrency(),
    description: description.trim(),
    category,
    tags,
    city: leg?.city ?? '',
    country: leg?.country ?? '',
    date,
  });
  return true;
}

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
          <div class="exp-budget-card">
            <div class="exp-budget-top">
              <div class="exp-budget-label">Budget</div>
              <button class="exp-budget-edit" id="exp-budget-edit" title="Edit budget">✎</button>
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
          </div>`;
      })()
    : `
      <div class="exp-budget-card exp-budget-empty">
        <div class="exp-budget-label">Budget</div>
        <button class="exp-budget-set" id="exp-budget-edit">Set a budget</button>
      </div>`;

  el.innerHTML = `
    <div class="exp-stat-card accent">
      <div class="exp-stat-num">${fmt(sum)}</div>
      <div class="exp-stat-label">Total spent</div>
    </div>
    <div class="exp-stat-card">
      <div class="exp-stat-num">${fmt(dailyAvg)}</div>
      <div class="exp-stat-label">Daily avg</div>
    </div>
    <div class="exp-stat-card">
      <div class="exp-stat-num">${expenses.length}</div>
      <div class="exp-stat-label">Transactions</div>
    </div>
    <div class="exp-stat-card">
      <div class="exp-stat-num">${unclassified || getCities().length}</div>
      <div class="exp-stat-label">${unclassified ? 'To sort' : 'Cities'}</div>
    </div>
    ${budgetBlock}
  `;

  el.querySelector('#exp-budget-edit')?.addEventListener('click', () => openBudgetModal(el));
}

function openBudgetModal(summaryEl: HTMLElement) {
  const budget = tripBudget();
  const sym = currencySymbol(baseCurrency());

  const m = openModal({
    title: 'Trip budget',
    body: `
      <label class="field-label">Total budget (${sym}, ${baseCurrency()})</label>
      <input class="input" type="number" id="exp-budget-input" min="0" step="1"
        placeholder="e.g. 5000" value="${budget ?? ''}">
      <p class="exp-modal-hint">Set your total trip budget. This appears as a bar in the summary so you can track spend vs plan at a glance.</p>`,
    footer: `
      ${budget ? `<button class="btn btn-danger" data-act="remove">Remove</button>` : ''}
      <button class="btn btn-primary" data-act="save">Save</button>`,
  });

  const input = m.root.querySelector('#exp-budget-input') as HTMLInputElement;
  const save = async () => {
    const val = parseFloat(input.value);
    await setTripBudget(val > 0 ? val : null);
    m.close();
    renderSummary(summaryEl);
  };
  m.root.querySelector('[data-act="save"]')?.addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  m.root.querySelector('[data-act="remove"]')?.addEventListener('click', async () => {
    await setTripBudget(null);
    m.close();
    renderSummary(summaryEl);
  });
}

/* ── Render: form ────────────────────────────────────────────────────────── */

function currencyOptions(selected: string): string {
  return CURRENCIES.map((c) =>
    `<option value="${c.code}" ${c.code === selected ? 'selected' : ''}>${c.flag} ${c.code} ${c.symbol}</option>`,
  ).join('');
}

function renderForm(el: HTMLElement) {
  const todayIso = new Date().toISOString().split('T')[0];
  const defCur = defaultCurrency(todayIso);
  const base = baseCurrency();

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
          <label class="field-label">Date</label>
          <input class="input" type="date" id="exp-date" value="${todayIso}">
        </div>
        <div>
          <label class="field-label">Tags</label>
          <input class="input" id="exp-tags" placeholder="ramen, with friends">
        </div>
      </div>
      <button class="btn btn-primary" id="exp-add-btn" style="width:100%;justify-content:center">Add expense</button>
    </div>
  `;

  const dateInput = el.querySelector('#exp-date') as HTMLInputElement;
  const curInput = el.querySelector('#exp-currency') as HTMLSelectElement;
  dateInput.addEventListener('change', () => {
    curInput.value = defaultCurrency(dateInput.value);
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
    const date = dateInput.value;
    const tags = parseTags((el.querySelector('#exp-tags') as HTMLInputElement).value);

    if (await addExpense(amount, currency, desc, date, selectedCategory, tags)) {
      (el.querySelector('#exp-amount') as HTMLInputElement).value = '';
      (el.querySelector('#exp-desc') as HTMLInputElement).value = '';
      (el.querySelector('#exp-tags') as HTMLInputElement).value = '';
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

/* ── Render: list ────────────────────────────────────────────────────────── */

function renderList(el: HTMLElement) {
  const cities = getCities();
  const list = filteredExpenses();
  const unsortedCount = expenses.filter((e) => e.category === UNCLASSIFIED).length;

  el.innerHTML = `
    <div class="exp-list-header">
      <div class="exp-list-title">Transactions</div>
    </div>
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
        <p>No expenses yet. Add your first one!</p>
      </div>
    ` : `
    <div class="exp-items">
      ${list.map((e) => {
        const cat = categoryById(e.category);
        const baseStr = e.currency !== baseCurrency() ? ` · ${fmt(inBase(e))}` : '';
        const meta = [cat?.label ?? 'Unsorted', e.city, e.date].filter(Boolean);
        const tags = e.tags?.length
          ? `<div class="exp-item-tags">${e.tags.map((t) => `<span class="exp-tag">#${t}</span>`).join('')}</div>`
          : '';
        // Unsorted items get an inline category picker so a whole pile can be
        // tidied without opening each one.
        const picker = e.category === UNCLASSIFIED ? `
          <div class="exp-item-picker">
            ${categories().map((c) => `<button class="exp-item-cat" data-id="${e.id}" data-cat="${c.id}" title="${c.label}">${c.icon}</button>`).join('')}
          </div>` : '';
        return `
          <div class="exp-item ${e.category === UNCLASSIFIED ? 'unsorted' : ''}">
            <div class="exp-item-icon" style="background:${cat?.color ?? '#f3f4f6'}">${cat?.icon ?? '🗂️'}</div>
            <div class="exp-item-body">
              <div class="exp-item-desc">${e.description}</div>
              <div class="exp-item-meta">
                ${meta.map((m, i) => `${i ? '<span>·</span>' : ''}<span>${m}</span>`).join('')}
              </div>
              ${tags}
              ${picker}
            </div>
            <div class="exp-item-amount">${fmtRaw(e.amount, e.currency)}${baseStr}</div>
            <button class="exp-item-delete" data-id="${e.id}">✕</button>
          </div>
        `;
      }).join('')}
    </div>`}
  `;

  el.querySelectorAll('.exp-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterCategory = (btn as HTMLElement).dataset.filter!;
      renderList(el);
    });
  });

  el.querySelectorAll('.exp-city-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      filterCity = (pill as HTMLElement).dataset.city!;
      renderList(el);
    });
  });

  el.querySelector('#exp-sort-banner')?.addEventListener('click', () => {
    filterCategory = UNCLASSIFIED;
    renderList(el);
  });

  el.querySelectorAll('.exp-item-cat').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { id, cat } = (btn as HTMLElement).dataset;
      void expenseStore.update(id!, { category: cat! });
    });
  });

  el.querySelectorAll('.exp-item-delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteExpense((btn as HTMLElement).dataset.id!));
  });
}

/* ── Render: analysis ────────────────────────────────────────────────────── */

interface Row { label: string; sum: number; color: string; sub?: string; catId?: string; budget?: number; isDay?: boolean; }

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
  const key = analysisDim;
  const groups = new Map<string, number>();
  for (const e of expenses) {
    const v = e[key];
    if (!v) continue;
    groups.set(v, (groups.get(v) ?? 0) + inBase(e));
  }
  return [...groups.entries()]
    .map(([value, sum]) => {
      const days = daysForPlace(key, value);
      return { label: value, sum, color: 'var(--accent)', sub: `${fmt(sum / days)}/day · ${days}d` };
    })
    .sort((a, b) => b.sum - a.sum);
}

function dailyBudgetAmount(): number | null {
  const budget = tripBudget();
  if (!budget) return null;
  const legs = routeStore.peek().filter((l) => l.tripId === currentTripId());
  if (!legs.length) return null;
  const dates = legs.flatMap((l) => [l.dateFrom, l.dateTo]);
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
        const setBtn = r.catId
          ? `<button class="exp-cat-budget-btn" data-cat-budget="${r.catId}" title="${hasBudget ? 'Edit budget' : 'Set budget'}">${hasBudget ? '✎' : '＋'}</button>`
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
      openCategoryBudgetModal(btn.dataset.catBudget!, el);
    });
  });
}

/** Modal to set/clear a single category's budget cap. */
function openCategoryBudgetModal(catId: string, breakdownEl: HTMLElement) {
  const cat = categoryById(catId);
  const current = categoryBudgets()[catId];
  const sym = currencySymbol(baseCurrency());

  const m = openModal({
    title: `${cat ? `${cat.icon} ${cat.label}` : 'Category'} budget`,
    body: `
      <label class="field-label">Cap for this category (${sym}, ${baseCurrency()})</label>
      <input class="input" type="number" id="exp-catbudget-input" min="0" step="1"
        placeholder="e.g. 800" value="${current ?? ''}">
      <p class="exp-modal-hint">The category bar will track spend against this cap and turn amber, then red, as you approach it.</p>`,
    footer: `
      ${current ? `<button class="btn btn-danger" data-act="remove">Remove</button>` : ''}
      <button class="btn btn-primary" data-act="save">Save</button>`,
  });

  const input = m.root.querySelector('#exp-catbudget-input') as HTMLInputElement;
  const save = async () => {
    const val = parseFloat(input.value);
    await setCategoryBudget(catId, val > 0 ? val : null);
    m.close();
    renderBreakdown(breakdownEl);
  };
  m.root.querySelector('[data-act="save"]')?.addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  m.root.querySelector('[data-act="remove"]')?.addEventListener('click', async () => {
    await setCategoryBudget(catId, null);
    m.close();
    renderBreakdown(breakdownEl);
  });
}

/* ── Orchestration ───────────────────────────────────────────────────────── */

function render() {
  const root = document.getElementById('view-expenses');
  if (!root) return;
  renderSummary(root.querySelector('.exp-summary')!);
  renderList(root.querySelector('.exp-list-wrap')!);
  renderBreakdown(root.querySelector('.exp-breakdown-wrap')!);
}

export function initExpenses() {
  const root = document.getElementById('view-expenses');
  if (!root) return;

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
  // A trip switch changes base currency, total budget AND category caps — repaint everything.
  unsubTripChange = onTripChange(() => render());
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
