/* ==========================================================================
   On the Road · My Map (amCharts5)
   --------------------------------------------------------------------------
   Fully data-driven: plots whatever cities the itinerary contains (bundled
   coords + online geocoding fallback), lights the countries along the route,
   auto-fits the camera, and — when every stop is in one country — drills into
   that country's regions and animates city-to-city inside it.

   The outbound/return "home" flight is derived from the itinerary itself: the
   first leg's arrivalTransport tells us where the traveller came from, and its
   `via[]` carries any connecting-flight stopovers (联程). Nothing is hardcoded
   to a particular trip.
   ========================================================================== */

import './map.css';
import { EUROPE_CENTER } from '../../data/geo-index.ts';
import { plotStoredLegs, type StoredLegInput } from './map-plot.ts';
import { geocode } from './geocode.ts';
import { loadAmCharts, loadCountryGeodata, preloadDrilldownCountries, DRILLDOWN_COUNTRIES } from './amcharts-loader.ts';
import { createMapRoot, disposeRoot, motionMs, prefersReducedMotion } from './amcharts-boot.ts';
import { mapColors as C, countryColor, onMapRepaint } from './map-theme.ts';
import { drawRouteLines } from './route-layer.ts';
import { legVisitState } from './map-status.ts';
import { t, getLocale } from '../../core/i18n.ts';
import { todayIso } from '../../data/trip-phase.ts';
import {
  type GeoPt, chainWaypoints,
  expandBounds, geoDist, wrapMapLabel,
} from './map-geo.ts';
import {
  type PlottedLeg, type FlightChain, type CountryStop,
  summarizeRoute, buildCountryStops,
} from './map-stats.ts';
import { bindHeroOverlay, ensureHeroOverlay, HERO_SRC } from './hero-overlay.ts';
import { type Am5Obj, type MapChart, asMapChart } from './map-amcharts.ts';
import { routeStore } from '../../data/stores/route-store.ts';
import {
  onTripChange, currentTrip,
} from '../../data/trip-context.ts';
import { openTripChooser } from '../../core/trip-chooser.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { openCityActionSheet } from './map-city-sheet.ts';
import { openMapExport } from './map-export-sheet.ts';
import { wireRouteChrome, postmarkPin, repaintPostmarkPin } from './map-chrome.ts';
import {
  statsMarkup, flightRowMarkup, legListMarkup, unlocatedMarkup, stageInnerMarkup,
} from './map-panel.ts';
// Assets live in public/art/. Prefix with Vite's base URL so they resolve under
// any deploy base (e.g. /on-the-road/) instead of the site root.
const ART = `${import.meta.env.BASE_URL}art/`.replace(/\/{2,}/g, '/');
const PLANE_PNG = `${ART}plane.png`;

// PlottedLeg, FlightChain, CountryStop are defined in ./map-stats.ts (imported
// above) so the pure route-stats logic can be tested without this module.
interface OverlayItem {
  el: HTMLElement;
  lng: number;
  lat: number;
}

/* ── State ────────────────────────────────────────────────────────────────── */
let _initialized = false;
let _root:  Am5Obj = null;
let _chart: MapChart | null = null;
let _unsubLegs: (() => void) | null = null;
let _worldSeries: Am5Obj = null;
let _idleWorld: Am5Obj = null;   // the outline-only world of the empty state (recoloured on theme change)
const _polyById      = new Map<string, Am5Obj>();
const _dataItemById  = new Map<string, Am5Obj>();
const _lit         = new Set<string>();       // countries visited (full colour)
const _planned     = new Set<string>();       // countries only planned (dashed, faint)
const _painted     = new Set<string>();       // countries carrying an explicit fill (re-coloured on theme change)
let _drillSeries: Am5Obj = null;
let _drillCode:   string | null = null;
let _replayTimer:    number | null = null;
let _flightPanTimer: number | null = null;
let _paused = false;
let _playing = false;
let _legsRef: PlottedLeg[] = [];
let _outboundChain: FlightChain | null = null;
let _returnChain: FlightChain | null = null;
let _singleCountryIso: string | null = null;   // set when the whole trip is in one country
let _regionLabelOverlays: OverlayItem[] = [];
let _countryPinOverlays: OverlayItem[] = [];
let _activeMotionId: string | null = null;
let _buildToken = 0;   // guards against stale async builds after teardown/scope switch
let _idleChartToken = 0;   // guards against overlapping bootIdleChart() calls racing on the async amCharts load
let _bootChartAttempt = 0; // guards against overlapping buildAndBoot() calls racing to bootChart()
let _chartAbort: AbortController | null = null;   // listeners wired for the live chart; aborted on teardown
let _unlocated: Array<{ legId: string; place: string }> = [];   // stops geocoding could not place
let _repaintExtras: Array<() => void> = [];   // recolour hooks for the route lines / pins of the live chart

function setReplayBtnLabel(playing: boolean) {
  const btn = document.getElementById('mapReplay');
  if (btn) btn.textContent = playing ? t('map.pause') : t('map.replay');
}

/** Intl locale tag for the current UI language. */
const loc = () => getLocale();

/* ── Data ─────────────────────────────────────────────────────────────────── */
async function plotLegs(stored: StoredLegInput[]): Promise<PlottedLeg[]> {
  const r = await plotStoredLegs(stored);
  _unlocated = r.unlocated;
  return r.legs;
}

/**
 * Build the outbound home flight:
 *   origin →[via…]→ first leg's city.
 * Origin is the trip's `homeCity` when set; otherwise we fall back to the first
 * leg's arrivalTransport.from (legacy behaviour). `via[]` carries any connecting
 * stopovers. Returns null when there's no usable origin.
 */
async function buildOutboundChain(legs: PlottedLeg[], stored: StoredLegInput[]): Promise<FlightChain | null> {
  const firstStored = stored.find((s) => s.id === legs[0]?.id);
  const t = firstStored?.arrivalTransport;
  const origin = (currentTrip()?.homeCity ?? '').trim() || t?.from;
  if (!origin) return null;
  const names = [origin, ...(t?.via ?? [])];
  const pts: GeoPt[] = [];
  const labels: string[] = [];
  for (const name of names) {
    const hit = await geocode(name);
    if (!hit) continue;
    pts.push({ lat: hit.lat, lng: hit.lng });
    labels.push(name);
  }
  if (pts.length === 0) return null;
  const dest = legs[0];
  pts.push({ lat: dest.lat, lng: dest.lng });
  labels.push(dest.city);
  return {
    label: `${labels[0]} → ${dest.city}`,
    sub: labels.join(' · '),
    waypoints: chainWaypoints(pts),
  };
}

