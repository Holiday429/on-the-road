/* ==========================================================================
   On the Road · My Map (amCharts5)
   ========================================================================== */

import './map.css';
import { renderViewTitleMarkup } from '../../core/app.ts';
import { cityLocationsFor, isoFor, EUROPE_CENTER } from './geo.ts';
import { loadAmCharts, loadCountryGeodata, preloadDrilldownCountries, DRILLDOWN_COUNTRIES } from './amcharts-loader.ts';
import { MAP_COLORS as C, countryColor } from './map-shared.ts';
import { bindHeroOverlay, ensureHeroOverlay } from './hero-overlay.ts';
import { routeStore } from '../../data/stores/route-store.ts';
// Assets live in public/art/. Prefix with Vite's base URL so they resolve under
// any deploy base (e.g. /on-the-road/) instead of the site root.
const ART = `${import.meta.env.BASE_URL}art/`.replace(/\/{2,}/g, '/');
const HERO_GIF  = `${ART}logo.gif`;
const PLANE_PNG = `${ART}plane.png`;

interface Leg {
  id: string; city: string; country: string; flag: string;
  dateFrom: string; dateTo: string; notes?: string;
}
interface PlottedLeg extends Leg {
  lat: number;
  lng: number;
  iso: string | null;
  stops: Array<{ key: string; name: string; lat: number; lng: number }>;
}
interface CountryStop {
  key: string;
  name: string;
  lat: number;
  lng: number;
}
interface OverlayItem {
  el: HTMLElement;
  lng: number;
  lat: number;
}

/* Colors and country data imported from map-shared.ts */

/* ── Flight waypoints ─────────────────────────────────────────────────────── */
const HARBIN  = { lat: 45.8038, lng: 126.5350 };
const BEIJING = { lat: 39.9042, lng: 116.4074 };
const CPH     = { lat: 55.6761, lng:  12.5683 };
const HOME_COUNTRY_ISO = 'CN';

/* Quadratic Bézier arc — perpendicular-left bend (flight-map style) */
function arcPoints(
  from: {lat:number;lng:number}, to: {lat:number;lng:number},
  n = 20, bendFraction = 0.15,
): [number,number][] {
  const dLng = to.lng - from.lng, dLat = to.lat - from.lat;
  const chord = Math.sqrt(dLng*dLng + dLat*dLat);
  if (chord < 0.001) return [[from.lng, from.lat]];
  const pLng = -dLat/chord, pLat = dLng/chord;
  const b = chord * bendFraction;
  const cpLng = (from.lng+to.lng)/2 + pLng*b;
  const cpLat = (from.lat+to.lat)/2 + pLat*b;
  const pts: [number,number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i/n, u = 1-t;
    pts.push([u*u*from.lng + 2*u*t*cpLng + t*t*to.lng,
              u*u*from.lat + 2*u*t*cpLat + t*t*to.lat]);
  }
  return pts;
}
function bezierWaypoints(from:{lat:number;lng:number}, to:{lat:number;lng:number}, bend=0.25, n=30) {
  return arcPoints(from, to, n, bend).map(([lng,lat]) => ({lat, lng}));
}

/* Waypoints whose count is proportional to geo distance, so that with a fixed
   per-waypoint duration the plane moves at a constant *visual* speed across
   segments of different lengths. ~one waypoint per `degPerStep` degrees. */
function evenSpeedWaypoints(
  from:{lat:number;lng:number}, to:{lat:number;lng:number}, bend=0.25, degPerStep=1.6,
) {
  const dLng = to.lng - from.lng, dLat = to.lat - from.lat;
  const chord = Math.sqrt(dLng*dLng + dLat*dLat);
  const n = Math.max(2, Math.round(chord / degPerStep));
  return bezierWaypoints(from, to, bend, n);
}

/* ── State ────────────────────────────────────────────────────────────────── */
let _initialized = false;
let _root:  any = null;
let _chart: any = null;
let _worldSeries: any = null;
let _polyById    = new Map<string, any>();
let _dataItemById = new Map<string, any>();  // iso → dataItem (unused after zoom refactor)
let _lit         = new Set<string>();
let _drillSeries: any = null;
let _drillCode:   string | null = null;
let _replayTimer:      number | null = null;
let _planeReplayTimer: number | null = null;
let _outboundPanTimer: number | null = null;
let _returnPanTimer: number | null = null;
let _paused = false;
let _playing = false;
let _legsRef: PlottedLeg[] = [];
let _regionLabelOverlays: OverlayItem[] = [];
let _countryPinOverlays: OverlayItem[] = [];
let _activeMotionId: string | null = null;

