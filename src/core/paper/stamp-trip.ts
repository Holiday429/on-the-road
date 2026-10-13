/* ==========================================================================
   On the Road · Paper kit · trip-complete stamp
   --------------------------------------------------------------------------
   The full stop at the end of a trip: a double ring, "TRIP COMPLETE" over the
   top, the number of days in the middle, the trip's name along the bottom.
   It belongs to the trip's own page (Wrap), not to the passport — the
   passport only collects countries.
   ========================================================================== */

import { INK_FILTERS, ensureStampDefs, nextUid, stampDate, stampText } from './stamp-base.ts';
import { escHtml as esc } from '../utils.ts';
import { hashStr } from '../../data/palette.ts';

export interface TripStampSpec {
  name: string;
  startDate: string;
  endDate: string;
  days: number;
  /** Any CSS colour. */
  ink: string;
}

export function renderTripStamp(s: TripStampSpec, size = 150): string {
  ensureStampDefs();
  const id = nextUid();
  const seed = hashStr(`${s.name}${s.startDate}`);
  const filter = INK_FILTERS[seed % INK_FILTERS.length];
  const rot = (seed % 15) - 7;
  const name = stampText(s.name, 22);
  const range = `${stampDate(s.startDate)} – ${stampDate(s.endDate)}`;
  return `<span class="pp-stamp pp-trip" style="--ink-c:${esc(s.ink)};--rot:${rot}deg;--sz:${size}px" role="img" aria-label="${esc(`${s.name}: ${s.days}`)}">
    <svg viewBox="0 0 120 120" width="${size}" height="${size}" focusable="false" aria-hidden="true">
      <g filter="url(#${filter})">
        <circle cx="60" cy="60" r="55" class="pp-line pp-thick"/><circle cx="60" cy="60" r="51" class="pp-line"/>
        <path id="pp-tt-${id}" d="M 60 60 m -40 0 a 40 40 0 1 1 80 0" fill="none"/>
        <path id="pp-tb-${id}" d="M 16 62 a 44 44 0 0 0 88 0" fill="none"/>
        <text class="pp-t pp-name" font-size="9.5" letter-spacing="1.6"><textPath href="#pp-tt-${id}" startOffset="50%" text-anchor="middle">TRIP COMPLETE</textPath></text>
        <text x="60" y="63" class="pp-t pp-name" text-anchor="middle" font-size="22">${s.days}</text>
        <text x="60" y="73" class="pp-t pp-xs" text-anchor="middle" letter-spacing="1.4">${s.days === 1 ? 'DAY' : 'DAYS'}</text>
        <text x="60" y="85" class="pp-t pp-xs" text-anchor="middle" letter-spacing=".6">${esc(range)}</text>
        <text class="pp-t pp-name" font-size="8.5" letter-spacing="1"><textPath href="#pp-tb-${id}" startOffset="50%" text-anchor="middle">${esc(name)}</textPath></text>
      </g>
    </svg></span>`;
}
