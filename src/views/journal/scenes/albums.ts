/* ==========================================================================
   On the Road · Journal albums — booklets on a shelf
   --------------------------------------------------------------------------
   Each album is a small book on the shelf, printed with its own cover. Tapping
   one opens it as a magazine (scenes/magazine.ts); this file is the shelf and
   the helpers both share: an album's entries, and the art its cover prints.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import { escHtml, entryCover } from '../shared/utils.ts';
import { hashId } from './feed-plan.ts';
import { coverOf, renderCover } from './album-cover.ts';
import '../styles/album-cover.css';

const TONES = 6;
export function bookTone(id: string): number { return hashId(id) % TONES; }
export function bookLean(id: string): number { return ((hashId(id) >> 3) % 7 - 3) * 0.8; }

/** Entries of an album, in the album's order, skipping ones since deleted. */
export function albumEntries(album: StoredJournalAlbum, all: StoredJournalEntry[]): StoredJournalEntry[] {
  return album.entryIds
    .map((id) => all.find((e) => e.id === id))
    .filter((e): e is StoredJournalEntry => Boolean(e));
}

/**
 * The entries of an album in the order a magazine prints them: by the day they happened, oldest
 * first, so the contents read as the trip did. (The album's own order is the order they were
 * filed in, which is not the order they happened in.) Entries of one day keep their filing order.
 */
export function magazineEntries(album: StoredJournalAlbum, all: StoredJournalEntry[]): StoredJournalEntry[] {
  return albumEntries(album, all)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.happenedOn.localeCompare(b.e.happenedOn) || a.i - b.i)
    .map(({ e }) => e);
}

/* ── The shelf ───────────────────────────────────────────────────────────── */

export function renderBooklet(album: StoredJournalAlbum, entries: StoredJournalEntry[]): string {
  const art = coverArtOf(album, entries);
  return `
    <button class="jb-book" data-open-album="${escHtml(album.id)}" style="--lean:${bookLean(album.id)}deg" type="button">
      ${renderCover(coverOf(album), art)}
      <span class="jb-spine" aria-hidden="true"></span>
    </button>`;
}

export function renderShelf(albums: StoredJournalAlbum[], entriesOf: (a: StoredJournalAlbum) => StoredJournalEntry[], withNew: boolean): string {
  return `
    <div class="jb-rack">
      ${albums.map((a) => renderBooklet(a, entriesOf(a))).join('')}
      ${withNew ? `<button class="jb-book jb-book--new" data-album-create type="button"><span class="jb-new-plus" aria-hidden="true">+</span><span class="jb-new-label">New album</span></button>` : ''}
    </div>`;
}

/** The cover art an album prints, drawn from its entries. */
export function coverArtOf(album: StoredJournalAlbum, given: StoredJournalEntry[]) {
  // The cover is the same whichever order the entries arrive in (the magazine passes them by date).
  const at = (e: StoredJournalEntry) => album.entryIds.indexOf(e.id);
  const entries = [...given].sort((a, b) => at(a) - at(b));
  const coverEntry = entries.find((e) => e.id === album.coverEntryId && entryCover(e)) ?? entries.find((e) => entryCover(e));
  const dates = entries.map((e) => e.happenedOn).filter(Boolean).sort();
  return {
    photo: coverEntry ? entryCover(coverEntry) : '',
    count: entries.length,
    newest: dates[dates.length - 1] ?? '',
  };
}
