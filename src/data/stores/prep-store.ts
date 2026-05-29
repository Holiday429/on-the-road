/* ==========================================================================
   On the Road · Prep store
   Business surface for pre-departure tasks, on top of the generic store.
   ========================================================================== */

import { createCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { PrepTaskSchema, type PrepTask } from '../schema.ts';

export type StoredPrepTask = WithMeta<PrepTask>;

function store() {
  return createCollectionStore(currentTripId(), 'prepTasks', PrepTaskSchema);
}

export const prepStore = {
  subscribe: (cb: (tasks: StoredPrepTask[]) => void) => store().subscribe(cb),
  peek: () => store().peek() as StoredPrepTask[],

  add(input: { text: string; category: string; phase: PrepTask['phase']; note?: string }) {
    return store().set({ ...input, done: false, order: Date.now() });
  },

  toggle(id: string, done: boolean) {
    return store().update(id, { done });
  },

  remove(id: string) {
    return store().remove(id);
  },

  seed(tasks: Omit<PrepTask, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>[]) {
    return store().bulkSet(tasks);
  },
};
