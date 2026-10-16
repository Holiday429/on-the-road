/* ==========================================================================
   On the Road · Journal — one photo as a postcard
   --------------------------------------------------------------------------
   Every photo of an entry is its own postcard. Cards come in two sizes, wide and
   tall (letter-model's postcardFrame); a photo that is not exactly that shape is
   cropped to fill it — the whole photograph is one click away in the Gallery.
   Front: the photo in a white margin. Back (tap to turn it over): a divided
   card — the message on the left, the address side on the right with a stamp
   and a postmark, and "No. 2 / 4" for its place in the pile.

   Pure markup. Where the card sits (pile, row, or scattered on the desk) is
   styles/letter.css's job; this only hands it the numbers as custom properties.
   ========================================================================== */

import { t } from '../../../core/i18n.ts';
import { escHtml } from '../shared/utils.ts';
import { CARD_BORDER, stampParts, type PileCard } from '../shared/letter-model.ts';

export interface PostcardOpts {
  src: string;
  index: number;
  total: number;
  /** Where the pile puts it, and how it is shaped. */
  card: PileCard;
  /** Stacking order in the pile: the picked card is on top. */
  z: number;
  picked: boolean;
  flipped: boolean;
  /** Back of the card. */
  place: string;
  /** ISO date. */
  date: string;
  message: string;
  /** The stamp, already drawn (core/paper/stamp-country). */
  stamp: string;
}

/** The ring that says where and when it was posted. */
export function postmark(place: string, iso: string): string {
  const { day, month } = stampParts(iso);
  const text = place.trim();
  if (!text) return '';
  return `
    <span class="ltr-postmark" aria-hidden="true">
      <span class="ltr-postmark-city">${escHtml(text.toUpperCase().slice(0, 12))}</span>
      <span class="ltr-postmark-date">${escHtml(`${day} ${month}`)}</span>
    </span>`;
}

export function renderPostcard(o: PostcardOpts): string {
  const { card } = o;
  const style = [
    `--w:${card.w}px`, `--top:${card.top}px`, `--left:${card.left}px`, `--tilt:${card.tilt}deg`,
    `--ar:${card.frame.ratio}`, `--b:${CARD_BORDER}px`, `--z:${o.z}`,
  ].join(';');
  const label = t('journal.letter.postcard', { n: o.index + 1, total: o.total });
  return `
    <div class="ltr-pc${o.picked ? ' is-picked' : ''}${o.flipped ? ' is-flipped' : ''}" data-postcard="${o.index}"
         data-orient="${card.frame.orientation}" role="button" tabindex="0" aria-pressed="${o.flipped}" aria-label="${escHtml(label)}" style="${style}">
      <div class="ltr-pc-inner">
        <div class="ltr-pc-face ltr-pc-front">
          <img src="${escHtml(o.src)}" alt="${escHtml(o.message)}" loading="lazy" draggable="false">
        </div>
        <div class="ltr-pc-face ltr-pc-back" aria-hidden="${!o.flipped}">
          <span class="ltr-pc-no">No. ${o.index + 1} / ${o.total}</span>
          <div class="ltr-pc-msg">${escHtml(o.message)}</div>
          <div class="ltr-pc-addr">
            <span class="ltr-pc-stamp">${o.stamp}${postmark(o.place, o.date)}</span>
            <span class="ltr-pc-line">${escHtml(o.place)}</span>
            <span class="ltr-pc-line"></span>
            <span class="ltr-pc-line"></span>
          </div>
        </div>
      </div>
    </div>`;
}
