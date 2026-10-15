/* ==========================================================================
   On the Road · Journal — the open notebook
   --------------------------------------------------------------------------
   One spread, two states: writing and reading. They are the same two pages, so
   switching between them moves nothing on screen — the pen simply comes out.

   Left page is the day: a rubber date stamp, the city as a postmark, a mood
   sticker, and the photos taped on as polaroids. Right page is ruled paper —
   the title in a hand, the body written across the rules. Tags and the rest of
   the optional fields live on a sticky note at the foot of the right page,
   folded away until wanted.

   Pure markup: every function takes what it draws and returns a string. The
   photo angles come from the entry/photo id, never from `Math.random()`, so a
   page looks the same every time it is opened and a re-render never reshuffles
   the pictures.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import type { CaptureState } from '../capture/types.ts';
import { t } from '../../../core/i18n.ts';
import { escHtml, entryImages, moodEmoji, MOODS, MAX_JOURNAL_IMAGES, OTHER_DESTINATION, prettyDate, titleFor } from '../shared/utils.ts';
import { hashId } from './feed-plan.ts';
import { renderFastener } from '../../../core/paper/fastener.ts';
import '../../../core/paper/fastener.css';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** How far a taped-down photo leans, in degrees — small, alternating, and stable per photo. */
export function photoLean(key: string, index: number): number {
  const h = hashId(`${key}:${index}`);
  const size = 1.2 + (h % 180) / 100;          // 1.2° – 3.0°
  return index % 2 === 0 ? -size : size;
}

/** The date as a rubber stamp prints it: day, month, year on three lines. */
export function stampParts(iso: string): { day: string; month: string; year: string } {
  const [y, m, d] = iso.split('-');
  const mi = Number(m) - 1;
  return { day: d ?? '', month: mi >= 0 && mi < 12 ? MONTHS[mi] : (m ?? ''), year: y ?? '' };
}

/* ── The furniture of the left page ──────────────────────────────────────── */

/** The date, inked on with a rubber stamp. In the composer it is the date control. */
function dateStamp(iso: string, editable: boolean): string {
  const { day, month, year } = stampParts(iso);
  const face = `
    <span class="jsp-stamp-day">${escHtml(day)}</span>
    <span class="jsp-stamp-month">${escHtml(month)}</span>
    <span class="jsp-stamp-year">${escHtml(year)}</span>`;
  if (!editable) return `<div class="jsp-stamp" aria-label="${escHtml(prettyDate(iso))}">${face}</div>`;
  return `
    <label class="jsp-stamp is-editable">
      ${face}
      <input class="jsp-stamp-input" type="date" id="journal-date" value="${escHtml(iso)}" aria-label="${escHtml(t('journal.date'))}">
    </label>`;
}

/** The city, struck on as a postmark ring. */
function postmark(place: string, iso: string): string {
  const { day, month } = stampParts(iso);
  const text = place.trim();
  if (!text) return '';
  return `
    <div class="jsp-postmark" aria-hidden="true">
      <span class="jsp-postmark-city">${escHtml(text.toUpperCase().slice(0, 14))}</span>
      <span class="jsp-postmark-date">${escHtml(`${day} ${month}`)}</span>
    </div>`;
}