/**
 * Build the return home flight: last leg's city → returnCity (falling back to
 * homeCity). Explicit and user-controlled — never mirrors the outbound origin,
 * since people often fly home from a different city than they arrived in.
 * Returns null when neither returnCity nor homeCity is set.
 */
async function buildReturnChain(_outbound: FlightChain | null, legs: PlottedLeg[]): Promise<FlightChain | null> {
  const trip = currentTrip();
  const dest = ((trip?.returnCity ?? '').trim() || (trip?.homeCity ?? '').trim());
  if (!dest || legs.length === 0) return null;
  const hit = await geocode(dest);
  if (!hit) return null;
  const last = legs[legs.length - 1];
  const pts: GeoPt[] = [
    { lat: last.lat, lng: last.lng },
    { lat: hit.lat, lng: hit.lng },
  ];
  return {
    label: `${last.city} → ${dest}`,
    sub: `${last.city} · ${dest}`,
    waypoints: chainWaypoints(pts),
  };
}

function fitGeoBounds(bounds: { left: number; right: number; top: number; bottom: number }, duration = 700, ratio = 0.12) {
  if (!_chart) return false;
  try {
    _chart.zoomToGeoBounds(expandBounds(bounds, ratio), motionMs(duration));
    return true;
  } catch {
    return false;
  }
}

function overlayLayer(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function clearOverlayItems(items: OverlayItem[], layerId: string) {
  items.forEach(({ el }) => el.remove());
  items = [];
  const layer = overlayLayer(layerId);
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  if (layer) layer.innerHTML = '';
  return items;
}

function syncOverlayItems(items: OverlayItem[]) {
  if (!_chart) return;
  for (const item of items) {
    const px = _chart.convert({ longitude: item.lng, latitude: item.lat });
    if (!px) {
      item.el.style.opacity = '0';
      continue;
    }
    item.el.style.opacity = '1';
    item.el.style.left = `${px.x}px`;
    item.el.style.top = `${px.y}px`;
  }
}

function geoCentroid(geometry: Am5Obj) {
  try {
    const centroid = am5map.getGeoCentroid(geometry);
    if (centroid && Number.isFinite(centroid.longitude) && Number.isFinite(centroid.latitude)) return centroid;
  } catch {}
  try {
    const bounds = am5map.getGeoBounds(geometry);
    if (bounds) return { longitude: (bounds.left + bounds.right) / 2, latitude: (bounds.top + bounds.bottom) / 2 };
  } catch {}
  return { longitude: EUROPE_CENTER.longitude, latitude: EUROPE_CENTER.latitude };
}


function renderRegionLabels(series: Am5Obj, cityStops: CountryStop[] = []) {
  _regionLabelOverlays = clearOverlayItems(_regionLabelOverlays, 'mapRegionLabels');
  const layer = overlayLayer('mapRegionLabels');
  if (!layer) return;

  // A region label is suppressed when it sits on top of a city pin (the pin
  // already shows that place's name) or too close to another region label.
  const CITY_GAP = 0.9;     // degrees — hide region name near a city pin
  const LABEL_GAP = 1.1;    // degrees — minimum spacing between region labels
  const placed: { lng: number; lat: number }[] = [];

  series.dataItems.forEach((item: Am5Obj) => {
    const name = String(item.dataContext?.name ?? '').trim();
    if (!name) return;
    const centroid = geoCentroid(item.get('geometry') ?? item.dataContext?.geometry);
    const { longitude: lng, latitude: lat } = centroid;

    // Skip if a city pin already labels roughly this spot.
    if (cityStops.some(s => geoDist(lng, lat, s.lng, s.lat) < CITY_GAP)) return;
    // Skip if it would collide with an already-placed region label.
    if (placed.some(p => geoDist(lng, lat, p.lng, p.lat) < LABEL_GAP)) return;

    const el = document.createElement('div');
    el.className = 'map-region-label';
    el.textContent = wrapMapLabel(name);
    layer.appendChild(el);
    _regionLabelOverlays.push({ el, lng, lat });
    placed.push({ lng, lat });
  });
  syncOverlayItems(_regionLabelOverlays);
}

function renderCountryPins(stops: CountryStop[]) {
  _countryPinOverlays = clearOverlayItems(_countryPinOverlays, 'mapCountryPins');
  const layer = overlayLayer('mapCountryPins');
  if (!layer) return;
  for (const stop of stops) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'map-country-pin';

    const icon = document.createElement('span');
    icon.className = 'map-country-pin-icon';
    const core = document.createElement('span');
    core.className = 'map-country-pin-core';
    icon.appendChild(core);

    const label = document.createElement('span');
    label.className = 'map-country-pin-label';
    label.textContent = wrapMapLabel(stop.name, 10);

    el.append(icon, label);
    el.title = t('map.pin.cityActions', { city: stop.name });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openCityActionSheet(stop.name);
    });
    layer.appendChild(el);
    _countryPinOverlays.push({ el, lng: stop.lng, lat: stop.lat });
  }
  syncOverlayItems(_countryPinOverlays);
}

function clearDrillOverlays() {
  _regionLabelOverlays = clearOverlayItems(_regionLabelOverlays, 'mapRegionLabels');
  _countryPinOverlays = clearOverlayItems(_countryPinOverlays, 'mapCountryPins');
}

