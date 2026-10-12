/* ==========================================================================
   On the Road · Dashboard — spend drawer
   --------------------------------------------------------------------------
   The details the one-line quick-add leaves out: currency, note and date, plus
   the latest entries. Opened by the card's + (form first) or by tapping the
   total (list first). Writes through the same path as the quick-add.
   ========================================================================== */

import { openDrawer } from '../../core/drawer.ts';
import { navigateTo } from '../../core/app.ts';
import { closeDrawer } from '../../core/drawer.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';
import { baseCurrency } from '../../data/trip-context.ts';
import { peekRateTable, allCurrencies, currencySymbol } from '../../data/rates.ts';
import { todayIso } from '../../data/trip-phase.ts';
import { expensesAsOf } from '../../data/as-of.ts';
import type { StoredExpense } from '../../data/stores/expense-store.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { expenseSlip } from '../expenses/expense-slip.ts';
import { addExpenseWithDefaults, defaultCurrency, defaultPlace, BUILTIN_CATEGORIES } from '../expenses/expense-defaults.ts';

import { WIDGET_ICON } from '../../core/icons.ts';
const RECENT = 12;

function shortDate(iso: string): string {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

function num(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function rowHtml(e: Pick<StoredExpense, 'date' | 'description' | 'category' | 'amount' | 'currency' | 'baseAmount' | 'baseCurrency'>): string {
  const cat = BUILTIN_CATEGORIES.find((c) => c.id === e.category);
  const label = e.description?.trim() || cat?.label || t('dash.spend.unlabelled');
  const base = e.currency !== e.baseCurrency ? ` <span class="td-sp-base">≈ ${esc(currencySymbol(e.baseCurrency))}${esc(num(e.baseAmount))}</span>` : '';
  return `
    <div class="td-sp-row">
      <span class="td-sp-date">${esc(shortDate(e.date))}</span>
      <span class="td-sp-label">${cat ? `${cat.icon} ` : ''}${esc(label)}</span>
      <span class="td-sp-amt">${esc(num(e.amount))} ${esc(e.currency)}${base}</span>
    </div>`;
}

export function openSpendDrawer(opts: {
  expenses: StoredExpense[];
  /** When looking back at a day, only entries up to it are listed. */
  asOf?: string | null;
  legs: StoredLeg[];
  /** Which part leads: the add form (from +) or the list (from the total). */
  focus: 'form' | 'list';
  trigger?: HTMLElement | null;
}): void {
  const today = todayIso();
  const cur = defaultCurrency(opts.legs, today);
  const recent = [...expensesAsOf(opts.expenses, opts.asOf ?? null)]
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, RECENT);

  const form = `
    <form class="td-spf" data-spf>
      <div class="td-spf-row">
        <input class="input td-spf-amt" name="amount" type="text" inputmode="decimal" placeholder="0.00" aria-label="${esc(t('dash.agenda.spendAmount'))}" required>
        <select class="input select td-spf-cur" name="currency" aria-label="${esc(t('dash.spend.currency'))}">
          ${allCurrencies().map((c) => `<option value="${esc(c.code)}" ${c.code === cur ? 'selected' : ''}>${c.flag} ${esc(c.code)}</option>`).join('')}
        </select>
      </div>
      <div class="td-spf-row">
        <select class="input select" name="category" aria-label="${esc(t('dash.agenda.spendCategory'))}">
          <option value="">${esc(t('dash.agenda.spendCategory'))}…</option>
          ${BUILTIN_CATEGORIES.map((c) => `<option value="${esc(c.id)}">${c.icon} ${esc(c.label)}</option>`).join('')}
        </select>
        <input class="input" name="date" type="date" value="${esc(today)}" aria-label="${esc(t('dash.spend.date'))}">
      </div>
      <input class="input" name="note" type="text" placeholder="${esc(t('dash.spend.note'))}" aria-label="${esc(t('dash.spend.note'))}">
      <div class="td-spf-actions">
        <span class="td-spf-msg" data-spf-msg role="status"></span>
        <button class="btn btn-primary" type="submit">${esc(t('common.add'))}</button>
      </div>
    </form>`;

  const list = `
    <h3 class="td-dh">${esc(t('dash.spend.recent'))}</h3>
    <section class="td-dcard td-sp-list" data-spend-list>
      ${recent.length ? recent.map(rowHtml).join('') : `<p class="td-dempty">${esc(t('dash.spend.none'))}</p>`}
    </section>`;

  const d = openDrawer({
    title: `${WIDGET_ICON.spend} ${t('dash.widget.spend')}`,
    body: opts.focus === 'form' ? `${form}${list}` : `${list}<h3 class="td-dh">${esc(t('dash.spend.addTitle'))}</h3>${form}`,
    footer: `<button type="button" class="btn btn-ghost" data-d-open>${esc(t('dash.link.allExpenses'))}</button>`,
    returnFocus: opts.trigger,
  });

  d.root.querySelector('[data-d-open]')?.addEventListener('click', () => { closeDrawer(); navigateTo('expenses'); });
  if (opts.focus === 'form') d.root.querySelector<HTMLInputElement>('.td-spf-amt')?.focus();

  const f = d.root.querySelector<HTMLFormElement>('[data-spf]')!;
  const msg = f.querySelector<HTMLElement>('[data-spf-msg]')!;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (n: string) => (f.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement).value;
    const amount = parseFloat(v('amount').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) { f.querySelector<HTMLInputElement>('.td-spf-amt')?.focus(); return; }
    const date = v('date') || today;
    const place = defaultPlace(opts.legs, date);
    const btn = f.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    btn.disabled = true;
    const input = {
      amount, currency: v('currency'), description: v('note'), date, category: v('category'),
      country: place.country, city: place.city, rates: peekRateTable(baseCurrency()),
    };
    const printSlip = expenseSlip(input);
    const ok = await addExpenseWithDefaults(input).catch(() => false);
    btn.disabled = false;
    if (!ok) { msg.textContent = t('dash.spend.failed'); return; }
    msg.textContent = `✓ ${t('dash.spend.saved')}`;
    printSlip();
    // Show it at the top without waiting for the store round-trip.
    const listEl = d.root.querySelector<HTMLElement>('[data-spend-list]');
    const fresh = rowHtml({ ...input, baseAmount: amount, baseCurrency: input.currency });
    listEl?.querySelector('.td-dempty')?.remove();
    listEl?.insertAdjacentHTML('afterbegin', fresh);
    (f.elements.namedItem('amount') as HTMLInputElement).value = '';
    (f.elements.namedItem('note') as HTMLInputElement).value = '';
    f.querySelector<HTMLInputElement>('.td-spf-amt')?.focus();
  });
}


/** The Expenses page's Analysis panel in the side drawer (expand button on the card). */
export async function openSpendAnalysisDrawer(trigger: HTMLElement | null): Promise<void> {
  const { mountExpenseAnalysis } = await import('../expenses/expenses.ts');
  let dispose: (() => void) | null = null;
  const d = openDrawer({
    title: `${WIDGET_ICON.spend} ${t('expenses.analysisTitle')}`,
    body: '<div class="exp-breakdown-wrap td-sp-analysis"></div>',
    footer: `<button type="button" class="btn btn-ghost" data-d-open>${esc(t('dash.link.allExpenses'))}</button>`,
    className: 'td-sp-analysis-drawer',
    returnFocus: trigger,
    onClose: () => { dispose?.(); dispose = null; },
  });
  const host = d.body.querySelector<HTMLElement>('.td-sp-analysis');
  if (host) dispose = mountExpenseAnalysis(host);
  d.root.querySelector('[data-d-open]')?.addEventListener('click', () => { closeDrawer(); navigateTo('expenses'); });
}
