/* ==========================================================================
   On the Road · Agenda view
   --------------------------------------------------------------------------
   The whole trip, day by day, drawn as a real calendar. Left: a wall calendar —
   a month page with kind-coloured ink dots, a legend and month totals, hung
   from a ring binding and turned like paper — over a sticky note with the open
   to-dos. Right: a tear-off sheet for the selected date — transport, stays,
   plan items, spend and journal, in the order the day actually happens, each
   tappable through to its own view (expandable for details).

   Aggregation is data/day-agenda.ts, shared with the dashboard agenda widget
   and ported from iOS CalendarStore so both platforms read a day identically.
   Narrow screens stack the panel under the month instead of a modal.
   ========================================================================== */

import './agenda.css';
import '../../core/paper/paper.css';
import '../../core/paper/fastener.css';
import '../../core/paper/page-flip.css';
import '../itinerary/itinerary.css';
import '../expenses/styles/records.css';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { todoStore, type StoredTodo } from '../../data/stores/todo-store.ts';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import { expenseCategoryStore } from '../../data/stores/expense-category-store.ts';
import { agendaForDay, kindsByDate, AGENDA_COLORS, type AgendaItem, type AgendaKind, type AgendaSources } from '../../data/day-agenda.ts';
import { baseCurrency } from '../../data/trip-context.ts';
import { currencySymbol, peekRateTable } from '../../data/rates.ts';
import { navigateTo, consumeNavIntent, type NavIntent, type ViewId } from '../../core/app.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';
import { renderFastener } from '../../core/paper/fastener.ts';
import { attachPageDrag, finishFlip, isFlipping, onFlipIdle, turnPage } from './agenda-flip.ts';
import { openModal } from '../../core/modal.ts';
import { scheduleAllNotifications, clearAllNotificationTimers } from '../../core/notifications.ts';
import { entryCover, excerpt, moodEmoji, titleFor } from '../journal/shared/utils.ts';
import { dayHint } from '../dashboard/dashboard-agenda.ts';
import { openBookingWindow } from '../dashboard/banner-drawers.ts';
import { renderStayCard, renderTicket } from '../itinerary/itinerary-cards.ts';
import { legStays } from '../itinerary/itinerary-utils.ts';
import { renderRecordTag } from '../expenses/expense-record-tag.ts';
import { BUILTIN_CATEGORIES, type Category } from '../expenses/expense-helpers.ts';
import type { PlanItem } from '../../data/schema.ts';

import { WIDGET_ICON, GLYPH } from '../../core/icons.ts';
/* ── State ───────────────────────────────────────────────────────────────── */
let _legs:     StoredLeg[]          = [];
let _journal:  StoredJournalEntry[] = [];
let _todos:    StoredTodo[]         = [];
let _expenses: StoredExpense[]      = [];
let _year  = new Date().getFullYear();
let _month = new Date().getMonth();   // 0-based
let _selected: string = todayIso();
const _expanded = new Set<string>();  // item ids whose detail rows are open
let _unsubs: Array<() => void> = [];

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function pad(n: number): string { return String(n).padStart(2, '0'); }
function isoDate(y: number, m: number, d: number): string { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function todayIso(): string {
  const d = new Date();
  return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
}
function sources(): AgendaSources {
  return { legs: _legs, journal: _journal, todos: _todos, expenses: _expenses };
}
/** An expense in the current base currency (re-expressed via the live cross-rate if the base changed). */
function inBase(e: StoredExpense): number {
  const base = baseCurrency();
  if (e.baseCurrency === base) return e.baseAmount;
  const cross = peekRateTable(base)[e.baseCurrency];
  return cross ? e.baseAmount * cross : e.baseAmount;
}
function categoryFor(id: string): Category | undefined {
  const builtin = BUILTIN_CATEGORIES.find((c) => c.id === id);
  if (builtin) return builtin;
  const c = expenseCategoryStore.peek().find((x) => x.id === id);
  return c ? { id: c.id, label: c.label, icon: c.icon, color: c.color, builtin: false } : undefined;
}
function shortDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtMoney(n: number): string {
  return `${currencySymbol(baseCurrency())}${Math.round(n).toLocaleString()}`;
}

/** Show `iso` — jumping the visible month to it. */
function select(iso: string): void {
  _selected = iso;
  const [y, m] = iso.split('-').map(Number);
  _year = y; _month = m - 1;
}

const LEGEND: AgendaKind[] = ['transport', 'stay', 'plan', 'journal', 'spend', 'todo'];

/* ── Month page ──────────────────────────────────────────────────────────── */
const RING_COUNT = 14;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];   // Monday-first, as Date.getDay() numbers

