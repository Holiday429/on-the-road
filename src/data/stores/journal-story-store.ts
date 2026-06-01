import { createCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { JournalStorySchema, type JournalStory } from '../schema.ts';

export type StoredJournalStory = WithMeta<JournalStory>;

function store() {
  return createCollectionStore(currentTripId(), 'journalStories', JournalStorySchema);
}

export const journalStoryStore = {
  subscribe: (cb: (rows: StoredJournalStory[]) => void) => store().subscribe(cb),
  peek: () => store().peek() as StoredJournalStory[],

  save(story: Partial<JournalStory> & { id?: string }) {
    return store().set(story);
  },

  update(id: string, patch: Partial<JournalStory>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },
};
