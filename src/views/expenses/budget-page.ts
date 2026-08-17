/* ==========================================================================
   On the Road · Expenses · Budget overlay page
   --------------------------------------------------------------------------
   The full-screen budget surface behind the summary card's budget tile: a
   read-only "compare" block (total + per-country + per-category progress bars)
   over a tabbed editor for the caps themselves.

   Split out of expenses.ts, which owns the live expense/leg/category state.
   That state arrives through BudgetPageCtx rather than being imported, so this
   module stays a pure renderer over whatever the host currently holds.

   Editing invariant — the reason this file has three narrow refresh helpers
   instead of one render-everything call: a cap <input> commits on `change`,
   which fires on BLUR, and that blur is usually the user clicking straight
   into the next cap field. Rebuilding the settings pane at that moment
   replaces the element that just received focus, so the value typed into it
   lands on a detached node and is never persisted. Cap edits therefore repaint
   only non-input regions (compare bars + the allocated footer); the inputs are
   left alone and keep both their focus and their listeners.
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import { escHtml } from '../../core/utils.ts';
import type { StoredExpense } from '../../data/stores/expense-store.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import {
  baseCurrency, tripBudget, setTripBudget,
  categoryBudgets, setCategoryBudget, countryBudgets, setCountryBudget,
} from '../../data/trip-context.ts';
import { currencySymbol } from '../../data/rates.ts';
import { legCountries } from './expense-defaults.ts';
import type { Category, BudgetTab } from './expense-helpers.ts';

/** Live state + repaint callbacks owned by expenses.ts. Read fresh on every
 *  render, so the host can keep mutating its module-level state as usual. */
export interface BudgetPageCtx {
  expenses: () => StoredExpense[];
  legs: () => StoredLeg[];
  categories: () => Category[];
  /** One expense re-expressed in the CURRENT base currency. */
  inBase: (e: StoredExpense) => number;
  /** Format an amount in the current base currency. */
  fmt: (n: number) => string;
  /** Repaint the expenses summary card only (never the budget page). */
  renderSummaryOnly: () => void;
  /** Repaint the summary card AND this page. Only safe when no cap input is
   *  mid-edit — see the editing invariant at the top of this file. */
  renderSummaryRoot: () => void;
  /** Repaint the logging form (its country-budget reminder reads the caps). */
  renderForm: () => void;
}

let ctx: BudgetPageCtx;
let showBudget = false;
let budgetTab: BudgetTab = 'total';

/** Wire the page to the host's state. Call once, before any open/render. */
export function initBudgetPage(c: BudgetPageCtx) {
  ctx = c;
}

/** Is the budget overlay currently open? */
export function isBudgetOpen(): boolean {
  return showBudget;
}

function onBudgetKey(ev: KeyboardEvent) { if (ev.key === 'Escape') closeBudgetPage(); }

export function openBudgetPage(tab: BudgetTab = 'total') {
  budgetTab = tab;
  showBudget = true;
  document.body.classList.add('exp-records-lock');
  document.addEventListener('keydown', onBudgetKey);
  renderBudgetPage();
}

export function closeBudgetPage() {
  showBudget = false;
  document.body.classList.remove('exp-records-lock');
  document.removeEventListener('keydown', onBudgetKey);
  renderBudgetPage();
  ctx.renderSummaryRoot();
}

/** Total spent in a country, in the current base currency. */
function countrySpend(country: string): number {
  return ctx.expenses().filter((e) => e.country === country)
    .reduce((s, e) => s + ctx.inBase(e), 0);
}

/** Total spent in a category, in the current base currency. */
function categorySpend(categoryId: string): number {
  return ctx.expenses().filter((e) => e.category === categoryId)
    .reduce((s, e) => s + ctx.inBase(e), 0);
}

/** Inner HTML of the read-only compare block at the top of the page. Split out
 *  so a cap edit can refresh the bars without touching the settings inputs. */
function budgetCompareHtml(): string {
  const { fmt, legs, categories } = ctx;
  const sym = currencySymbol(baseCurrency());
  const tripTotal = tripBudget();
  const sum = ctx.expenses().reduce((s, e) => s + ctx.inBase(e), 0);

  return `
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
            const countriesList = [...new Set([...legCountries(legs()), ...Object.keys(caps)])];
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
                const flag = legs().find((l) => l.country === c)?.flag ?? '';
                return `
                  <div class="exp-budget-cmp-row">
                    <div class="exp-budget-cmp-name">${escHtml(flag)} ${escHtml(c)}</div>
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
                const spent = categorySpend(cat.id);
                const cap = caps[cat.id];
                const pct = Math.min(100, Math.round((spent / cap) * 100));
                const over = spent > cap;
                const color = pct >= 100 ? 'var(--coral-500)' : pct >= 80 ? '#f59e0b' : 'var(--sage-500)';
                return `
                  <div class="exp-budget-cmp-row">
                    <div class="exp-budget-cmp-name">${escHtml(cat.icon)} ${escHtml(cat.label)}</div>
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
          })()}`;
}