/** One printed month: title, weekday row, six weeks of days, legend and totals. Always six rows, like a real page. */
function renderMonthPage(year: number, month: number, kinds: Map<string, Set<AgendaKind>>): string {
  const today = todayIso();
  const loc = getLocale();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;   // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const monthName = new Date(year, month, 1).toLocaleString(loc, { month: 'long' });
  // Weekday names from a known Monday, so they follow the locale.
  const hdr = WEEKDAYS.map((dow, i) => {
    const name = new Date(2024, 0, 7 + dow).toLocaleDateString(loc, { weekday: 'short' });
    return `<div class="cal-hdr${i >= 5 ? ' is-weekend' : ''}">${esc(name)}</div>`;
  }).join('');

  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = i - firstDow + 1;
    const weekend = i % 7 >= 5 ? ' is-weekend' : '';
    if (d < 1 || d > daysInMonth) {
      // The days of the neighbouring months, printed faint like on a real page.
      cells += `<div class="cal-cell cal-empty${weekend}" aria-hidden="true"><span class="cal-cell-top"><span class="cal-daynum">${d < 1 ? prevDays + d : d - daysInMonth}</span></span></div>`;
      continue;
    }
    const iso = isoDate(year, month, d);
    const set = kinds.get(iso);
    const dots = set
      ? LEGEND.filter((k) => set.has(k)).map((k) => `<i style="background:${AGENDA_COLORS[k]}"></i>`).join('')
      : '';
    const leg = _legs.find((l) => l.dateFrom <= iso && iso <= l.dateTo);
    const cls = ['cal-cell', weekend.trim(), iso === today ? 'is-today' : '', iso === _selected ? 'is-sel' : '', leg ? 'in-leg' : ''].filter(Boolean).join(' ');
    // A new city starts today: just its flag in the cell, the details in a hover tooltip.
    const arriving = _legs.find((l) => l.dateFrom === iso);
    const tip = arriving ? `${arriving.flag} ${arriving.city} · ${shortDate(arriving.dateFrom)} – ${shortDate(arriving.dateTo)}`.trim() : '';
    const city = arriving ? `<span class="cal-city" aria-hidden="true">${esc(arriving.flag || '📍')}</span>` : '';
    cells += `
      <button type="button" class="${cls}" data-day="${iso}"${tip ? ` data-tip="${esc(tip)}" aria-label="${esc(tip)}"` : ''}>
        <span class="cal-cell-top"><span class="cal-daynum">${d}</span>${city}</span>
        <span class="cal-dots">${dots}</span>
      </button>`;
  }

  return `
    <div class="cal-page" data-ym="${year}-${pad(month + 1)}">
      <div class="cal-nav">
        <div class="cal-title">
          <h2 class="cal-month-title">${esc(monthName)}</h2>
          <span class="cal-year">${year}</span>
        </div>
        <div class="cal-nav-tools">
          <button type="button" class="cal-nav-btn" data-dir="-1" aria-label="Previous month">‹</button>
          <button type="button" class="cal-nav-btn" data-dir="1" aria-label="Next month">›</button>
          <button type="button" class="cal-today-btn" data-go-today>${esc(t('dash.agenda.today'))}</button>
        </div>
      </div>
      <div class="cal-grid">${hdr}${cells}</div>
      <div class="cal-meta">
        <div class="cal-legend">${LEGEND.map((k) => `<span><i style="background:${AGENDA_COLORS[k]}"></i>${esc(t(`cal.kind.${k}`))}</span>`).join('')}</div>
        ${renderStats(year, month)}
      </div>
    </div>`;
}

