/* ==========================================================================
   On the Road · Calendar view
   --------------------------------------------------------------------------
   The whole trip, day by day. Left: a month grid with kind-coloured dots, a
   legend, month totals and the open to-do list. Right: a persistent day panel
   for the selected date — transport, stays, plan items, to-dos, spend and
   journal, in the order the day actually happens, each tappable through to its
   own view (expandable for details).

   Aggregation is data/day-agenda.ts, shared with the dashboard agenda widget
   and ported from iOS CalendarStore so both platforms read a day identically.
   Narrow screens stack the panel under the month instead of a modal.
   ========================================================================== */

import './calendar.css';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { todoStore, type StoredTodo } from '../../data/stores/todo-store.ts';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import { agendaForDay, kindsByDate, undatedTodos, AGENDA_COLORS, type AgendaItem, type AgendaKind, type AgendaSources } from '../../data/day-agenda.ts';
import { baseCurrency } from '../../data/trip-context.ts';
import { currencySymbol, peekRateTable } from '../../data/rates.ts';
import { navigateTo, consumeNavIntent, type NavIntent, type ViewId } from '../../core/app.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { openModal } from '../../core/modal.ts';
import { scheduleAllNotifications, clearAllNotificationTimers } from '../../core/notifications.ts';
import { entryCover, excerpt, moodEmoji, titleFor } from '../journal/shared/utils.ts';
import { dayHint } from '../dashboard/dashboard-agenda.ts';
import type { PlanItem } from '../../data/schema.ts';

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
function fmtMoney(n: number): string {
  return `${currencySymbol(baseCurrency())}${Math.round(n).toLocaleString()}`;
}

/** Show `iso` — jumping the visible month to it. */
function select(iso: string): void {
  _selected = iso;
  const [y, m] = iso.split('-').map(Number);
  _year = y; _month = m - 1;
}

const KIND_LABEL: Record<AgendaKind, string> = {
  transport: 'Travel', stay: 'Stay', plan: 'Plan', journal: 'Journal', spend: 'Spend', todo: 'To-do', context: '',
};
const LEGEND: AgendaKind[] = ['transport', 'stay', 'plan', 'journal', 'spend', 'todo'];

/* ── Month grid ──────────────────────────────────────────────────────────── */
function renderMonthGrid(kinds: Map<string, Set<AgendaKind>>): string {
  const today = todayIso();
  const firstDow = (new Date(_year, _month, 1).getDay() + 6) % 7;   // Monday-first
  const daysInMonth = new Date(_year, _month + 1, 0).getDate();
  const hdr = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-hdr">${d}</div>`).join('');

  let cells = '<div class="cal-cell cal-empty"></div>'.repeat(firstDow);
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = isoDate(_year, _month, d);
    const set = kinds.get(iso);
    const dots = set
      ? LEGEND.filter((k) => set.has(k)).map((k) => `<i style="background:${AGENDA_COLORS[k]}"></i>`).join('')
      : '';
    const leg = _legs.find((l) => l.dateFrom <= iso && iso <= l.dateTo);
    const cls = ['cal-cell', iso === today ? 'is-today' : '', iso === _selected ? 'is-sel' : '', leg ? 'in-leg' : ''].filter(Boolean).join(' ');
    const city = leg && (iso === leg.dateFrom || d === 1) ? `<span class="cal-city">${esc(leg.flag)} ${esc(leg.city)}</span>` : '';
    cells += `
      <button type="button" class="${cls}" data-day="${iso}">
        <span class="cal-daynum">${d}</span>
        ${city}
        <span class="cal-dots">${dots}</span>
      </button>`;
  }
  return `<div class="cal-grid">${hdr}${cells}</div>`;
}

function renderStats(): string {
  const prefix = `${_year}-${pad(_month + 1)}`;
  const tripDays = new Set<string>();
  for (const l of _legs) {
    for (let d = new Date(l.dateFrom + 'T00:00:00'); isoDate(d.getFullYear(), d.getMonth(), d.getDate()) <= l.dateTo; d.setDate(d.getDate() + 1)) {
      const iso = isoDate(d.getFullYear(), d.getMonth(), d.getDate());
      if (iso.startsWith(prefix)) tripDays.add(iso);
    }
  }
  const journals = _journal.filter((e) => e.happenedOn.startsWith(prefix)).length;
  const base = baseCurrency();
  const rates = peekRateTable(base);
  const spend = _expenses.filter((e) => e.date.startsWith(prefix)).reduce((s, e) => {
    if (e.baseCurrency === base) return s + e.baseAmount;
    const cross = rates[e.baseCurrency];
    return s + (cross ? e.baseAmount * cross : e.baseAmount);
  }, 0);
  const stat = (n: string, label: string) => `<div class="cal-stat"><strong>${esc(n)}</strong><span>${esc(label)}</span></div>`;
  return `<div class="cal-stats">${stat(String(tripDays.size), t('cal.stat.days'))}${stat(String(journals), t('cal.stat.journal'))}${stat(fmtMoney(spend), t('cal.stat.spend'))}</div>`;
}

