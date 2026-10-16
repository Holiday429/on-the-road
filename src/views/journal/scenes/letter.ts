/* ==========================================================================
   On the Road · Journal — the letter
   --------------------------------------------------------------------------
   One entry, read as a thing that came in the post: an envelope (stamped and
   postmarked, addressed with the title), a letter on paper (the words — and
   only the words), and the photos as postcards beside it. Either may be
   missing: a letter with no photos is just the paper; photos with no words are
   a spread of postcards under their envelope.

   The rule for the whole scene: controls are never printed on the paper. Edit,
   share, pin, delete, the album menu and the page arrows all live in a bar
   under the desk.

   Pure markup — every function takes what it draws and returns a string. The
   lean of each card comes from the entry id (shared/letter-model.ts), never
   Math.random(), so a re-render never reshuffles the desk.
   Styles: styles/letter.css.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import { t } from '../../../core/i18n.ts';
import { escHtml, entryImages, moodEmoji, MAX_JOURNAL_IMAGES, titleFor } from '../shared/utils.ts';
import { envelopeTitle, hasLetter, letterDate, pilePlan, postcardTilt, type CardFocus } from '../shared/letter-model.ts';
import { renderStamp, type StampSpec } from '../../../core/paper/stamp.ts';
import { COUNTRY_SHAPES } from '../../../core/paper/stamp-country.ts';
import { countryInk } from '../../../data/country-ink.ts';
import { hashStr } from '../../../data/palette.ts';
import { postmark, renderPostcard } from './postcard.ts';
import '../../../core/paper/paper.css';

export interface ReadLetterOpts {
  entry: StoredJournalEntry;
  albums: StoredJournalAlbum[];
  /** Entry ids either side of this one, for the page arrows. */
  prevId: string | null;
  nextId: string | null;
  /** Which way the last turn went; '' on first open. Drives a fade, never the open animation. */
  dir: '' | 'next' | 'prev';
  /** Width ÷ height of each photo (undefined = not measured yet), index-aligned with the photos. */
  ratios: Array<number | undefined>;
  /** ISO-3166 alpha-2 of the place, when it could be worked out, and the country's name. */
  iso: string | null;
  country: string;
  locale: string;
  focus: CardFocus | null;
}

/* ── The stamp ───────────────────────────────────────────────────────────── */

/** The country stamp for an entry. With no country it is a plain stamp with the place's name. */
function entryStamp(entry: StoredJournalEntry, iso: string | null, country: string, size: number): string {
  const name = country || entry.destination.trim();
  const key = iso || name.toLowerCase();
  const spec: StampSpec = {
    id: `letter:${entry.id}`, kind: 'country', city: entry.destination, country: name, iso: iso ?? '',
    date: entry.happenedOn, nights: 1,
    shape: COUNTRY_SHAPES[hashStr(key) % COUNTRY_SHAPES.length],
    rotation: postcardTilt(entry.id, 0) / 2,
    ink: countryInk(iso ?? '', name), earned: true, pressure: 0.85,
  };
  return renderStamp(spec, { size });
}

/* ── The envelope ────────────────────────────────────────────────────────── */

function envelope(entry: StoredJournalEntry, iso: string | null, country: string, big: boolean): string {
  const to = envelopeTitle(entry);
  return `
    <div class="ltr-env${big ? ' is-big' : ''}" aria-hidden="true">
      <div class="ltr-env-flap"></div>
      <div class="ltr-env-body">
        <div class="ltr-env-from">
          <span class="ltr-env-label">${escHtml(t('journal.letter.from'))}</span>
          <span class="ltr-env-place">${escHtml(entry.destination.trim() || '—')}</span>
        </div>
        <div class="ltr-env-stamp">${entryStamp(entry, iso, country, big ? 72 : 60)}${postmark(entry.destination, entry.happenedOn)}</div>
        <div class="ltr-env-to">
          <span class="ltr-env-label">${escHtml(t('journal.letter.to'))}</span>
          <span class="ltr-env-title">${escHtml(to)}</span>
          <span class="ltr-env-rule"></span>
        </div>
      </div>
    </div>`;
}

/* ── The paper ───────────────────────────────────────────────────────────── */

/** The mood, pressed into wax. */
function waxSeal(mood: string | undefined): string {
  const emoji = moodEmoji(mood);
  if (!emoji) return '';
  return `<span class="ltr-seal" data-mood="${escHtml(mood ?? '')}" title="${escHtml(mood ?? '')}" role="img" aria-label="${escHtml(`${t('journal.mood')}: ${mood ?? ''}`)}"><span class="ltr-seal-icon" aria-hidden="true">${emoji}</span></span>`;
}

function paper(entry: StoredJournalEntry, locale: string): string {
  const title = entry.title.trim();
  const body = entry.body.trim();
  const tags = entry.tags.length
    ? `<div class="ltr-tags">${entry.tags.map((tag) => `<span class="ltr-tag">#${escHtml(tag)}</span>`).join('')}</div>`
    : '<span></span>';
  return `
    <section class="ltr-paper">
      <div class="ltr-letterhead" aria-hidden="true">On the Road</div>
      <p class="ltr-dateline">${escHtml(letterDate(entry.happenedOn, entry.destination, locale))}</p>
      ${title ? `<h2 class="ltr-title">${escHtml(title)}</h2>` : ''}
      ${body ? `<div class="ltr-text">${escHtml(body)}</div>` : ''}
      <footer class="ltr-foot">${tags}${waxSeal(entry.mood)}</footer>
    </section>`;
}

/* ── The postcards ───────────────────────────────────────────────────────── */

