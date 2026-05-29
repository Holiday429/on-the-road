/* ==========================================================================
   On the Road · Expense store
   ========================================================================== */

import { createCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { ExpenseSchema, type Expense } from '../schema.ts';

export type StoredExpense = WithMeta<Expense>;

function store() {
  return createCollectionStore(currentTripId(), 'expenses', ExpenseSchema);
}

export const expenseStore = {
  subscribe: (cb: (rows: StoredExpense[]) => void) => store().subscribe(cb),
  peek: () => store().peek() as StoredExpense[],

  add(input: Omit<Expense, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>) {
    return store().set(input);
  },

  remove(id: string) {
    return store().remove(id);
  },

  seed(rows: Omit<Expense, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>[]) {
    return store().bulkSet(rows);
  },
};