/* ── Day panel ───────────────────────────────────────────────────────────── */
function renderItem(it: AgendaItem): string {
  const open = _expanded.has(it.id);
  const nav = it.navTo ? ` data-nav="${it.navTo}"${it.intent ? ` data-intent='${esc(JSON.stringify(it.intent))}'` : ''}` : '';
  const check = it.planRef
    ? `<button type="button" class="cal-check${it.done ? ' is-done' : ''}" data-toggle-plan="${esc(it.planRef.legId)}:${esc(it.planRef.planId)}" aria-label="Toggle done">${it.done ? '✓' : ''}</button>`
    : '';
  const chevron = it.details.length
    ? `<button type="button" class="cal-chev${open ? ' is-open' : ''}" data-expand="${esc(it.id)}" aria-expanded="${open}" aria-label="Details">▾</button>`
    : '';
  const details = open
    ? `<dl class="cal-details">${it.details.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join('')}</dl>`
    : '';
  return `
    <div class="cal-item${it.done ? ' is-done' : ''}" style="--ag-c:${AGENDA_COLORS[it.kind]}">
      <div class="cal-item-row"${nav}>
        <span class="cal-item-time">${esc(it.time ?? '')}</span>
        <span class="cal-item-icon">${it.icon}</span>
        <span class="cal-item-copy">
          <span class="cal-item-title">${esc(it.title)}</span>
          ${it.subtitle ? `<span class="cal-item-sub">${esc(it.subtitle)}</span>` : ''}
        </span>
        ${check}${chevron}
      </div>
      ${details}
    </div>`;
}

