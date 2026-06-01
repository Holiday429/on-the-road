/* ==========================================================================
   On the Road · Expense category store — user-defined spend categories
   --------------------------------------------------------------------------
   Only the user's own categories are stored here; the built-in seven live in
   the expenses view. Same cloud-synced collection-store pattern as the rest.
   ========================================================================== */

import { createCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { ExpenseCategorySchema, type ExpenseCategory } from '../schema.ts';

export type StoredExpenseCategory = WithMeta<ExpenseCategory>;

function store() {
  return createCollectionStore(currentTripId(), 'expenseCategories', ExpenseCategorySchema);
}

export const expenseCategoryStore = {
  subscribe: (cb: (rows: StoredExpenseCategory[]) => void) => store().subscribe(cb),
  peek: () => store().peek() as StoredExpenseCategory[],

  add(input: Omit<ExpenseCategory, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>) {
    return store().set(input);
  },

  remove(id: string) {
    return store().remove(id);
  },
};
