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
import { renderRecordTag as recordTag } from './expense-record-tag.ts';
import { t } from '../../core/i18n.ts';
import { escHtml } from '../../core/utils.ts';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import {
  baseCurrency, setBaseCurrency, tripBudget,
  categoryBudgets, countryBudgets,
  onTripChange, currentTripId,
} from '../../data/trip-context.ts';
import {
  expenseCategoryStore, type StoredExpenseCategory,
} from '../../data/stores/expense-category-store.ts';
import {
  CURRENCIES, allCurrencies, isApproxCurrency, currencySymbol, getRateTable, peekRateTable, type RateTable,
} from '../../data/rates.ts';
import { budgetBarColor } from '../../data/budget-tone.ts';
import { budgetPace, tripSpan } from '../../data/budget-pace.ts';
import { openModal } from '../../core/modal.ts';
import '../../core/paper/paper.css';
import { convertedHint } from './checkout.ts';
import { initMart, martVfd, refreshMart, startIdle, vfdError, runScan } from './checkout-wire.ts';
import { beepEnabled, setBeepEnabled } from './checkout-fx.ts';
import { paperStamp } from '../../core/paper/paper.ts';
import { openCurrencyManager } from './currency-manager.ts';
import {
  lastUsed, legCountries, legCitiesFor, defaultPlace, defaultCurrency,
  convert, addExpenseWithDefaults, knownCurrencyForCountry,
} from './expense-defaults.ts';
import {
  type Category, BUILTIN_CATEGORIES, UNCLASSIFIED, categoryDisplayColor, categoryInkColor, categoryChartColor,
  type AnalysisDim, ANALYSIS_DIMS, nightCount, renderDonut,
} from './expense-helpers.ts';
import {
  initBudgetAnalysis, openBudgetAnalysis, closeBudgetAnalysis, renderBudgetAnalysis, isBudgetAnalysisOpen,
} from './budget-analysis.ts';

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

/* ── Render: summary (2 equal hero buttons) ──────────────────────────────── */

function renderSummary(el: HTMLElement) {
  const sum = total(expenses);
  const budget = tripBudget();
  const sym = currencySymbol(baseCurrency());
  const unclassified = expenses.filter((e) => e.category === UNCLASSIFIED).length;
  const toSortChip = unclassified
    ? `<span class="exp-stat-chip" id="exp-tosort-chip">🗂️ ${t('expenses.toSort', { n: unclassified })}</span>`
    : '';

  // Right button: if budget set, show spent/total + bar; else invite to set one.
  const budgetRight = budget
    ? (() => {
        const pct = Math.min(100, Math.round((sum / budget) * 100));
        const over = sum > budget;
        const span = tripSpan(legs);
        const fast = budgetPace({ spent: sum, budget, startIso: span.startIso, endIso: span.endIso, todayIso: new Date().toISOString().slice(0, 10) }).status === 'fast';
        const barColor = fast && !over ? 'var(--amber-500)' : budgetBarColor(pct);
        return `
          <div class="exp-hero-eyebrow">${t('expenses.budgetAnalysisTitle')}</div>
          <div class="exp-hero-num">${sym}${Math.round(budget).toLocaleString()}</div>
          <div class="exp-hero-bar-track">
            <div class="exp-hero-bar-fill" style="width:${pct}%;background:${barColor}"></div>
          </div>
          <div class="exp-hero-label ${over ? 'exp-hero-label-over' : fast ? 'exp-hero-label-fast' : ''}">
            ${over ? `▲ ${fmt(sum - budget)} ${t('expenses.over')}` : `${fmt(budget - sum)} ${t('expenses.remaining')}${fast ? ` · ${t('expenses.ba.statusFast')}` : ''} ›`}
          </div>
          ${over ? paperStamp({ text: t('expenses.overBudget'), tone: 'bad', corner: true }) : ''}`;
      })()
    : `<div class="exp-hero-eyebrow">${t('expenses.budgetAnalysisTitle')}</div>
       <div class="exp-hero-num exp-hero-empty">—</div>
       <div class="exp-hero-label">${t('expenses.tapToSet')}</div>`;

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
  el.innerHTML = `
    <button class="exp-hero-btn exp-hero-spend" id="exp-open-records">
      <div class="exp-hero-eyebrow">${t('expenses.totalSpent')} ${toSortChip ? '· ' + t('expenses.toSort', { n: unclassified }) : ''}</div>
      <div class="exp-hero-num">${fmt(sum)}</div>
      <div class="exp-hero-label">${t('expenses.viewAllRecords')}</div>
    </button>
    <button class="exp-hero-btn exp-hero-budget" id="exp-open-budget">
      ${budgetRight}
    </button>
    <button type="button" class="exp-days-btn" id="exp-open-days" title="${t('expenses.book.title')}">🧾 ${t('expenses.book.open')} ›</button>
  `;

  el.querySelector('#exp-open-records')?.addEventListener('click', () => openRecords());
  el.querySelector('#exp-open-days')?.addEventListener('click', () => {
    const day = (document.getElementById('exp-date') as HTMLInputElement | null)?.value || new Date().toISOString().split('T')[0];
    void import('./receipt-book.ts').then((m) => m.openReceiptBook(day));
  });
  el.querySelector('#exp-open-budget')?.addEventListener('click', () => openBudgetAnalysis());
  el.querySelector('#exp-tosort-chip')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    filterCategory = UNCLASSIFIED;
    openRecords();
  });
}

