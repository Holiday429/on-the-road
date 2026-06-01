import { createCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { JournalTemplateSchema, type JournalTemplate } from '../schema.ts';

export type StoredJournalTemplate = WithMeta<JournalTemplate>;

function store() {
  return createCollectionStore(currentTripId(), 'journalTemplates', JournalTemplateSchema);
}

export const journalTemplateStore = {
  subscribe: (cb: (rows: StoredJournalTemplate[]) => void) => store().subscribe(cb),
  peek: () => store().peek() as StoredJournalTemplate[],

  save(template: Partial<JournalTemplate> & { id?: string }) {
    return store().set(template);
  },

  update(id: string, patch: Partial<JournalTemplate>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },
};
