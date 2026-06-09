/* ==========================================================================
   On the Road · Calendar view
   --------------------------------------------------------------------------
   Full-month calendar aggregating three event sources:
     · route legs       → amber band across the date range
     · journal entries  → sky-blue dot on happenedOn
     · todos            → coral dot on dueDate (with tick button inline)
   Navigation: prev / next month.  Click a day → day detail panel.
   ========================================================================== */

import './calendar.css';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { todoStore, type StoredTodo } from '../../data/stores/todo-store.ts';
import { navigateTo, type NavIntent } from '../../core/app.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { openModal } from '../../core/modal.ts';

/* ── State ───────────────────────────────────────────────────────────────── */
let _legs:    StoredLeg[]          = [];
let _journal: StoredJournalEntry[] = [];
let _todos:   StoredTodo[]         = [];
let _year  = new Date().getFullYear();
let _month = new Date().getMonth();   // 0-based
let _selectedDay: string | null = null;
let _unsubs: Array<() => void> = [];

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function todayIso(): string { return new Date().toISOString().slice(0, 10); }

interface DayEvents {
  legs:    StoredLeg[];
  journal: StoredJournalEntry[];
  todos:   StoredTodo[];
}
function eventsForDay(iso: string): DayEvents {
  return {
    legs:    _legs.filter(l => l.dateFrom <= iso && l.dateTo >= iso),
    journal: _journal.filter(e => e.happenedOn === iso),
    todos:   _todos.filter(t => t.dueDate === iso),
  };
}

