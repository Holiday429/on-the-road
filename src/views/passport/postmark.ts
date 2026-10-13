/* ==========================================================================
   On the Road · Postmark markup for Itinerary cards and the stop hero
   --------------------------------------------------------------------------
   Transparent ink only (no paper scrap behind it). A mark plays the "pressed"
   thunk the first time it is seen on this device, then sits still.
   ========================================================================== */

import './passport-links.css';
import { renderStamp } from '../../core/paper/stamp.ts';
import { t } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { markStampsSeen, unseenStamps } from '../../data/stamp-seen.ts';
import type { CardPostmarks } from '../../data/card-postmarks.ts';

export interface PostmarkOpts {
  /** Arrival-stamp pixel size; the departure mark is a little smaller. */
  size: number;
  /** Id handed to the passport opener, so it can open on this stop. */
  openId: string;
  /** Over a photo: ink turns pale so it reads on the dark shade. */
  onPhoto?: boolean;
}

/** The arrival and/or departure mark of a stop as one overlapping pair ('' when neither has happened yet). */
export function postmarkPair(m: CardPostmarks | undefined, o: PostmarkOpts): string {
  if (!m || (!m.arrive && !m.depart)) return '';
  const fresh = new Set(unseenStamps([m.arrive?.id, m.depart?.id].filter((x): x is string => !!x)));
  const one = (s: NonNullable<CardPostmarks['arrive']>, size: number, cls: string) =>
    `<span class="pm-mark ${cls}">${renderStamp(s, { size, pressed: fresh.has(s.id) })}</span>`;
  const html = `<button type="button" class="pm-pair${o.onPhoto ? ' pm-on-photo' : ''}" data-open-passport="${esc(o.openId)}" title="${esc(t('passport.open'))}" aria-label="${esc(t('passport.open'))}">
    ${m.arrive ? one(m.arrive, o.size, 'pm-arrive') : ''}${m.depart ? one(m.depart, Math.round(o.size * 0.86), 'pm-depart') : ''}
  </button>`;
  markStampsSeen([...fresh]);
  return html;
}
