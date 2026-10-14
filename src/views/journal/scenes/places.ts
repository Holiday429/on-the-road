/* ==========================================================================
   On the Road · Journal places — markup
   --------------------------------------------------------------------------
   Where you have been, read top to bottom: the countries strung along one line
   in the order you reached them; below it the page splits — the route map on the
   left (drawn by places-map.ts), the chosen country's entries on the right, with
   the small places written about inside that country as chips above them.
   Picking a country, a place or a pin is the same action.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { escHtml, entryCover, excerpt, prettyDate, titleFor, moodEmoji } from '../shared/utils.ts';
import { todayIso } from '../../../data/trip-phase.ts';
import { byCountry, countryKey, countryName, flagOf, mapPins, resolveChosen, routeNodes, NO_PLACE, type LegLike, type PlaceStop } from './places-model.ts';
import { stampDate } from './feed.ts';

function span(from: string, to: string): string {
  return from === to ? prettyDate(from) : `${prettyDate(from)} → ${prettyDate(to)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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

export function renderPlaces(stops: PlaceStop[], legs: LegLike[], selectedKey: string | null, flip: boolean, empty: string): string {
  if (!stops.length) return empty;
  const groups = byCountry(stops);
  const chosen = resolveChosen(groups, stops, selectedKey);
  const { group } = chosen;
  const { pins } = mapPins(stops);
  const route = routeNodes(legs, todayIso());
  const total = stops.reduce((n, s) => n + s.entries.length, 0);
  const placed = groups.filter((g) => g.iso).length;
  const name = group.iso ? countryName(group.iso) : 'Elsewhere';
  const model = { route, pins, isos: groups.map((g) => g.iso).filter(Boolean), iso: group.iso, key: chosen.key };

  const line = groups.map((g) => {
    const on = g.iso === group.iso;
    return `
      <li class="jp-item">
        <button class="jp-stop${on ? ' is-selected' : ''}" data-place-pick="${escHtml(countryKey(g.iso))}" aria-pressed="${on}" type="button">
          <span class="jp-dot" aria-hidden="true">${flagOf(g.iso || null)}</span>
          <span class="jp-stop-name">${escHtml(g.iso ? countryName(g.iso) : 'Elsewhere')}</span>
          <span class="jp-stop-meta">${plural(g.entries, 'entry', 'entries')}</span>
        </button>
      </li>`;
  }).join('');

  // the small places of the chosen country — only worth a row when there is more than one
  const chips = group.stops.length > 1 ? `
    <div class="jp-cities" role="group" aria-label="Places in ${escHtml(name)}">
      <button class="jp-city${chosen.stop ? '' : ' is-selected'}" data-place-pick="${escHtml(countryKey(group.iso))}" aria-pressed="${!chosen.stop}" type="button">All<span class="jp-city-n">${group.entries}</span></button>
      ${group.stops.map((s) => `
        <button class="jp-city${s.key === chosen.key ? ' is-selected' : ''}" data-place-pick="${escHtml(s.key)}" aria-pressed="${s.key === chosen.key}" type="button">
          ${escHtml(s.label)}<span class="jp-city-n">${s.entries.length}</span>
        </button>`).join('')}
    </div>` : '';

  const title = chosen.stop ? chosen.stop.label : name;
  const sub = chosen.stop ? span(chosen.stop.from, chosen.stop.to) : span(group.from, group.to);
  const filterLabel = chosen.stop && chosen.stop.label !== NO_PLACE ? chosen.stop.label : '';

  return `
    <div class="jp">
      <nav class="jp-line" aria-label="Countries, in the order you reached them">
        <ol class="jp-track">${line}</ol>
      </nav>

      <div class="jp-split">
        <section class="jp-stage" aria-label="Map of your route">
          <div class="jp-map" data-places-map data-morph-keep data-model="${escHtml(JSON.stringify(model))}"></div>
          <div class="jp-hud">
            <span><b>${placed || groups.length}</b> ${(placed || groups.length) === 1 ? 'country' : 'countries'} · <b>${stops.length}</b> ${stops.length === 1 ? 'place' : 'places'} · <b>${total}</b> ${total === 1 ? 'entry' : 'entries'}</span>
            <button class="jp-link" data-open-map-view type="button">Open the route map →</button>
          </div>
        </section>

        <section class="jp-pile ${flip ? 'is-a' : 'is-b'}" aria-live="polite">
          <header class="jp-pile-head">
            <span class="jp-pile-flag" aria-hidden="true">${flagOf(group.iso || null)}</span>
            <div class="jp-pile-title">
              <h3>${escHtml(title)}</h3>
              <span>${escHtml(chosen.stop && group.iso ? `${name} · ` : '')}${escHtml(sub)} · ${plural(chosen.entries.length, 'entry', 'entries')}</span>
            </div>
            ${filterLabel ? `<button class="jp-link" data-place-filter="${escHtml(filterLabel)}" type="button">Read them in the feed →</button>` : ''}
          </header>
          ${chips}
          <div class="jp-cards">${chosen.entries.map(card).join('')}</div>
        </section>
      </div>
    </div>`;
}