/** Repaint only the compare bars. Safe while a cap input has focus. */
function refreshBudgetCompare() {
  const cmp = document.querySelector('.exp-budget-compare') as HTMLElement | null;
  if (!cmp) return;
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
  cmp.innerHTML = budgetCompareHtml();
}

/**
 * Bind a cap <input> to its store write.
 *
 * `change` alone is not enough. It only fires when the field loses focus in a
 * way the browser counts as a commit, so a value could be typed and then lost
 * outright by: pressing Enter (no handler on these fields), hitting Escape
 * (the panel closes and the DOM is thrown away), or leaving the page/tab while
 * the field still has focus. Each of those is an ordinary thing to do after
 * typing a number, and each silently discarded the edit.
 *
 * So commit on three signals, all funnelled through one idempotent save:
 *   - `input`, debounced — the value is safe ~400ms after typing stops, with
 *     no blur required at all. This is the one that actually fixes the bug.
 *   - `change` — immediate save on a normal blur, no debounce wait.
 *   - Enter — commits and drops focus, which is what users expect it to do.
 *
 * `last` makes repeat saves cheap: re-committing an unchanged value is skipped,
 * so the debounce and the blur firing back-to-back cost one write, not two.
 */
function bindCapInput(
  input: HTMLInputElement,
  save: (amount: number | null) => Promise<void>,
): { commit: () => Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = input.value.trim();

  const commit = async () => {
    clearTimeout(timer);
    const raw = input.value.trim();
    if (raw === last) return; // nothing new to persist
    last = raw;
    const val = parseFloat(raw);
    await save(Number.isFinite(val) && val > 0 ? val : null);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { void commit(); }, 400);
  });
  input.addEventListener('change', () => { void commit(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Commit explicitly rather than leaning on blur to raise `change` —
      // whether it does is browser-dependent for a programmatic blur.
      void commit().then(() => input.blur());
      return;
    }
    // Escape tears the panel down (see onBudgetKey), so flush before that runs.
    if (e.key === 'Escape') void commit();
  });

  return { commit };
}

/** Repaint the "Allocated X · Y unallocated" footer in place from the caps just
 *  persisted. Touches no input, so it is safe from a cap `change` handler. */
function refreshAllocatedLine(pane: HTMLElement, caps: Record<string, number>) {
  const el = pane.querySelector('.exp-budget-flex') as HTMLElement | null;
  if (!el) return; // no total budget set → the line isn't rendered at all
  const tripTotal = tripBudget();
  if (tripTotal == null) return;
  const totalCap = Object.values(caps).reduce((s, v) => s + v, 0);
  const flex = tripTotal - totalCap;
  el.classList.toggle('over', flex < 0);
  el.textContent = `${t('expenses.allocatedLabel')} ${ctx.fmt(totalCap)} · ${
    flex < 0
      ? `${ctx.fmt(-flex)} ${t('expenses.overTotal')}`
      : `${ctx.fmt(flex)} ${t('expenses.unallocated')}`}`;
}

