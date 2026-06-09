/* ==========================================================================
   On the Road · Calendar view
   --------------------------------------------------------------------------
   Full-month calendar aggregating three event sources:
     · route legs       → amber band across the date range
     · journal entries  → sky-blue dot on happenedOn
     · todos            → coral dot on dueDate (with tick button inline)
   Navigation: prev / next month.  Click a day → day detail panel.

   Day panel shows:
     · Leg detail: transport (type/from/time/price) + accommodation
     · Journal entry previews (title + 2-line body)
     · Todos for the day + all undated todos (shown on today's panel only)
   ========================================================================== */

import './calendar.css';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { todoStore, type StoredTodo } from '../../data/stores/todo-store.ts';
import { navigateTo, type NavIntent } from '../../core/app.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { openModal } from '../../core/modal.ts';
import { scheduleAllNotifications, clearAllNotificationTimers } from '../../core/notifications.ts';

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

const TRANSPORT_ICON: Record<string, string> = {
  flight: '✈️', train: '🚂', bus: '🚌', ferry: '⛴️',
};

interface DayEvents {
  legs:    StoredLeg[];
  journal: StoredJournalEntry[];
  todos:   StoredTodo[];
}
function eventsForDay(iso: string): DayEvents {
  const undated = iso === todayIso()
    ? _todos.filter(t => !t.dueDate && !t.done)
    : [];
  return {
    legs:    _legs.filter(l => l.dateFrom <= iso && l.dateTo >= iso),
    journal: _journal.filter(e => e.happenedOn === iso),
    todos:   [
      ..._todos.filter(t => t.dueDate === iso),
      ...undated,
    ],
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
  for (let i = 0; i < offset; i++) cells += `<div class="cal-cell cal-empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = isoDate(_year, _month, d);
    const ev  = eventsForDay(iso);
    const isToday    = iso === today;
    const isSelected = iso === _selectedDay;
    const hasLeg     = ev.legs.length > 0;
    const legLabel   = hasLeg ? esc(ev.legs[0].city) : '';

    const dots = [
      ev.journal.length ? `<span class="cal-dot cal-dot-journal"></span>` : '',
      ev.todos.filter(t => !t.done && t.dueDate).length ? `<span class="cal-dot cal-dot-todo"></span>` : '',
      ev.todos.filter(t => t.done).length  ? `<span class="cal-dot cal-dot-todo-done"></span>` : '',
    ].join('');

    cells += `
      <div class="cal-cell ${hasLeg ? 'has-leg' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}" data-day="${iso}">
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
  const isToday = iso === todayIso();

  /* ── Leg rows (rich: transport + accommodation) ── */
  const legRows = ev.legs.map(leg => {
    const t = leg.arrivalTransport;
    const accs = leg.accommodations?.length
      ? leg.accommodations
      : leg.accommodation ? [leg.accommodation] : [];

    const firstAcc = accs[0];

    // Check-in / check-out logic for this specific date
    const isArrival   = leg.dateFrom === iso;
    const isDeparture = leg.dateTo   === iso;

    let transportChip = '';
    if (t && isArrival) {
      const icon = TRANSPORT_ICON[t.type] ?? '🚀';
      const via  = t.via?.length ? ` via ${t.via.join(', ')}` : '';
      const time = t.time ? ` · ${t.time}` : '';
      const price = t.price ? ` · ${t.price}` : '';
      transportChip = `
        <div class="cal-transport-chip">
          <span class="cal-transport-icon">${icon}</span>
          <span class="cal-transport-text">${esc(t.from)} → ${esc(t.to)}${esc(via)}${esc(time)}${esc(price)}</span>
          ${t.confirmed ? '<span class="cal-confirmed">✓</span>' : ''}
        </div>`;
    }

    let accChip = '';
    if (firstAcc) {
      const checkTag = isArrival ? 'Check-in'
        : isDeparture ? 'Check-out'
        : '';
      const priceStr = firstAcc.price ? ` · ${firstAcc.price}` : '';
      accChip = `
        <div class="cal-acc-chip">
          <span class="cal-acc-icon">🏠</span>
          <span class="cal-acc-name">${esc(firstAcc.name)}${esc(priceStr)}</span>
          ${checkTag ? `<span class="cal-acc-tag">${checkTag}</span>` : ''}
        </div>`;
    }

    return `
      <div class="cal-panel-row cal-row-leg" data-nav="route" data-intent='${esc(JSON.stringify({ legId: leg.id } satisfies NavIntent))}'>
        <span class="cal-row-icon">${esc(leg.flag)}</span>
        <div class="cal-row-body">
          <div class="cal-row-title">${esc(leg.city)}</div>
          <div class="cal-row-sub">${esc(leg.dateFrom)} – ${esc(leg.dateTo)}</div>
          ${transportChip}
          ${accChip}
        </div>
        <span class="cal-row-arrow">›</span>
      </div>`;
  }).join('');

  /* ── Journal rows ── */
  const jRows = ev.journal.map(e => {
    const preview = e.body.slice(0, 80).replace(/\n/g, ' ');
    return `
      <div class="cal-panel-row cal-row-journal" data-nav="journal">
        <span class="cal-row-icon">📔</span>
        <div class="cal-row-body">
          <div class="cal-row-title">${esc(e.title || e.body.slice(0, 50))}</div>
          ${preview ? `<div class="cal-row-sub cal-journal-preview">${esc(preview)}…</div>` : ''}
        </div>
        <span class="cal-row-arrow">›</span>
      </div>`;
  }).join('');

  /* ── Todo rows ── */
  const undatedHeader = isToday && ev.todos.some(t => !t.dueDate && !t.done)
    ? `<div class="cal-section-label">Undated tasks</div>` : '';

  const todoRows = ev.todos.map(t => {
    const overdue = t.dueDate && t.dueDate < todayIso() && !t.done;
    const remindLabel = t.remindAt
      ? new Date(t.remindAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
      : '';
    return `
      <div class="cal-panel-row cal-row-todo ${t.done ? 'is-done' : ''} ${!t.dueDate ? 'is-undated' : ''}" data-todo-id="${esc(t.id)}">
        <button class="cal-todo-check" data-toggle-todo="${esc(t.id)}:${t.done}" title="Mark done">${t.done ? '✓' : ''}</button>
        <div class="cal-row-body">
          <div class="cal-row-title ${overdue ? 'is-overdue' : ''}">${esc(t.text)}</div>
          <div class="cal-todo-meta">
            ${overdue ? `<span class="cal-overdue-tag">Overdue</span>` : ''}
            ${remindLabel ? `<span class="cal-remind-tag">🔔 ${remindLabel}</span>` : ''}
          </div>
        </div>
        <button class="cal-todo-edit" data-edit-todo="${esc(t.id)}" title="Edit">✏️</button>
        <button class="cal-todo-del" data-del-todo="${esc(t.id)}" title="Delete">✕</button>
      </div>`;
  }).join('');

  const empty = !legRows && !jRows && !ev.todos.length
    ? `<div class="cal-panel-empty">Nothing scheduled — looks like a free day.</div>` : '';

  return `
    <div class="cal-day-panel">
      <div class="cal-panel-date">${esc(label)}</div>
      ${legRows}
      ${jRows}
      ${undatedHeader}
      ${todoRows}
      ${empty}
      <button class="cal-add-todo btn btn-ghost" data-add-todo="${iso}">+ Add to-do</button>
    </div>`;
}

/* ── Add / Edit todo modal ───────────────────────────────────────────────── */
function openTodoModal(opts: {
  mode: 'add';
  dueDate: string;
} | {
  mode: 'edit';
  todo: StoredTodo;
}): void {
  const isEdit = opts.mode === 'edit';
  const existing = isEdit ? opts.todo : null;
  const defaultDate = isEdit ? (existing!.dueDate ?? '') : opts.dueDate;
  const defaultText = existing?.text ?? '';
  const defaultRemind = existing?.remindAt
    ? new Date(existing.remindAt).toISOString().slice(0, 16)
    : '';

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

  // Show notification permission status
  const statusEl = handle.root.querySelector<HTMLElement>('#cal-notif-status');
  if (statusEl && 'Notification' in window) {
    if (Notification.permission === 'denied') {
      statusEl.textContent = 'Notifications are blocked in browser settings.';
    } else if (Notification.permission === 'default') {
      statusEl.textContent = 'Set a remind time to enable notifications.';
    }
  }

  handle.root.querySelector('#cal-todo-cancel')?.addEventListener('click', () => handle.close());
  handle.root.querySelector('#cal-todo-save')?.addEventListener('click', async () => {
    const text = (handle.root.querySelector<HTMLInputElement>('#cal-todo-text'))?.value.trim() ?? '';
    const due  = (handle.root.querySelector<HTMLInputElement>('#cal-todo-due'))?.value || null;
    const remindStr = (handle.root.querySelector<HTMLInputElement>('#cal-todo-remind'))?.value || '';
    let remindAt: number | null = null;
    if (remindStr) {
      const ms = new Date(remindStr).getTime();
      if (!isNaN(ms)) remindAt = ms;
    }
    if (!text) { handle.root.querySelector<HTMLInputElement>('#cal-todo-text')?.focus(); return; }

    // Request notification permission if a reminder was set
    if (remindAt && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    if (isEdit) {
      await todoStore.update(existing!.id, { text, dueDate: due, remindAt });
    } else {
      await todoStore.add({ text, dueDate: due, remindAt });
    }
    handle.close();
    scheduleAllNotifications();
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

  // Todo edit
  body.querySelectorAll<HTMLElement>('[data-edit-todo]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.editTodo!;
      const todo = _todos.find(t => t.id === id);
      if (todo) openTodoModal({ mode: 'edit', todo });
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
    btn.addEventListener('click', () => openTodoModal({ mode: 'add', dueDate: btn.dataset.addTodo! }));
  });
}

/* ── Init ────────────────────────────────────────────────────────────────── */
export function initCalendar(): void {
  const root = document.getElementById('view-calendar');
  if (!root) return;

  _legs    = routeStore.peek();
  _journal = journalStore.peek();
  _todos   = todoStore.peek();
  if (!_selectedDay) _selectedDay = todayIso();
  render();
  scheduleAllNotifications();

  _unsubs.forEach(u => u());
  _unsubs = [
    routeStore.subscribe(rows => { _legs    = rows; render(); }),
    journalStore.subscribe(rows => { _journal = rows; render(); }),
    todoStore.subscribe(rows => {
      _todos = rows;
      clearAllNotificationTimers();
      scheduleAllNotifications();
      render();
    }),
  ];
}
