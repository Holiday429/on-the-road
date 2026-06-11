/* ==========================================================================
   On the Road · To-Do store
   Trip-scoped (lives at trips/{tripId}/todos) so trip members share the same
   to-do list. Each doc also carries a tripId tag for convenience. Per-trip
   consumers (dashboard, calendar, notifications) use subscribe(), which reads
   the current trip's list.
   ========================================================================== */

import { createTaggedCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { TodoSchema, type Todo } from '../schema.ts';

export type StoredTodo = WithMeta<Todo>;

function store() {
  return createTaggedCollectionStore('todos', TodoSchema);
}

export const todoStore = {
  peek: (): StoredTodo[] => store().peek() as StoredTodo[],

  subscribe: (cb: (rows: StoredTodo[]) => void) =>
    store().subscribeForTrip(currentTripId(), cb as (rows: WithMeta<Todo>[]) => void),

  add(input: Pick<Todo, 'text'> & Partial<Omit<Todo, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>>) {
    const order = (store().peek() as StoredTodo[]).length;
    return store().set({ done: false, dueDate: null, remindAt: null, order, ...input });
  },

  toggle(id: string, current: boolean) {
    return store().update(id, { done: !current });
  },

  update(id: string, patch: Partial<Todo>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },
};
