/* ==========================================================================
   On the Road · Map page (Route)
   --------------------------------------------------------------------------
   `#map` is the route map of the CURRENT trip: stops, route, replay.
   The lifelong footprint — every country on every trip — is the Atlas
   (`#atlas`, views/atlas/), a page of its own beside the passport.

   Old links that asked this page for the world view (`mode: 'world'`, or an
   `iso`) are handed on to the Atlas, so every earlier entry point keeps working.
   ========================================================================== */

import './map.css';
import { renderViewTitleMarkup, consumeNavIntent, navigateTo } from '../../core/app.ts';
import { t, onLocaleChange } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { switchTrip, currentTripId, onTripChange } from '../../data/trip-context.ts';

let _inited = false;

function renderHeader(view: HTMLElement) {
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  view.querySelector('.view-header')!.innerHTML = `
    <div class="view-title">${renderViewTitleMarkup('map', t('map.title'))}</div>
    <div class="view-subtitle">${esc(t('map.subtitle'))}</div>`;
}

/**
 * Deep links — `navigateTo('map', { tripId, legId, mode, iso })`:
 *   mode 'world' or an iso → the Atlas (this page no longer draws the world)
 *   tripId                 → switch to that trip first
 *   legId                  → highlight that stop on the route
 */
async function applyIntent(): Promise<void> {
  const i = consumeNavIntent('map');
  if (!i) return;
  if (i.mode === 'world' || i.iso) {
    const { mode: _m, ...rest } = i;
    void navigateTo('atlas', rest);
    return;
  }
  if (i.tripId && i.tripId !== currentTripId()) await switchTrip(i.tripId);
  if (i.legId) (await import('./map.ts')).focusRouteLeg(i.legId);
}

export function initMap() {
  if (_inited) return; _inited = true;
  const view = document.getElementById('view-map'); if (!view) return;

  const body = view.querySelector('.stub-body');
  if (body) body.outerHTML = '<div class="map-route-host" id="mapRouteHost"></div>';
  renderHeader(view);

  void import('./map.ts').then((route) => {
    route.initRoute(view.querySelector<HTMLElement>('#mapRouteHost')!);
    // Fresh mounts read the intent now; an already-mounted page is told by app.ts.
    void applyIntent();
  });
  window.addEventListener('otr:nav-intent', (e) => {
    if ((e as CustomEvent).detail?.view === 'map') void applyIntent();
  });

  onTripChange(() => renderHeader(view));

  onLocaleChange(() => {
    renderHeader(view);
    void import('./map.ts').then((m) => m.refreshRouteText());
  });
}