function zoomToCountryPoly(poly: Am5Obj) {
  const di = poly?.dataItem;
  if (!_worldSeries || !_chart || !di) return;
  // Jump straight to the country's bounds with no animation, so the detailed
  // (region-labelled) view appears instantly instead of flashing through zooms.
  try {
    const bounds = am5map.getGeoBounds(di.get('geometry'));
    if (bounds && Number.isFinite(bounds.left)) {
      fitGeoBounds(bounds, 0, 0.1);
      return;
    }
  } catch {}
  _chart.zoomToGeoPoint(geoCentroid(di.get('geometry')), 6.5, true, 0);
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */
/**
 * Mount the Route view into `host` (the page owns the header and the World ↔
 * Route switch). Called once, the first time the Route tab is opened.
 */
export function initRoute(host: HTMLElement) {
  if (_initialized) return; _initialized = true;
  // eslint-disable-next-line no-restricted-syntax -- audited: stageMarkup() escapes every interpolation (map-panel.ts)
  host.innerHTML = stageMarkup();

  // Subscribe to legs for the active scope. Re-runnable: on scope change or
  // trip switch we tear down the chart and re-subscribe so the route rebuilds.
  subscribeLegs(host);

  // Trip switch: re-subscribe under the new trip (unless viewing all trips).
  onTripChange(() => subscribeLegs(host));

  // Theme switch: recolour the live chart in place (a rebuild would lose the view).
  onMapRepaint(repaintChart);
  _host = host;
}

let _host: HTMLElement | null = null;

/** Re-apply translated text after a language switch (the chart is left alone). */
export function refreshRouteText() {
  const set = (id: string, text: string, title?: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (text) el.textContent = text;
    if (title) el.title = title;
  };
  setReplayBtnLabel(_playing);
  set('mapReplay', '', t('map.replayTitle'));
  set('mapExport', t('map.export'), t('map.exportTitle'));
  set('mapBack', t('map.back'), t('map.backTitle'));
  set('mapZoomIn', '', t('map.zoomIn'));
  set('mapZoomOut', '', t('map.zoomOut'));
  set('mapZoomFit', '', t('map.zoomFit'));
  if (_host && _chart && _legsRef.length > 0) renderPanel(_host, _legsRef);
}

let _pendingLeg: string | null = null;

/** Highlight a stop on the route and zoom to it — now, or as soon as the chart has it. */
export function focusRouteLeg(legId: string) {
  _pendingLeg = legId;
  applyPendingLeg();
}

function applyPendingLeg() {
  if (!_pendingLeg || !_chart) return;
  const leg = _legsRef.find((l) => l.id === _pendingLeg);
  if (!leg) return;
  _pendingLeg = null;
  focusLeg(leg.id);
  lightLeg(leg);
  _chart.zoomToGeoPoint?.({ longitude: leg.lng, latitude: leg.lat }, 6, true, motionMs(700));
}

function stageMarkup(): string {
  return `
    <div class="map-layout">
      <div class="map-main">
        <div class="map-stage">
          ${stageInnerMarkup()}
        </div>
      </div>
      <aside class="map-panel"></aside>
    </div>`;
}

/**
 * Dispose the amCharts root so the next leg snapshot reboots the chart, and
 * drop everything that belonged to it: listeners wired for it, timers, lit /
 * drilled state and overlays. Nothing may outlive the chart it describes.
 */
function teardownChart() {
  _chartAbort?.abort();
  _chartAbort = null;
  clearAllTimers();
  disposeRoot(_root);
  _root = null;
  _chart = null;
  _worldSeries = null;
  _drillSeries = null;
  _drillCode = null;
  _polyById.clear();
  _dataItemById.clear();
  _lit.clear();
  _planned.clear();
  _painted.clear();
  _idleWorld = null;
  _repaintExtras = [];
  _legsRef = [];
  _activeMotionId = null;
  _paused = false;
  if (_playing) { _playing = false; setReplayBtnLabel(false); }
  clearDrillOverlays();
}

/**
 * Render a minimal "outline only" world map into #mapChart — no fills, no
 * route, no pins. Used for the empty / setup state so the stage always shows
 * a real globe instead of a loading spinner.
 */
async function bootIdleChart() {
  if (_chart) return;
  const el = document.getElementById('mapChart');
  if (!el) return;
  const idleToken = _buildToken;
  // Claim this build synchronously (before the async gap below) so a second
  // overlapping call — e.g. two routeStore snapshots (cache, then server)
  // both landing on showEmpty()/showSetupPanel() while amCharts is still
  // loading — bails instead of racing to create two am5.Root instances on
  // the same DOM node.
  const myIdleAttempt = ++_idleChartToken;
  try {
    await loadAmCharts();
  } catch { return; }
  // Bail if legs arrived during the async load (buildAndBoot already took over),
  // or another bootIdleChart() call started after us and should win instead.
  if (_chart || idleToken !== _buildToken || myIdleAttempt !== _idleChartToken) return;
  // Also bail if the DOM element is gone (buildAndBoot replaced the stage HTML).
  if (!document.getElementById('mapChart')) return;
  // Defensive: dispose any root left behind by a losing bootChart()/bootIdleChart()
  // attempt from the same race — token checks above only guard against races
  // WITHIN one function, not between this and the other builder.
  teardownChart();

  const root = createMapRoot('mapChart', { animated: false });
  _root = root;

  const chart = root.container.children.push(am5map.MapChart.new(root, {
    projection: am5map.geoMercator(),
    panX: 'translateX', panY: 'translateY',
    wheelY: 'zoom', pinchZoom: true,
    zoomStep: 1.4, maxZoomLevel: 16, minZoomLevel: 0.8,
    wheelSensitivity: 0.6,
    homeGeoPoint: EUROPE_CENTER,
  }));
  _chart = chart;
  _worldSeries = null;

  const world = chart.series.push(am5map.MapPolygonSeries.new(root, {
    geoJSON: am5geodata_worldLow, exclude: ['AQ'],
  }));
  world.mapPolygons.template.setAll({
    interactive: false,
    fill: am5.color(C().miniLand),
    stroke: am5.color(C().miniStroke),
    strokeWidth: 0.7,
    nonScalingStroke: true,
  });
  _idleWorld = world;

  chart.appear(motionMs(600), motionMs(80));
  document.getElementById('mapLoading')?.remove();
}

function subscribeLegs(view: HTMLElement) {
  _unsubLegs?.();
  teardownChart();
  const token = ++_buildToken;
  _unsubLegs = routeStore.subscribe((storedLegs) => {
    if (token !== _buildToken) return;
    // Preserve the user's custom order within the trip.
    const stored = (storedLegs as unknown as StoredLegInput[]).slice().sort(
      (a, b) => (a.dateFrom ?? '').localeCompare(b.dateFrom ?? '') || (a.order ?? 0) - (b.order ?? 0),
    );

    // Chart already running with real legs — refresh the side panel.
    if (_chart && _legsRef.length > 0) {
      renderPanel(view, _legsRef);
      return;
    }

    // No legs for this trip yet — show the setup panel.
    if (stored.length === 0) {
      showSetupPanel(view, token);
      return;
    }

    // Plot asynchronously (geocoding may hit the network), then boot the chart.
    buildAndBoot(view, stored, token);
  });
}

function showEmpty(view: HTMLElement) {
  const panel = view.querySelector<HTMLElement>('.map-panel');
  if (panel) panel.replaceChildren();
  const stage = view.querySelector<HTMLElement>('.map-stage');
  if (!stage) return;
  if (!stage.querySelector('.map-idle-hint')) {
    teardownChart();
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
    stage.innerHTML = `
      <div id="mapChart" class="map-chart"></div>
      <div class="map-idle-hint">
        <span class="map-idle-hint-text">${t('map.idle.noFootprints', { link: `<a href="#route">${esc(t('nav.route'))}</a>` })}</span>
      </div>`;
    bootIdleChart();
  }
}

/** Show when the current trip has no legs: let user link a trip or add stops manually. */
async function showSetupPanel(view: HTMLElement, token: number) {
  const stage = view.querySelector<HTMLElement>('.map-stage');
  const panel = view.querySelector<HTMLElement>('.map-panel');
  if (!stage || !panel) return;

  // Stage: outline world map + hint banner overlay.
  if (!stage.querySelector('.map-idle-hint')) {
    teardownChart();
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
    stage.innerHTML = `
      <div id="mapChart" class="map-chart"></div>
      <div class="map-idle-hint">
        <span class="map-idle-hint-text">${esc(t('map.idle.noItinerary'))}</span>
      </div>`;
    bootIdleChart();
  }

  if (token !== _buildToken) return;

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  panel.innerHTML = `
    <div class="map-setup">
      <div class="map-setup-section">
        <button class="btn btn-primary map-setup-btn" id="mapLinkTrip">${esc(t('map.setup.link'))}</button>
      </div>
      <div class="map-setup-divider"><span>${esc(t('map.setup.or'))}</span></div>
      <div class="map-setup-section">
        <div class="map-setup-label">${esc(t('map.setup.manual'))}</div>
        <div class="map-setup-hint">${esc(t('map.setup.manualHint'))}</div>
        <button class="btn btn-ghost map-setup-btn" id="mapAddManual">${esc(t('map.setup.manualBtn'))}</button>
      </div>
    </div>`;

  document.getElementById('mapLinkTrip')?.addEventListener('click', () => {
    openTripChooser({ title: t('map.setup.link'), subtitle: t('map.setup.chooserSub') });
  });

  document.getElementById('mapAddManual')?.addEventListener('click', () => {
    import('../../core/app.ts').then(({ navigateTo }) => navigateTo('route'));
  });
}

async function buildAndBoot(view: HTMLElement, stored: StoredLegInput[], token: number) {
  // Claim this build attempt synchronously — routeStore can fire its callback
  // twice in quick succession (cached snapshot, then server-confirmed one)
  // with the SAME _buildToken, so token alone doesn't stop two buildAndBoot()
  // calls from both racing through the async geocode/chain-build pipeline
  // below and both reaching bootChart() before either sets _chart.
  const myAttempt = ++_bootChartAttempt;
  const stage = view.querySelector<HTMLElement>('.map-stage');
  // If we were showing an idle outline chart, tear it down and rebuild with full markup.
  if (stage?.querySelector('.map-empty, .map-setup-idle, .map-idle-hint')) {
    teardownChart();
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
    stage.innerHTML = stageInnerMarkup();
  }

  const legs = await plotLegs(stored);
  if (token !== _buildToken) return;   // scope/trip changed mid-geocode
  if (legs.length === 0) { showEmpty(view); return; }

  _outboundChain = await buildOutboundChain(legs, stored);
  if (token !== _buildToken) return;
  _returnChain   = await buildReturnChain(_outboundChain, legs);
  if (token !== _buildToken) return;

  // Single-country trip → we'll drill into its regions for the animation.
  const isos = new Set(legs.map((l) => l.iso).filter(Boolean) as string[]);
  _singleCountryIso = (isos.size === 1 && DRILLDOWN_COUNTRIES[[...isos][0]]) ? [...isos][0] : null;

  renderPanel(view, legs);
  try {
    await loadAmCharts();
    if (token !== _buildToken || myAttempt !== _bootChartAttempt) return;
    bootChart(view, legs);
    preloadDrilldownCountries(legs.map((l) => l.iso).filter(Boolean) as string[]);
  } catch (err) {
    console.error('amCharts load failed', err);
    showLoadFailure(view, stored, token);
  }
}

/** The CDN script failed: say so and offer a retry (the loader forgets failures). */
function showLoadFailure(view: HTMLElement, stored: StoredLegInput[], token: number) {
  const el = document.getElementById('mapLoading');
  if (!el) return;
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  el.innerHTML = `<div class="map-load-failed"><span>${esc(t('map.loadFailed'))}</span><button class="btn btn-ghost" type="button">${esc(t('map.retry'))}</button></div>`;
  el.querySelector('button')?.addEventListener('click', () => {
    el.textContent = t('map.loading');
    if (token === _buildToken) void buildAndBoot(view, stored, token);
  });
}

/* ── Chart ────────────────────────────────────────────────────────────────── */
function bootChart(view: HTMLElement, legs: PlottedLeg[]) {
  // Defensive: dispose any root a concurrent bootIdleChart() left behind —
  // amCharts throws "multiple Roots on the same DOM node" if we don't, since
  // this function otherwise has no guard against that race at all. (Teardown
  // also clears per-chart state, so everything below is set after it.)
  teardownChart();
  _legsRef = legs;
  _chartAbort = new AbortController();
  const { signal } = _chartAbort;
  const today = todayIso();
  const root = createMapRoot('mapChart');
  _root = root;

  const chart = root.container.children.push(am5map.MapChart.new(root, {
    projection: am5map.geoMercator(),
    panX:'translateX', panY:'translateY',
    wheelY:'zoom', pinchZoom:true,
    zoomStep:1.4, maxZoomLevel:64, minZoomLevel:1,
    wheelSensitivity:0.6, homeGeoPoint:routeCenter(legs),
  }));
  // Our overlay attachments (_planeItem/_heroImg/…) go through this typed view;
  // `chart` itself stays the loose amCharts object for library calls.
  const mc = asMapChart(chart);
  _chart = mc;

  /* World polygons */
  const world = chart.series.push(am5map.MapPolygonSeries.new(root, {
    geoJSON: am5geodata_worldLow, exclude:['AQ'],
  }));
  _worldSeries = world;
  world.mapPolygons.template.setAll({
    interactive:true, fill:am5.color(C().land),
    stroke:am5.color(C().landStroke), strokeWidth:0.6, nonScalingStroke:true,
  });
  world.mapPolygons.template.states.create('hover', { fill:am5.color(C().hover) });
  world.events.on('datavalidated', () => {
    _polyById.clear();
    world.mapPolygons.each((poly:any) => {
      const id = poly.dataItem?.get('id');
      if (id) { _polyById.set(id, poly); _dataItemById.set(id, poly.dataItem); }
      poly.set('cursorOverStyle', DRILLDOWN_COUNTRIES[id] ? 'pointer' : 'default');
    });
    _painted.forEach(paintState);
  });

  const tooltip = document.getElementById('mapTooltip')!;
  const tipName = document.getElementById('mapTooltipName')!;
  const tipMeta = document.getElementById('mapTooltipMeta')!;
  world.mapPolygons.template.events.on('pointerover', (ev:any) => {
    const id = ev.target.dataItem.get('id');
    const legHere = legs.filter((l) => l.iso === id);
    tipName.textContent = ev.target.dataItem.dataContext?.name ?? id;
    const zoomHint = DRILLDOWN_COUNTRIES[id] ? t('map.tip.zoomIn') : '';
    const base = legHere.length
      ? [t(legHere.length === 1 ? 'map.tip.stop' : 'map.tip.stops', { n: legHere.length }), zoomHint].filter(Boolean).join(' · ')
      : zoomHint;
    tipMeta.textContent = base;
    tooltip.classList.add('visible');
  });
  world.mapPolygons.template.events.on('globalpointermove', (ev:any) => positionTooltip(view, ev));
  world.mapPolygons.template.events.on('pointerout', () => tooltip.classList.remove('visible'));
  world.mapPolygons.template.events.on('click', (ev:any) => {
    const id = ev.target.dataItem.get('id');
    if (!DRILLDOWN_COUNTRIES[id]) return;
    stopReplayMotion();
    drillCountry(id, ev.target.dataItem.dataContext?.name??id, legs, ev.target);
  });

  /* Home (outbound + return) flight arcs — only when derived from the trip */
  if (_outboundChain || _returnChain) {
    const flightSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
    flightSeries.mapLines.template.setAll({
      stroke:am5.color(C().flightArc), strokeWidth:2, strokeOpacity:0.65, strokeDasharray:[5,7],
    });
    for (const chain of [_outboundChain, _returnChain]) {
      if (!chain) continue;
      flightSeries.pushDataItem({ geometry:{ type:'LineString',
        coordinates: chain.waypoints.map((w) => [w.lng, w.lat]) }});
    }
    _repaintExtras.push(() => flightSeries.mapLines.template.set('stroke', am5.color(C().flightArc)));
  }

  /* Trip route arcs — drawn in two parts so how far you have got reads off the
     map: the legs behind you (and the one you are in) in the route colour, the
     ones still ahead in grey. Shared with the Journal's Places view. */
  _repaintExtras.push(drawRouteLines(root, chart, legs, today));

  /* City number pins */
  const pinSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
  pinSeries.bullets.push((bRoot:any, _s:any, dataItem:any) => {
    const idx = dataItem.dataContext.index;
    // Stops still ahead of today get a dashed, lighter pin.
    const c = postmarkPin(bRoot, idx + 1, legVisitState(legs[idx], today) === 'planned');
    return am5.Bullet.new(bRoot, { sprite:c });
  });
  pinSeries.data.setAll(legs.map((l,index) => ({
    geometry:{ type:'Point', coordinates:[l.lng, l.lat] }, index, id:l.id,
  })));
  _repaintExtras.push(() => pinSeries.dataItems.forEach((di: Am5Obj) => di.bullets?.forEach((b: Am5Obj) => {
    repaintPostmarkPin(b.get('sprite'), legVisitState(legs[di.dataContext.index], today) === 'planned');
  })));

  /* Plane overlay */
  const planeData = chart.series.push(am5map.MapPointSeries.new(root, {}));
  const planeStart = _outboundChain?.waypoints[0] ?? legs[0];
  const planeItem = planeData.pushDataItem({ longitude:planeStart.lng, latitude:planeStart.lat });
  mc._planeItem = planeItem;
  let planeImg = document.querySelector('.map-plane-img') as HTMLImageElement|null;
  if (!planeImg) {
    planeImg = document.createElement('img');
    planeImg.className = 'map-plane-img';
    planeImg.src = PLANE_PNG; planeImg.alt = '';
    (document.querySelector('.map-stage') as HTMLElement).appendChild(planeImg);
  }
  // Hidden until an outbound/return flight chain actually flies it.
  planeImg.style.opacity = '0';
  mc._planeImg = planeImg;
  // Track position history to compute heading; no bob/pulse effects.
  let _prevPlanePx: {x:number;y:number}|null = null;
  let _planeBaseAngle = 180;
  let _planeCurrentAngle = 180;
  const syncPlane = () => {
    const img = mc._planeImg;
    const it  = mc._planeItem;
    if (!img||!it) return;
    const lng = it.get('longitude'), lat = it.get('latitude');
    if (lng==null||lat==null) return;
    const px = chart.convert({ longitude:lng, latitude:lat }); if (!px) return;
    if (_prevPlanePx) {
      const dx = px.x - _prevPlanePx.x;
      const dy = px.y - _prevPlanePx.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        const rawAngle = Math.atan2(dy, dx) * 180 / Math.PI;
        let delta = rawAngle - _planeBaseAngle;
        while (delta > 180)  delta -= 360;
        while (delta < -180) delta += 360;
        delta = Math.max(-6, Math.min(6, delta));
        const targetAngle = _planeBaseAngle + delta;
        _planeCurrentAngle += (targetAngle - _planeCurrentAngle) * 0.1;
      }
    }
    img.style.transform = `translate(-50%, -50%) rotate(${_planeCurrentAngle.toFixed(2)}deg)`;
    _prevPlanePx = { x:px.x, y:px.y };
    img.style.left = `${px.x}px`; img.style.top = `${px.y}px`;
  };
  mc._setPlaneBase = (angle: number) => {
    _planeBaseAngle    = angle;
    _planeCurrentAngle = angle;
    const img = mc._planeImg;
    if (img) img.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
  };
  root.events.on('frameended', syncPlane);

  /* Hero overlay */
  const heroData = chart.series.push(am5map.MapPointSeries.new(root, {}));
  const heroItem = heroData.pushDataItem({ longitude:legs[0].lng, latitude:legs[0].lat });
  mc._heroItem = heroItem;
  const heroImg = ensureHeroOverlay(
    document.querySelector('.map-stage') as HTMLElement,
    'map-hero-img',
    HERO_SRC,
  );
  mc._heroImg = heroImg;
  const syncHero = bindHeroOverlay(root, {
    chart,
    item: heroItem,
    image: heroImg,
    host: document.querySelector('.map-stage') as HTMLElement,
  });
  root.events.on('frameended', () => {
    syncOverlayItems(_regionLabelOverlays);
    syncOverlayItems(_countryPinOverlays);
  });

  chart.appear(motionMs(700), motionMs(100)).then(() => {
    if (_chart !== mc) return;    // torn down while appearing
    document.getElementById('mapLoading')?.remove();
    // Fit the whole route on load; animation only starts when the user clicks Play.
    window.setTimeout(() => {
      if (_chart !== mc) return;
      syncHero(); syncPlane(); fitToRoute(legs, 700);
      applyPendingLeg();
    }, 400);
  });

  // Toolbar buttons live in the stage markup, which outlives a chart rebuild
  // (scope / trip switch), so listeners are tied to this chart's signal and
  // removed on teardown — otherwise each rebuild would stack another Replay.
  const on = (id: string, fn: () => void) =>
    document.getElementById(id)?.addEventListener('click', fn, { signal });

  // Replay / Pause button — toggles between playing and paused/stopped.
  on('mapReplay', () => {
    if (_playing) stopReplayMotion();
    else void travelSequence(legs, true);
  });
  on('mapExport', openMapExport);
  wireRouteChrome(_host, signal);
  on('mapBack', () => {
    stopReplayMotion();
    backToOverview();
  });
  on('mapZoomIn', () => {
    stopReplayMotion();
    if (chart.zoomIn) chart.zoomIn();
    else chart.set('zoomLevel', (chart.get('zoomLevel') ?? 1) * 1.5);
  });
  on('mapZoomOut', () => {
    stopReplayMotion();
    if (chart.zoomOut) chart.zoomOut();
    else chart.set('zoomLevel', (chart.get('zoomLevel') ?? 1) / 1.5);
  });
  on('mapZoomFit', () => {
    stopReplayMotion();
    fitToRoute(_legsRef, 700);
  });
}