/* ── Render: form ────────────────────────────────────────────────────────── */

/** `list` defaults to every currency we can price (built-in + approximate +
 *  user-added). The base picker passes CURRENCIES: a base needs a live feed. */
function currencyOptions(selected: string, list = allCurrencies()): string {
  return list.map((c) =>
    `<option value="${c.code}" ${c.code === selected ? 'selected' : ''}>${c.flag} ${c.code} ${c.symbol}${isApproxCurrency(c.code) ? ' ≈' : ''}</option>`,
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
  return `<option value="${WHOLE_TRIP}" ${isWholeTrip ? 'selected' : ''}>🌍 Whole trip</option>${known}${extra}<option value="${CUSTOM_PLACE}">+ Other…</option>`;
}

function cityOptions(country: string, selected: string): string {
  if (!country || country === WHOLE_TRIP) return '';
  const opts = legCitiesFor(legs, country);
  const known = opts.map((c) =>
    `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
  const extra = selected && !opts.includes(selected)
    ? `<option value="${selected}" selected>${selected}</option>` : '';
  return `<option value="">— City —</option>${known}${extra}<option value="${CUSTOM_PLACE}">+ Other…</option>`;
}

/** Country-budget standing for the form's country as one display line (the screen shows it
 *  in its idle rotation); '' when the country has no cap. */
function countryReminderText(): string {
  if (!formCountry || formCountry === WHOLE_TRIP) return '';
  const cap = countryBudgets()[formCountry];
  if (!cap) return '';
  const remaining = cap - countrySpend(formCountry);
  return `📍 ${formCountry.toUpperCase()}  ${fmt(countrySpend(formCountry))} / ${fmt(cap)}  ·  ${remaining < 0 ? `${fmt(-remaining)} ${t('expenses.over')}` : `${fmt(remaining)} ${t('expenses.left')}`}`.toUpperCase();
}

/* ── Checkout counter helpers ────────────────────────────────────────────── */

/** Keeps the readout's symbol and the "≈ home currency" line in step with what is typed. */
function syncCounter(el: HTMLElement): void {
  const amount = parseFloat((el.querySelector('#exp-amount') as HTMLInputElement | null)?.value ?? '');
  const currency = (el.querySelector('#exp-currency') as HTMLSelectElement | null)?.value ?? baseCurrency();
  const sym = el.querySelector('#exp-sym');
  if (sym) sym.textContent = currencySymbol(currency);
  const aux = el.querySelector('#exp-led-aux');
  if (aux) aux.textContent = convertedHint(amount, currency, baseCurrency(), (a, c) => convert(rates, a, c).baseAmount, fmt);
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

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
  el.innerHTML = `
    <div class="exp-form paper ck-machine">
      <div class="ck-plate">
        <div class="ck-plate-name"><span>ON THE ROAD MART</span><em>${escHtml(t('expenses.formTitle'))}</em></div>
        <div class="ck-head-tools">
          <button type="button" class="ck-beep" id="exp-beep" aria-pressed="${beepEnabled()}" title="${escHtml(t('expenses.mart.beep'))}" aria-label="${escHtml(t('expenses.mart.beep'))}">${beepEnabled() ? '🔊' : '🔇'}</button>
          <label class="exp-base-picker">
            <span>${t('expenses.showTotalsIn')}</span>
            <select class="input select" id="exp-base">
              ${currencyOptions(base, CURRENCIES)}
            </select>
          </label>
        </div>
      </div>
      <div class="ck-screen" id="exp-screen">
        ${martVfd(dateValue)}
        <div class="ck-keys-row">
          <div class="ck-keys" id="exp-cat-chips" role="group" aria-label="${escHtml(t('expenses.mart.keys'))}">
            ${categories().map((c) => `
              <button type="button" class="ck-key ${c.id === selectedCategory ? 'is-on' : ''}" data-cat="${escHtml(c.id)}" aria-pressed="${c.id === selectedCategory}" style="--kc:${categoryDisplayColor(c.color)}">
                <span class="ck-key-emoji" aria-hidden="true">${escHtml(c.icon)}</span>
                <span class="ck-key-label">${escHtml(c.label)}</span>
              </button>
            `).join('')}
            <button type="button" class="ck-key ck-key--new" id="exp-cat-manage" title="Manage categories">
              <span class="ck-key-emoji" aria-hidden="true">+</span>
              <span class="ck-key-label">${escHtml(t('expenses.mart.newKey'))}</span>
            </button>
          </div>
        </div>
        <div class="ck-display" id="exp-led">
          <span class="ck-sym" id="exp-sym">${escHtml(currencySymbol(curValue))}</span>
          <input class="ck-amount" type="number" id="exp-amount" placeholder="0.00" min="0" step="0.01" inputmode="decimal" aria-label="${escHtml(t('expenses.counterAria'))}" value="${escHtml(draftAmount)}">
          <span class="ck-aux" id="exp-led-aux" aria-live="polite"></span>
        </div>
      </div>
      <div class="exp-form-grid">
        <div>
          <label class="field-label">Currency</label>
          <div class="exp-cur-row">
            <select class="input select" id="exp-currency">
              ${currencyOptions(curValue)}
            </select>
            <button class="exp-cur-add" id="exp-cur-add" type="button" title="${escHtml(t('currency.addBtn'))}" aria-label="${escHtml(t('currency.addBtn'))}">+</button>
          </div>
        </div>
        <div>
          <label class="field-label">Date</label>
          <input class="input" type="date" id="exp-date" value="${dateValue}">
        </div>
        <div${!isWholeTrip && cityOpts ? '' : ' class="ck-span2"'}>
          <label class="field-label">Country</label>
          <select class="input select" id="exp-country">${countryOptions(formCountry)}</select>
        </div>
        ${!isWholeTrip && cityOpts ? `
        <div>
          <label class="field-label">City</label>
          <select class="input select" id="exp-city">${cityOpts}</select>
        </div>` : ''}
      </div>
      <div class="ck-buyrow">
        <div class="ck-what">
          <label class="field-label">What for?</label>
          <input class="input" id="exp-desc" placeholder="${t('expenses.descPh')}" value="${escHtml(draftDesc)}">
        </div>
        <button class="ck-scanbtn" id="exp-add-btn" type="button"><span>${escHtml(t('expenses.mart.scan'))}</span><span class="ck-scanbtn-hint">${escHtml(t('expenses.mart.enter'))}</span></button>
      </div>
    </div>
  `;
  syncCounter(el);
  refreshMart(el, true);
  startIdle();

  const curInput = el.querySelector('#exp-currency') as HTMLSelectElement;
  const countrySel = el.querySelector('#exp-country') as HTMLSelectElement;

  el.querySelector('#exp-cur-add')?.addEventListener('click', () => {
    openCurrencyManager(() => { rates = peekRateTable(baseCurrency()); render(); });
  });

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
      curInput.value = knownCurrencyForCountry(formCountry) ?? base;
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

  for (const sel of ['#exp-amount', '#exp-currency']) el.querySelector(sel)?.addEventListener('input', () => syncCounter(el));
  el.querySelector('#exp-currency')?.addEventListener('change', () => syncCounter(el));
  el.querySelector('#exp-date')?.addEventListener('change', () => refreshMart(el, true, true));
  el.querySelector('#exp-beep')?.addEventListener('click', (ev) => {
    const btn = ev.currentTarget as HTMLButtonElement;
    const on = !beepEnabled();
    setBeepEnabled(on);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '🔊' : '🔇';
  });
  for (const sel of ['#exp-amount', '#exp-desc']) {
    el.querySelector(sel)?.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') { ev.preventDefault(); (el.querySelector('#exp-add-btn') as HTMLButtonElement).click(); }
    });
  }

  el.querySelectorAll('.ck-key[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedCategory = (btn as HTMLElement).dataset.cat!;
      el.querySelectorAll('.ck-key[data-cat]').forEach((b) => { b.classList.remove('is-on'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('is-on');
      btn.setAttribute('aria-pressed', 'true');
    });
  });

  el.querySelector('#exp-cat-manage')?.addEventListener('click', () => openCategoryManager(el));

  el.querySelector('#exp-add-btn')?.addEventListener('click', () => {
    const amountInput = el.querySelector('#exp-amount') as HTMLInputElement;
    const descInput = el.querySelector('#exp-desc') as HTMLInputElement;
    const amount = parseFloat(amountInput.value);
    const currency = curInput.value;
    const desc = descInput.value;
    const date = (el.querySelector('#exp-date') as HTMLInputElement).value;
    const country = formCountry === WHOLE_TRIP ? '' : formCountry;
    const btn = el.querySelector('#exp-add-btn') as HTMLButtonElement;
    if (btn.disabled) return;

    // Only the amount is required — an empty one makes the display ask for it.
    if (!amount) { vfdError(); amountInput.focus(); return; }

    const cat = categoryById(selectedCategory);
    const typed = { amount: amountInput.value, desc };
    btn.disabled = true;
    // The product label carries the typed values across the scan window, so the
    // one-off fields clear straight away (currency/date stay as sticky defaults).
    draftAmount = ''; draftDesc = '';
    amountInput.value = ''; descInput.value = '';
    syncCounter(el);
    void runScan(el, {
      amount, currency, icon: cat?.icon ?? '🗂️',
      label: desc.trim() || cat?.label || t('dash.spend.unlabelled'),
      save: () => addExpenseWithDefaults({
        amount, currency, description: desc, date,
        category: selectedCategory, country, city: formCity, rates,
      }),
      restore: () => { amountInput.value = typed.amount; descInput.value = typed.desc; syncCounter(el); },
      onFailed: () => alert(t('expenses.addFailed')),
    }).finally(() => { btn.disabled = false; amountInput.focus(); });
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
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
  panel.innerHTML = `
    <div class="exp-cat-manager-title">${t('expenses.managerTitle')}</div>
    <div class="exp-cat-manager-list">
      ${categories().map((c) => `
        <span class="exp-cat-manager-item ${c.builtin ? 'builtin' : ''}">
          ${escHtml(c.icon)} ${escHtml(c.label)}
          ${c.builtin ? '' : `<button class="exp-cat-del" data-id="${escHtml(c.id)}" title="Delete">✕</button>`}
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
  formEl.querySelector('.ck-screen')!.after(panel);

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
  const raw = categoryById(catId)?.color;
  return raw ? `background:${categoryDisplayColor(raw)};border-color:${categoryDisplayColor(raw)};color:${categoryInkColor(raw)}` : '';
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

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
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
        return `<button class="exp-filter-btn ${isActive ? 'active' : ''}" data-filter="${escHtml(c.id)}" ${style}>${escHtml(c.icon)} ${escHtml(c.label)}</button>`;
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
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
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

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
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

function renderRecordTag(e: StoredExpense): string {
  const baseStr = e.currency !== baseCurrency() ? ` · ${fmt(inBase(e))}` : '';
  return recordTag(e, categoryById(e.category), baseStr);
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
          <button class="exp-cat-chip ${c.id === e.category ? 'selected' : ''}" data-cat="${escHtml(c.id)}">${escHtml(c.icon)} ${escHtml(c.label)}</button>
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
          <input class="input" id="ee-desc" value="${escHtml(e.description)}">
        </div>
        <div class="field-full">
          <label class="field-label">Tags <span style="font-weight:400;color:var(--ink-faint)">(comma-separated, e.g. #ramen, souvenir)</span></label>
          <input class="input" id="ee-tags" placeholder="e.g. #ramen, business" value="${escHtml((e.tags ?? []).join(', '))}">
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
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
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
function analysisRows(dim: AnalysisDim = analysisDim): Row[] {
  if (dim === 'category') {
    const caps = categoryBudgets();
    const rows: Row[] = categories()
      .map((cat) => ({
        label: `${cat.icon} ${cat.label}`,
        sum: expenses.filter((e) => e.category === cat.id).reduce((s, e) => s + inBase(e), 0),
        color: categoryChartColor(cat.color === '#f3f4f6' ? '#d1d5db' : cat.color),
        catId: cat.id,
        budget: caps[cat.id],
      }));
    const unsorted = expenses.filter((e) => e.category === UNCLASSIFIED).reduce((s, e) => s + inBase(e), 0);
    if (unsorted > 0) rows.push({ label: '🗂️ Unsorted', sum: unsorted, color: categoryChartColor('#d1d5db') });
    // Keep a row if it has spend OR a budget cap (so you can watch an empty cap fill up).
    return rows
      .filter((r) => r.sum > 0 || (r.budget ?? 0) > 0)
      .sort((a, b) => b.sum - a.sum);
  }

  if (dim === 'time') {
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

/** One analysis dimension's body (donut + legend / daily bars + calendar / countries and cities). */
function breakdownContent(dim: AnalysisDim): string {
  const rows = analysisRows(dim);
  const empty = `<p class="exp-breakdown-empty">${t('expenses.breakdownEmpty')}</p>`;

  let content = '';

  if (dim === 'category') {
    if (rows.length === 0) {
      content = empty;
    } else {
      const donut = renderDonut(rows, fmt);
      const totalSum2 = rows.reduce((s, x) => s + x.sum, 0);
      const legend = rows.map((r) => {
        const hasBudget = (r.budget ?? 0) > 0;
        const pct = Math.round((r.sum / Math.max(totalSum2, 1)) * 100);
        const budgetStr = hasBudget
          ? `<span class="exp-legend-budget${r.sum > r.budget! ? ' is-over' : ''}">${fmt(r.sum)} / ${fmt(r.budget!)}${r.sum > r.budget! ? ' ▲ ' + t('expenses.over') : ''}</span>`
          : '';
        return `
          <div class="exp-legend-row">
            <span class="exp-legend-dot" style="background:${r.color}"></span>
            <span class="exp-legend-name">${escHtml(r.label)}</span>
            <span class="paper-row-lead" aria-hidden="true"></span>
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

  else if (dim === 'time') {
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
               style="stroke:var(--amber-500)" stroke-width="1.5" stroke-dasharray="4 3"/>`
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
          ? (budgetBarColor(usage * 100))
          : 'var(--amber-300)';
        const budgetStr = hasBudget
          ? `${fmt(r.sum)} / ${fmt(r.budget!)}${r.sum > r.budget! ? ' ▲ ' + t('expenses.over') : ''}`
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
            <span class="exp-place-city-name">${escHtml(city)}</span>
            <span class="exp-place-city-amt">${fmt(citySum)}</span>
          </div>`).join('');

        return `
          <div class="exp-place-row">
            <div class="exp-place-header">
              <span class="exp-place-flag">${flag}</span>
              <span class="exp-place-name">${escHtml(r.country)}</span>
              <span class="exp-place-total">${fmt(r.sum)}</span>
            </div>
            <div class="exp-cat-bar-track" style="margin:4px 0 6px">
              <div class="exp-cat-bar-fill" style="width:${pct}%;background:${barColor}"></div>
            </div>
            ${budgetStr ? `<div class="exp-place-sub${hasBudget && r.sum > r.budget! ? ' is-over' : ''}">${budgetStr}</div>` : ''}
            ${cityHtml ? `<div class="exp-place-cities">${cityHtml}</div>` : ''}
          </div>`;
      }).join('');
    }
  }

  return content;
}

