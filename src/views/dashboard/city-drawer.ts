/* ==========================================================================
   On the Road · Dashboard — city page drawer
   --------------------------------------------------------------------------
   Opened from the city name in the banner. The Itinerary's cover hero for the stop
   (its photo — or the tinted flag — with the city and dates over it), then the Plan
   in the Itinerary's Feed view, drawn by the Itinerary's own renderer so it looks
   the same and ticking an item writes the same field. Nothing else: the stays and
   transport have their own drawers and notes stay on the page.
   (The Itinerary view is a full page with its own editors and state, so it is not
   mounted inside a drawer; its pure card renderers are.)
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { navigateTo } from '../../core/app.ts';
import { escHtml as esc, safeUrl } from '../../core/utils.ts';
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
    const hasCover = !!safeUrl(leg.coverImageUrl);
    return `
      <div class="td-itn td-itn-city">
        <header class="rd-hero ${hasCover ? 'has-cover' : ''}">
          ${legCoverArt(leg as never, 'rd-hero', true)}
          <div class="rd-hero-shade"></div>
          <div class="rd-hero-content">
            <div class="rd-hero-kicker"><span>${leg.flag || ''} ${esc(leg.country)}</span></div>
            <h2 class="rd-hero-city">${esc(leg.city)}</h2>
            <div class="rd-hero-dates"><span>${esc(fmtDate(leg.dateFrom))} → ${esc(fmtDate(leg.dateTo))} · ${esc(nightsLabel(nights))}</span></div>
          </div>
        </header>
        <h3 class="td-dh">${esc(t('dash.city.plan'))}</h3>
        ${renderPlanFeedView(leg as never)}
      </div>`;
  };

  const d = openDrawer({
    title: `${legIn.flag} ${legIn.city}`.trim(),
    body: body(),
    footer: `<button type="button" class="btn btn-ghost" data-d-open>${esc(t('dash.banner.openItinerary'))}</button>`,
    className: 'td-itn-drawer',
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