/** One photo, taped to the page as a polaroid. */
function polaroid(src: string, key: string, index: number, caption = ''): string {
  return `
    <figure class="jsp-photo" style="--lean:${photoLean(key, index)}deg">
      ${renderFastener(index % 3 === 1 ? 'pin' : 'tape', { at: 0.3 + ((hashId(`${key}${index}`) % 40) / 100) })}
      <img src="${escHtml(src)}" alt="${escHtml(caption)}" loading="lazy" draggable="false">
    </figure>`;
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

export interface ReadSpreadOpts {
  entry: StoredJournalEntry;
  albums: StoredJournalAlbum[];
  /** Entry ids either side of this one, for the page arrows. */
  prevId: string | null;
  nextId: string | null;
  /** Which way the last turn went, so the page animates from the right edge. */
  dir: '' | 'next' | 'prev';
}

export function renderReadSpread(o: ReadSpreadOpts, albumsMarkup: string): string {
  const { entry } = o;
  const photos = entryImages(entry).slice(0, MAX_JOURNAL_IMAGES);
  const mood = moodEmoji(entry.mood);
  const isPublic = entry.visibility === 'public';

  return `
    <article class="jsp jsp--read${o.dir ? ` is-turning-${o.dir}` : ''}" data-journal-spread>
      <div class="jsp-book">
        <section class="jsp-page jsp-page--left">
          <div class="jsp-day">
            ${dateStamp(entry.happenedOn, false)}
            ${postmark(entry.destination, entry.happenedOn)}
            ${mood ? `<span class="jsp-mood" title="${escHtml(entry.mood ?? '')}">${mood}</span>` : ''}
          </div>
          <div class="jsp-photos${photos.length > 1 ? ' is-many' : ''}">
            ${photos.length
              ? photos.map((src, i) => polaroid(src, entry.id, i, titleFor(entry))).join('')
              : `<p class="jsp-nophoto">${escHtml(t('journal.noPhotos'))}</p>`}
          </div>
        </section>

        <section class="jsp-page jsp-page--right">
          <div class="jsp-written">
            ${entry.title.trim() ? `<h2 class="jsp-title">${escHtml(titleFor(entry))}</h2>` : ''}
            ${entry.body.trim() ? `<div class="jsp-text">${escHtml(entry.body)}</div>` : ''}
          </div>
          <div class="jsp-foot">
            ${entry.tags.length ? `<div class="jsp-tags">${entry.tags.map((tag) => `<span class="journal-tag">#${escHtml(tag)}</span>`).join('')}</div>` : ''}
            ${albumsMarkup}
          </div>
        </section>
      </div>

      <div class="jsp-bar">
        <button class="jsp-turn" data-spread-prev="${escHtml(o.prevId ?? '')}" type="button" ${o.prevId ? '' : 'disabled'} aria-label="${escHtml(t('journal.prevEntry'))}">‹</button>
        <div class="jsp-tools">
          <button class="journal-reader-pill" data-open-reader-edit="${escHtml(entry.id)}" type="button">✎ ${escHtml(t('journal.editAction'))}</button>
          <button class="journal-reader-pill" data-card-entry="${escHtml(entry.id)}" type="button">🖼 ${escHtml(t('journal.card'))}</button>
          <button class="journal-reader-pill ${isPublic ? 'is-on' : ''}" data-share-entry="${escHtml(entry.id)}" type="button">↗ ${escHtml(t('journal.share'))}</button>
          <button class="journal-reader-pill ${entry.favorite ? 'is-on' : ''}" data-favorite-entry="${escHtml(entry.id)}" type="button">📌 ${escHtml(t('journal.pin'))}</button>
          <button class="journal-reader-pill is-danger" data-delete-entry="${escHtml(entry.id)}" type="button">✕ ${escHtml(t('journal.delete'))}</button>
        </div>
        <button class="jsp-turn" data-spread-next="${escHtml(o.nextId ?? '')}" type="button" ${o.nextId ? '' : 'disabled'} aria-label="${escHtml(t('journal.nextEntry'))}">›</button>
      </div>

      <button class="journal-icon-btn jsp-close" data-reader-close type="button" title="${escHtml(t('journal.close'))}">✕</button>
    </article>`;
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

export interface WriteSpreadOpts {
  state: CaptureState;
  /** Cities from the itinerary, offered as the place. */
  cities: string[];
  /** Places written about before, for the free-text list. */
  destinations: string[];
  /** The guide-place picker and any other optional fields, already drawn. */
  extras: string;
}

export function renderWriteSpread(o: WriteSpreadOpts): string {
  const { state } = o;
  const d = state.draft;
  const place = d.destination.trim();
  const isCustom = place !== '' && !o.cities.includes(place);
  const full = d.images.length >= MAX_JOURNAL_IMAGES;

  return `
    <article class="jsp jsp--write" data-journal-spread>
      <div class="jsp-book">
        <section class="jsp-page jsp-page--left">
          <div class="jsp-day">
            ${dateStamp(d.happenedOn, true)}
            <div class="jsp-place">
              ${o.cities.length ? `
                <select class="jsp-place-select" id="journal-destination-select" aria-label="${escHtml(t('journal.whereWereYou'))}">
                  ${o.cities.map((c) => `<option value="${escHtml(c)}" ${!isCustom && c === place ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
                  <option value="${OTHER_DESTINATION}" ${isCustom ? 'selected' : ''}>${escHtml(t('journal.otherPlace'))}</option>
                </select>` : ''}
              <input class="jsp-place-input" id="journal-destination" list="journal-dest-list"
                placeholder="${escHtml(t('journal.whereWereYou'))}" value="${escHtml(d.destination)}"
                ${o.cities.length && !isCustom ? 'hidden' : ''}>
              <datalist id="journal-dest-list">
                ${o.destinations.map((x) => `<option value="${escHtml(x)}"></option>`).join('')}
              </datalist>
            </div>
          </div>

          <div class="jsp-stickers" role="group" aria-label="${escHtml(t('journal.mood'))}">
            ${MOODS.map((m) => `
              <label class="jsp-sticker ${d.mood === m.value ? 'is-on' : ''}" title="${escHtml(m.value)}">
                <input type="radio" name="journal-mood" value="${escHtml(m.value)}" ${d.mood === m.value ? 'checked' : ''}>
                <span aria-hidden="true">${m.emoji}</span>
              </label>`).join('')}
          </div>

          <div class="jsp-photos is-tray${d.images.length > 1 ? ' is-many' : ''}">
            ${d.images.map((src, i) => `
              <figure class="jsp-photo" style="--lean:${photoLean('draft', i)}deg">
                ${renderFastener(i % 3 === 1 ? 'pin' : 'tape', { at: 0.3 + (i * 7) / 100 })}
                <img src="${escHtml(src)}" alt="" draggable="false">
                <button class="jsp-photo-x" data-remove-image="${i}" type="button" aria-label="${escHtml(t('journal.removePhoto'))}">✕</button>
              </figure>`).join('')}
            ${full ? '' : `
              <label class="jsp-add" for="journal-image-input">
                <span class="jsp-add-plus" aria-hidden="true">+</span>
                <span class="jsp-add-label">${escHtml(t('journal.addPhoto'))}</span>
              </label>`}
            <input class="jsp-file" type="file" id="journal-image-input" accept="image/*" multiple>
            ${d.uploading ? `<span class="jsp-uploading">${escHtml(t('journal.uploading'))}</span>` : ''}
          </div>
        </section>

        <section class="jsp-page jsp-page--right">
          <input class="jsp-title-input" id="journal-title" maxlength="80"
            placeholder="${escHtml(t('journal.titlePlaceholder'))}" value="${escHtml(d.title)}">
          <textarea class="jsp-text-input" id="journal-body"
            placeholder="${escHtml(t('journal.bodyPlaceholder'))}">${escHtml(d.body)}</textarea>

          <details class="jsp-note" ${state.moreOpen ? 'open' : ''} data-journal-more>
            <summary class="jsp-note-tab">${escHtml(t('journal.moreFields'))}</summary>
            <div class="jsp-note-body">
              <input class="input" id="journal-tags" placeholder="${escHtml(t('journal.tagsPlaceholder'))}" value="${escHtml(d.tagsText)}">
              ${o.extras}
            </div>
          </details>
        </section>
      </div>

      <div class="jsp-bar">
        <span class="jsp-bar-hint">${escHtml(t(state.editingId ? 'journal.edit' : 'journal.new'))}</span>
        <div class="jsp-tools">
          <button class="btn btn-ghost" data-journal-cancel type="button">${escHtml(t('journal.cancel'))}</button>
          <button class="btn btn-primary" data-journal-save type="button">${escHtml(t('journal.save'))}</button>
        </div>
      </div>

      <button class="journal-icon-btn jsp-close" data-journal-close type="button" title="${escHtml(t('journal.close'))}">✕</button>
    </article>`;
}
