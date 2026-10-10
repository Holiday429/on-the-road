/* ==========================================================================
   On the Road · Dashboard — agenda widget
   --------------------------------------------------------------------------
   Replaces the old month-calendar tile and the per-leg "Upcoming" feed with one
   "calendar + schedule" widget: a compact month on the left, the selected
   day's full agenda on the right (today by default, tomorrow one tap away, or
   any day you tap in the month).

   All aggregation lives in data/day-agenda.ts — shared with the Calendar view
   and mirroring iOS — so this file is rendering and a little UI state only.
   ========================================================================== */

import { agendaForDay, kindsByDate, addDays, AGENDA_COLORS, type AgendaItem, type AgendaKind, type AgendaSources, type DayAgenda } from '../../data/day-agenda.ts';
import { entryCover, moodEmoji } from '../journal/shared/utils.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';

type Tab = 'today' | 'tomorrow';
let _tab: Tab = 'today';
let _sel: string | null = null;      // explicit day picked from the month grid

const MAX_ITEMS = 7;
const DOT_ORDER: AgendaKind[] = ['transport', 'stay', 'plan', 'todo', 'spend', 'journal'];

/** Reset UI state (new trip / re-init) so a stale selection can't leak across. */
export function resetAgenda(): void { _tab = 'today'; _sel = null; }

/** Which date the right-hand panel shows, and whether it's a "next up" fallback. */
function resolveDay(today: string, src: AgendaSources): { iso: string; nextUp: boolean } {
  if (_sel) return { iso: _sel, nextUp: false };
  if (_tab === 'tomorrow') return { iso: addDays(today, 1), nextUp: false };
  // Before/after the trip (or on a free day) "today" is empty — rather than a
  // blank panel, jump to the next day that actually has something.
  if (agendaForDay(today, src).isEmpty) {
    const kinds = kindsByDate(src);
    const next = [...kinds.keys()].filter((d) => d > today).sort()[0];
    if (next) return { iso: next, nextUp: true };
  }
  return { iso: today, nextUp: false };
}

/* ── Month grid ──────────────────────────────────────────────────────────── */

