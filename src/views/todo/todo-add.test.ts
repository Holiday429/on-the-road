/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const add = vi.fn(async () => undefined);
vi.mock('../../data/stores/todo-store.ts', () => ({ todoStore: { add: (...a: unknown[]) => (add as (...x: unknown[]) => unknown)(...a) } }));
vi.mock('../../core/notifications.ts', () => ({ scheduleAllNotifications: vi.fn() }));

import { emptyDraft, renderTodoAddRow, wireTodoAddRow } from './todo-add.ts';

function mount(draft = emptyDraft(), shown = '2026-07-14') {
  const root = document.createElement('div');
  root.innerHTML = renderTodoAddRow(draft, shown);
  document.body.append(root);
  const hooks = { rerender: vi.fn(), refocus: vi.fn() };
  wireTodoAddRow(root, draft, hooks);
  return { root, draft, hooks, input: root.querySelector<HTMLTextAreaElement>('.td-todo-add-input')!, form: root.querySelector<HTMLFormElement>('[data-todo-new]')! };
}

describe('todo add row', () => {
  beforeEach(() => { add.mockClear(); document.body.innerHTML = ''; });

  it('files a new to-do under the day being shown, then clears and refocuses', async () => {
    const { input, form, hooks } = mount();
    input.value = '  Pack   the adapter ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledWith({ text: 'Pack the adapter', dueDate: '2026-07-14', remindAt: null });
    expect(input.value).toBe('');
    expect(hooks.rerender).toHaveBeenCalled();
    expect(hooks.refocus).toHaveBeenCalled();
  });

  it('ignores an empty line', async () => {
    const { input, form } = mount();
    input.value = '   ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await Promise.resolve();
    expect(add).not.toHaveBeenCalled();
  });

  it('carries a picked due date, and Esc drops the picks', () => {
    const draft = emptyDraft();
    draft.due = '2026-08-01';
    const { root, input, hooks } = mount(draft);
    expect(root.querySelector<HTMLInputElement>('[data-todo-due]')!.value).toBe('2026-08-01');
    expect(root.querySelector('[data-todo-new]')!.classList.contains('has-meta')).toBe(true);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(draft.due).toBeUndefined();
    expect(hooks.rerender).toHaveBeenCalled();
  });

  it('saves on Enter', () => {
    const { input, form } = mount();
    const submit = vi.fn();
    form.requestSubmit = submit;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(submit).toHaveBeenCalled();
  });
});