function renderBreakdown(el: HTMLElement) {
  const dimLabels: Record<AnalysisDim, string> = {
    category: t('expenses.dimCategory'),
    place:    t('expenses.dimPlace'),
    time:     t('expenses.dimTime'),
  };
  const tabs = ANALYSIS_DIMS.map((d) => `
    <button class="exp-analysis-tab ${d.id === analysisDim ? 'active' : ''}" data-dim="${d.id}">${dimLabels[d.id]}</button>
  `).join('');

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
  el.innerHTML = `
    <div class="exp-breakdown">
      <div class="exp-form-title" style="margin-bottom:var(--sp-4)">${t('expenses.analysisTitle')}</div>
      <div class="exp-analysis-tabs">${tabs}</div>
      ${breakdownContent(analysisDim)}
    </div>`;

  el.querySelectorAll('.exp-analysis-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      analysisDim = (btn as HTMLElement).dataset.dim as AnalysisDim;
      renderBreakdown(el);
    });
  });
  bindBreakdown(el, () => renderBreakdown(el));
}

/** Calendar month nav for the Time body (shared by the Dashboard drawer and the Budget & analysis sheet). */
function stepCalendar(dir: -1 | 1) {
  calViewMonth += dir;
  if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
  if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
}

function bindBreakdown(el: HTMLElement, repaint: () => void) {
  el.querySelector('[data-cal-prev]')?.addEventListener('click', () => { stepCalendar(-1); repaint(); });
  el.querySelector('[data-cal-next]')?.addEventListener('click', () => { stepCalendar(1); repaint(); });
}

