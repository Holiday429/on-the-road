/* ==========================================================================
   On the Road · Journal places — markup
   --------------------------------------------------------------------------
   One view for where you have been: a country map on top (drawn by
   places-map.ts), the places strung along a single line beneath it in the
   order you reached them, and under the line the entries of whichever stop you
   touch, fanned out like a hand of cards. Picking from the map, the line or a
   country is the same action.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { escHtml, entryCover, excerpt, prettyDate, titleFor, moodEmoji } from '../shared/utils.ts';
import { flagOf, mapPins, NO_PLACE, type PlaceStop } from './places-model.ts';
import { stampDate } from './feed.ts';

function span(s: PlaceStop): string {
  return s.from === s.to ? prettyDate(s.from) : `${prettyDate(s.from)} → ${prettyDate(s.to)}`;
}

function card(e: StoredJournalEntry, i: number): string {
  const cover = entryCover(e);
  const title = titleFor(e);
  return `
    <article class="jp-card${cover ? '' : ' is-text'}" style="--i:${i}" data-open-entry="${escHtml(e.id)}" role="button" tabindex="0">
      ${cover
        ? `<div class="jp-card-photo"><img src="${escHtml(cover)}" alt="" loading="lazy" draggable="false"></div>`
        : `<div class="jp-card-words">${moodEmoji(e.mood) ? `<span>${moodEmoji(e.mood)}</span>` : ''}<p>${escHtml(excerpt(e.body, 90))}</p></div>`}
      <div class="jp-card-cap"><span class="jp-card-title">${escHtml(title)}</span><span class="jp-card-date">${escHtml(stampDate(e.happenedOn))}</span></div>
    </article>`;
}

export function renderPlaces(stops: PlaceStop[], selectedKey: string | null, flip: boolean, empty: string): string {
  if (!stops.length) return empty;
  const chosen = stops.find((s) => s.key === selectedKey) ?? stops[stops.length - 1];
  const { pins, countries } = mapPins(stops);
  const total = stops.reduce((n, s) => n + s.entries.length, 0);

  const line = stops.map((s) => {
    const on = s.key === chosen.key;
    return `
      <li class="jp-item">
        <button class="jp-stop${on ? ' is-selected' : ''}" data-place-pick="${escHtml(s.key)}" aria-pressed="${on}" type="button">
          <span class="jp-dot" aria-hidden="true">${flagOf(s.iso)}</span>
          <span class="jp-stop-name">${escHtml(s.label)}</span>
          <span class="jp-stop-meta">${s.entries.length} ${s.entries.length === 1 ? 'entry' : 'entries'}</span>
        </button>
      </li>`;
  }).join('');

  return `
    <div class="jp">
      <section class="jp-stage" aria-label="Map of your places">
        <div class="jp-map" data-places-map data-morph-keep data-pins="${escHtml(JSON.stringify(pins))}" data-selected="${escHtml(chosen.key)}"></div>
        <div class="jp-hud">
          <span><b>${stops.length}</b> ${stops.length === 1 ? 'place' : 'places'}${countries.length ? ` · <b>${countries.length}</b> ${countries.length === 1 ? 'country' : 'countries'}` : ''} · <b>${total}</b> ${total === 1 ? 'entry' : 'entries'}</span>
          <button class="jp-link" data-open-map-view type="button">Open the route map →</button>
        </div>
      </section>

      <nav class="jp-line" aria-label="Places, in the order you reached them">
        <ol class="jp-track">${line}</ol>
      </nav>

      <section class="jp-pile ${flip ? 'is-a' : 'is-b'}" aria-live="polite">
        <header class="jp-pile-head">
          <span class="jp-pile-flag" aria-hidden="true">${flagOf(chosen.iso)}</span>
          <div class="jp-pile-title">
            <h3>${escHtml(chosen.label === NO_PLACE ? NO_PLACE : chosen.label)}</h3>
            <span>${escHtml(span(chosen))} · ${chosen.entries.length} ${chosen.entries.length === 1 ? 'entry' : 'entries'}</span>
          </div>
          ${chosen.label === NO_PLACE ? '' : `<button class="jp-link" data-place-filter="${escHtml(chosen.label)}" type="button">Read them in the feed →</button>`}
        </header>
        <div class="jp-cards">${chosen.entries.map(card).join('')}</div>
      </section>
    </div>`;
}