/* Centre of the route's footprint — used as the chart's home point. */
function routeCenter(legs: PlottedLeg[]) {
  if (legs.length === 0) return EUROPE_CENTER;
  let n=-90,s=90,e=-180,w=180;
  for (const l of legs) { n=Math.max(n,l.lat);s=Math.min(s,l.lat);e=Math.max(e,l.lng);w=Math.min(w,l.lng); }
  return { longitude: (e+w)/2, latitude: (n+s)/2 };
}

/* ── Tooltip ──────────────────────────────────────────────────────────────── */
function positionTooltip(view: HTMLElement, ev: Am5Obj) {
  const tooltip = document.getElementById('mapTooltip');
  if (!tooltip||!ev?.point) return;
  tooltip.style.left = `${ev.point.x}px`; tooltip.style.top = `${ev.point.y}px`;
  void view;
}

/* ── Drilldown ────────────────────────────────────────────────────────────── */
function fitDrilledCountry(series: Am5Obj, duration = 760) {
  try {
    const bounds = series.geoBounds();
    if (!bounds || !Number.isFinite(bounds.left) || !Number.isFinite(bounds.right)) return false;
    return fitGeoBounds(bounds, duration, 0.1);
  } catch {
    return false;
  }
}

async function drillCountry(code: string, name: string, legs: PlottedLeg[], worldPoly?: Am5Obj): Promise<boolean> {
  if (_drillCode === code && _drillSeries) {
    if (worldPoly) zoomToCountryPoly(worldPoly);
    else window.setTimeout(() => fitDrilledCountry(_drillSeries), 420);
    return true;
  }
  try { await loadCountryGeodata(code); } catch { return false; }
  const meta = DRILLDOWN_COUNTRIES[code];
  const geo  = (window as unknown as Record<string, Am5Obj>)[meta.global];
  if (!geo) { console.warn('geodata missing for', code); return false; }

  if (_drillSeries) { _drillSeries.dispose(); _drillSeries = null; }
  clearDrillOverlays();

  const series = _chart!.series.push(am5map.MapPolygonSeries.new(_root, { geoJSON:geo, visible:false }));
  series.mapPolygons.template.setAll({
    interactive:true,
    cursorOverStyle:'pointer',
    fill:am5.color(countryColor(code)),
    stroke:am5.color('#ffffff'),
    strokeWidth:1.2,
    nonScalingStroke:true,
    shadowColor:am5.color(C().ink), shadowBlur:6, shadowOpacity:0.12,
    tooltipText: '',
  });
  series.mapPolygons.template.states.create('hover', {
    fill:am5.color(C().hover), stroke:am5.color('#ffffff'), strokeWidth:1.5,
  });

  const tooltip = document.getElementById('mapTooltip')!;
  const tipName = document.getElementById('mapTooltipName')!;
  const tipMeta = document.getElementById('mapTooltipMeta')!;
  series.mapPolygons.template.events.on('pointerover', (ev:any) => {
    tipName.textContent = ev.target.dataItem.dataContext?.name ?? '';
    tipMeta.textContent = name;
    tooltip.classList.add('visible');
  });
  series.mapPolygons.template.events.on('globalpointermove', (ev:any) => {
    positionTooltip(document.getElementById('view-map') as HTMLElement, ev);
  });
  series.mapPolygons.template.events.on('pointerout', () => tooltip.classList.remove('visible'));

  _drillSeries = series;
  _drillCode   = code;

  return await new Promise<boolean>((resolve) => {
    let finalized = false;
    const finalizeDrill = () => {
      if (finalized || _drillSeries !== series) { resolve(false); return; }
      finalized = true;
      const cityStops = buildCountryStops(legs, code);
      // Region labels first dedupe against the city pins (which show city names).
      renderRegionLabels(series, cityStops);
      renderCountryPins(cityStops);
      (document.getElementById('mapBack') as HTMLElement).hidden = false;

      // Show the detailed country polygons immediately (no fade), then snap the
      // camera to its bounds with no animation.
      series.show(0);

      if (worldPoly) {
        zoomToCountryPoly(worldPoly);
      } else {
        if (!fitDrilledCountry(series, 0)) {
          _chart!.zoomToGeoPoint(geoCentroidOf(series), 6.5, true, 0);
        }
      }
      resolve(true);
    };

    series.events.on('datavalidated', finalizeDrill);
    window.setTimeout(finalizeDrill, 0);
    _root.events.once('frameended', finalizeDrill);
  });
}