function setReplayBtnLabel(playing: boolean) {
  const btn = document.getElementById('mapReplay');
  if (btn) btn.textContent = playing ? '⏸ Pause' : '▶ Replay route';
}

/* ── Data ─────────────────────────────────────────────────────────────────── */
function plot(legs: Leg[]): PlottedLeg[] {
  return legs.flatMap((leg) => {
    const stops = cityLocationsFor(leg.city);
    const anchor = stops[0];
    if (!anchor) return [];
    return [{ ...leg, lat: anchor.lat, lng: anchor.lng, iso: isoFor(leg.country), stops }];
  });
}
function fmtRange(from: string, to: string): string {
  const o: Intl.DateTimeFormatOptions = { month:'short', day:'numeric' };
  return `${new Date(from).toLocaleDateString('en-US',o)} – ${new Date(to).toLocaleDateString('en-US',o)}`;
}
function nights(from: string, to: string): number {
  return Math.max(0, Math.round((+new Date(to) - +new Date(from)) / 86400000));
}

function wrapMapLabel(text: string, maxLineLength = 12): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return text;
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    if (`${current} ${word}`.length <= maxLineLength) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  lines.push(current);
  return lines.join('\n');
}

function buildCountryStops(legs: PlottedLeg[], code: string): CountryStop[] {
  const stops = new Map<string, CountryStop>();
  for (const leg of legs) {
    if (leg.iso !== code) continue;
    for (const stop of leg.stops) {
      if (!stops.has(stop.key)) {
        stops.set(stop.key, { key: stop.key, name: stop.name, lat: stop.lat, lng: stop.lng });
      }
    }
  }
  return [...stops.values()];
}

function expandBounds(bounds: { left: number; right: number; top: number; bottom: number }, ratio = 0.12) {
  const width = Math.max(0.1, bounds.right - bounds.left);
  const height = Math.max(0.1, bounds.top - bounds.bottom);
  const padLng = Math.max(0.28, width * ratio);
  const padLat = Math.max(0.28, height * ratio);
  return {
    left: bounds.left - padLng,
    right: bounds.right + padLng,
    top: bounds.top + padLat,
    bottom: bounds.bottom - padLat,
  };
}

