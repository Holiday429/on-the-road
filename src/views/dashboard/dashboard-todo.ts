/* ==========================================================================
   On the Road · Dashboard — To-do widget
   --------------------------------------------------------------------------
   The open items — those due on the shown day first — then, right after the last
   one, a row with a + in front where you just type the next to-do (Enter saves).
   While you type, a 📅 for the due date and a 🔔 for a reminder appear on the row
   (native pickers behind an icon). The corner ring counts the shown day's own
   to-dos: done / due that day. The whole card is a sticky note — the same paper, tape,
   checkbox and dashed rules as a note on the Prepare checklist board.
   ========================================================================== */

import { escHtml as esc } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';
import type { StoredTodo } from '../../data/stores/todo-store.ts';
import { openTodosFor } from '../../data/todo-order.ts';
import { renderFastener } from '../../core/paper/fastener.ts';
import '../../core/paper/fastener.css';
import { emptyDraft, renderTodoAddRow, wireTodoAddRow } from '../todo/todo-add.ts';
import { strikeRow } from '../todo/todo-strike.ts';
import { todoStore } from '../../data/stores/todo-store.ts';

import { WIDGET_ICON } from '../../core/icons.ts';
const SHOWN = 4;

/* The add row's picks live here (the dashboard re-renders wholesale): the chosen due
   date (undefined = the day being shown) and the reminder. The typed text itself is
   carried across re-renders by dashboard-render's captureUiState. */
const _draft = emptyDraft();

/** New trip / re-init. */
export function resetTodoAdd(): void { _draft.due = undefined; _draft.remind = ''; }

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
  // 3 rows + the add row keeps the card short.
  const shown = open.slice(0, SHOWN - 1);
  const more = open.length - shown.length;

  const rows = shown.map((td) => {
    const due = dueLabel(td.dueDate, today);
    const onSel = !!td.dueDate && td.dueDate === selected && selected !== today;
    return `
      <div class="td-todo-row${onSel ? ' is-sel' : ''}">
        <button type="button" class="td-todo-check" data-toggle-todo="${esc(td.id)}:false" title="${esc(t('dash.todo.markDone'))}" aria-label="${esc(t('dash.todo.markDone'))}"></button>
        <span class="td-todo-label">${esc(td.text)}</span>
        ${due.text ? `<span class="td-todo-due ${due.overdue ? 'is-overdue' : ''}"${due.overdue ? ` title="${esc(t('dash.todo.overdue'))}"` : ''}>${esc(due.text)}</span>` : ''}
      </div>`;
  }).join('');

  // The add row: always there, straight after the last item.
  const newRow = renderTodoAddRow(_draft, selected);

  // Nothing open: say so, centred, under the add row.
  const empty = !shown.length
    ? `<div class="td-todo-empty"><div class="td-todo-empty-title">${esc(t('dash.todo.empty'))}</div></div>` : '';

  // The whole card is one note, drawn like a note on the Prepare checklist board.
  return `
    <div class="td-widget td-w-todo">
      ${renderFastener('tape')}
      <div class="td-widget-header">
        <div class="td-widget-label">${WIDGET_ICON.todo} ${esc(t('dash.widget.todo'))}</div>
        ${dayTotal ? `<span class="td-todo-badge" title="${esc(t('dash.todo.progress', { done: dayDone, total: dayTotal }))}">${dayDone}/${dayTotal}</span>` : ''}
      </div>
      <div class="td-todo-list">${rows}${newRow}${empty}</div>
      ${more > 0 ? `<button type="button" class="td-link td-todo-more" data-nav="agenda">${esc(t('dash.todo.more', { n: more }))}</button>` : ''}
    </div>`;
}

/** Wire the add row and its two pickers. `render` re-renders the dashboard. */
export function wireTodo(body: HTMLElement, render: () => void): void {
  // Ticking an item: the line is drawn across the whole entry (the same motion as on the Agenda's note),
  // the entry slides off the note, and only then is the change written — this note lists open items only.
  body.querySelectorAll<HTMLElement>('.td-w-todo [data-toggle-todo]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const [id, doneStr] = btn.dataset.toggleTodo!.split(':');
      const commit = () => todoStore.toggle(id, doneStr === 'true');
      const row = btn.closest<HTMLElement>('.td-todo-row');
      const label = row?.querySelector<HTMLElement>('.td-todo-label');
      if (row && label && doneStr !== 'true') {
        strikeRow(row, { from: label, to: row.querySelector<HTMLElement>('.td-todo-due') ?? label, leave: true }, commit);
      } else void commit();
    });
  });
  wireTodoAddRow(body, _draft, {
    rerender: render,
    refocus: () => document.querySelector<HTMLTextAreaElement>('#view-today .td-todo-add-input')?.focus(),
  });
}