function geoCentroidOf(series: Am5Obj) {
  try { const b = series.geoBounds(); return { longitude:(b.left+b.right)/2, latitude:(b.top+b.bottom)/2 }; }
  catch { return EUROPE_CENTER; }
}

function fitToRoute(legs: PlottedLeg[], duration = 700) {
  if (!_chart||legs.length===0) return;
  let n=-90,s=90,e=-180,w=180;
  for (const l of legs) { n=Math.max(n,l.lat);s=Math.min(s,l.lat);e=Math.max(e,l.lng);w=Math.min(w,l.lng); }
  const padLat=Math.max(1.2,(n-s)*0.18), padLng=Math.max(1.2,(e-w)*0.18);
  try { _chart.zoomToGeoBounds({ left:w-padLng,right:e+padLng,top:n+padLat,bottom:s-padLat }, motionMs(duration)); }
  catch { _chart.zoomToGeoPoint?.(routeCenter(legs), 4.8, true, motionMs(duration)); }
}

function backToOverview() {
  if (_drillSeries) { _drillSeries.dispose(); _drillSeries = null; _drillCode = null; }
  clearDrillOverlays();
  (document.getElementById('mapBack') as HTMLElement).hidden = true;
  fitToRoute(_legsRef, 800);
}

/* ── Country lighting ─────────────────────────────────────────────────────── */
/**
 * Give one country its explicit paint for its current state: visited (full
 * colour), planned (dashed outline, faint fill — not counted as visited) or
 * plain land. Painted countries are remembered so a theme switch can repaint
 * them (an explicit fill would otherwise keep the old theme's colour).
 */