function todoRow(td: StoredTodo, today: string): string {
  const overdue = !!td.dueDate && td.dueDate < today && !td.done;
  const due = !td.dueDate ? '' : td.dueDate === today ? 'Today' : overdue ? `Overdue · ${td.dueDate}` : td.dueDate;
  const remind = td.remindAt ? new Date(td.remindAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : '';
  return `
    <div class="cal-todo-row ${td.done ? 'is-done' : ''}">
      <button class="cal-todo-check ${td.done ? 'is-checked' : ''}" data-toggle-todo="${esc(td.id)}:${td.done}" title="${td.done ? 'Mark undone' : 'Mark done'}">${td.done ? '✓' : ''}</button>
      <div class="cal-todo-body">
        <span class="cal-todo-label ${overdue ? 'is-overdue' : ''}">${esc(td.text)}</span>
        <span class="cal-todo-meta">
          ${due ? `<span class="cal-todo-due ${overdue ? 'is-overdue' : ''}">${esc(due)}</span>` : ''}
          ${remind ? `<span class="cal-remind-tag">🔔 ${remind}</span>` : ''}
        </span>
      </div>
      <button class="cal-todo-edit" data-edit-todo="${esc(td.id)}" title="Edit">✏️</button>
      <button class="cal-todo-del" data-del-todo="${esc(td.id)}" title="Delete">✕</button>
    </div>`;
}

function renderDayPanel(): string {
  const src = sources();
  const day = agendaForDay(_selected, src);
  const today = todayIso();
  const date = new Date(_selected + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const where = day.leg
    ? `${esc(day.leg.flag)} ${esc(day.leg.city)}${day.dayInLeg ? ` · ${esc(t('dash.agenda.dayOf', { n: day.dayInLeg.n, total: day.dayInLeg.total }))}` : ''}`
    : '';
  const hint = dayHint(day, src);

  // To-dos get their own section (editable, incl. done ones) rather than the
  // agenda's "open only" card; today also surfaces the undated ones.
  const dayTodos = _todos.filter((td) => td.dueDate === _selected);
  const floating = _selected === today ? undatedTodos(_todos) : [];
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

  const todoSection = (dayTodos.length || floating.length)
    ? `<div class="cal-sec">
         <div class="cal-sec-label">☑️ To-do</div>
         ${dayTodos.map((td) => todoRow(td, today)).join('')}
         ${floating.length ? `<div class="cal-sec-sub">No due date</div>${floating.map((td) => todoRow(td, today)).join('')}` : ''}
       </div>`
    : '';

  const empty = !rows.length && !journal && !todoSection
    ? `<div class="cal-empty-day">${esc(t('dash.agenda.empty'))}</div>` : '';

  return `
    <aside class="cal-panel" id="cal-panel">
      <div class="cal-panel-head">
        <div class="cal-panel-date">${esc(date)}</div>
        ${where ? `<div class="cal-panel-where">${where}</div>` : ''}
        ${hint ? `<div class="cal-panel-hint">${esc(hint)}</div>` : ''}
      </div>
      ${rows.length ? `<div class="cal-items">${rows.map(renderItem).join('')}</div>` : ''}
      ${journal ? `<div class="cal-sec"><div class="cal-sec-label">📔 Journal</div>${journal}</div>` : ''}
      ${todoSection}
      ${empty}
      <div class="cal-panel-actions">
        <button class="btn btn-ghost" data-add-todo="${_selected}">+ ${esc(t('cal.addTodo'))}</button>
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
  return `
    <div class="cal-todos-panel" id="cal-todos">
      <div class="cal-todos-header">
        <span class="cal-todos-title">☑️ ${esc(t('dash.widget.todo'))}</span>
        <button class="cal-todos-add btn btn-ghost" data-add-todo="${today}">+ ${esc(t('cal.addTodo'))}</button>
      </div>
      ${pending.length ? pending.map((td) => todoRow(td, today)).join('') : `<div class="cal-todos-empty">No open to-dos.</div>`}
      ${done.length ? `<div class="cal-todos-section-label">Recently done</div>${done.map((td) => todoRow(td, today)).join('')}` : ''}
    </div>`;
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
function render(): void {
  const body = document.querySelector<HTMLElement>('#view-calendar .cal-body');
  if (!body) return;
  const kinds = kindsByDate(sources());
  const monthName = new Date(_year, _month, 1).toLocaleString(undefined, { month: 'long' });

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  body.innerHTML = `
    <div class="cal-root">
      <div class="cal-main">
        <div class="cal-nav">
          <button class="cal-nav-btn" data-dir="-1" aria-label="Previous month">‹</button>
          <h2 class="cal-month-title">${esc(monthName)} ${_year}</h2>
          <button class="cal-nav-btn" data-dir="1" aria-label="Next month">›</button>
          <button class="cal-today-btn" data-go-today>${esc(t('dash.agenda.today'))}</button>
        </div>
        ${renderMonthGrid(kinds)}
        <div class="cal-legend">${LEGEND.map((k) => `<span><i style="background:${AGENDA_COLORS[k]}"></i>${KIND_LABEL[k]}</span>`).join('')}</div>
        ${renderStats()}
        ${renderTodosPanel()}
      </div>
      ${renderDayPanel()}
    </div>`;
  wire(body);
}

function wire(body: HTMLElement): void {
  body.querySelectorAll<HTMLElement>('[data-dir]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _month += parseInt(btn.dataset.dir!, 10);
      if (_month > 11) { _month = 0; _year++; }
      if (_month < 0)  { _month = 11; _year--; }
      render();
    });
  });
  body.querySelector('[data-go-today]')?.addEventListener('click', () => { select(todayIso()); render(); });

  body.querySelectorAll<HTMLElement>('[data-day]').forEach((cell) => {
    cell.addEventListener('click', () => {
      _selected = cell.dataset.day!;
      render();
      // Stacked (narrow) layout: bring the panel into view.
      if (window.matchMedia('(max-width: 860px)').matches) {
        document.getElementById('cal-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    });
  });

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
  const intent = consumeNavIntent('calendar');
  if (intent?.date && /^\d{4}-\d{2}-\d{2}$/.test(intent.date)) { select(intent.date); return true; }
  return false;
}

export function initCalendar(): void {
  const root = document.getElementById('view-calendar');
  if (!root) return;

  _legs     = routeStore.peek();
  _journal  = journalStore.peek();
  _todos    = todoStore.peek();
  _expenses = expenseStore.peek();

  // A tap-through from the dashboard ("+3 more ›") lands on that date.
  if (!applyIntent() && !document.querySelector('#view-calendar .cal-root')) select(todayIso());
  // Already mounted when the intent arrives (init won't re-run) → listen for it.
  if (!_intentWired) {
    _intentWired = true;
    window.addEventListener('otr:nav-intent', (e) => {
      if ((e as CustomEvent<{ view: string }>).detail?.view !== 'calendar') return;
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
