/* ==========================================================================
   On the Road · To-Do store
   User-scoped (lives at users/{uid}/todos), not trip-scoped, so todos survive
   trip switches and can carry a tripId field for optional filtering.
   ========================================================================== */

import { createUserCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { TodoSchema, type Todo } from '../schema.ts';

export type StoredTodo = WithMeta<Todo>;

function store() {
  return createUserCollectionStore('todos', TodoSchema);
}

export const todoStore = {
  peek: (): StoredTodo[] => store().peek() as StoredTodo[],

  subscribe: (cb: (rows: StoredTodo[]) => void) =>
    store().subscribe(cb as (rows: WithMeta<Todo>[]) => void),

  add(input: Pick<Todo, 'text'> & Partial<Omit<Todo, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>>) {
    const order = (store().peek() as StoredTodo[]).length;
    return store().set({ done: false, dueDate: null, remindAt: null, tripId: null, order, ...input });
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
