/* ==========================================================================
   On the Road · Dashboard — Where to go
   --------------------------------------------------------------------------
   The bottom strip: tabs (All / Sights / Food / Coffee / Work), a
   horizontally scrolling rail of cards for the city of the day being shown, and
   a + on each card that drops the place onto that day. The Work tab is the
   traveller's own work-friendly spots — what used to be a separate Nomad bar.

   Not drawn at all when no city on the trip has anything to recommend, so the
   cards above sit flush against the bottom of the page.
   ========================================================================== */

import type { StoredLeg } from '../../data/stores/route-store.ts';
import type { StoredCityIntel } from '../../data/stores/city-store.ts';
import type { StoredNomadSpot } from '../../data/stores/nomad-store.ts';
import { legForDate } from '../../data/plan-days.ts';
import { tripHasRecommendations, wtgCards, WTG_TABS, type WtgCard, type WtgTab } from '../../data/whereto-model.ts';
import { escHtml as esc, safeUrl } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';

import { WIDGET_ICON } from '../../core/icons.ts';
const TINTS = ['#f4e7bf', '#dbe7f1', '#dcebe3', '#e8dcef', '#f2dcdd', '#f3dfcf'];
const TYPE_EMOJI: Record<string, string> = { attraction: '🏛️', experience: '✨', restaurant: '🍽️', cafe: '☕', work: '💼' };

let _tab: WtgTab = 'all';
let _scroll = 0;

/** New trip / re-init. */
export function resetWhereTo(): void { _tab = 'all'; _scroll = 0; }

export interface WhereToInput {
  legs: StoredLeg[];
  /** The day the dashboard is showing — picks the city. */
  iso: string;
  intel: StoredCityIntel[];
  spots: StoredNomadSpot[];
}

function renderCard(c: WtgCard, idx: number): string {
  const img = safeUrl(c.imageUrl);
  let media = '';
  if (c.type !== 'work') {
    media = img
      ? `<div class="td-whereto-photo" style="background-image:url('${img}')">
           ${c.photographer ? `<a class="td-whereto-photo-credit" href="${safeUrl(c.photographerUrl) || '#'}" target="_blank" rel="noopener">${esc(c.photographer)} / Unsplash</a>` : ''}
         </div>`
      : `<div class="td-whereto-tint" style="--wtg-tint:${TINTS[idx % TINTS.length]}"><span class="td-whereto-tint-emoji">${TYPE_EMOJI[c.type] ?? c.icon}</span></div>`;
  }
  const ratings = c.ratings?.length
    ? `<div class="td-nomad-ratings">${c.ratings.map(([e, v]) => `<span class="td-nomad-rating">${e} ${v}/5</span>`).join('')}</div>` : '';
  return `
    <div class="td-whereto-card wtg-card${c.type === 'work' ? ' wtg-card--work' : ''}">
      ${media}
      <div class="td-whereto-card-body">
        <div class="td-whereto-card-top">
          <span class="td-whereto-type-icon">${c.icon}</span>
          ${c.subtype ? `<span class="td-nomad-type">${esc(c.subtype)}</span>` : ''}
          <button type="button" class="td-whereto-add-btn" data-wtg-add="${esc(c.title)}" title="${esc(t('dash.whereto.add'))}" aria-label="${esc(t('dash.whereto.add'))}">+</button>
        </div>
        <div class="td-whereto-name">${esc(c.title)}</div>
        ${c.cost ? `<div class="td-whereto-cost">${esc(c.cost)}</div>` : ''}
        ${ratings}
        ${c.highlight ? `<div class="td-whereto-highlight">${esc(c.highlight)}</div>` : ''}
      </div>
    </div>`;
}

export function renderWhereTo(inp: WhereToInput): string {
  const cities = [...new Set(inp.legs.map((l) => l.city))];
  if (!tripHasRecommendations(cities, inp.intel, inp.spots)) return '';

  const leg = legForDate(inp.legs, inp.iso);
  if (!leg) return '';
  const cards = wtgCards(_tab, leg.city, inp.intel, inp.spots);
  const tab = (id: WtgTab) =>
    `<button type="button" class="ag-tab${_tab === id ? ' is-active' : ''}" data-wtg-tab="${id}" aria-pressed="${_tab === id}">${esc(t(`dash.whereto.tab.${id}`))}</button>`;

  const body = cards.length
    ? `<div class="wtg-rail">
         <button type="button" class="wtg-arrow" data-wtg-scroll="-1" aria-label="${esc(t('dash.whereto.prev'))}">‹</button>
         <div class="wtg-strip" data-wtg-strip>${cards.map(renderCard).join('')}</div>
         <button type="button" class="wtg-arrow" data-wtg-scroll="1" aria-label="${esc(t('dash.whereto.next'))}">›</button>
       </div>`
    : `<div class="td-whereto-empty">${esc(t(_tab === 'work' ? 'dash.whereto.emptyWork' : 'dash.whereto.empty', { city: leg.city }))}</div>`;

  return `
    <div class="td-widget td-w-whereto" data-widget-id="whereto">
      <div class="td-widget-header">
        <div class="td-widget-label">${WIDGET_ICON.whereto} ${esc(t('dash.widget.whereToGo'))} · ${esc(`${leg.flag} ${leg.city}`.trim())}</div>
        <div class="ag-tabs wtg-tabs">${WTG_TABS.map(tab).join('')}</div>
      </div>
      ${body}
    </div>`;
}

/** Tabs, arrows, and keeping the rail's scroll position across the dashboard's
 *  wholesale re-renders. `render` re-renders the whole dashboard. */
export function wireWhereTo(body: HTMLElement, render: () => void): void {
  body.querySelectorAll<HTMLElement>('[data-wtg-tab]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      _tab = b.dataset.wtgTab as WtgTab;
      _scroll = 0;
      render();
    });
  });
  const strip = body.querySelector<HTMLElement>('[data-wtg-strip]');
  if (!strip) return;
  strip.scrollLeft = _scroll;
  let raf = 0;
  strip.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; _scroll = strip.scrollLeft; });
  }, { passive: true });
  body.querySelectorAll<HTMLElement>('[data-wtg-scroll]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      strip.scrollBy({ left: Number(b.dataset.wtgScroll) * strip.clientWidth * 0.8, behavior: 'smooth' });
    });
  });
}
