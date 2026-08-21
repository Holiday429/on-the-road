/* ==========================================================================
   On the Road · Dashboard — alert bell
   --------------------------------------------------------------------------
   Two kinds of nag surface here rather than as banners across the top of the
   dashboard: country budgets at 80%+ of their cap (or already over), and to-dos
   whose due date has passed. Both render as a bell with a count badge in the
   greeting row; details live in a hover/click popover.

   Alerts are derived state, not stored records — there's nothing to mutate when
   one is dismissed. So dismissals are kept per-device in localStorage, keyed by
   a stable id per alert. A budget alert's key folds in the severity bucket, so
   dismissing "Italy at 98%" re-fires once Italy actually goes over.
   ========================================================================== */

import type { StoredLeg } from '../../data/stores/route-store.ts';
import type { StoredExpense } from '../../data/stores/expense-store.ts';
import type { StoredTodo } from '../../data/stores/todo-store.ts';
import { baseCurrency, countryBudgets, currentTripId } from '../../data/trip-context.ts';
import { currencySymbol } from '../../data/rates.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';

interface Alert {
  /** Stable across renders — identifies the alert for dismissal. */
  key: string;
  kind: 'budget' | 'todo';
  icon: string;
  /** Pre-escaped markup — every interpolated value goes through esc(). */
  html: string;
  /** Over budget / past due sort ahead of warnings. */
  urgent: boolean;
  /** Tie-break within a kind: higher sorts first. */
  weight: number;
}

/** Dashboard state the bell reads — passed in so this module owns no data. */
export interface AlertContext {
  expenses: StoredExpense[];
  legs: StoredLeg[];
  todos: StoredTodo[];
  /** Today as 'YYYY-MM-DD'. */
  today: string;
  /** Converts an expense to the trip's base currency. */
  inBase: (e: StoredExpense) => number;
}

/* ── Dismissals ──────────────────────────────────────────────────────────── */

const DISMISS_KEY = 'otr.alerts.dismissed';

function dismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}

/**
 * Records a dismissal. Prunes to the most recent 200 so a long trip can't grow
 * the entry without bound.
 */
function dismissAlert(key: string): void {
  try {
    const keys = [...dismissed()].filter(k => k !== key);
    keys.push(key);
    localStorage.setItem(DISMISS_KEY, JSON.stringify(keys.slice(-200)));
  } catch { /* ignore — dismissal is a convenience, not state we depend on */ }
}

/* ── Alert sources ───────────────────────────────────────────────────────── */

function budgetAlerts(ctx: AlertContext): Alert[] {
  const caps = countryBudgets();
  const sym  = currencySymbol(baseCurrency());
  const trip = currentTripId() ?? '-';
  const out: Alert[] = [];

  for (const [country, cap] of Object.entries(caps)) {
    if (!cap) continue;
    const spent = ctx.expenses.filter(e => e.country === country).reduce((s, e) => s + ctx.inBase(e), 0);
    const pct = spent / cap;
    if (pct < 0.8) continue;

    const over = spent > cap;
    const flag = ctx.legs.find(l => l.country === country)?.flag ?? '';
    const text = over
      ? t('dashboard.budgetOverBy').replace('{amount}', `${sym}${Math.round(spent - cap)}`)
      : t('dashboard.budgetAtPct')
          .replace('{pct}', String(Math.round(pct * 100)))
          .replace('{cap}', `${sym}${Math.round(cap)}`);

    out.push({
      // Severity is part of the key so a dismissed warning returns once the
      // country crosses its cap.
      key: `${trip}:budget:${country}:${over ? 'over' : 'warn'}`,
      kind: 'budget',
      icon: flag,
      html: `<strong>${esc(country)}</strong> ${esc(text)}`,
      urgent: over,
      weight: pct,
    });
  }
  return out;
}

function todoAlerts(ctx: AlertContext): Alert[] {
  const trip = currentTripId() ?? '-';

  return ctx.todos
    .filter(td => !td.done && td.dueDate && td.dueDate < ctx.today)
    .map(td => {
      const days = daysBetween(td.dueDate as string, ctx.today);
      const late = days === 1
        ? t('dashboard.todoOverdueDay')
        : t('dashboard.todoOverdueDays').replace('{n}', String(days));
      return {
        // Keyed by due date too, so rescheduling a task re-raises it.
        key: `${trip}:todo:${td.id}:${td.dueDate}`,
        kind: 'todo' as const,
        icon: '⏰',
        html: `<strong>${esc(td.text)}</strong> — ${esc(late)}`,
        urgent: true,
        weight: days,
      };
    });
}

