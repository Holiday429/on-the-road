/* ==========================================================================
   On the Road · Dashboard — To-do widget
   --------------------------------------------------------------------------
   The open items — those due on the shown day first — then, right after the last
   one, a row with a + in front where you just type the next to-do (Enter saves).
   While you type, a 📅 for the due date and a 🔔 for a reminder appear on the row
   (native pickers behind an icon). The corner ring counts the shown day's own
   to-dos: done / due that day. Drawn as a pad of sticky notes — the same paper as
   the Prepare checklist board (--note-0..5), one note per to-do, a blank one to write on.
   ========================================================================== */

import { escHtml as esc } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';
import type { StoredTodo } from '../../data/stores/todo-store.ts';
import { openTodosFor } from '../../data/todo-order.ts';
import { todoStore } from '../../data/stores/todo-store.ts';
import { noteVar } from '../../data/palette.ts';
import { scheduleAllNotifications } from '../../core/notifications.ts';

import { WIDGET_ICON } from '../../core/icons.ts';
const SHOWN = 4;

/* The add row's picks live here (the dashboard re-renders wholesale): the chosen due
   date (undefined = the day being shown) and the reminder. The typed text itself is
   carried across re-renders by dashboard-render's captureUiState. */
let _due: string | undefined;
let _remind = '';

/** New trip / re-init. */
export function resetTodoAdd(): void { _due = undefined; _remind = ''; }
const R = 9;
const C = 2 * Math.PI * R;