function postcards(o: ReadLetterOpts, photos: string[], layout: 'stack' | 'loose'): string {
  const { entry } = o;
  const pile = pilePlan(entry.id, photos.map((_, i) => o.ratios[i]));
  const focus = o.focus && o.focus.entryId === entry.id ? o.focus : { entryId: entry.id, picked: 0, flipped: [] };
  const picked = Math.min(focus.picked, photos.length - 1);
  const message = titleFor(entry);
  const country = o.country;
  return `
    <aside class="ltr-cards" data-layout="${layout}" aria-label="${escHtml(t('journal.letter.postcards'))}"
           style="--pile-w:${pile.width}px;--pile-h:${pile.height}px">
      ${photos.map((src, i) => renderPostcard({
        src, index: i, total: photos.length, card: pile.cards[i],
        z: i === picked ? 100 : 50 - Math.abs(i - picked),
        picked: i === picked, flipped: focus.flipped.includes(i),
        place: entry.destination, date: entry.happenedOn, message,
        stamp: entryStamp(entry, o.iso, country, 46),
      })).join('')}
    </aside>`;
}

/* ── The bar under the desk ──────────────────────────────────────────────── */

/**
 * Album membership, as a small menu in the bar: which albums this entry is in
 * (with a way out of each) and a select to file it in another. It used to be
 * printed on the page.
 */
function albumMenu(entry: StoredJournalEntry, albums: StoredJournalAlbum[]): string {
  const inAlbums = albums.filter((album) => album.entryIds.includes(entry.id));
  const available = albums.filter((album) => !album.entryIds.includes(entry.id));
  return `
    <details class="ltr-album">
      <summary class="journal-reader-pill${inAlbums.length ? ' is-on' : ''}">📁 ${escHtml(t('journal.letter.album'))}${inAlbums.length ? ` · ${inAlbums.length}` : ''}</summary>
      <div class="ltr-album-pop">
        ${inAlbums.map((album) => `
          <span class="journal-album-chip">
            ${escHtml(album.emoji)} ${escHtml(album.title)}
            <button class="journal-album-chip-x" data-album-remove-entry="${escHtml(album.id)}:${escHtml(entry.id)}" type="button" title="${escHtml(t('journal.album.remove'))}" aria-label="${escHtml(t('journal.album.remove'))}">✕</button>
          </span>`).join('')}
        <select class="select input journal-album-add" data-album-add-entry="${escHtml(entry.id)}" aria-label="${escHtml(t('journal.letter.album'))}">
          <option value="">${escHtml(t('journal.album.add'))}</option>
          ${available.map((album) => `<option value="${escHtml(album.id)}">${escHtml(album.emoji)} ${escHtml(album.title)}</option>`).join('')}
          <option value="__new__">${escHtml(t('journal.album.new'))}</option>
        </select>
      </div>
    </details>`;
}

function bar(o: ReadLetterOpts): string {
  const { entry } = o;
  const isPublic = entry.visibility === 'public';
  return `
    <nav class="ltr-bar" aria-label="${escHtml(t('journal.letter.tools'))}">
      <button class="ltr-turn" data-spread-prev="${escHtml(o.prevId ?? '')}" type="button" ${o.prevId ? '' : 'disabled'} aria-label="${escHtml(t('journal.prevEntry'))}">‹</button>
      <div class="ltr-tools">
        <button class="journal-reader-pill" data-open-reader-edit="${escHtml(entry.id)}" type="button">✎ ${escHtml(t('journal.editAction'))}</button>
        <button class="journal-reader-pill" data-card-entry="${escHtml(entry.id)}" type="button">🖼 ${escHtml(t('journal.card'))}</button>
        <button class="journal-reader-pill ${isPublic ? 'is-on' : ''}" data-share-entry="${escHtml(entry.id)}" type="button">↗ ${escHtml(t('journal.share'))}</button>
        <button class="journal-reader-pill ${entry.favorite ? 'is-on' : ''}" data-favorite-entry="${escHtml(entry.id)}" type="button">📌 ${escHtml(t('journal.pin'))}</button>
        ${albumMenu(entry, o.albums)}
        <button class="journal-reader-pill is-danger" data-delete-entry="${escHtml(entry.id)}" type="button">✕ ${escHtml(t('journal.delete'))}</button>
      </div>
      <button class="ltr-turn" data-spread-next="${escHtml(o.nextId ?? '')}" type="button" ${o.nextId ? '' : 'disabled'} aria-label="${escHtml(t('journal.nextEntry'))}">›</button>
    </nav>`;
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

export function renderReadLetter(o: ReadLetterOpts): string {
  const { entry } = o;
  const photos = entryImages(entry).slice(0, MAX_JOURNAL_IMAGES);
  const letter = hasLetter(entry);
  const layout = letter ? 'letter' : 'cards';
  // A turn replays a short fade; two names so the second turn restarts it as well.
  const fade = o.dir ? ` is-fading-${o.dir === 'next' ? 'a' : 'b'}` : '';

  return `
    <article class="ltr ltr--read${fade}" data-letter-scene data-layout="${layout}">
      <div class="ltr-scroll">
        <div class="ltr-scene ltr-scene--${layout}${photos.length ? ' has-cards' : ''}">
          ${envelope(entry, o.iso, o.country, !letter)}
          ${letter ? paper(entry, o.locale) : ''}
          ${photos.length ? postcards(o, photos, letter ? 'stack' : 'loose') : ''}
        </div>
      </div>
      ${bar(o)}
      <button class="journal-icon-btn ltr-close" data-reader-close type="button" title="${escHtml(t('journal.close'))}" aria-label="${escHtml(t('journal.close'))}">✕</button>
    </article>`;
}