function paintState(iso: string) {
  const poly = _polyById.get(iso); if (!poly) return;
  _painted.add(iso);
  if (_lit.has(iso)) {
    poly.setAll({ fill: am5.color(countryColor(iso)), fillOpacity: 1, stroke: am5.color(C().landStroke), strokeDasharray: [] });
  } else if (_planned.has(iso)) {
    const col = am5.color(countryColor(iso));
    poly.setAll({ fill: col, fillOpacity: 0.28, stroke: col, strokeDasharray: [3, 3] });
  } else {
    poly.setAll({ fill: am5.color(C().land), fillOpacity: 1, stroke: am5.color(C().landStroke), strokeDasharray: [] });
  }
  poly.states.create('hover', { fill: am5.color(C().hover) });
}

function markCountry(iso: string | null, state: 'visited' | 'planned') {
  if (!iso) return;
  if (state === 'visited') {
    if (_lit.has(iso)) return;
    _lit.add(iso); _planned.delete(iso);
    paintState(iso);
    if (!prefersReducedMotion()) {
      _polyById.get(iso)?.animate({ key:'fillOpacity', from:0.4, to:1, duration:700, easing:am5.ease.out(am5.ease.cubic) });
    }
  } else {
    if (_lit.has(iso) || _planned.has(iso)) return;
    _planned.add(iso);
    paintState(iso);
  }
}
/** Light a stop's country as visited or planned, by whether its date has come. */
function lightLeg(leg: PlottedLeg) {
  markCountry(leg.iso, legVisitState(leg, todayIso()));
}
function resetLit() {
  const touched = [..._lit, ..._planned];
  _lit.clear(); _planned.clear();
  touched.forEach(paintState);
}

