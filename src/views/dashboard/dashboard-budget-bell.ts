/* ==========================================================================
   On the Road · Dashboard — budget alert bell
   --------------------------------------------------------------------------
   Country budgets that are at 80%+ of their cap (or already over) surface as a
   bell with a count badge in the greeting row, rather than as banners stacked
   across the top of the dashboard. Details live in a hover/click popover.
   ========================================================================== */

import type { StoredLeg } from '../../data/stores/route-store.ts';
import type { StoredExpense } from '../../data/stores/expense-store.ts';
import { baseCurrency, countryBudgets } from '../../data/trip-context.ts';
import { currencySymbol } from '../../data/rates.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';

interface BudgetAlert {
  country: string;
  flag: string;
  over: boolean;
  /** Amount over the cap, in base currency — only meaningful when `over`. */
  overBy: number;
  /** Spent / cap, e.g. 0.91. */
  pct: number;
  cap: number;
}

/** Dashboard state the bell reads — passed in so this module owns no data. */
export interface BudgetAlertContext {
  expenses: StoredExpense[];
  legs: StoredLeg[];
  /** Converts an expense to the trip's base currency. */
  inBase: (e: StoredExpense) => number;
}

function budgetAlerts(ctx: BudgetAlertContext): BudgetAlert[] {
  const caps = countryBudgets();
  const out: BudgetAlert[] = [];

  for (const [country, cap] of Object.entries(caps)) {
    if (!cap) continue;
    const spent = ctx.expenses.filter(e => e.country === country).reduce((s, e) => s + ctx.inBase(e), 0);
    const pct = spent / cap;
    if (pct < 0.8) continue;
    out.push({
      country,
      flag: ctx.legs.find(l => l.country === country)?.flag ?? '',
      over: spent > cap,
      overBy: spent - cap,
      pct,
      cap,
    });
  }

  // Worst first: over-budget countries, then the closest to their cap.
  return out.sort((a, b) => Number(b.over) - Number(a.over) || b.pct - a.pct);
}

/**
 * Budget alerts live in the greeting row as a bell with a count badge, so they
 * stay one glance away without eating the top of the dashboard. The details sit
 * in a popover that opens on hover and on click (click pins it open).
 */
export function renderBudgetBell(ctx: BudgetAlertContext): string {
  const alerts = budgetAlerts(ctx);
  if (!alerts.length) return '';

  const sym     = currencySymbol(baseCurrency());
  const overCnt = alerts.filter(a => a.over).length;
  const tone    = overCnt ? 'is-over' : 'is-warning';

  const rows = alerts.map(a => `
    <button type="button" class="td-ba-row ${a.over ? 'is-over' : 'is-warning'}" data-nav="expenses">
      <span class="td-ba-flag">${esc(a.flag)}</span>
      <span class="td-ba-text">
        ${a.over
          ? `<strong>${esc(a.country)}</strong> ${esc(t('dashboard.budgetOverBy').replace('{amount}', `${sym}${Math.round(a.overBy)}`))}`
          : `<strong>${esc(a.country)}</strong> ${esc(t('dashboard.budgetAtPct')
              .replace('{pct}', String(Math.round(a.pct * 100)))
              .replace('{cap}', `${sym}${Math.round(a.cap)}`))}`}
      </span>
      <span class="td-ba-arrow">›</span>
    </button>`).join('');

  const label = t('dashboard.budgetAlertsCount').replace('{n}', String(alerts.length));

  return `
    <div class="td-budget-bell ${tone}" data-budget-bell>
      <button type="button" class="td-bell-btn" aria-haspopup="dialog" aria-expanded="false"
              aria-label="${esc(label)}" title="${esc(label)}">
        <span class="td-bell-icon" aria-hidden="true">&#128276;</span>
        <span class="td-bell-badge">${alerts.length}</span>
      </button>
      <div class="td-bell-pop" role="dialog" aria-label="${esc(label)}">
        <div class="td-bell-pop-title">${esc(label)}</div>
        ${rows}
      </div>
    </div>`;
}