/* ── Month grid ──────────────────────────────────────────────────────────── */
function renderMonthGrid(): string {
  const today      = todayIso();
  const daysInMonth = new Date(_year, _month + 1, 0).getDate();
  const firstDow   = new Date(_year, _month, 1).getDay(); // 0=Sun
  const offset     = (firstDow + 6) % 7; // Mon-first

  const DAY_HDRS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const headers  = DAY_HDRS.map(d => `<div class="cal-hdr">${d}</div>`).join('');

  let cells = '';
  // Empty leading cells
  for (let i = 0; i < offset; i++) cells += `<div class="cal-cell cal-empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = isoDate(_year, _month, d);
    const ev  = eventsForDay(iso);
    const isToday    = iso === today;
    const isSelected = iso === _selectedDay;
    const hasLeg     = ev.legs.length > 0;
    const legLabel   = hasLeg ? esc(ev.legs[0].city) : '';
    const legClass   = hasLeg ? 'has-leg' : '';

    const dots = [
      ev.journal.length ? `<span class="cal-dot cal-dot-journal"></span>` : '',
      ev.todos.filter(t => !t.done).length ? `<span class="cal-dot cal-dot-todo"></span>` : '',
      ev.todos.filter(t => t.done).length  ? `<span class="cal-dot cal-dot-todo-done"></span>` : '',
    ].join('');

    cells += `
      <div class="cal-cell ${legClass} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}" data-day="${iso}">
        <span class="cal-daynum">${d}</span>
        ${hasLeg ? `<span class="cal-leg-label">${legLabel}</span>` : ''}
        ${dots ? `<span class="cal-dots">${dots}</span>` : ''}
      </div>`;
  }

  return `<div class="cal-grid">${headers}${cells}</div>`;
}

/* ── Day detail panel ────────────────────────────────────────────────────── */
function renderDayPanel(iso: string): string {
  const ev  = eventsForDay(iso);
  const d   = new Date(iso + 'T00:00:00');
  const label = d.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });

  const legRows = ev.legs.map(leg => `
    <div class="cal-panel-row cal-row-leg" data-nav="route" data-intent='${esc(JSON.stringify({ legId: leg.id } satisfies NavIntent))}'>
      <span class="cal-row-icon">${esc(leg.flag)}</span>
      <div><div class="cal-row-title">${esc(leg.city)}</div>
           <div class="cal-row-sub">${esc(leg.dateFrom)} – ${esc(leg.dateTo)}</div></div>
      <span class="cal-row-arrow">›</span>
    </div>`).join('');

  const jRows = ev.journal.map(e => `
    <div class="cal-panel-row cal-row-journal" data-nav="journal">
      <span class="cal-row-icon">📔</span>
      <div><div class="cal-row-title">${esc(e.title || e.body.slice(0, 50))}</div></div>
      <span class="cal-row-arrow">›</span>
    </div>`).join('');

  const todoRows = ev.todos.map(t => `
    <div class="cal-panel-row cal-row-todo ${t.done ? 'is-done' : ''}">
      <button class="cal-todo-check" data-toggle-todo="${esc(t.id)}:${t.done}">${t.done ? '✓' : ''}</button>
      <div class="cal-row-title">${esc(t.text)}</div>
      <button class="cal-todo-del" data-del-todo="${esc(t.id)}" title="Delete">✕</button>
    </div>`).join('');

  const empty = !legRows && !jRows && !todoRows
    ? `<div class="cal-panel-empty">Nothing scheduled — looks like a free day.</div>` : '';

  return `
    <div class="cal-day-panel">
      <div class="cal-panel-date">${esc(label)}</div>
      ${legRows}
      ${jRows}
      ${todoRows}
      ${empty}
      <button class="cal-add-todo btn btn-ghost" data-add-todo="${iso}">+ Add to-do</button>
    </div>`;
}

/* ── Add todo modal ──────────────────────────────────────────────────────── */
function openAddTodo(dueDate: string): void {
  const handle = openModal({
    title: '+ New to-do',
    body: `
      <div style="display:flex;flex-direction:column;gap:12px">
        <input class="input" id="cal-todo-text" placeholder="What do you need to do?" autofocus>
        <div style="display:flex;gap:8px;align-items:center">
          <label class="field-label" style="margin:0;white-space:nowrap">Due date</label>
          <input class="input" id="cal-todo-due" type="date" value="${dueDate}">
        </div>
      </div>`,
    footer: `<button class="btn btn-ghost" id="cal-add-cancel">Cancel</button>
             <button class="btn btn-primary" id="cal-add-save">Add</button>`,
  });
  handle.root.querySelector('#cal-add-cancel')?.addEventListener('click', () => handle.close());
  handle.root.querySelector('#cal-add-save')?.addEventListener('click', async () => {
    const text = (handle.root.querySelector<HTMLInputElement>('#cal-todo-text'))?.value.trim() ?? '';
    const due  = (handle.root.querySelector<HTMLInputElement>('#cal-todo-due'))?.value ?? null;
    if (!text) { handle.root.querySelector<HTMLInputElement>('#cal-todo-text')?.focus(); return; }
    await todoStore.add({ text, dueDate: due || null });
    handle.close();
    render();
  });
  handle.root.querySelector<HTMLInputElement>('#cal-todo-text')?.focus();
}

/* ── Render ──────────────────────────────────────────────────────────────── */
function render(): void {
  const body = document.querySelector<HTMLElement>('#view-calendar .cal-body');
  if (!body) return;

  const monthName = new Date(_year, _month, 1).toLocaleString('en', { month: 'long' });

  body.innerHTML = `
    <div class="cal-root">
      <div class="cal-main">
        <div class="cal-nav">
          <button class="cal-nav-btn" data-dir="-1">‹</button>
          <h2 class="cal-month-title">${monthName} ${_year}</h2>
          <button class="cal-nav-btn" data-dir="1">›</button>
          <button class="cal-today-btn" data-go-today>Today</button>
        </div>
        ${renderMonthGrid()}
      </div>
      ${_selectedDay ? renderDayPanel(_selectedDay) : '<div class="cal-panel-hint">Select a day to see details</div>'}
    </div>`;

  wire(body);
}

function wire(body: HTMLElement): void {
  // Month navigation
  body.querySelectorAll<HTMLElement>('[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      _month += parseInt(btn.dataset.dir!);
      if (_month > 11) { _month = 0; _year++; }
      if (_month < 0)  { _month = 11; _year--; }
      render();
    });
  });
  body.querySelector('[data-go-today]')?.addEventListener('click', () => {
    const now = new Date();
    _year = now.getFullYear(); _month = now.getMonth();
    _selectedDay = todayIso();
    render();
  });

  // Day cell click → select day
  body.querySelectorAll<HTMLElement>('.cal-cell:not(.cal-empty)').forEach(cell => {
    cell.addEventListener('click', () => {
      _selectedDay = cell.dataset.day ?? null;
      render();
    });
  });

  // Nav from day panel (leg → route, journal → journal)
  body.querySelectorAll<HTMLElement>('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const intent = el.dataset.intent ? JSON.parse(el.dataset.intent) as NavIntent : undefined;
      navigateTo(el.dataset.nav as Parameters<typeof navigateTo>[0], intent);
    });
  });

  // Todo toggle
  body.querySelectorAll<HTMLElement>('[data-toggle-todo]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const [id, doneStr] = btn.dataset.toggleTodo!.split(':');
      void todoStore.toggle(id, doneStr === 'true');
    });
  });

  // Todo delete
  body.querySelectorAll<HTMLElement>('[data-del-todo]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      void todoStore.remove(btn.dataset.delTodo!);
    });
  });

  // Add todo button
  body.querySelectorAll<HTMLElement>('[data-add-todo]').forEach(btn => {
    btn.addEventListener('click', () => openAddTodo(btn.dataset.addTodo!));
  });
}

/* ── Init ────────────────────────────────────────────────────────────────── */
export function initCalendar(): void {
  const root = document.getElementById('view-calendar');
  if (!root) return;

  _legs    = routeStore.peek();
  _journal = journalStore.peek();
  _todos   = todoStore.peek();
  // Default selected day = today
  if (!_selectedDay) _selectedDay = todayIso();
  render();

  _unsubs.forEach(u => u());
  _unsubs = [
    routeStore.subscribe(rows => { _legs    = rows; render(); }),
    journalStore.subscribe(rows => { _journal = rows; render(); }),
    todoStore.subscribe(rows => { _todos   = rows; render(); }),
  ];
}