/** Whole days from `from` to `to`, both 'YYYY-MM-DD'. */
function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`);
  return Math.max(1, Math.round(ms / 86_400_000));
}

/* ── Render ──────────────────────────────────────────────────────────────── */

/**
 * Alerts live in the greeting row as a bell with a count badge, so they stay
 * one glance away without eating the top of the dashboard. Details sit in a
 * popover that opens on hover and on click (click pins it open).
 */
export function renderAlertBell(ctx: AlertContext): string {
  const gone = dismissed();
  const alerts = [...budgetAlerts(ctx), ...todoAlerts(ctx)]
    .filter(a => !gone.has(a.key))
    // Worst first: urgent ahead of warnings, then by how bad within that.
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.weight - a.weight);

  if (!alerts.length) return '';

  const tone  = alerts.some(a => a.urgent) ? 'is-over' : 'is-warning';
  const label = t('dashboard.alertsCount').replace('{n}', String(alerts.length));

  const rows = alerts.map(a => `
    <div class="td-ba-row ${a.urgent ? 'is-over' : 'is-warning'}">
      <span class="td-ba-flag" aria-hidden="true">${esc(a.icon)}</span>
      <span class="td-ba-text">${a.html}</span>
      <button type="button" class="td-ba-dismiss" data-dismiss-alert="${esc(a.key)}"
              aria-label="${esc(t('dashboard.alertDismiss'))}"
              title="${esc(t('dashboard.alertDismiss'))}">&times;</button>
    </div>`).join('');

  return `
    <div class="td-alert-bell ${tone}" data-alert-bell>
      <button type="button" class="td-bell-btn" aria-haspopup="dialog" aria-expanded="false"
              aria-label="${esc(label)}" title="${esc(label)}">
        <span class="td-bell-icon" aria-hidden="true">&#128276;</span>
        <span class="td-bell-badge">${alerts.length > 99 ? '99+' : alerts.length}</span>
      </button>
      <div class="td-bell-pop" role="dialog" aria-label="${esc(label)}">
        <div class="td-bell-pop-title">${esc(label)}</div>
        ${rows}
      </div>
    </div>`;
}

/* ── Wiring ──────────────────────────────────────────────────────────────── */

/**
 * Hover previews the popover; click pins it open. Dismissing an alert re-renders
 * the dashboard (the bell disappears once the last alert is gone), so the caller
 * hands us its `render` rather than us reaching for it.
 */
export function wireAlertBell(body: HTMLElement, render: () => void): void {
  const bell = body.querySelector<HTMLElement>('[data-alert-bell]');
  if (!bell) return;

  const btn = bell.querySelector<HTMLButtonElement>('.td-bell-btn');

  // The outside-click listener is bound only while pinned open. render() runs
  // on every store update and re-wires this bell each time, so a listener left
  // on `document` would accumulate one per render.
  const onDocClick = (e: MouseEvent) => {
    if (!bell.contains(e.target as Node)) setPinned(false);
  };
  const setPinned = (on: boolean) => {
    bell.classList.toggle('is-open', on);
    btn?.setAttribute('aria-expanded', String(on));
    if (on) document.addEventListener('click', onDocClick);
    else document.removeEventListener('click', onDocClick);
  };

  btn?.addEventListener('click', e => {
    e.stopPropagation();
    setPinned(!bell.classList.contains('is-open'));
  });

  bell.querySelectorAll<HTMLElement>('[data-dismiss-alert]').forEach(x => {
    x.addEventListener('click', e => {
      e.stopPropagation();
      const key = x.dataset.dismissAlert;
      if (!key) return;
      dismissAlert(key);
      const wasOpen = bell.classList.contains('is-open');
      render();
      // Keep the popover open so several alerts can be cleared in a row. The
      // old node is gone after the re-render, so re-find the new one.
      if (wasOpen) {
        document.querySelector<HTMLElement>('[data-alert-bell] .td-bell-btn')?.click();
      }
    });
  });

  bell.addEventListener('keydown', e => {
    if (e.key === 'Escape') { setPinned(false); btn?.focus(); }
  });
}
