/* ==========================================================================
   On the Road · Dashboard — To-do widget
   --------------------------------------------------------------------------
   Small progress ring (done/total), the open items — those due on the
   selected day first — and a + in the corner that opens an add row inside the
   card itself: the text, a 📅 for the due date and a 🔔 for a reminder (both
   native pickers behind an icon), Enter or Add to save. No dialog.
   ========================================================================== */

import { escHtml as esc } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';
import type { StoredTodo } from '../../data/stores/todo-store.ts';
import { openTodosFor } from '../../data/todo-order.ts';
import { todoStore } from '../../data/stores/todo-store.ts';
import { scheduleAllNotifications } from '../../core/notifications.ts';

const SHOWN = 5;

/* The add row's state lives here (the dashboard re-renders wholesale): open or not,
   the chosen due date (undefined = the day being shown) and the reminder. */
let _adding = false;
let _due: string | undefined;
let _remind = '';
let _focusNew = false;

/** New trip / re-init. */
export function resetTodoAdd(): void { _adding = false; _due = undefined; _remind = ''; }
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
  const shown = open.slice(0, _adding ? SHOWN - 1 : SHOWN);
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

  // Nothing open: say so, centred, and ask the one question that gets a first item written.
  // Nothing open: say so, centred (the + in the corner is the way to add one).
  const empty = !shown.length && !_adding
    ? `<div class="td-todo-empty"><div class="td-todo-empty-title">${esc(t('dash.todo.empty'))}</div></div>` : '';

  const due = _due ?? selected;
  const remindShort = _remind ? new Date(_remind).toLocaleString(getLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const newRow = _adding ? `
    <form class="td-todo-new" data-todo-new>
      <input class="td-todo-add-input" type="text" placeholder="${esc(t('dash.todoModal.text'))}" aria-label="${esc(t('dash.todoModal.text'))}" required>
      <div class="td-todo-new-tools">
        <button type="button" class="td-ic${_due !== undefined ? ' is-set' : ''}" data-todo-pick="due" title="${esc(t('dash.todoModal.due'))}"><span aria-hidden="true">📅</span><span class="td-ic-v">${esc(shortDate(due))}</span></button>
        <button type="button" class="td-ic${_remind ? ' is-set' : ''}" data-todo-pick="remind" title="${esc(t('dash.todoModal.remind'))}"><span aria-hidden="true">🔔</span>${remindShort ? `<span class="td-ic-v">${esc(remindShort)}</span>` : ''}</button>
        <input class="td-ic-input" type="date" data-todo-due value="${esc(due)}" tabindex="-1" aria-hidden="true">
        <input class="td-ic-input" type="datetime-local" data-todo-remind value="${esc(_remind)}" tabindex="-1" aria-hidden="true">
        <button type="submit" class="btn btn-primary td-todo-new-go">${esc(t('common.add'))}</button>
      </div>
    </form>` : '';

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
        <button type="button" class="td-plus${_adding ? ' is-open' : ''}" data-todo-toggle title="${esc(t('dash.todo.add'))}" aria-label="${esc(t('dash.todo.add'))}" aria-expanded="${_adding}">+</button>
      </div>
      ${newRow}
      <div class="td-todo-list">${rows}${empty}</div>
      ${more > 0 ? `<button type="button" class="td-link td-todo-more" data-nav="calendar">${esc(t('dash.todo.more', { n: more }))}</button>` : ''}
    </div>`;
}

/** Wire the corner +, the add row and its two pickers. `render` re-renders the dashboard. */
export function wireTodo(body: HTMLElement, render: () => void): void {
  body.querySelector<HTMLElement>('[data-todo-toggle]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _adding = !_adding;
    if (_adding) _focusNew = true; else { _due = undefined; _remind = ''; }
    render();
  });
  const form = body.querySelector<HTMLFormElement>('[data-todo-new]');
  if (!form) return;
  const input = form.querySelector<HTMLInputElement>('.td-todo-add-input')!;
  if (_focusNew) { _focusNew = false; input.focus(); }

  const close = () => { _adding = false; _due = undefined; _remind = ''; render(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

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
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const dueDate = form.querySelector<HTMLInputElement>('[data-todo-due]')!.value || null;
    const ms = _remind ? new Date(_remind).getTime() : NaN;
    const remindAt = Number.isNaN(ms) ? null : ms;
    if (remindAt && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    await todoStore.add({ text, dueDate, remindAt });
    scheduleAllNotifications();
    input.value = '';
    close();
  });
}
