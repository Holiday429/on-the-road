/* ==========================================================================
   On the Road · Map page
   --------------------------------------------------------------------------
   The page the "Map" nav item opens. Two views share it behind a small
   World | Route switch:

     World — every trip's footprint on an oval, rotatable world (world/)
     Route — one trip's route, replay and layers (map.ts)

   The page always opens on World. Route is built lazily, the first time it is
   shown (and with its own header-less host), so opening the map never pays for
   it. The page owns the header, the switch and the language refresh.
   ========================================================================== */

import './map.css';
import { renderViewTitleMarkup } from '../../core/app.ts';
import { t, onLocaleChange } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { switchTrip, currentTripId } from '../../data/trip-context.ts';
import { mountWorld, type WorldController } from './world/world.ts';

type Mode = 'world' | 'route';

let _inited = false;
let _mode: Mode = 'world';
let _view: HTMLElement | null = null;
let _world: WorldController | null = null;
let _routeLoaded = false;

function renderChrome(view: HTMLElement) {
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  view.querySelector('.view-header')!.innerHTML = `
    <div class="view-title">${renderViewTitleMarkup('map', t('map.title'))}</div>
    <div class="view-subtitle">${esc(t(_mode === 'world' ? 'world.subtitle' : 'map.subtitle'))}</div>`;
  const seg = view.querySelector('.map-modes');
  if (seg) {
    seg.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      const on = b.dataset.mode === _mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = t(b.dataset.mode === 'world' ? 'world.mode.world' : 'world.mode.route');
    });
  }
}

async function setMode(mode: Mode) {
  if (!_view) return;
  _mode = mode;
  _view.querySelector<HTMLElement>('#mapWorldHost')!.hidden = mode !== 'world';
  const routeHost = _view.querySelector<HTMLElement>('#mapRouteHost')!;
  routeHost.hidden = mode !== 'route';
  renderChrome(_view);
  if (mode !== 'route') return;
  const route = await import('./map.ts');
  if (!_routeLoaded) { _routeLoaded = true; route.initRoute(routeHost); }
  else route.routeShown();
}

/** Open Route — for another trip if asked (switching to it first). */
async function openRoute(tripId: string | null) {
  if (tripId && tripId !== currentTripId()) await switchTrip(tripId);
  await setMode('route');
}

export function initMap() {
  if (_inited) return; _inited = true;
  const view = document.getElementById('view-map'); if (!view) return;
  _view = view;

  const body = view.querySelector('.stub-body');
  if (body) body.outerHTML = `
    <div class="map-modes map-scope" role="group">
      <button class="map-scope-btn" data-mode="world"></button>
      <button class="map-scope-btn" data-mode="route"></button>
    </div>
    <div class="map-mode-host" id="mapWorldHost"></div>
    <div class="map-mode-host" id="mapRouteHost" hidden></div>`;
  view.querySelectorAll<HTMLButtonElement>('.map-modes [data-mode]').forEach((b) => {
    b.addEventListener('click', () => void setMode(b.dataset.mode as Mode));
  });
  renderChrome(view);

  _world = mountWorld(view.querySelector<HTMLElement>('#mapWorldHost')!, { openRoute: (id) => void openRoute(id) });

  onLocaleChange(() => {
    renderChrome(view);
    _world?.refreshText();
    if (_routeLoaded) void import('./map.ts').then((m) => m.refreshRouteText());
  });
}
