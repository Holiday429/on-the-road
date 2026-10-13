/* ==========================================================================
   On the Road · Expenses · Budget & analysis
   --------------------------------------------------------------------------
   One sheet that answers "where is the money going, and am I on track?":

     · an overview — the total budget (editable right there), what is spent,
       what is left, the daily pace and where the trip ends up at that pace;
     · three columns that each read the spend one way — by category, by
       place, by time. In the first two, every row carries its own cap: the
       bar IS the budget progress and the number beside it IS the setting, so
       there is no separate "view" and "edit" copy of the same figure.

   Editing invariant (why refresh helpers exist instead of re-rendering):
   a cap <input> commits on `change`, which fires on BLUR — usually the user
   clicking straight into the next cap field. Rebuilding the sheet at that
   moment replaces the element that just took focus, so what was typed lands
   on a detached node and is lost. Cap edits therefore only update figures
   in place (bars, notes, overview numbers); inputs are built once per open
   and never replaced while one has focus. See cap-input.ts and the tests.
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import { escHtml } from '../../core/utils.ts';
import type { StoredExpense } from '../../data/stores/expense-store.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import {
  baseCurrency, tripBudget, setTripBudget,
  categoryBudgets, setCategoryBudget, countryBudgets, setCountryBudget,
} from '../../data/trip-context.ts';
import { budgetBarColor } from '../../data/budget-tone.ts';
import { budgetPace, tripSpan } from '../../data/budget-pace.ts';
import { currencySymbol } from '../../data/rates.ts';
import { bindCapInput } from './cap-input.ts';
import { renderDonut, categoryChartColor, UNCLASSIFIED, type Category } from './expense-helpers.ts';

export interface BudgetAnalysisCtx {
  expenses: () => StoredExpense[];
  legs: () => StoredLeg[];
  categories: () => Category[];
  /** One expense re-expressed in the CURRENT base currency. */
  inBase: (e: StoredExpense) => number;
  /** Format an amount in the current base currency. */
  fmt: (n: number) => string;
  /** The Time column's body (daily bars + month calendar) and the month-nav hook it needs. */
  timeHtml: () => string;
  calNav: (dir: -1 | 1) => void;
  /** A calendar day was clicked: close the sheet and point the till at that day. */
  onJumpDay: (iso: string) => void;
  /** "Sort them": open the ledger on the unclassified pile. */
  onSortUnsorted: () => void;
  /** Repaint the summary strip only (never this sheet). */
  renderSummaryOnly: () => void;
  /** Repaint the till (its screen reads the country caps). */
  renderForm: () => void;
}

let ctx: BudgetAnalysisCtx;
let open = false;

export function initBudgetAnalysis(c: BudgetAnalysisCtx): void { ctx = c; }
export function isBudgetAnalysisOpen(): boolean { return open; }

function onKey(ev: KeyboardEvent): void { if (ev.key === 'Escape') closeBudgetAnalysis(); }

export function openBudgetAnalysis(): void {
  open = true;
  document.body.classList.add('exp-analysis-lock');
  document.addEventListener('keydown', onKey);
  renderBudgetAnalysis();
}

export function closeBudgetAnalysis(): void {
  open = false;
  document.body.classList.remove('exp-analysis-lock');
  document.removeEventListener('keydown', onKey);
  renderBudgetAnalysis();
}

/* ── Figures ─────────────────────────────────────────────────────────────── */

const sym = () => currencySymbol(baseCurrency());
const todayIso = () => new Date().toISOString().slice(0, 10);

function sumBy(pick: (e: StoredExpense) => boolean): number {
  return ctx.expenses().filter(pick).reduce((s, e) => s + ctx.inBase(e), 0);
}

/** Itinerary days per country (nights, at least 1 per leg). */
function countryDays(): Record<string, number> {
  const days: Record<string, number> = {};
  for (const l of ctx.legs()) {
    if (!l.country) continue;
    const d = Math.max(1, Math.ceil((new Date(l.dateTo).getTime() - new Date(l.dateFrom).getTime()) / 86_400_000));
    days[l.country] = (days[l.country] ?? 0) + d;
  }
  return days;
}