function renderStats(year: number, month: number): string {
  const prefix = `${year}-${pad(month + 1)}`;
  const tripDays = new Set<string>();
  for (const l of _legs) {
    for (let d = new Date(l.dateFrom + 'T00:00:00'); isoDate(d.getFullYear(), d.getMonth(), d.getDate()) <= l.dateTo; d.setDate(d.getDate() + 1)) {
      const iso = isoDate(d.getFullYear(), d.getMonth(), d.getDate());
      if (iso.startsWith(prefix)) tripDays.add(iso);
    }
  }
  const journals = _journal.filter((e) => e.happenedOn.startsWith(prefix)).length;
  const spend = _expenses.filter((e) => e.date.startsWith(prefix)).reduce((sum, e) => sum + inBase(e), 0);
  const stat = (n: string, label: string) => `<span class="cal-stat"><strong>${esc(n)}</strong> ${esc(label)}</span>`;
  return `<div class="cal-stats">${stat(String(tripDays.size), t('cal.stat.days'))}${stat(String(journals), t('cal.stat.journal'))}${stat(fmtMoney(spend), t('cal.stat.spend'))}</div>`;
}

/* ── Day panel ───────────────────────────────────────────────────────────── */
/** The full card behind a row's chevron: transport and stays are drawn with the
 *  Itinerary's ticket / storefront cards, spend with the "All records" chips;
 *  everything else keeps the plain label/value list. */
function expandedBody(it: AgendaItem): string {
  const leg = it.legId ? _legs.find((l) => l.id === it.legId) : undefined;
  if (it.kind === 'transport' && leg?.arrivalTransport) {
    return `<div class="cal-itn" data-leg="${esc(leg.id)}">${renderTicket(leg.arrivalTransport as never)}</div>`;
  }
  if (it.kind === 'stay' && leg) {
    const raw = leg.accommodations?.length ? leg.accommodations : leg.accommodation ? [leg.accommodation] : [];
    const idx = raw.findIndex((a, i) => (a.id ?? `${leg.id}-${i}`) === it.stayKey);
    const a = raw[idx];
    if (a) {
      const ordered = legStays(leg as never);
      const pos = a.id ? ordered.findIndex((s) => s.id === a.id) : idx;
      return `<div class="cal-itn">${renderStayCard(leg as never, a as never, Math.max(0, pos), ordered.length)}</div>`;
    }
  }
  if (it.kind === 'spend') {
    const rows = _expenses.filter((e) => `spend-${e.date}` === it.id).sort((x, y) => y.baseAmount - x.baseAmount);
    const base = baseCurrency();
    return `<div class="cal-itn"><div class="exp-tags">${rows.map((e) =>
      renderRecordTag(e, categoryFor(e.category), e.currency !== base ? ` · ${fmtMoney(inBase(e))}` : '', false)).join('')}</div></div>`;
  }
  return it.details.length
    ? `<dl class="cal-details">${it.details.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join('')}</dl>`
    : '';
}

function renderItem(it: AgendaItem): string {
  const open = _expanded.has(it.id);
  const nav = it.navTo ? ` data-nav="${it.navTo}"${it.intent ? ` data-intent='${esc(JSON.stringify(it.intent))}'` : ''}` : '';
  const check = it.planRef
    ? `<button type="button" class="cal-check${it.done ? ' is-done' : ''}" data-toggle-plan="${esc(it.planRef.legId)}:${esc(it.planRef.planId)}" aria-label="Toggle done">${it.done ? '✓' : ''}</button>`
    : '';
  const expandable = it.details.length > 0 || it.kind === 'transport' || it.kind === 'stay';
  const chevron = expandable
    ? `<button type="button" class="cal-chev${open ? ' is-open' : ''}" data-expand="${esc(it.id)}" aria-expanded="${open}" aria-label="Details"></button>`
    : '';
  return `
    <div class="cal-item${it.done ? ' is-done' : ''}" style="--ag-c:${AGENDA_COLORS[it.kind]}">
      <div class="cal-item-row"${nav}>
        <span class="cal-item-icon">${it.icon}</span>
        <span class="cal-item-copy">
          <span class="cal-item-title">${esc(it.title)}</span>
          ${it.subtitle ? `<span class="cal-item-sub">${esc(it.subtitle)}</span>` : ''}
        </span>
        ${it.time ? `<span class="cal-item-time">${esc(it.time)}</span>` : ''}
        ${check}${chevron}
      </div>
      ${open ? expandedBody(it) : ''}
    </div>`;
}

