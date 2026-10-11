/* ==========================================================================
   On the Road · Dashboard — city page drawer
   --------------------------------------------------------------------------
   Opened from the city name in the banner. A bare drawer: the same cover as the stop's
   Itinerary list card (its photo — or the tinted flag) runs edge to edge from the top,
   the ✕ floating on it, then the city and dates, then the Plan
   in the Itinerary's Feed view, drawn by the Itinerary's own renderer so it looks
   the same and ticking an item writes the same field. Nothing else: the stays and
   transport have their own drawers and notes stay on the page.
   (The Itinerary view is a full page with its own editors and state, so it is not
   mounted inside a drawer; its pure card renderers are.)
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { navigateTo } from '../../core/app.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { legCoverArt, nightsLabel } from '../itinerary/itinerary-cards.ts';
import { renderPlanFeedView } from '../itinerary/itinerary-plan-views.ts';
import { daysBetween, fmtDate } from '../itinerary/itinerary-utils.ts';
import { loadItineraryStyles } from './banner-drawers.ts';

export async function openCityDrawer(legIn: StoredLeg, _todayIso: string, trigger: HTMLElement | null): Promise<void> {
  await loadItineraryStyles();
  const latest = (): StoredLeg => routeStore.peek().find((l) => l.id === legIn.id) ?? legIn;

  const body = (): string => {
    const leg = latest();
    const nights = Math.max(0, daysBetween(leg.dateFrom, leg.dateTo));
    return `
      <div class="td-itn td-itn-city">
        <div class="route-leg-cover td-itn-city-cover">${legCoverArt(leg as never, 'route-leg-cover', true)}</div>
        <header class="td-itn-city-head">
          <div class="td-itn-city-kicker">${leg.flag || ''} ${esc(leg.country)}</div>
          <h2 class="td-itn-city-name">${esc(leg.city)}</h2>
          <div class="td-itn-city-dates">${esc(fmtDate(leg.dateFrom))} → ${esc(fmtDate(leg.dateTo))} · ${esc(nightsLabel(nights))}</div>
        </header>
        <div class="td-itn-city-plan">
          <h3 class="td-dh">${esc(t('dash.city.plan'))}</h3>
          ${renderPlanFeedView(leg as never)}
        </div>
      </div>`;
  };

  const d = openDrawer({
    title: `${legIn.flag} ${legIn.city}`.trim(),
    body: body(),
    footer: `<button type="button" class="btn btn-ghost" data-d-open>${esc(t('dash.banner.openItinerary'))}</button>`,
    className: 'td-itn-drawer',
    bare: true,
    returnFocus: trigger,
  });
  d.root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const tick = target.closest<HTMLElement>('[data-act="toggle-plan"]');
    if (tick) {
      const leg = latest();
      const plans = (leg.plans ?? []).map((p) => (p.id === tick.dataset.plan ? { ...p, done: !p.done } : p));
      void routeStore.update(leg.id, { plans }).then(() => d.setBody(body()));
      return;
    }
    if (target.closest('[data-act="open-plan"]')) { closeDrawer(); navigateTo('route', { legId: legIn.id }); }
  });
  d.root.querySelector('[data-d-open]')?.addEventListener('click', () => { closeDrawer(); navigateTo('route', { legId: legIn.id }); });
}
