/* ==========================================================================
   On the Road · Dashboard — agenda widget
   --------------------------------------------------------------------------
   Replaces the old month-calendar tile and the per-leg "Upcoming" feed with one
   "calendar + schedule" widget: a compact month on the left, the selected
   day's full agenda on the right (today by default, tomorrow one tap away, or
   any day you tap in the month).

   The day panel lists only what you planned to do that day (plan items, in
   order) under the day's headline and hint. Flights and stays live in the banner,
   spend and journal in their own cards, to-dos in the To-do card — so none of
   them repeat here.

   All aggregation lives in data/day-agenda.ts — shared with the Calendar view
   and mirroring iOS — so this file is rendering and a little UI state only.
   ========================================================================== */

import { agendaForDay, kindsByDate, addDays, type AgendaItem, type AgendaSources, type DayAgenda } from '../../data/day-agenda.ts';
import { categoryById } from '../itinerary/itinerary-shared.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { openAgendaItemDrawer } from './agenda-drawer.ts';
import { openAddPlanModal } from './dashboard-modals.ts';

type Tab = 'today' | 'tomorrow';
let _tab: Tab = 'today';
let _sel: string | null = null;      // explicit day picked from the month grid
let _month: string | null = null;    // 'YYYY-MM' the user paged to; null = follow the shown day

const MAX_ITEMS = 3;   // the rest sit behind "+N more" — keeps the card as short as the month grid

/** Reset UI state (new trip / re-init) so a stale selection can't leak across. */
export function resetAgenda(): void { _tab = 'today'; _sel = null; _month = null; }

/** Which date the right-hand panel shows, and whether it's a "next up" fallback. */
function resolveDay(today: string, src: AgendaSources): { iso: string; nextUp: boolean } {
  if (_sel) return { iso: _sel, nextUp: false };
  if (_tab === 'tomorrow') return { iso: addDays(today, 1), nextUp: false };
  // Before/after the trip (or on a free day) "today" has nothing planned — rather
  // than a blank panel, jump to the next day that has a plan item. A day that
  // still has a headline hint (arrival, last day…) stays put.
  const todayDay = agendaForDay(today, src);
  if (!todayDay.items.some((i) => i.kind === 'plan') && !dayHint(todayDay, src)) {
    const kinds = kindsByDate(src);
    const next = [...kinds.entries()].filter(([d, k]) => d > today && k.has('plan')).map(([d]) => d).sort()[0];
    if (next) return { iso: next, nextUp: true };
  }
  return { iso: today, nextUp: false };
}

/** The date the widget is showing right now — the To-do widget and the + button key off it. */
export function shownAgendaDay(src: AgendaSources, today: string): string {
  return resolveDay(today, src).iso;
}