function todoRow(td: StoredTodo, today: string): string {
  const overdue = !!td.dueDate && td.dueDate < today && !td.done;
  const due = !td.dueDate ? '' : td.dueDate === today ? 'Today' : overdue ? `Overdue · ${td.dueDate}` : td.dueDate;
  const remind = td.remindAt ? new Date(td.remindAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '';
  return `
    <div class="cal-todo-row ${td.done ? 'is-done' : ''}${td.dueDate === _selected && !td.done ? ' is-due-sel' : ''}">
      <button class="cal-todo-check ${td.done ? 'is-checked' : ''}" data-toggle-todo="${esc(td.id)}:${td.done}" title="${td.done ? 'Mark undone' : 'Mark done'}">${td.done ? '✓' : ''}</button>
      <div class="cal-todo-body">
        <span class="cal-todo-label ${overdue ? 'is-overdue' : ''}">${esc(td.text)}</span>
        <span class="cal-todo-meta">
          ${due ? `<span class="cal-todo-due ${overdue ? 'is-overdue' : ''}">${esc(due)}</span>` : ''}
          ${remind ? `<span class="cal-remind-tag">🔔 ${remind}</span>` : ''}
        </span>
      </div>
      <button class="cal-todo-edit" data-edit-todo="${esc(td.id)}" title="Edit">${GLYPH.edit}</button>
      <button class="cal-todo-del" data-del-todo="${esc(td.id)}" title="Delete">✕</button>
    </div>`;
}

function renderDayPanel(): string {
  const src = sources();
  const day = agendaForDay(_selected, src);
  const d = new Date(_selected + 'T00:00:00');
  const loc = getLocale();
  const fullDate = d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const weekday = d.toLocaleDateString(loc, { weekday: 'long' });
  const monthYear = d.toLocaleDateString(loc, { month: 'long', year: 'numeric' });
  const where = day.leg
    ? `${esc(day.leg.flag)} ${esc(day.leg.city)}${day.dayInLeg ? ` · ${esc(t('dash.agenda.dayOf', { n: day.dayInLeg.n, total: day.dayInLeg.total }))}` : ''}`
    : '';
  const hint = dayHint(day, src);

  const rows = day.items.filter((i) => i.kind !== 'context' && i.kind !== 'todo');

  const journal = day.journalEntries.map((e) => {
    const cover = entryCover(e);
    const title = e.title.trim() ? titleFor(e) : excerpt(e.body, 40) || titleFor(e);
    return `
      <div class="cal-journal-card" data-nav="journal">
        <span class="cal-jthumb">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : esc(moodEmoji(e.mood) || '📖')}</span>
        <span class="cal-item-copy">
          <span class="cal-item-title">${esc(title)}</span>
          ${e.destination ? `<span class="cal-item-sub">${esc(e.destination)}</span>` : ''}
          ${e.body.trim() ? `<span class="cal-jexcerpt">${esc(excerpt(e.body, 90))}</span>` : ''}
        </span>
      </div>`;
  }).join('');

  const empty = !rows.length && !journal
    ? `<div class="cal-empty-day">${esc(t('dash.agenda.empty'))}</div>` : '';

  // A tear-off sheet: the month on the red header, the day in big print, then the day's lines.
  return `
    <aside class="cal-panel" id="cal-panel" aria-label="${esc(fullDate)}">
      <div class="cal-sheet-top"><span>${esc(monthYear)}</span></div>
      <div class="cal-panel-head">
        <div class="cal-bigday">${d.getDate()}</div>
        <div class="cal-panel-id">
          <div class="cal-panel-date">${esc(weekday)}</div>
          ${where ? `<div class="cal-panel-where">${where}</div>` : ''}
          ${hint ? `<div class="cal-panel-hint">${esc(hint)}</div>` : ''}
        </div>
        ${_selected === todayIso() ? `<span class="cal-today-stamp" aria-hidden="true">${esc(t('dash.agenda.today'))}</span>` : ''}
      </div>
      <div class="cal-perf" aria-hidden="true"></div>
      ${rows.length ? `<div class="cal-items">${rows.map(renderItem).join('')}</div>` : ''}
      ${journal ? `<div class="cal-sec"><div class="cal-sec-label">${WIDGET_ICON.journal} ${esc(t('dash.widget.journal'))}</div>${journal}</div>` : ''}
      ${empty}
      <div class="cal-panel-actions">
        <button class="btn btn-primary" data-journal-new>✍️ ${esc(t('dash.journal.compose'))}</button>
      </div>
    </aside>`;
}

/* ── All open to-dos ─────────────────────────────────────────────────────── */
function renderTodosPanel(): string {
  const today = todayIso();
  const pending = _todos.filter((td) => !td.done).sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });
  const done = _todos.filter((td) => td.done).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 3);
  // One sticky note, the same paper and tape as a note on the Prepare checklist board.
  return `
    <section class="cal-note" id="cal-todos">
      ${renderFastener('tape')}
      <div class="cal-note-head">
        <span class="cal-todos-title">${WIDGET_ICON.todo} ${esc(t('dash.widget.todo'))}</span>
        <button type="button" class="cal-todos-add" data-add-todo="${today}">+ ${esc(t('cal.addTodo'))}</button>
      </div>
      <div class="cal-note-list">
        ${pending.length ? pending.map((td) => todoRow(td, today)).join('') : `<div class="cal-todos-empty">${esc(t('cal.noOpenTodos'))}</div>`}
        ${done.length ? `<div class="cal-todos-section-label">${esc(t('cal.recentlyDone'))}</div>${done.map((td) => todoRow(td, today)).join('')}` : ''}
      </div>
    </section>`;
}