function renderMonth(iso: string, today: string, kinds: Map<string, Set<AgendaKind>>): string {
  const [y, m] = iso.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7;                       // Monday-first
  const hdr = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span class="ag-dow">${d}</span>`).join('');
  let cells = '<span class="ag-cell ag-empty"></span>'.repeat(offset);
  for (let d = 1; d <= days; d++) {
    const cur = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const set = kinds.get(cur);
    const dots = set
      ? DOT_ORDER.filter((k) => set.has(k)).slice(0, 3)
          .map((k) => `<i style="background:${AGENDA_COLORS[k]}"></i>`).join('')
      : '';
    const cls = ['ag-cell', cur === today ? 'is-today' : '', cur === iso ? 'is-sel' : ''].filter(Boolean).join(' ');
    cells += `<button type="button" class="${cls}" data-agenda-day="${cur}"><span>${d}</span><span class="ag-dots">${dots}</span></button>`;
  }
  const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `
    <div class="ag-month">
      <div class="ag-month-title">${esc(title)}</div>
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

function renderItem(it: AgendaItem): string {
  const color = AGENDA_COLORS[it.kind];
  // Plan items and to-dos tick inline; everything else is a plain tap-through.
  const check = it.planRef
    ? `<button type="button" class="ag-check${it.done ? ' is-done' : ''}" data-toggle-plan="${esc(it.planRef.legId)}:${esc(it.planRef.planId)}" aria-label="Toggle done"></button>`
    : it.todoId
    ? `<button type="button" class="ag-check" data-toggle-todo="${esc(it.todoId)}:false" aria-label="Mark done"></button>`
    : '';
  const nav = it.navTo
    ? ` data-nav="${it.navTo}"${it.intent ? ` data-intent='${esc(JSON.stringify(it.intent))}'` : ''}`
    : '';
  return `
    <div class="ag-item ag-kind-${it.kind}${it.done ? ' is-done' : ''}"${nav} style="--ag-c:${color}">
      <span class="ag-time">${esc(it.time ?? '')}</span>
      <span class="ag-icon">${it.icon}</span>
      <span class="ag-copy">
        <span class="ag-title">${esc(it.title)}</span>
        ${it.subtitle ? `<span class="ag-sub">${esc(it.subtitle)}</span>` : ''}
      </span>
      ${check}
    </div>`;
}

function renderDay(day: DayAgenda, src: AgendaSources, nextUp: boolean): string {
  const date = new Date(day.iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const where = day.leg
    ? `${esc(day.leg.flag)} ${esc(day.leg.city)}${day.dayInLeg ? ` · ${esc(t('dash.agenda.dayOf', { n: day.dayInLeg.n, total: day.dayInLeg.total }))}` : ''}`
    : '';
  const hint = dayHint(day, src);

  // The context card is the header's job here, not a row.
  const rows = day.items.filter((i) => i.kind !== 'context');
  const shown = rows.slice(0, MAX_ITEMS);
  const more = rows.length - shown.length;

  const journal = day.journalEntries.length
    ? `<div class="ag-journal" data-nav="journal">
         <span class="ag-journal-label">📔</span>
         ${day.journalEntries.slice(0, 4).map((e) => {
           const cover = entryCover(e);
           return `<span class="ag-thumb">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : esc(moodEmoji(e.mood) || '📖')}</span>`;
         }).join('')}
         ${day.journalEntries.length > 4 ? `<span class="ag-more-n">+${day.journalEntries.length - 4}</span>` : ''}
       </div>`
    : '';

  const body = shown.length || journal
    ? `<div class="ag-list">${shown.map(renderItem).join('')}</div>${journal}${more > 0 ? `<button type="button" class="ag-more" data-nav="calendar" data-intent='${esc(JSON.stringify({ date: day.iso }))}'>${esc(t('dash.agenda.more', { n: more }))}</button>` : ''}`
    : `<div class="ag-empty"><div>${esc(t('dash.agenda.empty'))}</div><button type="button" class="td-link" data-nav="cities">${esc(t('dash.agenda.explore'))}</button></div>`;

  return `
    <div class="ag-day">
      ${nextUp ? `<div class="ag-nextup">${esc(t('dash.agenda.nextUp'))}</div>` : ''}
      <div class="ag-day-head">
        <div class="ag-date">${esc(date)}</div>
        ${where ? `<div class="ag-where">${where}</div>` : ''}
        ${hint ? `<div class="ag-hint">${esc(hint)}</div>` : ''}
      </div>
      ${body}
    </div>`;
}

/* ── Public ──────────────────────────────────────────────────────────────── */

export function renderAgendaWidget(src: AgendaSources, today: string): string {
  const { iso, nextUp } = resolveDay(today, src);
  const kinds = kindsByDate(src);
  const day = agendaForDay(iso, src);
  const activeTab: Tab | null = _sel ? null : _tab;
  const tab = (id: Tab, label: string) =>
    `<button type="button" class="ag-tab${activeTab === id ? ' is-active' : ''}" data-agenda-tab="${id}">${esc(label)}</button>`;
  return `
    <div class="td-widget td-w-agenda" data-widget-id="agenda">
      <div class="td-widget-header">
        <div class="td-widget-label">📅 ${esc(t('dash.agenda.title'))}</div>
        <div class="ag-tabs">${tab('today', t('dash.agenda.today'))}${tab('tomorrow', t('dash.agenda.tomorrow'))}</div>
        <button type="button" class="td-link" data-nav="calendar">${esc(t('dash.agenda.all'))}</button>
      </div>
      <div class="ag-body">
        ${renderMonth(iso, today, kinds)}
        ${renderDay(day, src, nextUp)}
      </div>
    </div>`;
}

/** Wire tab + day-picker clicks. `render` re-renders the whole dashboard. */
export function wireAgenda(body: HTMLElement, render: () => void): void {
  body.querySelectorAll<HTMLElement>('[data-agenda-tab]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      _tab = b.dataset.agendaTab as Tab;
      _sel = null;
      render();
    });
  });
  body.querySelectorAll<HTMLElement>('[data-agenda-day]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      _sel = b.dataset.agendaDay!;
      render();
    });
  });
}