function countriesList(): string[] {
  const fromLegs = ctx.legs().map((l) => l.country).filter(Boolean);
  const fromSpend = ctx.expenses().map((e) => e.country).filter(Boolean);
  return [...new Set([...fromLegs, ...fromSpend, ...Object.keys(countryBudgets())])];
}

const pctOf = (spent: number, cap: number) => Math.min(100, Math.round((spent / cap) * 100));

/** Bar + note for a row: against its cap when it has one, else its share of the whole. */
function rowFigures(spent: number, cap: number | undefined, share: number): { width: number; color: string; note: string; over: boolean } {
  const f = ctx.fmt;
  if (cap && cap > 0) {
    const pct = pctOf(spent, cap);
    const over = spent > cap;
    return { width: pct, color: budgetBarColor(pct), over, note: `${f(spent)} / ${f(cap)}${over ? ` ▲ ${t('expenses.over')}` : ''}` };
  }
  return { width: share, color: 'var(--amber-300)', over: false, note: '' };
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function overviewFigsHtml(): string {
  const f = ctx.fmt;
  const spent = sumBy(() => true);
  const budget = tripBudget();
  const span = tripSpan(ctx.legs());
  const pace = budgetPace({ spent, budget, startIso: span.startIso, endIso: span.endIso, todayIso: todayIso() });

  const fig = (k: string, v: string, cls = '') => `<div class="ba-fig ${cls}"><span class="ba-fig-k">${escHtml(k)}</span><b>${escHtml(v)}</b></div>`;
  const figs = [fig(t('expenses.spentSoFar'), f(spent))];
  if (budget) figs.push(fig(t(spent > budget ? 'expenses.ba.overBy' : 'expenses.ba.left'), f(Math.abs(budget - spent)), spent > budget ? 'is-bad' : ''));
  if (pace.avgPerDay != null) figs.push(fig(t('expenses.ba.avgDay'), f(pace.avgPerDay)));
  if (pace.allowedPerDay != null) figs.push(fig(t('expenses.ba.allowedDay'), f(pace.allowedPerDay)));
  if (pace.forecast != null && budget) figs.push(fig(t('expenses.ba.forecast'), f(pace.forecast), pace.status === 'fast' ? 'is-warn' : ''));

  const chip = budget
    ? `<span class="ba-chip is-${pace.status}">${escHtml(t(pace.status === 'over' ? 'expenses.ba.statusOver' : pace.status === 'fast' ? 'expenses.ba.statusFast' : 'expenses.ba.statusOk'))}</span>`
    : '';
  const bar = budget
    ? `<div class="ba-ov-bar"><div class="exp-budget-bar-track"><div class="exp-budget-bar-fill" style="width:${pctOf(spent, budget)}%;background:${budgetBarColor(pctOf(spent, budget))}"></div></div>${chip}</div>`
    : `<p class="exp-modal-hint ba-ov-hint">${t('expenses.noBudgetHint')}</p>`;

  // How much of the total the caps account for, one line per kind that has any.
  const alloc = (label: string, caps: Record<string, number>) => {
    const sum = Object.values(caps).reduce((s, v) => s + v, 0);
    if (!sum) return '';
    const flex = budget ? budget - sum : null;
    const tail = flex == null ? '' : flex < 0 ? ` · ${f(-flex)} ${t('expenses.overTotal')}` : ` · ${f(flex)} ${t('expenses.unallocated')}`;
    return `<span class="ba-alloc${flex != null && flex < 0 ? ' is-bad' : ''}">${escHtml(label)} ${escHtml(f(sum))}${escHtml(tail)}</span>`;
  };
  const allocs = [alloc(t('expenses.ba.capsCat'), categoryBudgets()), alloc(t('expenses.ba.capsCountry'), countryBudgets())].filter(Boolean).join('');

  return `<div class="ba-figs">${figs.join('')}</div>${bar}${allocs ? `<div class="ba-allocs">${allocs}</div>` : ''}`;
}

/* ── Rows ────────────────────────────────────────────────────────────────── */

const capInput = (attr: string, key: string, cap: number | undefined, extra = '') =>
  `<input class="input ba-cap" type="number" min="0" step="1" ${attr}="${escHtml(key)}" ${extra} placeholder="${escHtml(t('expenses.ba.addCap'))}" value="${cap ?? ''}" aria-label="${escHtml(t('expenses.ba.capFor', { name: key }))}">`;

function categoryColumnHtml(): string {
  const caps = categoryBudgets();
  const cats = ctx.categories();
  const spentBy = new Map(cats.map((c) => [c.id, sumBy((e) => e.category === c.id)]));
  const unsorted = sumBy((e) => e.category === UNCLASSIFIED);
  const total = [...spentBy.values()].reduce((a, b) => a + b, 0) + unsorted;
  const rows = [...cats]
    .sort((a, b) => (spentBy.get(b.id) ?? 0) - (spentBy.get(a.id) ?? 0));
  const donut = renderDonut(rows.map((c) => ({ sum: spentBy.get(c.id) ?? 0, color: categoryChartColor(c.color === '#f3f4f6' ? '#d1d5db' : c.color) }))
    .concat(unsorted > 0 ? [{ sum: unsorted, color: categoryChartColor('#d1d5db') }] : []), ctx.fmt);

  const rowHtml = rows.map((c) => `
    <div class="ba-row" data-cat-row="${escHtml(c.id)}">
      <div class="ba-row-top">
        <span class="ba-dot" style="background:${categoryChartColor(c.color === '#f3f4f6' ? '#d1d5db' : c.color)}"></span>
        <span class="ba-name">${escHtml(c.icon)} ${escHtml(c.label)}</span>
        <span class="ba-share" data-share></span>
        <span class="ba-amt" data-amt></span>
      </div>
      <div class="ba-row-bar"><div class="exp-budget-bar-track ba-bar"><div class="exp-budget-bar-fill" data-fill></div></div>${capInput('data-cat', c.id, caps[c.id])}</div>
      <div class="ba-note" data-note></div>
    </div>`).join('');
  const unsortedRow = unsorted > 0 ? `
    <div class="ba-row ba-row--unsorted" data-unsorted-row>
      <div class="ba-row-top">
        <span class="ba-dot" style="background:${categoryChartColor('#d1d5db')}"></span>
        <span class="ba-name">🗂️ ${escHtml(t('expenses.ba.unsorted'))}</span>
        <span class="ba-share" data-share></span>
        <span class="ba-amt" data-amt></span>
      </div>
      <button type="button" class="ba-link" data-sort>${escHtml(t('expenses.ba.sortThem'))}</button>
    </div>` : '';
  return `<div class="ba-donut">${donut}</div>${rowHtml}${unsortedRow}${total === 0 ? `<p class="exp-breakdown-empty">${t('expenses.breakdownEmpty')}</p>` : ''}`;
}

function placeColumnHtml(): string {
  const caps = countryBudgets();
  const days = countryDays();
  const list = countriesList();
  const rows = list.map((c) => {
    const flag = ctx.legs().find((l) => l.country === c)?.flag ?? '';
    return `
    <div class="ba-row" data-country-row="${escHtml(c)}">
      <div class="ba-row-top">
        <span class="ba-name">${escHtml(flag)} ${escHtml(c)}</span>
        <span class="ba-amt" data-amt></span>
      </div>
      <div class="ba-row-bar"><div class="exp-budget-bar-track ba-bar"><div class="exp-budget-bar-fill" data-fill></div></div>${capInput('data-country', c, caps[c], `data-days="${days[c] ?? 0}"`)}</div>
      <div class="ba-note" data-note></div>
      <div class="ba-cities" data-cities></div>
    </div>`;
  }).join('');
  const auto = list.length ? `
    <div class="ba-auto">
      <span>${escHtml(t('expenses.ba.autoEstimate'))}</span>
      <input class="input ba-auto-rate" type="number" min="0" step="1" id="ba-daily-rate" placeholder="${escHtml(sym())}" aria-label="${escHtml(t('expenses.ba.dailyRate'))}">
      <span class="ba-auto-unit">${escHtml(sym())}/day</span>
      <button type="button" class="btn btn-ghost pk-sm" id="ba-apply-daily">${escHtml(t('expenses.ba.apply'))}</button>
    </div>` : `<p class="exp-modal-hint">${t('expenses.noCountriesHint')}</p>`;
  return `${rows}${auto}`;
}

/** Refresh every figure in place from the live data. Never touches an <input>. */
function refreshFigures(root: HTMLElement): void {
  const ov = root.querySelector<HTMLElement>('.ba-ov-figs');
  // eslint-disable-next-line no-restricted-syntax -- audited: overviewFigsHtml escapes every value
  if (ov) ov.innerHTML = overviewFigsHtml();

  const cats = categoryBudgets();
  const total = sumBy(() => true) || 1;
  root.querySelectorAll<HTMLElement>('[data-cat-row]').forEach((row) => {
    const id = row.dataset.catRow!;
    const spent = sumBy((e) => e.category === id);
    paintRow(row, spent, cats[id], Math.max(spent > 0 ? 3 : 0, Math.round((spent / total) * 100)), Math.round((spent / total) * 100));
  });
  root.querySelectorAll<HTMLElement>('[data-unsorted-row]').forEach((row) => {
    const spent = sumBy((e) => e.category === UNCLASSIFIED);
    const share = Math.round((spent / total) * 100);
    row.querySelector('[data-amt]')!.textContent = ctx.fmt(spent);
    row.querySelector('[data-share]')!.textContent = `${share}%`;
  });

  const countries = countryBudgets();
  const peakCountry = Math.max(1, ...countriesList().map((c) => sumBy((e) => e.country === c)));
  root.querySelectorAll<HTMLElement>('[data-country-row]').forEach((row) => {
    const c = row.dataset.countryRow!;
    const spent = sumBy((e) => e.country === c);
    const d = countryDays()[c];
    paintRow(row, spent, countries[c], Math.round((spent / peakCountry) * 100), 0, d ? `${ctx.fmt(spent / d)}/day · ${d}d` : '');
    const byCity = new Map<string, number>();
    for (const e of ctx.expenses()) if (e.country === c && e.city) byCity.set(e.city, (byCity.get(e.city) ?? 0) + ctx.inBase(e));
    const cities = row.querySelector<HTMLElement>('[data-cities]');
    // eslint-disable-next-line no-restricted-syntax -- audited: escHtml on city names, fmt output is numeric
    if (cities) cities.innerHTML = [...byCity].sort((a, b) => b[1] - a[1]).map(([city, v]) => `<div class="ba-city"><span>${escHtml(city)}</span><span>${escHtml(ctx.fmt(v))}</span></div>`).join('');
  });
}

function paintRow(row: HTMLElement, spent: number, cap: number | undefined, barShare: number, shareLabel: number, extraNote = ''): void {
  const fig = rowFigures(spent, cap, barShare);
  const fill = row.querySelector<HTMLElement>('[data-fill]');
  if (fill) { fill.style.width = `${fig.width}%`; fill.style.background = fig.color; }
  const amt = row.querySelector('[data-amt]');
  if (amt) amt.textContent = ctx.fmt(spent);
  const share = row.querySelector('[data-share]');
  if (share) share.textContent = shareLabel ? `${shareLabel}%` : '';
  const note = row.querySelector<HTMLElement>('[data-note]');
  if (note) {
    note.textContent = [fig.note, extraNote].filter(Boolean).join('  ·  ');
    note.classList.toggle('is-over', fig.over);
  }
}

/* ── Sheet ───────────────────────────────────────────────────────────────── */

function renderTime(panel: HTMLElement): void {
  const host = panel.querySelector<HTMLElement>('[data-col="time"] .ba-col-body');
  if (!host) return;
  // eslint-disable-next-line no-restricted-syntax -- audited: timeHtml is built by expenses.ts with escaped values
  host.innerHTML = ctx.timeHtml();
  host.querySelector('[data-cal-prev]')?.addEventListener('click', () => { ctx.calNav(-1); renderTime(panel); });
  host.querySelector('[data-cal-next]')?.addEventListener('click', () => { ctx.calNav(1); renderTime(panel); });
  host.querySelectorAll<HTMLElement>('.exp-cal-cell[data-iso]').forEach((cell) => {
    cell.classList.add('is-jump');
    cell.addEventListener('click', () => { const iso = cell.dataset.iso!; closeBudgetAnalysis(); ctx.onJumpDay(iso); });
  });
}

export function renderBudgetAnalysis(): void {
  const panel = document.querySelector<HTMLElement>('.exp-analysis-panel');
  if (!panel) return;
  panel.classList.toggle('open', open);
  // eslint-disable-next-line no-restricted-syntax -- audited: static empty string
  if (!open) { panel.innerHTML = ''; return; }

  // A live repaint (a spend landing, a leg edit) must not rebuild inputs the user is in.
  const active = document.activeElement;
  if (panel.querySelector('.ba-cols') && active instanceof HTMLInputElement && panel.contains(active)) {
    refreshFigures(panel);
    return;
  }

  const prevScroll = panel.querySelector<HTMLElement>('.exp-records-scroll')?.scrollTop ?? 0;
  const budget = tripBudget();
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations are translated strings, escaped values, or numbers
  panel.innerHTML = `
    <div class="exp-records-overlay exp-analysis-overlay">
      <div class="exp-records-bar">
        <button class="exp-records-back" id="ba-back">${t('expenses.btnBack')}</button>
        <div class="exp-records-bar-title">${t('expenses.budgetAnalysisTitle')}</div>
      </div>
      <div class="exp-records-scroll">
        <section class="ba-ov">
          <label class="ba-ov-total">
            <span class="ba-fig-k">${t('expenses.totalBudget')}</span>
            <span class="ba-total-wrap"><span>${escHtml(sym())}</span><input class="input ba-total" id="ba-total" type="number" min="0" step="1" placeholder="${escHtml(t('expenses.ba.setBudget'))}" value="${budget ?? ''}" aria-label="${escHtml(t('expenses.totalBudget'))}"></span>
          </label>
          <div class="ba-ov-figs"></div>
        </section>
        <div class="ba-cols">
          <section class="exp-acol" data-col="category"><h3 class="exp-acol-title">${t('expenses.dimCategory')}</h3><div class="ba-col-body">${categoryColumnHtml()}</div></section>
          <section class="exp-acol" data-col="place"><h3 class="exp-acol-title">${t('expenses.dimPlace')}</h3><div class="ba-col-body">${placeColumnHtml()}</div></section>
          <section class="exp-acol" data-col="time"><h3 class="exp-acol-title">${t('expenses.dimTime')}</h3><div class="ba-col-body"></div></section>
        </div>
      </div>
    </div>`;
  refreshFigures(panel);
  renderTime(panel);
  bindInputs(panel);
  panel.querySelector('#ba-back')?.addEventListener('click', closeBudgetAnalysis);
  panel.querySelector('[data-sort]')?.addEventListener('click', () => { closeBudgetAnalysis(); ctx.onSortUnsorted(); });
  const scroll = panel.querySelector<HTMLElement>('.exp-records-scroll');
  if (scroll) scroll.scrollTop = prevScroll;
}

function bindInputs(panel: HTMLElement): void {
  const afterEdit = (country: boolean) => { refreshFigures(panel); ctx.renderSummaryOnly(); if (country) ctx.renderForm(); };

  bindCapInput(panel.querySelector<HTMLInputElement>('#ba-total')!, async (amount) => {
    await setTripBudget(amount);
    afterEdit(false);
  });
  panel.querySelectorAll<HTMLInputElement>('input[data-cat]').forEach((input) => {
    bindCapInput(input, async (amount) => { await setCategoryBudget(input.dataset.cat!, amount); afterEdit(false); });
  });
  const bound = [...panel.querySelectorAll<HTMLInputElement>('input[data-country]')].map((input) => ({
    input,
    ...bindCapInput(input, async (amount) => { await setCountryBudget(input.dataset.country!, amount); afterEdit(true); }),
  }));

  // Auto-fill: days × daily rate into every country's cap. Goes through each field's own commit
  // so its last-saved value stays in step (a later manual edit back to the same number is not skipped).
  panel.querySelector('#ba-apply-daily')?.addEventListener('click', async () => {
    const rateEl = panel.querySelector<HTMLInputElement>('#ba-daily-rate');
    const rate = parseFloat(rateEl?.value ?? '');
    if (!rate || rate <= 0) { rateEl?.focus(); return; }
    for (const { input, commit } of bound) {
      const d = parseInt(input.dataset.days ?? '0', 10);
      if (!d) continue;
      input.value = String(Math.round(d * rate));
      await commit();
    }
  });
}