/** Recolour the live chart for the current theme, in place. */
function repaintChart() {
  if (!_chart) return;
  const c = C();
  if (_idleWorld) {
    _idleWorld.mapPolygons.template.setAll({ fill: am5.color(c.miniLand), stroke: am5.color(c.miniStroke) });
  }
  if (_worldSeries) {
    const tpl = _worldSeries.mapPolygons.template;
    tpl.setAll({ fill: am5.color(c.land), stroke: am5.color(c.landStroke) });
    tpl.states.lookup('hover')?.setAll({ fill: am5.color(c.hover) });
    _painted.forEach(paintState);
  }
  if (_drillSeries && _drillCode) {
    const tpl = _drillSeries.mapPolygons.template;
    tpl.setAll({ fill: am5.color(countryColor(_drillCode)), shadowColor: am5.color(c.ink) });
    tpl.states.lookup('hover')?.setAll({ fill: am5.color(c.hover) });
  }
  _repaintExtras.forEach((fn) => fn());
}

/* ── Timer helpers ────────────────────────────────────────────────────────── */
function clearAllTimers() {
  if (_replayTimer)    { clearTimeout(_replayTimer);    _replayTimer    = null; }
  if (_flightPanTimer) { clearInterval(_flightPanTimer); _flightPanTimer = null; }
}

function stopReplayMotion() {
  _paused = true;
  _playing = false;
  setReplayBtnLabel(false);
  clearAllTimers();
  const heroImg  = _chart?._heroImg;
  const planeImg = _chart?._planeImg;
  if (planeImg) planeImg.style.opacity = '0';
  if (heroImg)  heroImg.style.opacity  = '1';
}

