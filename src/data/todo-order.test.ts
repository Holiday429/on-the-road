import { describe, expect, it } from 'vitest';
import { openTodosFor } from './todo-order.ts';

const td = (id: string, dueDate: string | null, order = 0, done = false) => ({ id, dueDate, order, done });

describe('openTodosFor', () => {
  const todos = [
    td('undated', null, 1), td('later', '2026-08-20'), td('over', '2026-08-01'),
    td('sel', '2026-08-10'), td('today', '2026-08-07'), td('finished', '2026-08-10', 0, true),
    td('over2', '2026-07-20'), td('undated0', null, 0),
  ];
  it('puts the selected day first, then overdue oldest-first, then upcoming, then undated', () => {
    expect(openTodosFor(todos, '2026-08-10', '2026-08-07').map((t) => t.id))
      .toEqual(['sel', 'over2', 'over', 'today', 'later', 'undated0', 'undated']);
  });
  it('treats today as the selection when nothing else is picked', () => {
    expect(openTodosFor(todos, '2026-08-07', '2026-08-07')[0].id).toBe('today');
  });
  it('drops done items and does not mutate the input', () => {
    const copy = [...todos];
    expect(openTodosFor(todos, '2026-08-10', '2026-08-07').some((t) => t.id === 'finished')).toBe(false);
    expect(todos).toEqual(copy);
  });
});
