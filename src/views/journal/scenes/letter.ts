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

   Writing is the same desk, editable: the date and place are the dateline, the
   title and body are typed straight onto the paper, the mood is a row of wax
   seals to press, and the postcards are the photos about to be sent, with a
   blank card to add another.

   Pure markup — every function takes what it draws and returns a string. The
   lean of each card comes from the entry id (shared/letter-model.ts), never
   Math.random(), so a re-render never reshuffles the desk.
   Styles: styles/letter.css.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import { t } from '../../../core/i18n.ts';
import type { CaptureState } from '../capture/types.ts';
import { escHtml, entryImages, moodEmoji, MOODS, MAX_JOURNAL_IMAGES, OTHER_DESTINATION, titleFor } from '../shared/utils.ts';
import { datelineSep, envelopeTitle, hasLetter, letterDate, pilePlan, postcardTilt, type CardFocus } from '../shared/letter-model.ts';
import { renderStamp, type StampSpec } from '../../../core/paper/stamp.ts';
import { COUNTRY_SHAPES } from '../../../core/paper/stamp-country.ts';
import { countryInk } from '../../../data/country-ink.ts';
import { hashStr } from '../../../data/palette.ts';
import { postmark, renderPostcard, renderPostcardSlot } from './postcard.ts';
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

/** What the envelope and stamp need of an entry — also true of a draft. */
type LetterHead = Pick<StoredJournalEntry, 'id' | 'title' | 'body' | 'destination' | 'happenedOn'>;

/* ── The stamp ───────────────────────────────────────────────────────────── */