export function renderBudgetPage() {
  const panel = document.querySelector('.exp-budget-panel') as HTMLElement | null;
  if (!panel) return;
  panel.classList.toggle('open', showBudget);
  // eslint-disable-next-line no-restricted-syntax -- audited: static empty string
  if (!showBudget) { panel.innerHTML = ''; return; }

  const { fmt, legs, categories } = ctx;
  const sym = currencySymbol(baseCurrency());

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
  panel.innerHTML = `
    <div class="exp-records-overlay exp-budget-overlay">
      <div class="exp-records-bar">
        <button class="exp-records-back" id="exp-budget-back">${t('expenses.btnBack')}</button>
        <div class="exp-records-bar-title">${t('expenses.budgetTitle')}</div>
      </div>
      <div class="exp-records-scroll">
        <!-- Compare section -->
        <div class="exp-budget-compare">${budgetCompareHtml()}</div>

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
      // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
      settingsPane.innerHTML = `
        <label class="field-label">Total trip budget (${sym}, ${escHtml(baseCurrency())})</label>
        <input class="input" type="number" id="bm-total" min="0" step="1" placeholder="e.g. 5000" value="${budget ?? ''}">
        <p class="exp-modal-hint">${t('expenses.budgetTotalHint')}</p>`;
      const input = settingsPane.querySelector('#bm-total') as HTMLInputElement;
      // Only one input on this tab, so a full rebuild can't steal focus from a
      // sibling field the way it would on the country/category tabs.
      const save = async () => {
        const val = parseFloat(input.value);
        await setTripBudget(val > 0 ? val : null);
        ctx.renderSummaryRoot();
      };
      input.addEventListener('change', save);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      return;
    }

    if (budgetTab === 'country') {
      const caps = countryBudgets();
      const countriesList = [...new Set([...legCountries(legs()), ...Object.keys(caps)])];
      const totalCap = Object.values(caps).reduce((s, v) => s + v, 0);
      const tripTotal = tripBudget();
      const flex = tripTotal ? tripTotal - totalCap : null;

      // Per-country day count from itinerary
      const countryDays: Record<string, number> = {};
      for (const leg of legs()) {
        if (!leg.country) continue;
        const from = new Date(leg.dateFrom);
        const to   = new Date(leg.dateTo);
        const d = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
        countryDays[leg.country] = (countryDays[leg.country] ?? 0) + d;
      }

      // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
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
            const flag = legs().find((l) => l.country === c)?.flag ?? '';
            const spent = countrySpend(c);
            const daysLabel = countryDays[c] ? ` · ${countryDays[c]}d` : '';
            return `
              <div class="exp-budget-row">
                <div class="exp-budget-row-name">${escHtml(flag)} ${escHtml(c)}<span class="exp-budget-row-spent">${fmt(spent)} ${t('expenses.spentLabel')}${daysLabel}</span></div>
                <input class="input exp-budget-row-input" type="number" min="0" step="1" data-country="${escHtml(c)}" data-days="${countryDays[c] ?? 0}" placeholder="no cap" value="${caps[c] ?? ''}">
              </div>`;
          }).join('')}
        </div>
        ${flex != null ? `<p class="exp-budget-flex ${flex < 0 ? 'over' : ''}">${t('expenses.allocatedLabel')} ${fmt(totalCap)} · ${flex < 0 ? `${fmt(-flex)} ${t('expenses.overTotal')}` : `${fmt(flex)} ${t('expenses.unallocated')}`}</p>` : ''}`;

      // See the editing invariant at the top of this file: repaint the compare
      // bars and the footer, never the inputs.
      const bound = [...settingsPane.querySelectorAll<HTMLInputElement>('.exp-budget-row-input')]
        .map((input) => ({
          input,
          ...bindCapInput(input, async (amount) => {
            await setCountryBudget(input.dataset.country!, amount);
            refreshBudgetCompare();
            refreshAllocatedLine(settingsPane, countryBudgets());
            ctx.renderSummaryOnly();
            ctx.renderForm();
          }),
        }));

      // Auto-estimate: fill all inputs with days × daily rate. Goes through each
      // field's own commit rather than writing the store behind its back, so the
      // binding's last-committed value stays in step — otherwise a later manual
      // edit back to the estimated number would look unchanged and be skipped.
      settingsPane.querySelector('#bm-apply-daily')?.addEventListener('click', async () => {
        const rateEl = settingsPane.querySelector<HTMLInputElement>('#bm-daily-rate');
        const rate = parseFloat(rateEl?.value ?? '');
        if (!rate || rate <= 0) { rateEl?.focus(); return; }
        for (const { input, commit } of bound) {
          const d = parseInt(input.dataset.days ?? '0', 10);
          if (!d) continue;
          input.value = String(Math.round(d * rate));
          await commit();
        }
      });
      return;
    }

    // category tab
    const caps = categoryBudgets();
    const totalCap = Object.values(caps).reduce((s, v) => s + v, 0);
    const tripTotal = tripBudget();
    const flex = tripTotal ? tripTotal - totalCap : null;
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
    settingsPane.innerHTML = `
      <div class="exp-budget-rows">
        ${categories().map((cat) => {
          const spent = categorySpend(cat.id);
          return `
            <div class="exp-budget-row">
              <div class="exp-budget-row-name">${escHtml(cat.icon)} ${escHtml(cat.label)}<span class="exp-budget-row-spent">${fmt(spent)} ${t('expenses.spentLabel')}</span></div>
              <input class="input exp-budget-row-input" type="number" min="0" step="1" data-cat="${escHtml(cat.id)}" placeholder="no cap" value="${caps[cat.id] ?? ''}">
            </div>`;
        }).join('')}
      </div>
      ${flex != null ? `<p class="exp-budget-flex ${flex < 0 ? 'over' : ''}">${t('expenses.allocatedLabel')} ${fmt(totalCap)} · ${flex < 0 ? `${fmt(-flex)} ${t('expenses.overTotal')}` : `${fmt(flex)} ${t('expenses.unallocated')}`}</p>` : ''}`;

    // Same invariant as the country tab: never re-render the inputs on blur.
    settingsPane.querySelectorAll<HTMLInputElement>('.exp-budget-row-input').forEach((input) => {
      bindCapInput(input, async (amount) => {
        await setCategoryBudget(input.dataset.cat!, amount);
        refreshBudgetCompare();
        refreshAllocatedLine(settingsPane, categoryBudgets());
        ctx.renderSummaryOnly();
      });
    });
  };

  panel.querySelector('#exp-budget-back')?.addEventListener('click', () => closeBudgetPage());
  panel.querySelectorAll<HTMLElement>('.exp-budget-tab').forEach((btn) => {
    btn.addEventListener('click', () => { budgetTab = btn.dataset.tab as BudgetTab; renderSettings(); });
  });

  renderSettings();
}
