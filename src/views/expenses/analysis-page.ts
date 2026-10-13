/* ==========================================================================
   On the Road · Expenses · Budget & analysis sub-page
   --------------------------------------------------------------------------
   Opened from the summary strip's budget tile. One full-screen sheet: the
   trip budget as a single bar on top, then the three ways of reading the
   spend — by category, by place, by time — side by side instead of behind
   tabs. The caps themselves are edited in the budget editor (budget-page.ts),
   reached from the "Edit budgets" button or any ✎ / + next to a row; it opens
   on top of this page.

   Like budget-page.ts it holds no expense state: the host (expenses.ts) hands
   in accessors and the column renderer.
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import type { StoredExpense } from '../../data/stores/expense-store.ts';
import { baseCurrency, tripBudget } from '../../data/trip-context.ts';
import { budgetBarColor } from '../../data/budget-tone.ts';
import { currencySymbol } from '../../data/rates.ts';
import { openBudgetPage, isBudgetOpen } from './budget-page.ts';

export interface AnalysisPageCtx {
  expenses: () => StoredExpense[];
  inBase: (e: StoredExpense) => number;
  fmt: (n: number) => string;
  /** Paint the three analysis columns into `el`. */
  renderColumns: (el: HTMLElement) => void;
}

let ctx: AnalysisPageCtx;
let open = false;

export function initAnalysisPage(c: AnalysisPageCtx): void { ctx = c; }
export function isAnalysisOpen(): boolean { return open; }

// Escape closes the topmost sheet only: while the budget editor sits on top it takes the key.
function onKey(ev: KeyboardEvent): void { if (ev.key === 'Escape' && !isBudgetOpen()) closeAnalysisPage(); }

export function openAnalysisPage(): void {
  open = true;
  document.body.classList.add('exp-analysis-lock');
  document.addEventListener('keydown', onKey);
  renderAnalysisPage();
}

export function closeAnalysisPage(): void {
  open = false;
  document.body.classList.remove('exp-analysis-lock');
  document.removeEventListener('keydown', onKey);
  renderAnalysisPage();
}

function budgetStrip(): string {
  const sum = ctx.expenses().reduce((s, e) => s + ctx.inBase(e), 0);
  const budget = tripBudget();
  const edit = `<button type="button" class="btn btn-ghost exp-acol-edit" id="exp-analysis-edit">${t('expenses.editBudgets')}</button>`;
  if (!budget) return `<p class="exp-modal-hint">${t('expenses.noBudgetHint')}</p>${edit}`;
  const pct = Math.min(100, Math.round((sum / budget) * 100));
  const over = sum > budget;
  return `
    <div class="exp-astrip-fig"><span class="exp-astrip-k">${t('expenses.totalBudget')}</span><b>${currencySymbol(baseCurrency())}${Math.round(budget).toLocaleString()}</b></div>
    <div class="exp-astrip-fig"><span class="exp-astrip-k">${t('expenses.spentSoFar')}</span><b>${ctx.fmt(sum)}</b></div>
    <div class="exp-astrip-bar">
      <div class="exp-budget-bar-track"><div class="exp-budget-bar-fill" style="width:${pct}%;background:${budgetBarColor(pct)}"></div></div>
      <span class="${over ? 'exp-budget-over' : 'exp-budget-remain'}">${over ? `▲ ${ctx.fmt(sum - budget)} ${t('expenses.overBudget')}` : `${ctx.fmt(budget - sum)} ${t('expenses.remaining')} (${pct}%)`}</span>
    </div>
    ${edit}`;
}

/** Repaint the sheet (and keep it live while open). Closed → the panel is emptied. */
export function renderAnalysisPage(): void {
  const panel = document.querySelector<HTMLElement>('.exp-analysis-panel');
  if (!panel) return;
  panel.classList.toggle('open', open);
  // eslint-disable-next-line no-restricted-syntax -- audited: static empty string
  if (!open) { panel.innerHTML = ''; return; }

  // Keep scroll position across live repaints (a spend landing while the sheet is open).
  const prevScroll = panel.querySelector<HTMLElement>('.exp-records-scroll')?.scrollTop ?? 0;
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations are translated strings and numbers formatted by the host
  panel.innerHTML = `
    <div class="exp-records-overlay exp-analysis-overlay">
      <div class="exp-records-bar">
        <button class="exp-records-back" id="exp-analysis-back">${t('expenses.btnBack')}</button>
        <div class="exp-records-bar-title">${t('expenses.budgetAnalysisTitle')}</div>
      </div>
      <div class="exp-records-scroll">
        <div class="exp-astrip">${budgetStrip()}</div>
        <div class="exp-acols"></div>
      </div>
    </div>`;
  ctx.renderColumns(panel.querySelector<HTMLElement>('.exp-acols')!);
  panel.querySelector('#exp-analysis-back')?.addEventListener('click', closeAnalysisPage);
  panel.querySelector('#exp-analysis-edit')?.addEventListener('click', () => openBudgetPage());
  const scroll = panel.querySelector<HTMLElement>('.exp-records-scroll');
  if (scroll) scroll.scrollTop = prevScroll;
}
