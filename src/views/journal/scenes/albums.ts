/* ==========================================================================
   On the Road · Journal albums — booklets on a shelf, a book you open
   --------------------------------------------------------------------------
   Each album is a small book: a zine when it has a photo for its cover, a
   notebook with an elastic band when it doesn't. Tap one and its cover swings
   open on a two-page spread — a title page, then one entry to a page, each with
   its photo held by corners and a hand-written caption — and ‹ › turn the
   pages. All paging state lives in the caller (`spread`, `turn`), so a re-render
   never loses your place.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import { escHtml, entryCover, excerpt, moodEmoji, prettyDate, titleFor } from '../shared/utils.ts';
import { hashId } from './feed-plan.ts';
import { stampDate } from './feed.ts';

export type BookPage = { kind: 'title' } | { kind: 'entry'; entry: StoredJournalEntry } | null;

/** Pages in pairs: the title page faces the first entry, then entries two to a spread. */
export function albumSpreads(entries: StoredJournalEntry[]): [BookPage, BookPage][] {
  const pages: BookPage[] = [{ kind: 'title' }, ...entries.map((entry): BookPage => ({ kind: 'entry', entry }))];
  const out: [BookPage, BookPage][] = [];
  for (let i = 0; i < pages.length; i += 2) out.push([pages[i], pages[i + 1] ?? null]);
  return out;
}

export function spreadCount(entryCount: number): number {
  return Math.ceil((entryCount + 1) / 2);
}

export function clampSpread(spread: number, entryCount: number): number {
  return Math.max(0, Math.min(spreadCount(entryCount) - 1, Math.floor(spread) || 0));
}

const TONES = 6;
export function bookTone(id: string): number { return hashId(id) % TONES; }
export function bookLean(id: string): number { return ((hashId(id) >> 3) % 7 - 3) * 0.8; }

/* ── The shelf ───────────────────────────────────────────────────────────── */

export function renderBooklet(album: StoredJournalAlbum, entries: StoredJournalEntry[]): string {
  const coverEntry = entries.find((e) => e.id === album.coverEntryId && entryCover(e)) ?? entries.find((e) => entryCover(e));
  const cover = coverEntry ? entryCover(coverEntry) : '';
  const kind = cover ? 'zine' : 'notebook';
  return `
    <button class="jb-book jb-book--${kind} " data-tone="${bookTone(album.id)}" data-open-album="${escHtml(album.id)}" style="--lean:${bookLean(album.id)}deg" type="button">
      <span class="jb-pages" aria-hidden="true"></span>
      <span class="jb-cover">
        ${cover ? `<img class="jb-cover-img" src="${escHtml(cover)}" alt="" loading="lazy" draggable="false">` : '<span class="jb-band" aria-hidden="true"></span>'}
        <span class="jb-spine" aria-hidden="true"></span>
        <span class="jb-label">
          <span class="jb-emoji">${escHtml(album.emoji)}</span>
          <span class="jb-title">${escHtml(album.title)}</span>
        </span>
        <span class="jb-count">${entries.length} ${entries.length === 1 ? 'page' : 'pages'}</span>
        <span class="jb-ribbon" aria-hidden="true"></span>
      </span>
    </button>`;
}

export function renderShelf(albums: StoredJournalAlbum[], entriesOf: (a: StoredJournalAlbum) => StoredJournalEntry[], withNew: boolean): string {
  return `
    <div class="jb-rack">
      ${albums.map((a) => renderBooklet(a, entriesOf(a))).join('')}
      ${withNew ? `<button class="jb-book jb-book--new" data-album-create type="button"><span class="jb-new-plus" aria-hidden="true">+</span><span class="jb-new-label">New album</span></button>` : ''}
    </div>`;
}

/* ── The open book ───────────────────────────────────────────────────────── */