function shortDate(iso: string): string {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

function dueLabel(due: string | null | undefined, today: string): { text: string; overdue: boolean } {
  if (!due) return { text: '', overdue: false };
  if (due === today) return { text: t('dash.todo.today'), overdue: false };
  if (due < today) return { text: shortDate(due), overdue: true };   // red pen says "overdue"; the date is all a small note has room for
  return { text: shortDate(due), overdue: false };
}

export function renderTodoWidget(todos: StoredTodo[], selected: string, today: string): string {
  const open = openTodosFor(todos, selected, today);
  // The ring is about the shown day: to-dos due on it, done / total.
  const dayTodos = todos.filter((td) => td.dueDate === selected);
  const dayTotal = dayTodos.length;
  const dayDone = dayTodos.filter((td) => td.done).length;
  const frac = dayTotal ? dayDone / dayTotal : 0;
  // 3 rows + the add row keeps the card short.
  const shown = open.slice(0, SHOWN - 1);
  const more = open.length - shown.length;

  // Each to-do is a sticky note: its paper colour follows its place on the pad (neighbours differ,
  // see noteVar), and the due date is scribbled in the corner rather than set on a second line.
  const rows = shown.map((td, i) => {
    const due = dueLabel(td.dueDate, today);
    const onSel = !!td.dueDate && td.dueDate === selected && selected !== today;
    return `
      <div class="td-todo-row td-note${onSel ? ' is-sel' : ''}" style="--note-bg:${noteVar(i)}">
        <button type="button" class="td-todo-check" data-toggle-todo="${esc(td.id)}:false" title="${esc(t('dash.todo.markDone'))}" aria-label="${esc(t('dash.todo.markDone'))}"></button>
        <span class="td-todo-label">${esc(td.text)}</span>
        ${due.text ? `<span class="td-todo-due ${due.overdue ? 'is-overdue' : ''}"${due.overdue ? ` title="${esc(t('dash.todo.overdue'))}"` : ''}>${esc(due.text)}</span>` : ''}
      </div>`;
  }).join('');

  const due = _due ?? selected;
  const remindShort = _remind ? new Date(_remind).toLocaleString(getLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  // The add row: always there, straight after the last item. A + where the tick would be.
  const newRow = `
    <form class="td-todo-row td-todo-newrow${_due !== undefined || _remind ? ' has-meta' : ''}" data-todo-new>
      <span class="td-todo-plus" aria-hidden="true">+</span>
      <textarea class="td-todo-add-input" rows="1" placeholder="${esc(t('dash.todo.addRow'))}" aria-label="${esc(t('dash.todo.addRow'))}" autocomplete="off"></textarea>
      <span class="td-todo-new-tools">
        <button type="button" class="td-ic${_due !== undefined ? ' is-set' : ''}" data-todo-pick="due" title="${esc(`${t('dash.todoModal.due')} · ${shortDate(due)}`)}" aria-label="${esc(`${t('dash.todoModal.due')} · ${shortDate(due)}`)}"><span aria-hidden="true">📅</span></button>
        <button type="button" class="td-ic${_remind ? ' is-set' : ''}" data-todo-pick="remind" title="${esc(t('dash.todoModal.remind'))}"><span aria-hidden="true">🔔</span>${remindShort ? `<span class="td-ic-v">${esc(remindShort)}</span>` : ''}</button>
        <input class="td-ic-input" type="date" data-todo-due value="${esc(due)}" tabindex="-1" aria-hidden="true">
        <input class="td-ic-input" type="datetime-local" data-todo-remind value="${esc(_remind)}" tabindex="-1" aria-hidden="true">
        <button type="submit" class="td-todo-go" title="${esc(t('common.add'))}" aria-label="${esc(t('common.add'))}">↵</button>
      </span>
    </form>`;

  // Nothing open: say so, centred, under the add row.
  const empty = !shown.length
    ? `<div class="td-todo-empty"><div class="td-todo-empty-title">${esc(t('dash.todo.empty'))}</div></div>` : '';

  return `
    <div class="td-widget td-w-todo">
      <div class="td-widget-header">
        <div class="td-widget-label">${WIDGET_ICON.todo} ${esc(t('dash.widget.todo'))}</div>
        ${dayTotal ? `
          <div class="td-ring" title="${esc(t('dash.todo.progress', { done: dayDone, total: dayTotal }))}" role="img" aria-label="${esc(t('dash.todo.progress', { done: dayDone, total: dayTotal }))}">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <circle class="td-ring-track" cx="12" cy="12" r="${R}" />
              <circle class="td-ring-arc" cx="12" cy="12" r="${R}" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 12 12)" />
            </svg>
            <span class="td-ring-n">${dayDone}/${dayTotal}</span>
          </div>` : ''}
      </div>
      <div class="td-todo-list">${rows}${newRow}${empty}</div>
      ${more > 0 ? `<button type="button" class="td-link td-todo-more" data-nav="agenda">${esc(t('dash.todo.more', { n: more }))}</button>` : ''}
    </div>`;
}

/** Wire the add row and its two pickers. `render` re-renders the dashboard. */
export function wireTodo(body: HTMLElement, render: () => void): void {
  const form = body.querySelector<HTMLFormElement>('[data-todo-new]');
  if (!form) return;
  const input = form.querySelector<HTMLTextAreaElement>('.td-todo-add-input')!;

  // The box grows with what you type — up to two lines, then it scrolls.
  const fit = () => {
    input.style.height = 'auto';
    const line = parseFloat(getComputedStyle(input).lineHeight) || 18;
    input.style.height = `${Math.min(input.scrollHeight, line * 2 + 2)}px`;
  };
  fit();
  input.addEventListener('input', fit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; _due = undefined; _remind = ''; input.blur(); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }       // one to-do per line: Enter saves
  });

  // Icon buttons open the native pickers that sit invisibly beside them.
  form.querySelectorAll<HTMLElement>('[data-todo-pick]').forEach((b) => b.addEventListener('click', () => {
    const el = form.querySelector<HTMLInputElement>(b.dataset.todoPick === 'due' ? '[data-todo-due]' : '[data-todo-remind]')!;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  }));
  form.querySelector<HTMLInputElement>('[data-todo-due]')!.addEventListener('change', (e) => {
    _due = (e.target as HTMLInputElement).value || undefined;
    render();
  });
  form.querySelector<HTMLInputElement>('[data-todo-remind]')!.addEventListener('change', (e) => {
    _remind = (e.target as HTMLInputElement).value;
    render();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) { input.focus(); return; }
    const dueDate = form.querySelector<HTMLInputElement>('[data-todo-due]')!.value || null;
    const ms = _remind ? new Date(_remind).getTime() : NaN;
    const remindAt = Number.isNaN(ms) ? null : ms;
    if (remindAt && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    await todoStore.add({ text, dueDate, remindAt });
    scheduleAllNotifications();
    input.value = '';
    _due = undefined; _remind = '';
    render();
    document.querySelector<HTMLTextAreaElement>('.td-todo-add-input')?.focus();   // ready for the next one
  });
}