/* ── Add / Edit todo modal ───────────────────────────────────────────────── */
function openTodoModal(opts: { mode: 'add'; dueDate: string } | { mode: 'edit'; todo: StoredTodo }): void {
  const isEdit = opts.mode === 'edit';
  const existing = isEdit ? opts.todo : null;
  const defaultDate = isEdit ? (existing!.dueDate ?? '') : opts.dueDate;
  const defaultText = existing?.text ?? '';
  const defaultRemind = existing?.remindAt ? new Date(existing.remindAt).toISOString().slice(0, 16) : '';

  const handle = openModal({
    title: isEdit ? 'Edit to-do' : '+ New to-do',
    body: `
      <div style="display:flex;flex-direction:column;gap:12px">
        <input class="input" id="cal-todo-text" placeholder="What do you need to do?" value="${esc(defaultText)}" autofocus>
        <div style="display:flex;gap:8px;align-items:center">
          <label class="field-label" style="margin:0;white-space:nowrap;flex-shrink:0">Due date</label>
          <input class="input" id="cal-todo-due" type="date" value="${esc(defaultDate)}">
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <label class="field-label" style="margin:0;white-space:nowrap;flex-shrink:0">Remind me</label>
          <input class="input" id="cal-todo-remind" type="datetime-local" value="${esc(defaultRemind)}">
        </div>
        <div id="cal-notif-status" style="font-size:12px;color:var(--ink-faint)"></div>
      </div>`,
    footer: `<button class="btn btn-ghost" id="cal-todo-cancel">Cancel</button>
             <button class="btn btn-primary" id="cal-todo-save">${isEdit ? 'Save' : 'Add'}</button>`,
  });

  const statusEl = handle.root.querySelector<HTMLElement>('#cal-notif-status');
  if (statusEl && 'Notification' in window) {
    if (Notification.permission === 'denied') statusEl.textContent = 'Notifications are blocked in browser settings.';
    else if (Notification.permission === 'default') statusEl.textContent = 'Set a remind time to enable notifications.';
  }

  handle.root.querySelector('#cal-todo-cancel')?.addEventListener('click', () => handle.close());
  handle.root.querySelector('#cal-todo-save')?.addEventListener('click', async () => {
    const text = handle.root.querySelector<HTMLInputElement>('#cal-todo-text')?.value.trim() ?? '';
    const due  = handle.root.querySelector<HTMLInputElement>('#cal-todo-due')?.value || null;
    const remindStr = handle.root.querySelector<HTMLInputElement>('#cal-todo-remind')?.value || '';
    let remindAt: number | null = null;
    if (remindStr) {
      const ms = new Date(remindStr).getTime();
      if (!isNaN(ms)) remindAt = ms;
    }
    if (!text) { handle.root.querySelector<HTMLInputElement>('#cal-todo-text')?.focus(); return; }
    if (remindAt && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (isEdit) await todoStore.update(existing!.id, { text, dueDate: due, remindAt });
    else await todoStore.add({ text, dueDate: due, remindAt });
    handle.close();
    scheduleAllNotifications();
    render();
  });
  handle.root.querySelector<HTMLInputElement>('#cal-todo-text')?.focus();
}

/* ── Render + wire ───────────────────────────────────────────────────────── */
/** A store changed while a page was turning: draw it once the sheet has landed. */
let _stale = false;
onFlipIdle(() => { if (_stale) { _stale = false; render(); } });

function render(): void {
  const body = document.querySelector<HTMLElement>('#view-agenda .cal-body');
  if (!body) return;
  if (isFlipping()) { _stale = true; return; }
  _stale = false;
  const kinds = kindsByDate(sources());

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  body.innerHTML = `
    <div class="cal-root">
      <div class="cal-main">
        <section class="cal-book">
          <div class="cal-cap" aria-hidden="true"><span>On the Road</span><span>${_year}</span></div>
          <div class="cal-stage">${renderMonthPage(_year, _month, kinds)}</div>
          <div class="cal-rings" aria-hidden="true">${'<i></i>'.repeat(RING_COUNT)}</div>
        </section>
        ${renderTodosPanel()}
      </div>
      <div class="cal-slot">${renderDayPanel()}</div>
    </div>`;
  wire(body);
}

/** A detached copy of a month page / the day sheet, for a turn to bring in. */
function detached(html: string): HTMLElement {
  const box = document.createElement('div');
  // eslint-disable-next-line no-restricted-syntax -- audited: html comes from the escaping renderers above
  box.innerHTML = html.trim();
  return box.firstElementChild as HTMLElement;
}

/** Turn to the month `delta` away (the page lifts up for the next one, comes down for the one before). */
function turnMonth(delta: 1 | -1): void {
  finishFlip();
  const total = _year * 12 + _month + delta;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  const stage = document.querySelector<HTMLElement>('#view-agenda .cal-stage');
  const live = stage?.querySelector<HTMLElement>('.cal-page');
  const commit = () => { _year = y; _month = m; render(); };
  if (!stage || !live) { commit(); return; }
  turnPage(stage, live, detached(renderMonthPage(y, m, kindsByDate(sources()))), delta, commit);
}

/** Show another date. Same month: the day sheet is torn over; another month: the page turns to it. */
function goToDay(iso: string, scroll = false): void {
  finishFlip();
  if (iso === _selected && iso.slice(0, 7) === `${_year}-${pad(_month + 1)}`) return;
  const [y, m] = iso.split('-').map(Number);
  const prev = _selected;
  const commit = () => {
    select(iso);
    render();
    // Stacked (narrow) layout: bring the panel into view.
    if (scroll && window.matchMedia('(max-width: 860px)').matches) {
      document.getElementById('cal-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };
  if (m - 1 !== _month || y !== _year) {
    const stage = document.querySelector<HTMLElement>('#view-agenda .cal-stage');
    const live = stage?.querySelector<HTMLElement>('.cal-page');
    if (!stage || !live) { commit(); return; }
    const dir = y * 12 + m - 1 > _year * 12 + _month ? 1 : -1;
    _selected = iso;
    const target = detached(renderMonthPage(y, m - 1, kindsByDate(sources())));
    _selected = prev;
    turnPage(stage, live, target, dir, commit);
    return;
  }
  const slot = document.querySelector<HTMLElement>('#view-agenda .cal-slot');
  const live = slot?.querySelector<HTMLElement>('.cal-panel');
  if (!slot || !live) { commit(); return; }
  _selected = iso;
  const target = detached(renderDayPanel());
  _selected = prev;
  turnPage(slot, live, target, iso > prev ? 1 : -1, commit);
}

function wire(body: HTMLElement): void {
  body.querySelectorAll<HTMLElement>('[data-dir]').forEach((btn) => {
    btn.addEventListener('click', () => turnMonth(parseInt(btn.dataset.dir!, 10) < 0 ? -1 : 1));
  });
  body.querySelector('[data-go-today]')?.addEventListener('click', () => goToDay(todayIso()));

  body.querySelectorAll<HTMLElement>('[data-day]').forEach((cell) => {
    cell.addEventListener('click', () => goToDay(cell.dataset.day!, true));
  });

  // Pull the page: up for the next month, down for the one before.
  const stage = body.querySelector<HTMLElement>('.cal-stage');
  if (stage) {
    attachPageDrag(stage, {
      live: () => stage.querySelector<HTMLElement>('.cal-page'),
      target: (dir) => {
        const total = _year * 12 + _month + dir;
        const y = Math.floor(total / 12);
        return detached(renderMonthPage(y, total - y * 12, kindsByDate(sources())));
      },
      commit: (dir) => { const total = _year * 12 + _month + dir; _year = Math.floor(total / 12); _month = total - _year * 12; render(); },
    });
  }

  // Tap-through on agenda rows / journal cards. Inline controls handle themselves.
  body.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const intent = el.dataset.intent ? (JSON.parse(el.dataset.intent) as NavIntent) : undefined;
      navigateTo(el.dataset.nav as ViewId, intent);
    });
  });

  body.querySelectorAll<HTMLElement>('[data-expand]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.expand!;
      if (_expanded.has(id)) _expanded.delete(id); else _expanded.add(id);
      render();
    });
  });

  // Cards borrowed from other pages: the ticket's booked stub toggles, booking
  // links open in a popup, expense chips jump to the ledger.
  body.querySelector('#cal-panel')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>('a.rd-map-btn--soft');
    if (link?.href) { e.preventDefault(); openBookingWindow(link.href); return; }
    const toggle = target.closest<HTMLElement>('[data-act="toggle-transport-confirmed"]');
    if (toggle) {
      const cur = _legs.find((l) => l.id === toggle.closest<HTMLElement>('[data-leg]')?.dataset.leg);
      if (cur?.arrivalTransport) void routeStore.update(cur.id, { arrivalTransport: { ...cur.arrivalTransport, confirmed: !cur.arrivalTransport.confirmed } });
      return;
    }
    if (target.closest('.cal-itn .exp-tag-item')) navigateTo('expenses');
  });

  body.querySelectorAll<HTMLElement>('[data-toggle-plan]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const [legId, planId] = btn.dataset.togglePlan!.split(':');
      const leg = _legs.find((l) => l.id === legId);
      if (!leg) return;
      const plans = (leg.plans ?? []).map((p: PlanItem) => (p.id === planId ? { ...p, done: !p.done } : p));
      void routeStore.update(legId, { plans });
    });
  });

  body.querySelectorAll<HTMLElement>('[data-toggle-todo]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const [id, doneStr] = btn.dataset.toggleTodo!.split(':');
      void todoStore.toggle(id, doneStr === 'true');
    });
  });
  body.querySelectorAll<HTMLElement>('[data-edit-todo]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const todo = _todos.find((td) => td.id === btn.dataset.editTodo);
      if (todo) openTodoModal({ mode: 'edit', todo });
    });
  });
  body.querySelectorAll<HTMLElement>('[data-del-todo]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); void todoStore.remove(btn.dataset.delTodo!); });
  });
  body.querySelectorAll<HTMLElement>('[data-add-todo]').forEach((btn) => {
    btn.addEventListener('click', () => openTodoModal({ mode: 'add', dueDate: btn.dataset.addTodo! }));
  });

  // Journal composer overlay (lazy: journal/index pulls in Leaflet).
  body.querySelectorAll<HTMLElement>('[data-journal-new]').forEach((btn) => {
    btn.addEventListener('click', () => { import('../journal/index.ts').then((m) => m.openJournalComposerOverlay()); });
  });
}

