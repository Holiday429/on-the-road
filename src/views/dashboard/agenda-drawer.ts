/* ==========================================================================
   On the Road · Dashboard agenda — item detail drawer
   --------------------------------------------------------------------------
   Clicking a schedule row (plan item, transport, stay) opens its details in
   the side drawer instead of jumping to another page. Plan items also get a
   map link and a one-line "log an expense" form tied to the item and its day.
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { navigateTo } from '../../core/app.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { baseCurrency } from '../../data/trip-context.ts';
import { peekRateTable } from '../../data/rates.ts';
import type { AgendaItem } from '../../data/day-agenda.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { expenseSlip } from '../expenses/expense-slip.ts';
import { addExpenseWithDefaults, defaultCurrency, BUILTIN_CATEGORIES } from '../expenses/expense-defaults.ts';

export interface AgendaDrawerCtx {
  legs: StoredLeg[];
  /** The day being shown (YYYY-MM-DD) — the expense is logged on it. */
  iso: string;
  trigger?: HTMLElement | null;
}

/** Kinds that open the drawer; the rest keep tapping through to their page. */
export function opensDrawer(it: AgendaItem): boolean {
  return it.kind === 'plan' || it.kind === 'transport' || it.kind === 'stay';
}

function mapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function spendForm(cur: string): string {
  const sym = cur;
  return `
    <form class="td-dspend" data-dspend hidden>
      <div class="td-dspend-row">
        <span class="td-dspend-cur">${esc(sym)}</span>
        <input class="input td-dspend-amt" type="text" inputmode="decimal" placeholder="0.00" aria-label="${esc(t('dash.agenda.spendAmount'))}" required>
        <select class="input select td-dspend-cat" aria-label="${esc(t('dash.agenda.spendCategory'))}">
          <option value="">${esc(t('dash.agenda.spendCategory'))}…</option>
          ${BUILTIN_CATEGORIES.map((c) => `<option value="${esc(c.id)}">${c.icon} ${esc(c.label)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" type="submit">✓</button>
      </div>
    </form>`;
}

export function openAgendaItemDrawer(it: AgendaItem, ctx: AgendaDrawerCtx): void {
  const leg = ctx.legs.find((l) => l.id === it.legId) ?? null;
  const isPlan = it.kind === 'plan';
  const cur = defaultCurrency(ctx.legs, ctx.iso);

  const details = it.details.length
    ? it.details.map((d) => `<div class="td-dr"><span class="td-dr-k">${esc(d.label)}</span><span class="td-dr-v">${esc(d.value)}</span></div>`).join('')
    : `<p class="td-dempty">${esc(t('dash.agenda.noDetails'))}</p>`;

  const mapQuery = isPlan ? [it.title, leg?.city, leg?.country].filter(Boolean).join(', ')
    : it.details.find((d) => d.label === t('agenda.d.address'))?.value ?? '';
  const actions = [
    mapQuery ? `<button type="button" class="btn btn-ghost" data-d-map>${esc(t('dash.agenda.map'))}</button>` : '',
    isPlan ? `<button type="button" class="btn btn-ghost" data-d-spend-toggle>${esc(t('dash.agenda.logSpend'))}</button>` : '',
  ].filter(Boolean).join('');

  const d = openDrawer({
    title: `${it.icon} ${it.title}`,
    subtitle: [it.time, it.subtitle].filter(Boolean).join(' · ') || undefined,
    body: `
      <section class="td-dcard">${details}</section>
      ${actions ? `<div class="td-dactions">${actions}</div>` : ''}
      ${isPlan ? spendForm(cur) : ''}`,
    footer: it.navTo
      ? `<button type="button" class="btn btn-ghost" data-d-open>${esc(t(it.navTo === 'route' ? 'dash.banner.openItinerary' : 'dash.agenda.openPage'))}</button>`
      : undefined,
    returnFocus: ctx.trigger,
  });

  d.root.querySelector('[data-d-map]')?.addEventListener('click', () =>
    window.open(mapsUrl(mapQuery), '_blank', 'noopener,noreferrer'));
  d.root.querySelector('[data-d-open]')?.addEventListener('click', () => {
    closeDrawer();
    navigateTo(it.navTo!, it.intent);
  });

  const form = d.root.querySelector<HTMLFormElement>('[data-dspend]');
  d.root.querySelector('[data-d-spend-toggle]')?.addEventListener('click', () => {
    if (!form) return;
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector<HTMLInputElement>('.td-dspend-amt')?.focus();
  });
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseFloat(form.querySelector<HTMLInputElement>('.td-dspend-amt')!.value.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const category = form.querySelector<HTMLSelectElement>('.td-dspend-cat')!.value;
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    btn.disabled = true;
    const spend = {
      amount, currency: cur, description: it.title, date: ctx.iso, category,
      country: leg?.country ?? '', city: leg?.city ?? '',
      rates: peekRateTable(baseCurrency()),
    };
    const printSlip = expenseSlip(spend);
    const ok = await addExpenseWithDefaults(spend).catch(() => false);
    if (ok) { btn.textContent = '✓'; printSlip(); setTimeout(() => closeDrawer(), 600); }
    else btn.disabled = false;
  });
}
