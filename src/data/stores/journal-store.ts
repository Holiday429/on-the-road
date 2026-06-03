/* ==========================================================================
   On the Road · Journal store
   ========================================================================== */

import { createTaggedCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { JournalEntrySchema, type JournalEntry } from '../schema.ts';

export type StoredJournalEntry = WithMeta<JournalEntry>;

// Entries are flattened to users/{uid}/journalEntries with a tripId tag, so the
// calendar can show one trip or scroll across every trip's memories. Capture
// uses subscribe() (current trip); the calendar can opt into subscribeAll().
function store() {
  return createTaggedCollectionStore('journalEntries', JournalEntrySchema);
}

export const journalStore = {
  /** Entries for the current trip only. */
  subscribe: (cb: (rows: StoredJournalEntry[]) => void) =>
    store().subscribeForTrip(currentTripId(), cb as (rows: WithMeta<JournalEntry>[]) => void),

  /** Entries across all trips (calendar "all memories" view). */
  subscribeAll: (cb: (rows: StoredJournalEntry[]) => void) =>
    store().subscribeForTrip(null, cb as (rows: WithMeta<JournalEntry>[]) => void),

  peek: () => (store().peek() as StoredJournalEntry[]).filter(e => e.tripId === currentTripId()),

  save(entry: Partial<JournalEntry> & { id?: string }) {
    return store().set(entry);
  },

  update(id: string, patch: Partial<JournalEntry>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },

  /** Find a public entry by its share slug (across all trips in cache). */
  bySlug(slug: string): StoredJournalEntry | undefined {
    return (store().peek() as StoredJournalEntry[]).find(
      (e) => e.visibility === 'public' && e.slug === slug,
    );
  },
};