/* ── Init ────────────────────────────────────────────────────────────────── */
let _intentWired = false;
function applyIntent(): boolean {
  const intent = consumeNavIntent('agenda');
  if (intent?.date && /^\d{4}-\d{2}-\d{2}$/.test(intent.date)) { select(intent.date); return true; }
  return false;
}

export function initAgenda(): void {
  const root = document.getElementById('view-agenda');
  if (!root) return;

  _legs     = routeStore.peek();
  _journal  = journalStore.peek();
  _todos    = todoStore.peek();
  _expenses = expenseStore.peek();

  // A tap-through from the dashboard ("+3 more ›") lands on that date.
  if (!applyIntent() && !document.querySelector('#view-agenda .cal-root')) select(todayIso());
  // Already mounted when the intent arrives (init won't re-run) → listen for it.
  if (!_intentWired) {
    _intentWired = true;
    window.addEventListener('otr:nav-intent', (e) => {
      if ((e as CustomEvent<{ view: string }>).detail?.view !== 'agenda') return;
      if (applyIntent()) render();
    });
  }

  render();
  scheduleAllNotifications();

  _unsubs.forEach((u) => u());
  _unsubs = [
    routeStore.subscribe((rows) => { _legs = rows; render(); }),
    journalStore.subscribe((rows) => { _journal = rows; render(); }),
    expenseStore.subscribe((rows) => { _expenses = rows; render(); }),
    todoStore.subscribe((rows) => {
      _todos = rows;
      clearAllNotificationTimers();
      scheduleAllNotifications();
      render();
    }),
  ];
}