/* ── Month grid ──────────────────────────────────────────────────────────── */

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function renderMonth(monthKey: string, today: string, selected: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7;                       // Monday-first
  const hdr = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span class="ag-dow">${d}</span>`).join('');
  let cells = '<span class="ag-cell ag-empty"></span>'.repeat(offset);
  for (let d = 1; d <= days; d++) {
    const cur = `${monthKey}-${String(d).padStart(2, '0')}`;
    const cls = ['ag-cell', cur === today ? 'is-today' : '', cur === selected ? 'is-sel' : ''].filter(Boolean).join(' ');
    // The ring / fill sits on .ag-num (a fixed circle around the digits).
    cells += `<button type="button" class="${cls}" data-agenda-day="${cur}"><span class="ag-num">${d}</span></button>`;
  }
  const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `
    <div class="ag-month">
      <div class="ag-month-nav">
        <button type="button" class="ag-nav" data-agenda-month="-1" aria-label="${esc(t('dash.agenda.prevMonth'))}">‹</button>
        <div class="ag-month-title">${esc(title)}</div>
        <button type="button" class="ag-nav" data-agenda-month="1" aria-label="${esc(t('dash.agenda.nextMonth'))}">›</button>
      </div>
      <div class="ag-grid">${hdr}${cells}</div>
    </div>`;
}

/* ── Day panel ───────────────────────────────────────────────────────────── */

/** Phase-aware one-liner for the day, derived from the shared DayFlags. */
export function dayHint(day: DayAgenda, src: AgendaSources): string {
  const { flags, leg } = day;
  if (flags.isLastDayOfTrip) return `🏁 ${t('dash.agenda.hint.lastDay')}`;
  if (flags.isFirstDayOfTrip) return `🚀 ${t('dash.agenda.hint.firstDay')}`;
  if (flags.isArrival && leg) return `🛬 ${t('dash.agenda.hint.arrived', { city: leg.city })}`;
  if (flags.isEveOfDeparture && leg) {
    const next = [...src.legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom)).find((l) => l.dateFrom > leg.dateFrom);
    const tr = next?.arrivalTransport;
    const extra = tr ? ` · ${[tr.from, tr.to].filter(Boolean).join(' → ')}${tr.time ? ` ${tr.time}` : ''}` : '';
    return `🧳 ${t('dash.agenda.hint.leaving')}${extra}`;
  }
  return '';
}

/** A planned thing, the way the Itinerary's Plan board draws it: a tick in front (done →
 *  filled, the title struck through), the title on the category's colour, a chevron at the
 *  end. Ticking writes the same `done` flag the Itinerary reads; the row opens its details
 *  in the side drawer. */
function renderItem(it: AgendaItem, legs: StoredLeg[]): string {
  const leg = legs.find((l) => l.id === it.legId);
  const color = (leg && it.category ? categoryById(leg as never, it.category)?.color : undefined) ?? '#ebebeb';
  const check = it.planRef
    ? `<button type="button" class="ag-check${it.done ? ' is-done' : ''}" data-toggle-plan="${esc(it.planRef.legId)}:${esc(it.planRef.planId)}" aria-label="${esc(t('dash.agenda.toggleDone'))}" aria-pressed="${it.done ? 'true' : 'false'}"></button>`
    : '';
  return `
    <div class="ag-item${it.done ? ' is-done' : ''}" data-agenda-item="${esc(it.id)}" role="button" tabindex="0" style="--ag-bg:${esc(color)}">
      ${check}
      <span class="ag-title">${esc(it.title)}</span>
      <span class="ag-chev" aria-hidden="true">›</span>
    </div>`;
}

function renderDay(day: DayAgenda, src: AgendaSources, nextUp: boolean, today: string): string {
  const date = new Date(day.iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const where = day.leg
    ? `${esc(day.leg.flag)} ${esc(day.leg.city)}${day.dayInLeg ? ` · ${esc(t('dash.agenda.dayOf', { n: day.dayInLeg.n, total: day.dayInLeg.total }))}` : ''}`
    : '';
  const hint = dayHint(day, src);

  // Only the day's plan. (Context is the header's job; transport / stay are in the
  // banner; to-dos, spend and journal have their own cards.)
  const rows = day.items.filter((i) => i.kind === 'plan');
  const shown = rows.slice(0, MAX_ITEMS);
  const more = rows.length - shown.length;

  const body = shown.length
    ? `<div class="ag-list">${shown.map((i) => renderItem(i, src.legs)).join('')}</div>${more > 0 ? `<button type="button" class="ag-more" data-nav="calendar" data-intent='${esc(JSON.stringify({ date: day.iso }))}'>${esc(t('dash.agenda.more', { n: more }))}</button>` : ''}`
    : `<div class="ag-none">${esc(t(day.iso === today ? 'dash.agenda.noEventsToday' : 'dash.agenda.empty'))}</div>`;

  return `
    <div class="ag-day">
      ${nextUp ? `<div class="ag-nextup">${esc(t('dash.agenda.nextUp'))}</div>` : ''}
      <div class="ag-day-head">
        <div class="ag-date">${esc(date)}</div>
        ${where ? `<div class="ag-where">${where}</div>` : ''}
        ${hint ? `<div class="ag-hint">${esc(hint)}</div>` : ''}
      </div>
      ${body}
      ${src.legs.length ? `<button type="button" class="ag-add" data-agenda-add title="${esc(t('dash.agenda.add'))}"><span aria-hidden="true">＋</span> ${esc(t('dash.agenda.addShort'))}</button>` : ''}
    </div>`;
}

/* ── Public ──────────────────────────────────────────────────────────────── */

export function renderAgendaWidget(src: AgendaSources, today: string): string {
  const { iso, nextUp } = resolveDay(today, src);
  const day = agendaForDay(iso, src);
  const activeTab: Tab | null = _sel ? null : _tab;
  const tab = (id: Tab, label: string) =>
    `<button type="button" class="ag-tab${activeTab === id ? ' is-active' : ''}" data-agenda-tab="${id}">${esc(label)}</button>`;
  return `
    <div class="td-widget td-w-agenda" data-widget-id="agenda">
      <div class="td-widget-header">
        <div class="td-widget-label">📅 ${esc(t('dash.agenda.title'))}</div>
        <div class="ag-tabs">${tab('today', t('dash.agenda.today'))}${tab('tomorrow', t('dash.agenda.tomorrow'))}</div>
      </div>
      <div class="ag-body">
        ${renderMonth(_month ?? iso.slice(0, 7), today, iso)}
        ${renderDay(day, src, nextUp, today)}
      </div>
    </div>`;
}

/** Wire tab + day-picker clicks. `render` re-renders the whole dashboard. */
export function wireAgenda(body: HTMLElement, render: () => void, ctx: () => { src: AgendaSources; today: string }): void {
  // Row → detail drawer.
  body.querySelectorAll<HTMLElement>('[data-agenda-item]').forEach((row) => {
    const open = () => {
      const { src, today } = ctx();
      const iso = resolveDay(today, src).iso;
      const item = agendaForDay(iso, src).items.find((i) => i.id === row.dataset.agendaItem);
      if (item) openAgendaItemDrawer(item, { legs: src.legs, iso, trigger: row });
    };
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;      // the inline tick
      open();
    });
    row.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); open(); }
    });
  });
  // + → add a plan item to the day being shown.
  body.querySelector<HTMLElement>('[data-agenda-add]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const { src, today } = ctx();
    openAddPlanModal(src.legs, { date: resolveDay(today, src).iso });
  });
  body.querySelectorAll<HTMLElement>('[data-agenda-tab]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      _tab = b.dataset.agendaTab as Tab;
      _sel = null;
      _month = null;
      render();
    });
  });
  body.querySelectorAll<HTMLElement>('[data-agenda-day]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      _sel = b.dataset.agendaDay!;
      _month = null;                    // the clicked day's month is the shown one
      render();
    });
  });
  // Page the month grid without changing the selected day.
  body.querySelectorAll<HTMLElement>('[data-agenda-month]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const shown = body.querySelector<HTMLElement>('[data-agenda-day]')?.dataset.agendaDay?.slice(0, 7) ?? '';
      if (!shown) return;
      _month = shiftMonth(_month ?? shown, Number(b.dataset.agendaMonth));
      render();
    });
  });
}
