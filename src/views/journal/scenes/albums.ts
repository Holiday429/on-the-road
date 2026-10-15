/* ==========================================================================
   On the Road · Journal albums — booklets on a shelf, a book you open
   --------------------------------------------------------------------------
   Each album is a small book: a zine when it has a photo for its cover, a
   notebook with an elastic band when it doesn't. Tap one and its cover swings
   open on a magazine — the book is where the entries are read, not previewed,
   so a short piece gets a whole spread with its photo run large while a long one
   is broken over as many spreads as it needs (see album-pages.ts). ‹ › turn the
   pages. All paging state lives in the caller (`spread`, `turn`), so a re-render
   never loses your place.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import { escHtml, entryCover, moodEmoji, prettyDate, titleFor } from '../shared/utils.ts';
import { hashId } from './feed-plan.ts';
import { stampDate } from './feed.ts';
import { clampSpread, paginate, type Leaf } from './album-pages.ts';
import { coverOf, renderCover } from './album-cover.ts';
import { planLayouts, type PageLayout } from './album-layout.ts';
import { t } from '../../../core/i18n.ts';
import '../styles/album-cover.css';

export { clampSpread } from './album-pages.ts';

const TONES = 6;
export function bookTone(id: string): number { return hashId(id) % TONES; }
export function bookLean(id: string): number { return ((hashId(id) >> 3) % 7 - 3) * 0.8; }

/** Entries of an album, in the album's order, skipping ones since deleted. */
export function albumEntries(album: StoredJournalAlbum, all: StoredJournalEntry[]): StoredJournalEntry[] {
  return album.entryIds
    .map((id) => all.find((e) => e.id === id))
    .filter((e): e is StoredJournalEntry => Boolean(e));
}

/* ── The shelf ───────────────────────────────────────────────────────────── */

export function renderBooklet(album: StoredJournalAlbum, entries: StoredJournalEntry[]): string {
  const art = coverArtOf(album, entries);
  return `
    <button class="jb-book" data-open-album="${escHtml(album.id)}" style="--lean:${bookLean(album.id)}deg" type="button">
      <span class="jb-pages" aria-hidden="true"></span>
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

/* ── The open book ───────────────────────────────────────────────────────── */

/** The photos of a leaf, laid out inside the page rather than cropped to a thumbnail. */
function plate(photos: string[], title: string, big: boolean): string {
  if (!photos.length) return '';
  const shown = photos.slice(0, big ? 1 : 4);
  return `
    <div class="jb-plate${big ? ' is-big' : ''} jb-plate--${Math.min(shown.length, 4)}">
      ${shown.map((src) => `
        <figure class="jb-shot">
          <img src="${escHtml(src)}" alt="${escHtml(title)}" loading="lazy" draggable="false">
        </figure>`).join('')}
      ${photos.length > shown.length ? `<span class="jb-more">+${photos.length - shown.length}</span>` : ''}
    </div>`;
}

function entryLeaf(leaf: Leaf, albumId: string, side: 'l' | 'r', layout: PageLayout, folio: number): string {
  const e = leaf.entry!;
  const where = e.destination.trim();
  const mood = moodEmoji(e.mood);
  const big = layout === 'plate' || layout === 'openerL';
  return `
    <section class="jb-page jb-page--${side === 'l' ? 'left' : 'right'} jb-lay--${layout}" data-open-entry="${escHtml(e.id)}" role="button" tabindex="0">
      <button class="jb-page-x journal-icon-btn" data-album-remove-entry="${escHtml(albumId)}:${escHtml(e.id)}" type="button" title="Take out of this album" aria-label="Take out of this album">✕</button>
      ${leaf.continued
        ? '<span class="jb-runon">continued</span>'
        : `<header class="jb-head">
            <span class="jb-date">${escHtml(stampDate(e.happenedOn))}${where ? ` · ${escHtml(where)}` : ''}${mood ? ` ${mood}` : ''}</span>
            <h3 class="jb-hand">${escHtml(titleFor(e))}</h3>
          </header>`}
      ${plate(leaf.photos, titleFor(e), big)}
      ${leaf.text ? `<div class="jb-copy${leaf.continues ? ' is-cut' : ''}"><p>${escHtml(leaf.text)}</p></div>` : ''}
      ${leaf.continues ? '<span class="jb-turnover">continues ›</span>' : ''}
      <span class="jb-folio" aria-hidden="true">${folio}</span>
    </section>`;
}

/** The cover art an album prints, drawn from its entries. */
export function coverArtOf(album: StoredJournalAlbum, entries: StoredJournalEntry[]) {
  const coverEntry = entries.find((e) => e.id === album.coverEntryId && entryCover(e)) ?? entries.find((e) => entryCover(e));
  const dates = entries.map((e) => e.happenedOn).filter(Boolean).sort();
  return {
    photo: coverEntry ? entryCover(coverEntry) : '',
    count: entries.length,
    newest: dates[dates.length - 1] ?? '',
    suggested: entries.map((e) => titleFor(e)).filter(Boolean).slice(0, 2),
  };
}

/** The album's own cover, printed full size as the book's first page. */
function titleLeaf(album: StoredJournalAlbum, entries: StoredJournalEntry[]): string {
  const dates = entries.map((e) => e.happenedOn).sort();
  const span = dates.length ? (dates[0] === dates[dates.length - 1] ? prettyDate(dates[0]) : `${prettyDate(dates[0])} → ${prettyDate(dates[dates.length - 1])}`) : '';
  return `
    <section class="jb-page jb-page--left jb-page--title">
      <div class="jb-title-cover">${renderCover(coverOf(album), coverArtOf(album, entries))}</div>
      <p class="jb-book-meta">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${span ? ` · ${escHtml(span)}` : ''}</p>
      <div class="jb-book-actions">
        <button class="jb-chip" data-album-cover="${escHtml(album.id)}" type="button">${escHtml(t('journal.cover.design'))}</button>
        <button class="jb-chip" data-album-rename="${escHtml(album.id)}" type="button">${escHtml(t('journal.cover.rename'))}</button>
        <button class="jb-chip is-danger" data-album-delete="${escHtml(album.id)}" type="button">${escHtml(t('journal.cover.deleteAlbum'))}</button>
      </div>
    </section>`;
}

export interface BookState { spread: number; /** flips each turn so the page-turn animation restarts */ turn: boolean; dir: 'next' | 'prev' | ''; opening: boolean }

export function renderBook(album: StoredJournalAlbum, entries: StoredJournalEntry[], s: BookState): string {
  const spreads = paginate(entries);
  const i = clampSpread(s.spread, spreads.length);
  const [left, right] = spreads[i];
  // Layouts are planned across the WHOLE book, not per spread, so the no-repeat
  // and alternation rules still hold when you turn the page.
  const plan = planLayouts(spreads.flat(), album.id);
  const side = (leaf: Leaf | null, which: 'l' | 'r') => {
    const at = i * 2 + (which === 'l' ? 0 : 1);
    if (!leaf) return `<section class="jb-page jb-page--${which === 'l' ? 'left' : 'right'} is-blank" aria-hidden="true"></section>`;
    if (leaf.layout === 'title') return titleLeaf(album, entries);
    return entryLeaf(leaf, album.id, which, plan[at] ?? 'inset', at + 1);
  };
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

/** How many spreads this album runs to — the caller clamps its paging against it. */
export function spreadCount(entries: StoredJournalEntry[]): number {
  return paginate(entries).length;
}
