/* ==========================================================================
   On the Road · Journal store
   ========================================================================== */

import { createCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { JournalEntrySchema, type JournalEntry } from '../schema.ts';

export type StoredJournalEntry = WithMeta<JournalEntry>;

function store() {
  return createCollectionStore(currentTripId(), 'journalEntries', JournalEntrySchema);
}

export const journalStore = {
  subscribe: (cb: (rows: StoredJournalEntry[]) => void) => store().subscribe(cb),
  peek: () => store().peek() as StoredJournalEntry[],

  save(entry: Partial<JournalEntry> & { id?: string }) {
    return store().set(entry);
  },

  update(id: string, patch: Partial<JournalEntry>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },

  /** Find a public entry by its share slug (from the current cache snapshot). */
  bySlug(slug: string): StoredJournalEntry | undefined {
    return (store().peek() as StoredJournalEntry[]).find(
      (e) => e.visibility === 'public' && e.slug === slug,
    );
  },
};
