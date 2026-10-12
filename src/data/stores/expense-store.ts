/* ==========================================================================
   On the Road · Expense store
   ========================================================================== */

import { createCollectionStore, createTaggedCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { ExpenseSchema, type Expense } from '../schema.ts';

export type StoredExpense = WithMeta<Expense>;
/** An expense from the cross-trip feed: always knows which trip it belongs to. */
export type TaggedExpense = StoredExpense & { tripId: string };

function store() {
  return createCollectionStore(currentTripId(), 'expenses', ExpenseSchema);
}

export const expenseStore = {
  subscribe: (cb: (rows: StoredExpense[]) => void) => store().subscribe(cb),
  peek: () => store().peek() as StoredExpense[],

  /** Expenses across every trip the user belongs to (the World map's country panel). */
  subscribeAll: (cb: (rows: TaggedExpense[]) => void) =>
    createTaggedCollectionStore('expenses', ExpenseSchema)
      .subscribeForTrip(null, cb as (rows: WithMeta<Expense>[]) => void),

  add(input: Omit<Expense, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>) {
    return store().set(input);
  },

  update(id: string, patch: Partial<Expense>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },

  seed(rows: Omit<Expense, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>[]) {
    return store().bulkSet(rows);
  },
};