function fitGeoBounds(bounds: { left: number; right: number; top: number; bottom: number }, duration = 700, ratio = 0.12) {
  if (!_chart) return false;
  try {
    _chart.zoomToGeoBounds(expandBounds(bounds, ratio), duration);
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

function geoCentroid(geometry: any) {
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

// Great-circle-ish distance in degrees (good enough for de-duping nearby labels).
function geoDist(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const dLng = aLng - bLng, dLat = aLat - bLat;
  return Math.sqrt(dLng * dLng + dLat * dLat);
}

function renderRegionLabels(series: any, cityStops: CountryStop[] = []) {
  _regionLabelOverlays = clearOverlayItems(_regionLabelOverlays, 'mapRegionLabels');
  const layer = overlayLayer('mapRegionLabels');
  if (!layer) return;

  // A region label is suppressed when it sits on top of a city pin (the pin
  // already shows that place's name) or too close to another region label.
  const CITY_GAP = 0.9;     // degrees — hide region name near a city pin
  const LABEL_GAP = 1.1;    // degrees — minimum spacing between region labels
  const placed: { lng: number; lat: number }[] = [];

  series.dataItems.forEach((item: any) => {
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
    const el = document.createElement('div');
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
    layer.appendChild(el);
    _countryPinOverlays.push({ el, lng: stop.lng, lat: stop.lat });
  }
  syncOverlayItems(_countryPinOverlays);
}

function clearDrillOverlays() {
  _regionLabelOverlays = clearOverlayItems(_regionLabelOverlays, 'mapRegionLabels');
  _countryPinOverlays = clearOverlayItems(_countryPinOverlays, 'mapCountryPins');
}

function zoomToCountryPoly(poly: any) {
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
export function initMap() {
  if (_initialized) return; _initialized = true;
  const view = document.getElementById('view-map'); if (!view) return;

  view.querySelector('.view-header')!.innerHTML = `
    <div class="view-title">${renderViewTitleMarkup('map', 'My Map')}</div>
    <div class="view-subtitle">Your footprint across Europe — click a country to zoom into its regions.</div>`;

  const body = view.querySelector('.stub-body');
  if (body) {
    body.outerHTML = `
      <div class="map-layout">
        <div class="map-stage">
          <div id="mapChart" class="map-chart"></div>
          <div class="map-region-labels" id="mapRegionLabels"></div>
          <div class="map-country-pins" id="mapCountryPins"></div>
          <div class="map-tooltip" id="mapTooltip">
            <span class="map-tooltip-name" id="mapTooltipName"></span>
            <span class="map-tooltip-meta" id="mapTooltipMeta"></span>
          </div>
          <div class="map-toolbar">
            <button class="map-tool-btn" id="mapReplay" title="Replay route">▶ Replay route</button>
            <button class="map-tool-btn" id="mapBack" title="Back to Europe" hidden>← Back</button>
          </div>
          <div class="map-zoom-controls">
            <button class="map-zoom-btn" id="mapZoomIn"  title="Zoom in">+</button>
            <button class="map-zoom-btn" id="mapZoomFit" title="Fit to route">⊡</button>
            <button class="map-zoom-btn" id="mapZoomOut" title="Zoom out">−</button>
          </div>
          <div class="map-loading" id="mapLoading">Loading map…</div>
        </div>
        <aside class="map-panel"></aside>
      </div>`;
  }

  routeStore.subscribe((storedLegs) => {
    const legs = plot(storedLegs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) as Leg[]);

    // Chart already running — just refresh the side panel
    if (_chart) {
      renderPanel(view as HTMLElement, legs);
      return;
    }

    // No legs yet (empty cache or genuinely empty) — show placeholder and keep listening
    if (legs.length === 0) {
      const stage = view.querySelector<HTMLElement>('.map-stage');
      if (stage && !stage.querySelector('.map-empty')) {
        stage.innerHTML = `
          <div class="map-empty">
            <img src="${ART}earth_trans.png" alt="" class="map-empty-art">
            <div class="map-empty-title">No route yet</div>
            <div class="map-empty-sub">Add cities in <a href="#route">Itinerary</a> and they'll appear here.</div>
          </div>`;
      }
      return;
    }

    // Legs arrived — restore stage DOM if empty state was shown, then boot chart once
    const stage = view.querySelector<HTMLElement>('.map-stage');
    if (stage?.querySelector('.map-empty')) {
      stage.innerHTML = `
        <div id="mapChart" class="map-chart"></div>
        <div class="map-region-labels" id="mapRegionLabels"></div>
        <div class="map-country-pins" id="mapCountryPins"></div>
        <div class="map-tooltip" id="mapTooltip">
          <span class="map-tooltip-name" id="mapTooltipName"></span>
          <span class="map-tooltip-meta" id="mapTooltipMeta"></span>
        </div>
        <div class="map-toolbar">
          <button class="map-tool-btn" id="mapReplay" title="Replay route">▶ Replay route</button>
          <button class="map-tool-btn" id="mapBack" title="Back to Europe" hidden>← Back</button>
        </div>
        <div class="map-zoom-controls">
          <button class="map-zoom-btn" id="mapZoomIn"  title="Zoom in">+</button>
          <button class="map-zoom-btn" id="mapZoomFit" title="Fit to route">⊡</button>
          <button class="map-zoom-btn" id="mapZoomOut" title="Zoom out">−</button>
        </div>
        <div class="map-loading" id="mapLoading">Loading map…</div>`;
    }

    renderPanel(view as HTMLElement, legs);
    loadAmCharts()
      .then(() => { bootChart(view as HTMLElement, legs); preloadDrilldownCountries(); })
      .catch((err) => {
        console.error('amCharts load failed', err);
        const el = document.getElementById('mapLoading'); if (el) el.textContent = 'Map failed to load.';
      });
  });
}

/* ── Chart ────────────────────────────────────────────────────────────────── */
function bootChart(view: HTMLElement, legs: PlottedLeg[]) {
  _legsRef = legs;
  const root = am5.Root.new('mapChart');
  _root = root;
  root.setThemes([am5themes_Animated.new(root)]);
  if (root._logo) root._logo.dispose();

  const chart = root.container.children.push(am5map.MapChart.new(root, {
    projection: am5map.geoMercator(),
    panX:'translateX', panY:'translateY',
    wheelY:'zoom', pinchZoom:true,
    zoomStep:1.4, maxZoomLevel:64, minZoomLevel:1,
    wheelSensitivity:0.6, homeGeoPoint:EUROPE_CENTER,
  }));
  _chart = chart;

  /* World polygons */
  const world = chart.series.push(am5map.MapPolygonSeries.new(root, {
    geoJSON: am5geodata_worldLow, exclude:['AQ'],
  }));
  _worldSeries = world;
  world.mapPolygons.template.setAll({
    interactive:true, fill:am5.color(C.land),
    stroke:am5.color(C.landStroke), strokeWidth:0.6, nonScalingStroke:true,
  });
  world.mapPolygons.template.states.create('hover', { fill:am5.color(C.hover) });
  world.events.on('datavalidated', () => {
    _polyById.clear(); _dataItemById.clear();
    world.mapPolygons.each((poly:any) => {
      const id = poly.dataItem?.get('id');
      if (id) { _polyById.set(id, poly); _dataItemById.set(id, poly.dataItem); }
      poly.set('cursorOverStyle', DRILLDOWN_COUNTRIES[id] ? 'pointer' : 'default');
    });
    _lit.forEach((iso) => paintCountry(iso, countryColor(iso)));
  });

  const tooltip = document.getElementById('mapTooltip')!;
  const tipName = document.getElementById('mapTooltipName')!;
  const tipMeta = document.getElementById('mapTooltipMeta')!;
  world.mapPolygons.template.events.on('pointerover', (ev:any) => {
    const id = ev.target.dataItem.get('id');
    const legHere = legs.filter((l) => l.iso === id);
    tipName.textContent = ev.target.dataItem.dataContext?.name ?? id;
    tipMeta.textContent = legHere.length
      ? `${legHere.length} stop${legHere.length>1?'s':''}${DRILLDOWN_COUNTRIES[id]?' · click to zoom in':''}`
      : (DRILLDOWN_COUNTRIES[id] ? 'click to zoom in' : '');
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

  /* Flight arcs */
  const flightSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
  flightSeries.mapLines.template.setAll({
    stroke:am5.color('#7b9bbf'), strokeWidth:2, strokeOpacity:0.65, strokeDasharray:[5,7],
  });
  flightSeries.pushDataItem({ geometry:{ type:'LineString', coordinates:[
    ...arcPoints(HARBIN, BEIJING, 12, 0.25),
    ...arcPoints(BEIJING, CPH, 40, 0.25),
  ]}});
  flightSeries.pushDataItem({ geometry:{ type:'LineString', coordinates:[
    ...arcPoints(CPH, BEIJING, 40, 0.20),
    ...arcPoints(BEIJING, HARBIN, 12, 0.20),
  ]}});

  /* Trip route arcs */
  const lineSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
  lineSeries.mapLines.template.setAll({
    stroke:am5.color(C.route), strokeWidth:2.5, strokeOpacity:0.85, strokeDasharray:[4,6],
  });
  const routeCoords: [number,number][] = [];
  for (let i = 0; i < legs.length-1; i++) {
    const seg = arcPoints({lat:legs[i].lat,lng:legs[i].lng},{lat:legs[i+1].lat,lng:legs[i+1].lng},20,0.15);
    if (i>0) seg.shift();
    routeCoords.push(...seg);
  }
  lineSeries.pushDataItem({ geometry:{ type:'LineString', coordinates:routeCoords }});

  /* City number pins */
  const pinSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
  pinSeries.bullets.push((bRoot:any, _s:any, dataItem:any) => {
    const idx = dataItem.dataContext.index;
    const c = am5.Container.new(bRoot, {});
    c.children.push(am5.Circle.new(bRoot, { radius:9, fill:am5.color('#fff'), stroke:am5.color(C.route), strokeWidth:3 }));
    c.children.push(am5.Label.new(bRoot, {
      text:String(idx+1), centerX:am5.p50, centerY:am5.p50,
      fontSize:10, fontWeight:'700', fill:am5.color(C.route), populateText:false,
    }));
    return am5.Bullet.new(bRoot, { sprite:c });
  });
  pinSeries.data.setAll(legs.map((l,index) => ({
    geometry:{ type:'Point', coordinates:[l.lng, l.lat] }, index, id:l.id,
  })));

  /* Plane overlay */
  const planeData = chart.series.push(am5map.MapPointSeries.new(root, {}));
  const planeItem = planeData.pushDataItem({ longitude:HARBIN.lng, latitude:HARBIN.lat });
  (chart as any)._planeItem = planeItem;
  let planeImg = document.querySelector('.map-plane-img') as HTMLImageElement|null;
  if (!planeImg) {
    planeImg = document.createElement('img');
    planeImg.className = 'map-plane-img';
    planeImg.src = PLANE_PNG; planeImg.alt = '';
    (document.querySelector('.map-stage') as HTMLElement).appendChild(planeImg);
  }
  (chart as any)._planeImg = planeImg;
  // Track position history to compute a restrained heading + subtle flight motion.
  let _prevPlanePx: {x:number;y:number}|null = null;
  let _planeBaseAngle = 180; // outbound starts west-ish
  let _planeCurrentAngle = 180;
  const syncPlane = () => {
    const img = (chart as any)._planeImg as HTMLImageElement;
    const it  = (chart as any)._planeItem;
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
        // Keep the nose close to the base heading — only a subtle wobble.
        delta = Math.max(-6, Math.min(6, delta));
        const targetAngle = _planeBaseAngle + delta;
        _planeCurrentAngle += (targetAngle - _planeCurrentAngle) * 0.1;
      }
    }
    const flightPhase = performance.now() / 220;
    const bob = Math.sin(flightPhase) * 1.2;
    const pulse = 1 + Math.sin(flightPhase * 0.9) * 0.015;
    img.style.transform = `translate(-50%, calc(-50% + ${bob.toFixed(2)}px)) rotate(${_planeCurrentAngle.toFixed(2)}deg) scale(${pulse.toFixed(3)})`;
    _prevPlanePx = { x:px.x, y:px.y };
    img.style.left = `${px.x}px`; img.style.top = `${px.y}px`;
  };
  (chart as any)._setPlaneBase = (angle: number) => {
    _planeBaseAngle    = angle;
    _planeCurrentAngle = angle;
    const img = (chart as any)._planeImg as HTMLImageElement;
    if (img) img.style.transform = `translate(-50%, -50%) rotate(${angle}deg) scale(1)`;
  };
  root.events.on('frameended', syncPlane);

  /* Hero overlay */
  const heroData = chart.series.push(am5map.MapPointSeries.new(root, {}));
  const heroItem = heroData.pushDataItem({ longitude:legs[0].lng, latitude:legs[0].lat });
  (chart as any)._heroItem = heroItem;
  const heroImg = ensureHeroOverlay(
    document.querySelector('.map-stage') as HTMLElement,
    'map-hero-img',
    HERO_GIF,
  );
  (chart as any)._heroImg = heroImg;
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

  chart.appear(700, 100).then(() => {
    document.getElementById('mapLoading')?.remove();
    // Start at China — so the plane is visible from the first frame
    chart.zoomToGeoPoint({ longitude: HARBIN.lng, latitude: HARBIN.lat }, 3, true, 0);
    setTimeout(() => { syncHero(); syncPlane(); travelSequence(legs); }, 400);
  });

  // Replay / Pause button — toggles between playing and paused/stopped.
  const replayBtn = document.getElementById('mapReplay')!;
  replayBtn.addEventListener('click', () => {
    if (_playing) {
      // Currently playing → pause (freeze in place)
      stopReplayMotion();
    } else {
      // Stopped or paused → restart the sequence from the beginning
      travelSequence(legs, true);
    }
  });

  document.getElementById('mapBack')?.addEventListener('click', () => {
    stopReplayMotion();
    backToEurope();
  });
  document.getElementById('mapZoomIn')?.addEventListener('click', () => {
    stopReplayMotion();
    if (chart.zoomIn) chart.zoomIn();
    else chart.set('zoomLevel', (chart.get('zoomLevel') ?? 1) * 1.5);
  });
  document.getElementById('mapZoomOut')?.addEventListener('click', () => {
    stopReplayMotion();
    if (chart.zoomOut) chart.zoomOut();
    else chart.set('zoomLevel', (chart.get('zoomLevel') ?? 1) / 1.5);
  });
  document.getElementById('mapZoomFit')?.addEventListener('click', () => {
    stopReplayMotion();
    fitToRoute(_legsRef, 700);
  });
}

/* ── Tooltip ──────────────────────────────────────────────────────────────── */
function positionTooltip(view: HTMLElement, ev: any) {
  const tooltip = document.getElementById('mapTooltip');
  if (!tooltip||!ev?.point) return;
  tooltip.style.left = `${ev.point.x}px`; tooltip.style.top = `${ev.point.y}px`;
  void view;
}

/* ── Drilldown ────────────────────────────────────────────────────────────── */
function fitDrilledCountry(series: any, duration = 760) {
  try {
    const bounds = series.geoBounds();
    if (!bounds || !Number.isFinite(bounds.left) || !Number.isFinite(bounds.right)) return false;
    return fitGeoBounds(bounds, duration, 0.1);
  } catch {
    return false;
  }
}

async function drillCountry(code: string, name: string, legs: PlottedLeg[], worldPoly?: any) {
  if (_drillCode === code && _drillSeries) {
    if (worldPoly) zoomToCountryPoly(worldPoly);
    else window.setTimeout(() => fitDrilledCountry(_drillSeries), 420);
    return;
  }
  await loadCountryGeodata(code);
  const meta = DRILLDOWN_COUNTRIES[code];
  const geo  = (window as any)[meta.global];
  if (!geo) { console.warn('geodata missing for', code); return; }

  if (_drillSeries) { _drillSeries.dispose(); _drillSeries = null; }
  clearDrillOverlays();

  const series = _chart.series.push(am5map.MapPolygonSeries.new(_root, { geoJSON:geo, visible:false }));
  series.mapPolygons.template.setAll({
    interactive:true,
    cursorOverStyle:'pointer',
    fill:am5.color(countryColor(code)),
    stroke:am5.color('#ffffff'),
    strokeWidth:1.2,
    nonScalingStroke:true,
    shadowColor:am5.color(C.ink), shadowBlur:6, shadowOpacity:0.12,
    tooltipText: '',
  });
  series.mapPolygons.template.states.create('hover', {
    fill:am5.color(C.hover), stroke:am5.color('#ffffff'), strokeWidth:1.5,
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

  let finalized = false;
  const finalizeDrill = () => {
    if (finalized || _drillSeries !== series) return;
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
        _chart.zoomToGeoPoint(geoCentroidOf(series), 6.5, true, 0);
      }
    }
  };

  series.events.on('datavalidated', finalizeDrill);
  window.setTimeout(finalizeDrill, 0);
  _root.events.once('frameended', finalizeDrill);
}

function geoCentroidOf(series: any) {
  try { const b = series.geoBounds(); return { longitude:(b.left+b.right)/2, latitude:(b.top+b.bottom)/2 }; }
  catch { return EUROPE_CENTER; }
}

function fitToRoute(legs: PlottedLeg[], duration = 700) {
  if (!_chart||legs.length===0) return;
  let n=-90,s=90,e=-180,w=180;
  for (const l of legs) { n=Math.max(n,l.lat);s=Math.min(s,l.lat);e=Math.max(e,l.lng);w=Math.min(w,l.lng); }
  const padLat=Math.max(1.2,(n-s)*0.18), padLng=Math.max(1.2,(e-w)*0.18);
  try { _chart.zoomToGeoBounds({ left:w-padLng,right:e+padLng,top:n+padLat,bottom:s-padLat }, duration); }
  catch { _chart.zoomToGeoPoint?.(EUROPE_CENTER, 4.8, true, duration); }
}

function backToEurope() {
  if (_drillSeries) { _drillSeries.dispose(); _drillSeries = null; _drillCode = null; }
  clearDrillOverlays();
  (document.getElementById('mapBack') as HTMLElement).hidden = true;
  fitToRoute(_legsRef, 800);
}

/* ── Country lighting ─────────────────────────────────────────────────────── */
function paintCountry(iso: string, color: string) {
  const poly = _polyById.get(iso); if (!poly) return;
  poly.set('fill', am5.color(color));
  poly.states.create('hover', { fill:am5.color(C.hover) });
}
function lightCountry(iso: string|null) {
  if (!iso||_lit.has(iso)) return; _lit.add(iso);
  const poly = _polyById.get(iso); if (!poly) return;
  paintCountry(iso, countryColor(iso));
  poly.animate({ key:'fillOpacity', from:0.4, to:1, duration:700, easing:am5.ease.out(am5.ease.cubic) });
}
function resetLit() {
  _lit.forEach((iso) => { const p = _polyById.get(iso); if (p) p.set('fill', am5.color(C.land)); });
  _lit.clear();
}

/* ── Timer helpers ────────────────────────────────────────────────────────── */
function clearAllTimers() {
  if (_replayTimer)      { clearTimeout(_replayTimer);      _replayTimer      = null; }
  if (_planeReplayTimer) { clearTimeout(_planeReplayTimer); _planeReplayTimer = null; }
  if (_outboundPanTimer) { clearInterval(_outboundPanTimer); _outboundPanTimer = null; }
  if (_returnPanTimer)   { clearInterval(_returnPanTimer);   _returnPanTimer   = null; }
}

function stopReplayMotion() {
  _paused = true;
  _playing = false;
  setReplayBtnLabel(false);
  clearAllTimers();
  const heroImg  = (_chart as any)?._heroImg  as HTMLImageElement|null;
  const planeImg = (_chart as any)?._planeImg as HTMLImageElement|null;
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
function animatePlaneThrough(waypoints:{lat:number;lng:number}[], segDuration:number): Promise<void> {
  const item = (_chart as any)?._planeItem;
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
function panToGeoPoint(lng: number, lat: number, duration = 600) {
  if (!_chart) return;
  try {
    const current = _chart.get('zoomLevel') ?? 3;
    _chart.zoomToGeoPoint({ longitude: lng, latitude: lat }, current, true, duration);
  } catch {}
}

/* ── Travel sequence ──────────────────────────────────────────────────────── */
function travelSequence(legs: PlottedLeg[], replay = false) {
  const heroItem = (_chart as any)?._heroItem;
  if (!heroItem||legs.length===0) return;
  clearAllTimers();
  _paused = false;
  _playing = true;
  setReplayBtnLabel(true);
  if (replay) resetLit();

  if (!replay && window.matchMedia?.('(prefers-reduced-motion:reduce)').matches) {
    const last = legs[legs.length-1];
    heroItem.set('longitude',last.lng); heroItem.set('latitude',last.lat);
    lightCountry(HOME_COUNTRY_ISO);
    legs.forEach((l)=>lightCountry(l.iso));
    _playing = false;
    setReplayBtnLabel(false);
    return;
  }

  // Plane is fast: fixed ms per waypoint. Waypoint count scales with distance
  // so the plane keeps a constant visual speed across both segments.
  const FLIGHT_SEG = 90;
  const outboundWpts = [
    ...evenSpeedWaypoints(HARBIN, BEIJING, 0.25),
    ...evenSpeedWaypoints(BEIJING, CPH,    0.25).slice(1),
  ];

  const planeItem = (_chart as any)?._planeItem;
  if (planeItem) { planeItem.set('longitude',HARBIN.lng); planeItem.set('latitude',HARBIN.lat); }
  lightCountry(HOME_COUNTRY_ISO);
  focusMotion('flight-outbound');

  const heroImg  = (_chart as any)?._heroImg  as HTMLImageElement|null;
  const planeImg = (_chart as any)?._planeImg as HTMLImageElement|null;

  // Outbound: Harbin→CPH is westward → base angle 180° (pointing left)
  (_chart as any)._setPlaneBase?.(180);
  if (planeImg) planeImg.style.opacity = '1';
  if (heroImg) heroImg.style.opacity = '0';

  // Zoom to start at Harbin area
  panToGeoPoint(HARBIN.lng, HARBIN.lat, 0);

  // Pan camera along with the plane every few waypoints
  let outboundPanIdx = 0;
  _outboundPanTimer = window.setInterval(() => {
    if (_paused) { clearAllTimers(); return; }
    const item = (_chart as any)?._planeItem;
    if (!item) { clearAllTimers(); return; }
    const lng = item.get('longitude');
    const lat = item.get('latitude');
    if (lng != null && lat != null) panToGeoPoint(lng, lat, 800);
    outboundPanIdx++;
    if (outboundPanIdx > outboundWpts.length + 5 && _outboundPanTimer) {
      clearInterval(_outboundPanTimer);
      _outboundPanTimer = null;
    }
  }, FLIGHT_SEG * 4);

  animatePlaneThrough(outboundWpts, FLIGHT_SEG).then(() => {
    if (_outboundPanTimer) {
      clearInterval(_outboundPanTimer);
      _outboundPanTimer = null;
    }
    if (_paused) return;
    if (planeImg) planeImg.style.opacity = '0';
    if (heroImg)  heroImg.style.opacity  = '1';

    // Fit Europe once plane lands
    fitToRoute(legs, 800);
    setTimeout(() => { if (!_paused) travelHeroLegs(legs); }, 900);

    const LEG_DURATION  = 1800;
    const STEP_DELAY    = LEG_DURATION + 300;
    const euroTrip      = legs.length * STEP_DELAY + 1800;

    _planeReplayTimer = window.setTimeout(() => {
      if (_paused) return;
      if (heroImg)  heroImg.style.opacity  = '0';
      // Return: CPH→Harbin is eastward → base angle 0° (pointing right)
      (_chart as any)._setPlaneBase?.(0);
      if (planeImg) planeImg.style.opacity = '1';
      if (planeItem) { planeItem.set('longitude',CPH.lng); planeItem.set('latitude',CPH.lat); }
      focusMotion('flight-return');

      // Pan back to CPH area first
      panToGeoPoint(CPH.lng, CPH.lat, 400);

      const returnWpts = [
        ...evenSpeedWaypoints(CPH,     BEIJING, 0.20),
        ...evenSpeedWaypoints(BEIJING, HARBIN,  0.20).slice(1),
      ];

      // Pan along with return flight too
      let returnPanIdx = 0;
      _returnPanTimer = window.setInterval(() => {
        if (_paused) { clearAllTimers(); return; }
        const item = (_chart as any)?._planeItem;
        if (!item) { clearAllTimers(); return; }
        const lng = item.get('longitude');
        const lat = item.get('latitude');
        if (lng != null && lat != null) panToGeoPoint(lng, lat, 800);
        returnPanIdx++;
        if (returnPanIdx > returnWpts.length + 5 && _returnPanTimer) {
          clearInterval(_returnPanTimer);
          _returnPanTimer = null;
        }
      }, FLIGHT_SEG * 4);

      animatePlaneThrough(returnWpts, FLIGHT_SEG).then(() => {
        if (_returnPanTimer) {
          clearInterval(_returnPanTimer);
          _returnPanTimer = null;
        }
        if (planeImg) planeImg.style.opacity = '0';
        if (heroImg)  heroImg.style.opacity  = '1';
        // Linger on the arrival in China before flying the camera back to Europe.
        panToGeoPoint(HARBIN.lng, HARBIN.lat, 600);
        _planeReplayTimer = window.setTimeout(() => {
          if (_paused) return;
          fitToRoute(legs, 1100);
          focusLeg(legs[legs.length - 1].id);
          // Sequence finished naturally — reset to the replayable state.
          _playing = false;
          setReplayBtnLabel(false);
        }, 1400);
      });
    }, euroTrip);
  });
}

function travelHeroLegs(legs: PlottedLeg[]) {
  const item = (_chart as any)?._heroItem; if (!item||legs.length===0) return;
  const LEG_DURATION = 1800, STEP_DELAY = LEG_DURATION + 300;
  let i = 0;
  item.set('longitude',legs[0].lng); item.set('latitude',legs[0].lat);
  focusLeg(legs[0].id); lightCountry(legs[0].iso);
  const stepTo = (idx:number) => {
    if (_paused) return;
    const l = legs[idx];
    item.animate({ key:'longitude', to:l.lng, duration:LEG_DURATION, easing:am5.ease.inOut(am5.ease.cubic) });
    item.animate({ key:'latitude',  to:l.lat, duration:LEG_DURATION, easing:am5.ease.inOut(am5.ease.cubic) });
    // Sync the country fill and the right-hand list at the same moment the
    // little traveller arrives, so map + sidebar light up together.
    setTimeout(() => {
      if (_paused) return;
      lightCountry(l.iso);
      focusLeg(l.id);
    }, LEG_DURATION * 0.7);
  };
  const tick = () => {
    if (_paused) return;
    i++; if (i>=legs.length) return;
    stepTo(i);
    _replayTimer=window.setTimeout(tick,STEP_DELAY);
  };
  _replayTimer = window.setTimeout(tick, 700);
}

/* ── Side panel ───────────────────────────────────────────────────────────── */
function summarizeRoute(legs: PlottedLeg[]) {
  const uniqueCountries = new Set<string>();
  const uniqueCities = new Set<string>();

  for (const leg of legs) {
    uniqueCountries.add(leg.iso ?? leg.country);
    for (const stop of leg.stops) {
      uniqueCities.add(`${leg.iso ?? leg.country}:${stop.key}`);
    }
  }

  return {
    cityCount: uniqueCities.size,
    countryCount: uniqueCountries.size,
  };
}

function renderPanel(view: HTMLElement, legs: PlottedLeg[]) {
  const { cityCount, countryCount } = summarizeRoute(legs);
  const list = legs.map((l,i) => `
    <button class="leg-row ${_activeMotionId===l.id ? 'active' : ''}" data-id="${l.id}" data-motion-id="${l.id}">
      <span class="leg-row-num">${i+1}</span>
      <span class="leg-row-main">
        <span class="leg-row-city">${l.flag} ${l.city}</span>
        <span class="leg-row-meta">${fmtRange(l.dateFrom,l.dateTo)} · ${nights(l.dateFrom,l.dateTo)} nights</span>
      </span>
    </button>`).join('');

  (view.querySelector('.map-panel') as HTMLElement).innerHTML = `
    <div class="map-stats">
      <div class="map-stat"><div class="map-stat-num">${cityCount}</div><div class="map-stat-label">Cities</div></div>
      <div class="map-stat"><div class="map-stat-num">${countryCount}</div><div class="map-stat-label">Countries</div></div>
    </div>
    <div class="map-legs">
      <div class="leg-flight-row ${_activeMotionId === 'flight-outbound' ? 'active' : ''}" data-motion-id="flight-outbound">
        <span class="leg-flight-icon">✈️</span>
        <span class="leg-flight-main">
          <span class="leg-flight-label">China → Denmark</span>
          <span class="leg-flight-sub">Harbin · Beijing · Copenhagen</span>
        </span>
      </div>
      ${list}
      <div class="leg-flight-row ${_activeMotionId === 'flight-return' ? 'active' : ''}" data-motion-id="flight-return">
        <span class="leg-flight-icon">✈️</span>
        <span class="leg-flight-main">
          <span class="leg-flight-label">Denmark → China</span>
          <span class="leg-flight-sub">Copenhagen · Beijing · Harbin</span>
        </span>
      </div>
    </div>`;

  view.querySelectorAll<HTMLButtonElement>('.leg-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      stopReplayMotion();
      const id = btn.dataset.id!;
      focusLeg(id);
      const leg = legs.find((l)=>l.id===id); if (!leg) return;
      lightCountry(leg.iso);
      if (_chart) _chart.zoomToGeoPoint?.({ longitude:leg.lng, latitude:leg.lat }, 6, true, 700);
    });
  });
}

function focusLeg(id: string) {
  focusMotion(id);
}