/** The country stamp for an entry. With no country it is a plain stamp with the place's name. */
function entryStamp(entry: LetterHead, iso: string | null, country: string, size: number): string {
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

function envelope(entry: LetterHead, iso: string | null, country: string, big: boolean): string {
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

/* ── Writing ─────────────────────────────────────────────────────────────── */

export interface WriteLetterOpts {
  state: CaptureState;
  /** Cities from the itinerary, offered as the place. */
  cities: string[];
  /** Places written about before, for the free-text list. */
  destinations: string[];
  /** The guide-place picker and any other optional fields, already drawn. */
  extras: string;
  iso: string | null;
  country: string;
  locale: string;
}

/** The date, written as it will read on the letter. The real date control sits invisibly over it. */
function dateControl(iso: string, locale: string): string {
  return `
    <label class="ltr-date">
      <span class="ltr-date-text">${escHtml(letterDate(iso, '', locale))}</span>
      <input class="ltr-date-input" type="date" id="journal-date" value="${escHtml(iso)}" aria-label="${escHtml(t('journal.date'))}">
    </label>`;
}

function placeControl(o: WriteLetterOpts): string {
  const d = o.state.draft;
  const place = d.destination.trim();
  const isCustom = place !== '' && !o.cities.includes(place);
  return `
    <span class="ltr-place">
      ${o.cities.length ? `
        <select class="ltr-place-select" id="journal-destination-select" aria-label="${escHtml(t('journal.whereWereYou'))}">
          ${o.cities.map((c) => `<option value="${escHtml(c)}" ${!isCustom && c === place ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
          <option value="${OTHER_DESTINATION}" ${isCustom ? 'selected' : ''}>${escHtml(t('journal.otherPlace'))}</option>
        </select>` : ''}
      <input class="ltr-place-input" id="journal-destination" list="journal-dest-list"
        placeholder="${escHtml(t('journal.whereWereYou'))}" value="${escHtml(d.destination)}"
        ${o.cities.length && !isCustom ? 'hidden' : ''}>
      <datalist id="journal-dest-list">
        ${o.destinations.map((x) => `<option value="${escHtml(x)}"></option>`).join('')}
      </datalist>
    </span>`;
}

/** Four seals to press the letter with. The radio is the state; the wax is only its picture. */
function sealPicker(mood: string): string {
  return `
    <div class="ltr-seals" role="group" aria-label="${escHtml(t('journal.mood'))}">
      ${MOODS.map((m) => `
        <label class="ltr-seal ltr-seal--pick${mood === m.value ? ' is-on' : ''}" data-mood="${escHtml(m.value)}" title="${escHtml(m.value)}">
          <input type="radio" name="journal-mood" value="${escHtml(m.value)}" ${mood === m.value ? 'checked' : ''}>
          <span class="ltr-seal-icon" aria-hidden="true">${m.emoji}</span>
        </label>`).join('')}
    </div>`;
}

function writePaper(o: WriteLetterOpts): string {
  const { state } = o;
  const d = state.draft;
  return `
    <section class="ltr-paper ltr-paper--write">
      <div class="ltr-letterhead" aria-hidden="true">On the Road</div>
      <div class="ltr-dateline is-edit">${dateControl(d.happenedOn, o.locale)}<span class="ltr-sep" aria-hidden="true">${escHtml(datelineSep(o.locale).trim())}</span>${placeControl(o)}</div>
      <input class="ltr-title-input" id="journal-title" maxlength="80"
        placeholder="${escHtml(t('journal.titlePlaceholder'))}" value="${escHtml(d.title)}">
      <textarea class="ltr-text-input" id="journal-body"
        placeholder="${escHtml(t('journal.bodyPlaceholder'))}">${escHtml(d.body)}</textarea>
      <footer class="ltr-foot ltr-foot--write">
        <details class="ltr-note" ${state.moreOpen ? 'open' : ''} data-journal-more>
          <summary class="ltr-note-tab">${escHtml(t('journal.moreFields'))}</summary>
          <div class="ltr-note-body">
            <input class="input" id="journal-tags" placeholder="${escHtml(t('journal.tagsPlaceholder'))}" value="${escHtml(d.tagsText)}">
            ${o.extras}
          </div>
        </details>
        ${sealPicker(d.mood)}
      </footer>
    </section>`;
}

/** The photos about to go out, as a pile, with a blank card on the end to add another. */
function writeCards(o: WriteLetterOpts): string {
  const { state } = o;
  const d = state.draft;
  const key = 'draft';
  const full = d.images.length >= MAX_JOURNAL_IMAGES;
  const pile = pilePlan(key, [...d.images.map((_, i) => d.imageRatios[i]), ...(full ? [] : [undefined])]);
  const focus = state.letter?.entryId === key ? state.letter : null;
  const picked = Math.min(focus?.picked ?? 0, Math.max(0, d.images.length - 1));
  return `
    <aside class="ltr-cards" data-layout="stack" aria-label="${escHtml(t('journal.letter.postcards'))}"
           style="--pile-w:${pile.width}px;--pile-h:${pile.height}px">
      ${d.images.map((src, i) => renderPostcard({
        src, index: i, total: d.images.length, card: pile.cards[i],
        z: i === picked ? 100 : 50 - Math.abs(i - picked),
        picked: i === picked, flipped: false,
        place: d.destination, date: d.happenedOn, message: d.title, stamp: '',
        edit: { first: i === 0, last: i === d.images.length - 1 },
      })).join('')}
      ${full ? '' : renderPostcardSlot({ card: pile.cards[d.images.length], uploading: d.uploading, label: t('journal.addPhoto') })}
      <input class="ltr-file" type="file" id="journal-image-input" accept="image/*" multiple>
    </aside>`;
}

export function renderWriteLetter(o: WriteLetterOpts): string {
  const { state } = o;
  const d = state.draft;
  const head: LetterHead = { id: 'draft', title: d.title, body: d.body, destination: d.destination, happenedOn: d.happenedOn };
  return `
    <article class="ltr ltr--write" data-letter-scene data-layout="letter">
      <div class="ltr-scroll">
        <div class="ltr-scene ltr-scene--letter has-cards">
          ${envelope(head, o.iso, o.country, false)}
          ${writePaper(o)}
          ${writeCards(o)}
        </div>
      </div>
      <nav class="ltr-bar ltr-bar--write">
        <span class="ltr-bar-hint">${escHtml(t(state.editingId ? 'journal.edit' : 'journal.new'))}</span>
        <div class="ltr-tools">
          <button class="btn btn-ghost" data-journal-cancel type="button">${escHtml(t('journal.cancel'))}</button>
          <button class="btn btn-primary" data-journal-save type="button">${escHtml(t('journal.save'))}</button>
        </div>
      </nav>
      <button class="journal-icon-btn ltr-close" data-journal-close type="button" title="${escHtml(t('journal.close'))}" aria-label="${escHtml(t('journal.close'))}">✕</button>
    </article>`;
}