/** The till picks up a day chosen on the Budget & analysis calendar (to ring up a missed spend). */
function jumpToDate(iso: string) {
  draftDate = iso;
  const formEl = document.querySelector<HTMLElement>('#view-expenses .exp-form-wrap');
  const input = formEl?.querySelector<HTMLInputElement>('#exp-date');
  if (formEl && input) { input.value = iso; refreshMart(formEl, true, true); }
}

/* ── Orchestration ───────────────────────────────────────────────────────── */

/** Repaint the expenses summary card only (a cap edit must never rebuild the Budget & analysis
 *  sheet it came from — see the editing invariant in budget-analysis.ts). */
function renderSummaryOnly() {
  const root = document.getElementById('view-expenses');
  if (root) renderSummary(root.querySelector('.exp-summary')!);
}

function render() {
  const root = document.getElementById('view-expenses');
  if (!root) return;
  renderSummary(root.querySelector('.exp-summary')!);
  const formEl = root.querySelector<HTMLElement>('.exp-form-wrap');
  if (formEl) refreshMart(formEl, false);
  renderRecordsPanel();
  if (isBudgetAnalysisOpen()) renderBudgetAnalysis();
}

/** The Analysis panel mounted into `el` (the Dashboard drawer): feeds this module's state
 *  from the stores itself, repaints on change, returns a disposer. No budget-cap editors. */
