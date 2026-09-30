import { createCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { JournalAlbumSchema, type JournalAlbum } from '../schema.ts';

export type StoredJournalAlbum = WithMeta<JournalAlbum>;

function store() {
  return createCollectionStore(currentTripId(), 'journalAlbums', JournalAlbumSchema);
}

export const journalAlbumStore = {
  subscribe: (cb: (rows: StoredJournalAlbum[]) => void) => store().subscribe(cb),
  peek: () => store().peek() as StoredJournalAlbum[],

  save(album: Partial<JournalAlbum> & { id?: string }) {
    return store().set(album);
  },

  update(id: string, patch: Partial<JournalAlbum>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },

  /** Add entries to an album, preserving order and skipping ones already in it. */
  addEntries(album: StoredJournalAlbum, entryIds: string[]) {
    const next = [...album.entryIds];
    for (const id of entryIds) if (!next.includes(id)) next.push(id);
    if (next.length === album.entryIds.length) return Promise.resolve();
    return store().update(album.id, { entryIds: next });
  },

  removeEntry(album: StoredJournalAlbum, entryId: string) {
    if (!album.entryIds.includes(entryId)) return Promise.resolve();
    return store().update(album.id, { entryIds: album.entryIds.filter((id) => id !== entryId) });
  },
};
