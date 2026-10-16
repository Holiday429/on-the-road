/* ==========================================================================
   On the Road · To-do — the add row
   --------------------------------------------------------------------------
   The last line of a to-do note: a + where the tick would be, then the text;
   while you type, a 📅 for the due date and a 🔔 for a reminder appear (native
   pickers behind an icon) and ↵ saves. Enter saves, Esc clears.

   One piece, used by the Dashboard's to-do card and the Agenda's note, so adding
   a to-do behaves the same on both. Each page keeps its own `TodoAddDraft` (the
   chosen due date and reminder survive that page's re-renders) and says where
   focus goes back to after a save.
   ========================================================================== */

import './todo-add.css';
import { escHtml as esc } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';
import { todoStore } from '../../data/stores/todo-store.ts';
import { scheduleAllNotifications } from '../../core/notifications.ts';

/** What the traveller has picked on the add row but not saved yet. `due` undefined = the day being shown. */
export interface TodoAddDraft { due: string | undefined; remind: string }

export const emptyDraft = (): TodoAddDraft => ({ due: undefined, remind: '' });

function shortDate(iso: string): string {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

/** The add row for a note showing `shown` (YYYY-MM-DD): a new to-do is due that day unless another is picked. */
export function renderTodoAddRow(draft: TodoAddDraft, shown: string): string {
  const due = draft.due ?? shown;
  const remindShort = draft.remind
    ? new Date(draft.remind).toLocaleString(getLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  return `
    <form class="td-todo-row td-todo-newrow${draft.due !== undefined || draft.remind ? ' has-meta' : ''}" data-todo-new>
      <span class="td-todo-plus" aria-hidden="true">+</span>
      <textarea class="td-todo-add-input" rows="1" placeholder="${esc(t('dash.todo.addRow'))}" aria-label="${esc(t('dash.todo.addRow'))}" autocomplete="off"></textarea>
      <span class="td-todo-new-tools">
        <button type="button" class="td-ic${draft.due !== undefined ? ' is-set' : ''}" data-todo-pick="due" title="${esc(`${t('dash.todoModal.due')} · ${shortDate(due)}`)}" aria-label="${esc(`${t('dash.todoModal.due')} · ${shortDate(due)}`)}"><span aria-hidden="true">📅</span></button>
        <button type="button" class="td-ic${draft.remind ? ' is-set' : ''}" data-todo-pick="remind" title="${esc(t('dash.todoModal.remind'))}"><span aria-hidden="true">🔔</span>${remindShort ? `<span class="td-ic-v">${esc(remindShort)}</span>` : ''}</button>
        <input class="td-ic-input" type="date" data-todo-due value="${esc(due)}" tabindex="-1" aria-hidden="true">
        <input class="td-ic-input" type="datetime-local" data-todo-remind value="${esc(draft.remind)}" tabindex="-1" aria-hidden="true">
        <button type="submit" class="td-todo-go" title="${esc(t('common.add'))}" aria-label="${esc(t('common.add'))}">↵</button>
      </span>
    </form>`;
}

export interface TodoAddHooks {
  /** Redraw the page (its draft has changed, or a to-do was saved). */
  rerender(): void;
  /** Put the caret back in this page's add row, after a redraw. */
  refocus(): void;
}

/** Wire the add row inside `root` (a no-op when it has none). */
export function wireTodoAddRow(root: HTMLElement, draft: TodoAddDraft, hooks: TodoAddHooks): void {
  const form = root.querySelector<HTMLFormElement>('[data-todo-new]');
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
    if (e.key === 'Escape') { input.value = ''; draft.due = undefined; draft.remind = ''; input.blur(); hooks.rerender(); }
    else if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }       // one to-do per line: Enter saves
  });

  // Icon buttons open the native pickers that sit invisibly beside them.
  form.querySelectorAll<HTMLElement>('[data-todo-pick]').forEach((b) => b.addEventListener('click', () => {
    const el = form.querySelector<HTMLInputElement>(b.dataset.todoPick === 'due' ? '[data-todo-due]' : '[data-todo-remind]')!;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  }));
  form.querySelector<HTMLInputElement>('[data-todo-due]')!.addEventListener('change', (e) => {
    draft.due = (e.target as HTMLInputElement).value || undefined;
    hooks.rerender();
  });
  form.querySelector<HTMLInputElement>('[data-todo-remind]')!.addEventListener('change', (e) => {
    draft.remind = (e.target as HTMLInputElement).value;
    hooks.rerender();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) { input.focus(); return; }
    const dueDate = form.querySelector<HTMLInputElement>('[data-todo-due]')!.value || null;
    const ms = draft.remind ? new Date(draft.remind).getTime() : NaN;
    const remindAt = Number.isNaN(ms) ? null : ms;
    if (remindAt && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    await todoStore.add({ text, dueDate, remindAt });
    scheduleAllNotifications();
    input.value = '';
    draft.due = undefined; draft.remind = '';
    hooks.rerender();
    hooks.refocus();   // ready for the next one
  });
}
