/* ==========================================================================
   On the Road · Journal feed — markup
   --------------------------------------------------------------------------
   Draws the blocks planned by feed-plan.ts. Every block is a paper object the
   entry actually resembles: a cover story, a postcard with a postmark, a
   polaroid with a hand-written caption, a pull-quote, a ticket stub. Place and
   day live on the blocks as labels — there are no section breaks between them.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { escHtml, entryImages, excerpt, moodEmoji, titleFor } from '../shared/utils.ts';
import { planFeed, hashId, type FeedBlock } from './feed-plan.ts';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "03 JUN" — the way a postmark or ticket prints a date. */
export function stampDate(iso: string): string {
  const [, m, d] = iso.split('-');
  const mi = Number(m) - 1;
  return mi >= 0 && mi < 12 ? `${d} ${MONTHS[mi]}` : iso;
}

function whereOf(e: StoredJournalEntry): string {
  return e.destination.trim();
}

function badges(e: StoredJournalEntry, photos: number): string {
  return `${photos > 1 ? `<span class="jf-count" title="${photos} photos">▦ ${photos}</span>` : ''}${e.favorite ? '<span class="jf-pin" title="Pinned">📌</span>' : ''}`;
}

function photoBlock(b: FeedBlock): string {
  const e = b.entry;
  const photos = entryImages(e);
  const title = titleFor(e);
  const where = whereOf(e);
  const img = `<img class="jf-img" src="${escHtml(photos[0])}" alt="${escHtml(title)}" loading="lazy" draggable="false">`;

  if (b.variant === 'cover') {
    return `
      <div class="jf-photo">${img}</div>
      <div class="jf-cap">
        <span class="jf-kicker">${escHtml(stampDate(e.happenedOn))}${where ? ` · ${escHtml(where)}` : ''}</span>
        <h3 class="jf-title">${escHtml(title)}</h3>
        ${e.body.trim() ? `<p class="jf-excerpt">${escHtml(excerpt(e.body, 140))}</p>` : ''}
      </div>
      ${badges(e, photos.length)}`;
  }
  if (b.variant === 'postcard') {
    return `
      <div class="jf-photo">${img}</div>
      <div class="jf-postmark" aria-hidden="true"><span>${escHtml((where || 'ON THE ROAD').toUpperCase().slice(0, 12))}</span><span>${escHtml(stampDate(e.happenedOn))}</span></div>
      <div class="jf-strip">
        <h3 class="jf-title">${escHtml(title)}</h3>
        ${where ? `<span class="jf-where">📍 ${escHtml(where)}</span>` : ''}
      </div>
      ${badges(e, photos.length)}`;
  }
  // polaroid
  return `
    <span class="jf-tape" aria-hidden="true"></span>
    <div class="jf-photo">${img}</div>
    <div class="jf-strip">
      <h3 class="jf-title jf-hand">${escHtml(title)}</h3>
      <span class="jf-meta">${escHtml(stampDate(e.happenedOn))}${where ? ` · ${escHtml(where)}` : ''}</span>
    </div>
    ${badges(e, photos.length)}`;
}

function textBlock(b: FeedBlock): string {
  const e = b.entry;
  const where = whereOf(e);
  const hasTitle = e.title.trim().length > 0;
  const mood = moodEmoji(e.mood);
  if (b.variant === 'quote') {
    return `
      <span class="jf-quote-mark" aria-hidden="true">“</span>
      <p class="jf-quote-text">${escHtml(hasTitle ? e.title : excerpt(e.body, 150))}</p>
      ${hasTitle && e.body.trim() ? `<p class="jf-excerpt">${escHtml(excerpt(e.body, 120))}</p>` : ''}
      <footer class="jf-meta">${mood ? `${mood} ` : ''}${escHtml(stampDate(e.happenedOn))}${where ? ` · ${escHtml(where)}` : ''}</footer>
      ${badges(e, 0)}`;
  }
  // ticket
  const serial = `№ ${String(1000 + (hashId(e.id) % 9000))}`;
  return `
    <div class="jf-ticket-main">
      <span class="jf-kicker">${escHtml(stampDate(e.happenedOn))}${where ? ` · ${escHtml(where)}` : ''}</span>
      <p class="jf-ticket-text">${escHtml(hasTitle ? e.title : excerpt(e.body, 90))}</p>
      ${mood ? `<span class="jf-mood">${mood}</span>` : ''}
    </div>
    <div class="jf-ticket-stub" aria-hidden="true"><span>${escHtml(serial)}</span></div>
    ${badges(e, 0)}`;
}

export function renderBlock(b: FeedBlock, readingId: string | null): string {
  const open = b.entry.id === readingId;
  return `<article class="jf-block jf-block--${b.kind} jf-v-${b.variant}${open ? ' is-open' : ''}" style="--tilt:${b.tilt}deg;grid-column:span ${b.cols};grid-row:span ${b.rows}" data-open-entry="${escHtml(b.entry.id)}" role="button" tabindex="0">${b.hasPhoto ? photoBlock(b) : textBlock(b)}</article>`;
}

/** The whole feed: an editorial grid of planned blocks (see feed-plan.ts). */
export function renderFeedGrid(entries: StoredJournalEntry[], readingId: string | null): string {
  return `<div class="jf-wrap"><div class="jf-grid">${planFeed(entries).map((b) => renderBlock(b, readingId)).join('')}</div></div>`;
}