function focusMotion(id: string | null) {
  _activeMotionId = id;
  const rows = document.querySelectorAll<HTMLElement>('.leg-row, .leg-flight-row');
  rows.forEach((el) => {
    const isActive = el.dataset.motionId === id;
    el.classList.toggle('active', isActive);
    if (isActive) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

/* ── Plane animation ──────────────────────────────────────────────────────── */
function animatePlaneThrough(waypoints:GeoPt[], segDuration:number): Promise<void> {
  const item = _chart?._planeItem;
  if (!item||waypoints.length<2) return Promise.resolve();
  return new Promise((resolve) => {
    let idx = 0;
    item.set('longitude', waypoints[0].lng); item.set('latitude', waypoints[0].lat);
    const next = () => {
      if (_paused) { resolve(); return; }
      idx++; if (idx>=waypoints.length) { resolve(); return; }
      const w = waypoints[idx];
      item.animate({ key:'longitude', to:w.lng, duration:segDuration, easing:am5.ease.linear });
      item.animate({ key:'latitude',  to:w.lat, duration:segDuration, easing:am5.ease.linear });
      _replayTimer = window.setTimeout(next, segDuration);
    };
    _replayTimer = window.setTimeout(next, segDuration);
  });
}

/* ── Pan map to follow a geo point ───────────────────────────────────────── */
function panToGeoPoint(lng: number, lat: number, duration = 600, zoomLevel?: number) {
  if (!_chart) return;
  try {
    const level = zoomLevel ?? Math.min(_chart.get('zoomLevel') ?? 3, 3);
    _chart.zoomToGeoPoint({ longitude: lng, latitude: lat }, level, true, motionMs(duration));
  } catch {}
}

/** Pan the camera to keep up with the plane while a flight chain animates. */
function startFlightPan(segMs: number) {
  let idx = 0;
  _flightPanTimer = window.setInterval(() => {
    if (_paused) { clearAllTimers(); return; }
    const item = _chart?._planeItem;
    if (!item) { clearAllTimers(); return; }
    const lng = item.get('longitude');
    const lat = item.get('latitude');
    if (lng != null && lat != null) panToGeoPoint(lng, lat, 800);
    idx++;
    if (idx > 400 && _flightPanTimer) { clearInterval(_flightPanTimer); _flightPanTimer = null; }
  }, segMs * 4);
}
function stopFlightPan() {
  if (_flightPanTimer) { clearInterval(_flightPanTimer); _flightPanTimer = null; }
}

/* ── Travel sequence ──────────────────────────────────────────────────────── */
async function travelSequence(legs: PlottedLeg[], replay = false) {
  const heroItem = _chart?._heroItem;
  if (!heroItem||legs.length===0) return;
  clearAllTimers();
  _paused = false;
  _playing = true;
  setReplayBtnLabel(true);

  const heroImg  = _chart?._heroImg;
  const planeImg = _chart?._planeImg;
  const planeItem = _chart?._planeItem;

  // Reduced motion: no flights, hops or camera moves — show the finished route.
  if (prefersReducedMotion()) {
    const last = legs[legs.length-1];
    heroItem.set('longitude',last.lng); heroItem.set('latitude',last.lat);
    if (heroImg) heroImg.style.opacity = '1';
    legs.forEach(lightLeg);
    focusLeg(last.id);
    await settleView(legs);
    _playing = false;
    setReplayBtnLabel(false);
    return;
  }
  if (replay) resetLit();

  const FLIGHT_SEG = 45;

  // ── 1. Outbound home flight (if derived from the itinerary) ───────────────
  if (_outboundChain && _outboundChain.waypoints.length > 1) {
    const wpts = _outboundChain.waypoints;
    if (planeItem) { planeItem.set('longitude',wpts[0].lng); planeItem.set('latitude',wpts[0].lat); }
    // Heading: leftward if the flight trends west, else rightward.
    _chart?._setPlaneBase?.(wpts[wpts.length-1].lng < wpts[0].lng ? 180 : 0);
    if (planeImg) planeImg.style.opacity = '1';
    if (heroImg) heroImg.style.opacity = '0';
    focusMotion('flight-outbound');
    panToGeoPoint(wpts[0].lng, wpts[0].lat, 0);
    startFlightPan(FLIGHT_SEG);
    await animatePlaneThrough(wpts, FLIGHT_SEG);
    stopFlightPan();
    if (_paused) return;
    if (planeImg) planeImg.style.opacity = '0';
    if (heroImg)  heroImg.style.opacity  = '1';
  }

  // ── 2. Settle on the route (fit / drill into a single country) ────────────
  await settleView(legs);
  if (_paused) return;

  // ── 3. Hero hops through the legs in order ────────────────────────────────
  await new Promise<void>((resolve) => { _replayTimer = window.setTimeout(resolve, 500); });
  if (_paused) return;
  await travelHeroLegs(legs);
  if (_paused) return;

  // ── 4. Return home flight ─────────────────────────────────────────────────
  if (_returnChain && _returnChain.waypoints.length > 1) {
    await new Promise<void>((resolve) => { _replayTimer = window.setTimeout(resolve, 600); });
    if (_paused) return;
    // If we drilled into a country, pop back out to the world view first.
    if (_drillSeries) backToOverview();
    const wpts = _returnChain.waypoints;
    if (heroImg)  heroImg.style.opacity  = '0';
    _chart?._setPlaneBase?.(wpts[wpts.length-1].lng < wpts[0].lng ? 180 : 0);
    if (planeImg) planeImg.style.opacity = '1';
    if (planeItem) { planeItem.set('longitude',wpts[0].lng); planeItem.set('latitude',wpts[0].lat); }
    focusMotion('flight-return');
    panToGeoPoint(wpts[0].lng, wpts[0].lat, 400);
    startFlightPan(FLIGHT_SEG);
    await animatePlaneThrough(wpts, FLIGHT_SEG);
    stopFlightPan();
    if (_paused) return;
    if (planeImg) planeImg.style.opacity = '0';
    if (heroImg)  heroImg.style.opacity  = '1';
    const home = wpts[wpts.length-1];
    panToGeoPoint(home.lng, home.lat, 600);
    await new Promise<void>((resolve) => { _replayTimer = window.setTimeout(resolve, 1200); });
  }

  if (_paused) return;
  // Finish: frame the whole route and reset to replayable state.
  if (_drillSeries) backToOverview();
  else fitToRoute(legs, 1100);
  focusMotion(legs[legs.length - 1].id);
  _playing = false;
  setReplayBtnLabel(false);
}

/** After the outbound flight lands, fit the route — drilling into the country
 *  when the whole trip lives in one. */
async function settleView(legs: PlottedLeg[]) {
  if (_singleCountryIso) {
    const ok = await drillCountry(_singleCountryIso, _singleCountryIso, legs);
    if (ok) return;
  }
  fitToRoute(legs, 800);
}

function travelHeroLegs(legs: PlottedLeg[]): Promise<void> {
  const item = _chart?._heroItem;
  if (!item||legs.length===0) return Promise.resolve();
  const LEG_DURATION = 1800, STEP_DELAY = LEG_DURATION + 300;
  return new Promise((resolve) => {
    let i = 0;
    item.set('longitude',legs[0].lng); item.set('latitude',legs[0].lat);
    focusLeg(legs[0].id); lightLeg(legs[0]);
    const stepTo = (idx:number) => {
      if (_paused) return;
      const l = legs[idx];
      item.animate({ key:'longitude', to:l.lng, duration:LEG_DURATION, easing:am5.ease.inOut(am5.ease.cubic) });
      item.animate({ key:'latitude',  to:l.lat, duration:LEG_DURATION, easing:am5.ease.inOut(am5.ease.cubic) });
      // In a single-country view, keep the camera gently tracking the traveller.
      if (_singleCountryIso) {
        setTimeout(() => { if (!_paused) panToGeoPoint(l.lng, l.lat, LEG_DURATION); }, 0);
      }
      // Sync the country fill and the right-hand list when the traveller arrives.
      setTimeout(() => {
        if (_paused) return;
        lightLeg(l);
        focusLeg(l.id);
      }, LEG_DURATION * 0.7);
    };
    const tick = () => {
      if (_paused) { resolve(); return; }
      i++; if (i>=legs.length) { resolve(); return; }
      stepTo(i);
      _replayTimer=window.setTimeout(tick,STEP_DELAY);
    };
    _replayTimer = window.setTimeout(tick, 700);
  });
}

/* ── Side panel ───────────────────────────────────────────────────────────── */
function renderPanel(view: HTMLElement, legs: PlottedLeg[]) {
  const summary = summarizeRoute(legs, _outboundChain, _returnChain);

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  (view.querySelector('.map-panel') as HTMLElement).innerHTML = `
    ${statsMarkup(summary)}
    <div class="map-legs">
      ${flightRowMarkup(_outboundChain, 'flight-outbound', _activeMotionId)}
      ${legListMarkup(legs, { activeId: _activeMotionId, today: todayIso(), locale: loc() })}
      ${flightRowMarkup(_returnChain, 'flight-return', _activeMotionId)}
    </div>
    ${unlocatedMarkup(_unlocated)}`;

  view.querySelectorAll<HTMLButtonElement>('.leg-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      stopReplayMotion();
      const id = btn.dataset.id!;
      focusLeg(id);
      const leg = legs.find((l)=>l.id===id); if (!leg) return;
      lightLeg(leg);
      if (_chart) _chart.zoomToGeoPoint?.({ longitude:leg.lng, latitude:leg.lat }, 6, true, motionMs(700));
    });
  });
}

function focusLeg(id: string) {
  focusMotion(id);
}
