/* ==========================================================================
   On the Road · Journal places — markup
   --------------------------------------------------------------------------
   Where you have been, read top to bottom: the countries along the top as a row
   of flags, each holding its cities; below that the page splits — the country
   map on the left (drawn by places-map.ts), the chosen place's entries on the
   right. Picking a country, a city or a pin is the same action.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { escHtml, entryCover, excerpt, prettyDate, titleFor, moodEmoji } from '../shared/utils.ts';
import { byCountry, countryName, flagOf, mapPins, NO_PLACE, type PlaceStop } from './places-model.ts';
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

/** One country: its flag, its cities underneath as small buttons. */
function countryCard(iso: string, stops: PlaceStop[], entries: number, chosenKey: string): string {
  const here = stops.some((s) => s.key === chosenKey);
  const name = iso ? countryName(iso) : NO_PLACE;
  return `
    <article class="jp-country${here ? ' is-here' : ''}" data-country="${escHtml(iso)}">
      <button class="jp-country-head" data-place-pick="${escHtml(stops[0].key)}" type="button">
        <span class="jp-country-flag" aria-hidden="true">${flagOf(iso || null)}</span>
        <span class="jp-country-meta">
          <span class="jp-country-name">${escHtml(iso ? name : 'Elsewhere')}</span>
          <span class="jp-country-count">${stops.length} ${stops.length === 1 ? 'place' : 'places'} · ${entries} ${entries === 1 ? 'entry' : 'entries'}</span>
        </span>
      </button>
      <div class="jp-cities">
        ${stops.map((s) => `
          <button class="jp-city${s.key === chosenKey ? ' is-selected' : ''}" data-place-pick="${escHtml(s.key)}" aria-pressed="${s.key === chosenKey}" type="button">
            ${escHtml(s.label)}<span class="jp-city-n">${s.entries.length}</span>
          </button>`).join('')}
      </div>
    </article>`;
}

export function renderPlaces(stops: PlaceStop[], selectedKey: string | null, flip: boolean, empty: string): string {
  if (!stops.length) return empty;
  const chosen = stops.find((s) => s.key === selectedKey) ?? stops[stops.length - 1];
  const { pins, countries } = mapPins(stops);
  const groups = byCountry(stops);
  const total = stops.reduce((n, s) => n + s.entries.length, 0);

  return `
    <div class="jp">
      <nav class="jp-countries" aria-label="Countries, in the order you reached them">
        ${groups.map((g) => countryCard(g.iso, g.stops, g.entries, chosen.key)).join('')}
      </nav>

      <div class="jp-split">
        <section class="jp-stage" aria-label="Map of your places">
          <div class="jp-map" data-places-map data-morph-keep data-pins="${escHtml(JSON.stringify(pins))}" data-selected="${escHtml(chosen.key)}"></div>
          <div class="jp-hud">
            <span><b>${countries.length || groups.length}</b> ${(countries.length || groups.length) === 1 ? 'country' : 'countries'} · <b>${stops.length}</b> ${stops.length === 1 ? 'place' : 'places'} · <b>${total}</b> ${total === 1 ? 'entry' : 'entries'}</span>
            <button class="jp-link" data-open-map-view type="button">Open the route map →</button>
          </div>
        </section>

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
      </div>
    </div>`;
}
