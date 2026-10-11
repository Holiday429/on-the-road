/* ==========================================================================
   On the Road · Dashboard — To-do widget
   --------------------------------------------------------------------------
   Small progress ring (done/total), the open items — those due on the
   selected day first — and a + in the corner that opens the full add form
   pre-set to that day.
   ========================================================================== */

import { escHtml as esc } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';
import type { StoredTodo } from '../../data/stores/todo-store.ts';
import { openTodosFor } from '../../data/todo-order.ts';

const SHOWN = 5;
const R = 9;
const C = 2 * Math.PI * R;

function shortDate(iso: string): string {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

function dueLabel(due: string | null | undefined, today: string): { text: string; overdue: boolean } {
  if (!due) return { text: '', overdue: false };
  if (due === today) return { text: t('dash.todo.today'), overdue: false };
  if (due < today) return { text: `${t('dash.todo.overdue')} · ${shortDate(due)}`, overdue: true };
  return { text: shortDate(due), overdue: false };
}

export function renderTodoWidget(todos: StoredTodo[], selected: string, today: string): string {
  const open = openTodosFor(todos, selected, today);
  const total = todos.length;
  const done = total - open.length;
  const shown = open.slice(0, SHOWN);
  const more = open.length - shown.length;
  const frac = total ? done / total : 0;

  const rows = shown.map((td) => {
    const due = dueLabel(td.dueDate, today);
    const onSel = !!td.dueDate && td.dueDate === selected && selected !== today;
    return `
      <div class="td-todo-row${onSel ? ' is-sel' : ''}">
        <button type="button" class="td-todo-check" data-toggle-todo="${esc(td.id)}:false" title="${esc(t('dash.todo.markDone'))}" aria-label="${esc(t('dash.todo.markDone'))}"></button>
        <div class="td-todo-text">
          <span class="td-todo-label">${esc(td.text)}</span>
          ${due.text ? `<span class="td-todo-due ${due.overdue ? 'is-overdue' : ''}">${esc(due.text)}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  const empty = !shown.length
    ? `<div class="td-todo-empty">${esc(t('dash.todo.empty'))}${total ? ' 🎉' : ''}</div>` : '';

  return `
    <div class="td-widget td-w-todo">
      <div class="td-widget-header">
        <div class="td-widget-label">☑️ ${esc(t('dash.widget.todo'))}</div>
        ${total ? `
          <div class="td-ring" title="${esc(t('dash.todo.progress', { done, total }))}" role="img" aria-label="${esc(t('dash.todo.progress', { done, total }))}">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <circle class="td-ring-track" cx="12" cy="12" r="${R}" />
              <circle class="td-ring-arc" cx="12" cy="12" r="${R}" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 12 12)" />
            </svg>
            <span class="td-ring-n">${done}/${total}</span>
          </div>` : ''}
        <button type="button" class="td-plus" data-todo-add-modal title="${esc(t('dash.todo.add'))}" aria-label="${esc(t('dash.todo.add'))}">+</button>
      </div>
      <div class="td-todo-list">${rows}${empty}</div>
      ${more > 0 ? `<button type="button" class="td-link td-todo-more" data-nav="calendar">${esc(t('dash.todo.more', { n: more }))}</button>` : ''}
    </div>`;
}