function entryPage(e: StoredJournalEntry, albumId: string, side: 'l' | 'r'): string {
  const cover = entryCover(e);
  const where = e.destination.trim();
  const mood = moodEmoji(e.mood);
  return `
    <section class="jb-page jb-page--${side === 'l' ? 'left' : 'right'}" data-open-entry="${escHtml(e.id)}" role="button" tabindex="0">
      <button class="jb-page-x journal-icon-btn" data-album-remove-entry="${escHtml(albumId)}:${escHtml(e.id)}" type="button" title="Take out of this album" aria-label="Take out of this album">✕</button>
      ${cover ? `
        <div class="jb-photo">
          <span class="jb-corner jb-corner--tl"></span><span class="jb-corner jb-corner--tr"></span><span class="jb-corner jb-corner--bl"></span><span class="jb-corner jb-corner--br"></span>
          <img src="${escHtml(cover)}" alt="${escHtml(titleFor(e))}" loading="lazy" draggable="false">
        </div>` : ''}
      <div class="jb-notes${cover ? '' : ' is-lined'}">
        <span class="jb-date">${escHtml(stampDate(e.happenedOn))}${where ? ` · ${escHtml(where)}` : ''}${mood ? ` ${mood}` : ''}</span>
        <h3 class="jb-hand">${escHtml(titleFor(e))}</h3>
        ${e.body.trim() ? `<p class="jb-text">${escHtml(excerpt(e.body, cover ? 150 : 420))}</p>` : ''}
      </div>
    </section>`;
}

function titlePage(album: StoredJournalAlbum, entries: StoredJournalEntry[]): string {
  const dates = entries.map((e) => e.happenedOn).sort();
  const span = dates.length ? (dates[0] === dates[dates.length - 1] ? prettyDate(dates[0]) : `${prettyDate(dates[0])} → ${prettyDate(dates[dates.length - 1])}`) : '';
  return `
    <section class="jb-page jb-page--left jb-page--title">
      <span class="jb-title-emoji" aria-hidden="true">${escHtml(album.emoji)}</span>
      <h2 class="jb-book-title">${escHtml(album.emoji)} ${escHtml(album.title)}</h2>
      <p class="jb-book-meta">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${span ? ` · ${escHtml(span)}` : ''}</p>
      <div class="jb-book-actions">
        <button class="jb-chip" data-album-rename="${escHtml(album.id)}" type="button">Rename</button>
        <button class="jb-chip is-danger" data-album-delete="${escHtml(album.id)}" type="button">Delete album</button>
      </div>
    </section>`;
}

export interface BookState { spread: number; /** flips each turn so the page-turn animation restarts */ turn: boolean; dir: 'next' | 'prev' | ''; opening: boolean }

export function renderBook(album: StoredJournalAlbum, entries: StoredJournalEntry[], s: BookState): string {
  const spreads = albumSpreads(entries);
  const i = clampSpread(s.spread, entries.length);
  const [left, right] = spreads[i];
  const side = (p: BookPage, which: 'l' | 'r') => !p ? `<section class="jb-page jb-page--${which === 'l' ? 'left' : 'right'} is-blank" aria-hidden="true"></section>`
    : p.kind === 'title' ? titlePage(album, entries) : entryPage(p.entry, album.id, which);
  const turn = s.dir ? ` is-turn-${s.dir}-${s.turn ? 'a' : 'b'}` : '';
  return `
    <div class="jb-desk" tabindex="0" data-book-keys>
      <div class="jb-bar">
        <button class="jb-chip" data-album-back type="button">← Albums</button>
        <span class="jb-bar-title">${escHtml(album.emoji)} ${escHtml(album.title)}</span>
        <span class="jb-bar-pos">${i + 1} / ${spreads.length}</span>
      </div>
      <div class="jb-open" data-tone="${bookTone(album.id)}">
        <div class="jb-spread${turn}">${side(left, 'l')}${side(right, 'r')}</div>
        ${s.opening ? `<div class="jb-flap" aria-hidden="true"><span class="jb-flap-title">${escHtml(album.emoji)} ${escHtml(album.title)}</span></div>` : ''}
        <button class="jb-turn jb-turn--prev" data-album-page="prev" type="button" aria-label="Previous page" ${i === 0 ? 'disabled' : ''}>‹</button>
        <button class="jb-turn jb-turn--next" data-album-page="next" type="button" aria-label="Next page" ${i >= spreads.length - 1 ? 'disabled' : ''}>›</button>
      </div>
      ${entries.length === 0 ? '<p class="jb-empty-note">This album is empty — select photos in the Gallery to put some in.</p>' : ''}
    </div>`;
}