export function mountExpenseAnalysis(el: HTMLElement): () => void {
  rates = peekRateTable(baseCurrency());
  expenses = expenseStore.peek();
  legs = routeStore.peek();
  customCategories = expenseCategoryStore.peek();
  const paint = () => renderBreakdown(el);
  paint();
  const unsubs = [
    expenseStore.subscribe((rows) => { expenses = rows; paint(); }),
    routeStore.subscribe((rows) => { legs = rows; paint(); }),
    expenseCategoryStore.subscribe((rows) => { customCategories = rows; paint(); }),
  ];
  void getRateTable(baseCurrency()).then((table) => { rates = table; if (el.isConnected) paint(); });
  return () => unsubs.forEach((u) => u());
}

export function initExpenses() {
  const root = document.getElementById('view-expenses');
  if (!root) return;

  // Hand the Budget & analysis sheet live accessors (getters, not snapshots, so the store
  // subscriptions below keep it current without re-initialising).
  initBudgetAnalysis({
    expenses: () => expenses,
    legs: () => legs,
    categories,
    inBase,
    fmt,
    timeHtml: () => breakdownContent('time'),
    calNav: stepCalendar,
    onJumpDay: jumpToDate,
    onSortUnsorted: () => { filterCategory = UNCLASSIFIED; openRecords(); },
    renderSummaryOnly,
    renderForm: () => renderForm(root.querySelector('.exp-form-wrap') as HTMLElement),
  });
  initMart({
    expenses: () => expenses, inBase, fmt, categoryById,
    reminder: countryReminderText,
    place: () => ({ city: formCity, country: formCountry === WHOLE_TRIP ? '' : formCountry }),
    remove: deleteExpense,
  });

  // Close fixed overlays when navigating away from expenses.
  window.addEventListener('hashchange', () => {
    const view = window.location.hash.replace('#', '');
    if (view !== 'expenses') {
      if (showRecords) closeRecords();
      if (isBudgetAnalysisOpen()) closeBudgetAnalysis();
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
