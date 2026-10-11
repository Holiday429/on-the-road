/* ==========================================================================
   On the Road · To-do ordering for the Dashboard
   --------------------------------------------------------------------------
   Open items only. Due on the selected day first, then overdue (oldest
   first), then later dated items by date, then undated by their own order.
   ========================================================================== */

export interface OrderableTodo { done: boolean; dueDate?: string | null; order: number }

function rank(t: OrderableTodo, selected: string, today: string): number {
  if (t.dueDate && t.dueDate === selected) return 0;
  if (t.dueDate && t.dueDate < today) return 1;
  if (t.dueDate) return 2;
  return 3;
}

export function openTodosFor<T extends OrderableTodo>(todos: T[], selected: string, today: string): T[] {
  return todos
    .filter((t) => !t.done)
    .sort((a, b) =>
      rank(a, selected, today) - rank(b, selected, today)
      || (a.dueDate && b.dueDate ? a.dueDate.localeCompare(b.dueDate) : 0)
      || a.order - b.order);
}
