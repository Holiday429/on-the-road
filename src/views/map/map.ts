/* ==========================================================================
   On the Road · My Map (amCharts5)
   --------------------------------------------------------------------------
   Reuses Marginalia's amCharts5 architecture (world polygon series + per-
   country province drilldown + custom tooltip), rebuilt for travel:
     - World map, Europe-focused. Visited countries are highlighted.
     - The 9 trip countries (DK/DE/NL/BE/FR/ES/PT/CH/IT) drill down to their
       provinces/regions when clicked — same mechanism as MG's China.
     - Route line + numbered city pins overlay the map.
     - The logo.gif protagonist travels the route; a Play button replays it
       in date order.
     - Hover shows a branded tooltip; a side panel lists every leg.

   amCharts + geodata load lazily (see amcharts-loader.ts) so other pages stay
   fast. The whole thing is self-contained — no reading-app coupling.
   ========================================================================== */

import './map.css';
import { coordsFor, isoFor, primaryCity, EUROPE_CENTER } from './geo.ts';
import { loadAmCharts, loadCountryGeodata, preloadDrilldownCountries, DRILLDOWN_COUNTRIES } from './amcharts-loader.ts';

const ROUTE_KEY = 'otr:route:legs';
const HERO_GIF = '/art/logo.gif';

interface Leg {
  id: string; city: string; country: string; flag: string;
  dateFrom: string; dateTo: string; notes?: string;
}
interface PlottedLeg extends Leg { lat: number; lng: number; iso: string | null; }

/* ── Brand colors for the map ─────────────────────────────────────────────── */
const C = {
  land:        '#fde6c0',   // unvisited country
  landStroke:  '#e8c987',
  visited:     '#f9b830',   // visited country (amber)
  visitedHi:   '#f59e0b',
  drillFill:   '#fcd34d',   // province base
  hover:       '#ef4444',   // coral accent
  route:       '#ef4444',
  ink:         '#3a1d6e',
  sea:         '#eaf6fb',
};

let _initialized = false;
let _root: any = null;
let _chart: any = null;
let _activeId: string | null = null;
let _drillSeries: any = null;        // currently shown province series
let _drillCode: string | null = null;
let _replayTimer: number | null = null;

/* ── Data ─────────────────────────────────────────────────────────────────── */
function loadLegs(): Leg[] {
  try {
    const raw = localStorage.getItem(ROUTE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function plot(legs: Leg[]): PlottedLeg[] {
  const out: PlottedLeg[] = [];
  for (const leg of legs) {
    const c = coordsFor(leg.city);
    if (!c) continue;
    out.push({ ...leg, lat: c.lat, lng: c.lng, iso: isoFor(leg.country) });
  }
  return out;
}

function visitedISOs(legs: PlottedLeg[]): Set<string> {
  return new Set(legs.map((l) => l.iso).filter(Boolean) as string[]);
}

function fmtRange(from: string, to: string): string {
  const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${new Date(from).toLocaleDateString('en-US', o)} – ${new Date(to).toLocaleDateString('en-US', o)}`;
}
function nights(from: string, to: string): number {
  return Math.max(0, Math.round((+new Date(to) - +new Date(from)) / 86400000));
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */
export function initMap() {
  if (_initialized) return;
  _initialized = true;

  const view = document.getElementById('view-map');
  if (!view) return;

  view.querySelector('.view-header')!.innerHTML = `
    <div class="view-title">My map</div>
    <div class="view-subtitle">Your footprint across Europe — click a country to zoom into its regions.</div>`;

  const body = view.querySelector('.stub-body');
  if (body) {
    body.outerHTML = `
      <div class="map-layout">
        <div class="map-stage">
          <div id="mapChart" class="map-chart"></div>
          <div class="map-tooltip" id="mapTooltip">
            <span class="map-tooltip-name" id="mapTooltipName"></span>
            <span class="map-tooltip-meta" id="mapTooltipMeta"></span>
          </div>
          <div class="map-toolbar">
            <button class="map-tool-btn" id="mapReplay" title="Replay route">▶ Replay route</button>
            <button class="map-tool-btn" id="mapBack" title="Back to Europe" hidden>← Back</button>
          </div>
          <div class="map-loading" id="mapLoading">Loading map…</div>
        </div>
        <aside class="map-panel"></aside>
      </div>`;
  }

  const legs = plot(loadLegs());

  if (legs.length === 0) {
    (view.querySelector('.map-stage') as HTMLElement).innerHTML = `
      <div class="map-empty">
        <img src="/art/earth_trans.png" alt="" class="map-empty-art">
        <div class="map-empty-title">No route yet</div>
        <div class="map-empty-sub">Add cities in <a href="#route">Itinerary</a> and they'll appear here.</div>
      </div>`;
    return;
  }

  renderPanel(view as HTMLElement, legs);

  loadAmCharts()
    .then(() => { bootChart(view as HTMLElement, legs); preloadDrilldownCountries(); })
    .catch((err) => {
      console.error('amCharts load failed', err);
      const el = document.getElementById('mapLoading');
      if (el) el.textContent = 'Map failed to load (offline?).';
    });
}

/* ── Chart ────────────────────────────────────────────────────────────────── */
function bootChart(view: HTMLElement, legs: PlottedLeg[]) {
  const root = am5.Root.new('mapChart');
  _root = root;
  root.setThemes([am5themes_Animated.new(root)]);
  if (root._logo) root._logo.dispose();

  const chart = root.container.children.push(
    am5map.MapChart.new(root, {
      projection: am5map.geoMercator(),
      panX: 'translateX', panY: 'translateY',
      wheelY: 'zoom', pinchZoom: true,
      homeZoomLevel: 4.2,
      homeGeoPoint: EUROPE_CENTER,
    }),
  );
  _chart = chart;

  const visited = visitedISOs(legs);

  /* World countries */
  const world = chart.series.push(am5map.MapPolygonSeries.new(root, {
    geoJSON: am5geodata_worldLow,
    exclude: ['AQ'],
  }));
  world.mapPolygons.template.setAll({
    interactive: true,
    fill: am5.color(C.land),
    stroke: am5.color(C.landStroke),
    strokeWidth: 0.6,
    nonScalingStroke: true,
  });
  world.mapPolygons.template.states.create('hover', {
    fill: am5.color(C.hover),
  });

  // Paint visited countries, and make non-drillable ones non-interactive feel.
  world.events.on('datavalidated', () => {
    world.mapPolygons.each((poly: any) => {
      const id = poly.dataItem?.get('id');
      if (visited.has(id)) {
        poly.setAll({ fill: am5.color(C.visited) });
        poly.states.create('hover', { fill: am5.color(C.visitedHi) });
      }
      poly.set('cursorOverStyle', DRILLDOWN_COUNTRIES[id] ? 'pointer' : 'default');
    });
  });

  const tooltip = document.getElementById('mapTooltip')!;
  const tipName = document.getElementById('mapTooltipName')!;
  const tipMeta = document.getElementById('mapTooltipMeta')!;

  world.mapPolygons.template.events.on('pointerover', (ev: any) => {
    const id = ev.target.dataItem.get('id');
    const name = ev.target.dataItem.dataContext?.name ?? id;
    const legHere = legs.filter((l) => l.iso === id);
    tipName.textContent = name;
    tipMeta.textContent = legHere.length
      ? `${legHere.length} stop${legHere.length > 1 ? 's' : ''}${DRILLDOWN_COUNTRIES[id] ? ' · click to zoom in' : ''}`
      : (DRILLDOWN_COUNTRIES[id] ? 'click to zoom in' : '');
    tooltip.classList.add('visible');
  });
  world.mapPolygons.template.events.on('globalpointermove', (ev: any) => {
    positionTooltip(view, ev);
  });
  world.mapPolygons.template.events.on('pointerout', () => tooltip.classList.remove('visible'));

  world.mapPolygons.template.events.on('click', (ev: any) => {
    const id = ev.target.dataItem.get('id');
    if (DRILLDOWN_COUNTRIES[id]) drillCountry(id, ev.target.dataItem.dataContext?.name ?? id);
  });

  /* Route line */
  const lineSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
  lineSeries.mapLines.template.setAll({
    stroke: am5.color(C.route), strokeWidth: 2.5, strokeOpacity: 0.85,
    strokeDasharray: [4, 6],
  });
  lineSeries.pushDataItem({
    geometry: { type: 'LineString', coordinates: legs.map((l) => [l.lng, l.lat]) },
  });

  /* City pins */
  const pinSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
  pinSeries.bullets.push((bRoot: any, _series: any, dataItem: any) => {
    const i = dataItem.dataContext.index;
    const container = am5.Container.new(bRoot, {});
    container.children.push(am5.Circle.new(bRoot, {
      radius: 9, fill: am5.color('#ffffff'),
      stroke: am5.color(C.route), strokeWidth: 3,
    }));
    container.children.push(am5.Label.new(bRoot, {
      text: String(i + 1), centerX: am5.p50, centerY: am5.p50,
      fontSize: 10, fontWeight: '700', fill: am5.color(C.route),
      populateText: false,
    }));
    return am5.Bullet.new(bRoot, { sprite: container });
  });
  pinSeries.data.setAll(legs.map((l, index) => ({
    geometry: { type: 'Point', coordinates: [l.lng, l.lat] },
    index, id: l.id,
  })));

  /* Hero (logo.gif) — driven as a real HTML <img> so the GIF actually animates.
     amCharts renders to canvas (which only paints a GIF's first frame), so we
     keep an invisible point item as the animated position source of truth and
     mirror it to an <img> overlay every frame via chart.convert(). */
  const heroData = chart.series.push(am5map.MapPointSeries.new(root, {}));
  const heroItem = heroData.pushDataItem({
    longitude: legs[0].lng, latitude: legs[0].lat,
  });
  (chart as any)._heroItem = heroItem;

  // The overlay element lives in .map-stage, above the canvas.
  let heroImg = document.querySelector('.map-hero-img') as HTMLImageElement | null;
  if (!heroImg) {
    heroImg = document.createElement('img');
    heroImg.className = 'map-hero-img';
    heroImg.src = HERO_GIF;
    heroImg.alt = '';
    (document.querySelector('.map-stage') as HTMLElement).appendChild(heroImg);
  }
  (chart as any)._heroImg = heroImg;

  // Keep the <img> glued to the item's geo position on every zoom/pan/animation.
  const syncHero = () => {
    const img = (chart as any)._heroImg as HTMLImageElement;
    const it = (chart as any)._heroItem;
    if (!img || !it) return;
    const lng = it.get('longitude');
    const lat = it.get('latitude');
    if (lng == null || lat == null) return;
    const px = chart.convert({ longitude: lng, latitude: lat });
    if (px) { img.style.left = `${px.x}px`; img.style.top = `${px.y}px`; }
  };
  (chart as any)._syncHero = syncHero;
  // Re-sync continuously; amCharts fires 'frameended' each render frame.
  root.events.on('frameended', syncHero);

  chart.appear(700, 100).then(() => {
    document.getElementById('mapLoading')?.remove();
    // Snap to the Europe-focused home view, then send the hero traveling.
    chart.goHome?.(600);
    setTimeout(() => { syncHero(); travelHero(legs); }, 700);
  });

  // Toolbar
  document.getElementById('mapReplay')?.addEventListener('click', () => travelHero(legs, true));
  document.getElementById('mapBack')?.addEventListener('click', backToEurope);
}

/* ── Tooltip positioning ──────────────────────────────────────────────────── */
function positionTooltip(view: HTMLElement, ev: any) {
  const tooltip = document.getElementById('mapTooltip');
  const stage = view.querySelector('.map-stage') as HTMLElement;
  if (!tooltip || !stage || !ev?.point) return;
  const r = stage.getBoundingClientRect();
  // ev.point is relative to the chart root; offset within stage
  tooltip.style.left = `${ev.point.x}px`;
  tooltip.style.top = `${ev.point.y}px`;
  void r;
}

/* ── Drilldown ────────────────────────────────────────────────────────────── */
async function drillCountry(code: string, name: string) {
  if (_drillCode === code) return;
  await loadCountryGeodata(code);
  const meta = DRILLDOWN_COUNTRIES[code];
  const geo = (window as any)[meta.global];
  if (!geo) { console.warn('geodata missing for', code); return; }

  if (_drillSeries) { _drillSeries.dispose(); _drillSeries = null; }

  const series = _chart.series.push(am5map.MapPolygonSeries.new(_root, { geoJSON: geo }));
  series.mapPolygons.template.setAll({
    interactive: true, cursorOverStyle: 'pointer',
    fill: am5.color(C.drillFill),
    // White borders between regions read clearly over the amber country fill.
    stroke: am5.color('#ffffff'), strokeWidth: 1.2, nonScalingStroke: true,
    shadowColor: am5.color(C.ink), shadowBlur: 6, shadowOpacity: 0.12,
  });
  series.mapPolygons.template.states.create('hover', {
    fill: am5.color(C.hover), stroke: am5.color('#ffffff'), strokeWidth: 1.5,
  });

  const tooltip = document.getElementById('mapTooltip')!;
  const tipName = document.getElementById('mapTooltipName')!;
  const tipMeta = document.getElementById('mapTooltipMeta')!;
  series.mapPolygons.template.events.on('pointerover', (ev: any) => {
    tipName.textContent = ev.target.dataItem.dataContext?.name ?? '';
    tipMeta.textContent = name;
    tooltip.classList.add('visible');
  });
  series.mapPolygons.template.events.on('globalpointermove', (ev: any) => {
    const view = document.getElementById('view-map') as HTMLElement;
    positionTooltip(view, ev);
  });
  series.mapPolygons.template.events.on('pointerout', () => tooltip.classList.remove('visible'));

  _drillSeries = series;
  _drillCode = code;

  // Zoom to the country once its geometry is ready.
  series.events.once('datavalidated', () => {
    try {
      const b = series.geoBounds();
      if (b) { _chart.zoomToGeoBounds(b, 700); return; }
    } catch { /* fall through */ }
    _chart.zoomToGeoPoint(geoCentroidOf(series), 16, true, 700);
  });

  (document.getElementById('mapBack') as HTMLElement).hidden = false;
}

function geoCentroidOf(series: any) {
  try {
    const b = series.geoBounds();
    return { longitude: (b.left + b.right) / 2, latitude: (b.top + b.bottom) / 2 };
  } catch { return EUROPE_CENTER; }
}

function backToEurope() {
  if (_drillSeries) { _drillSeries.dispose(); _drillSeries = null; _drillCode = null; }
  (document.getElementById('mapBack') as HTMLElement).hidden = true;
  _chart.goHome?.(800);
}

/* ── Hero travel / replay ─────────────────────────────────────────────────── */
function travelHero(legs: PlottedLeg[], replay = false) {
  const item = (_chart as any)?._heroItem;
  if (!item || legs.length === 0) return;
  if (_replayTimer) { clearTimeout(_replayTimer); _replayTimer = null; }

  if (!replay && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    const last = legs[legs.length - 1];
    item.set('longitude', last.lng); item.set('latitude', last.lat);
    return;
  }

  let i = 0;
  item.set('longitude', legs[0].lng); item.set('latitude', legs[0].lat);
  focusLeg(legs[0].id);

  const stepTo = (idx: number) => {
    const l = legs[idx];
    // animate the data item's geo position
    item.animate({ key: 'longitude', to: l.lng, duration: 900, easing: am5.ease.inOut(am5.ease.cubic) });
    item.animate({ key: 'latitude', to: l.lat, duration: 900, easing: am5.ease.inOut(am5.ease.cubic) });
    focusLeg(l.id);
  };

  const tick = () => {
    i++;
    if (i >= legs.length) return;
    stepTo(i);
    _replayTimer = window.setTimeout(tick, 1100);
  };
  _replayTimer = window.setTimeout(tick, 700);
}

/* ── Side panel ───────────────────────────────────────────────────────────── */
function renderPanel(view: HTMLElement, legs: PlottedLeg[]) {
  const countries = new Set(legs.map((l) => l.country)).size;
  const list = legs.map((l, i) => `
    <button class="leg-row ${l.id === _activeId ? 'active' : ''}" data-id="${l.id}">
      <span class="leg-row-num">${i + 1}</span>
      <span class="leg-row-main">
        <span class="leg-row-city">${l.flag} ${l.city}</span>
        <span class="leg-row-meta">${fmtRange(l.dateFrom, l.dateTo)} · ${nights(l.dateFrom, l.dateTo)} nights</span>
      </span>
    </button>`).join('');

  (view.querySelector('.map-panel') as HTMLElement).innerHTML = `
    <div class="map-stats">
      <div class="map-stat"><div class="map-stat-num">${legs.length}</div><div class="map-stat-label">Cities</div></div>
      <div class="map-stat"><div class="map-stat-num">${countries}</div><div class="map-stat-label">Countries</div></div>
    </div>
    <div class="map-legs">${list}</div>`;

  view.querySelectorAll<HTMLButtonElement>('.leg-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id!;
      focusLeg(id);
      const leg = legs.find((l) => l.id === id);
      if (leg && _chart) _chart.zoomToGeoPoint?.({ longitude: leg.lng, latitude: leg.lat }, 6, true, 700);
    });
  });
}

function focusLeg(id: string) {
  _activeId = id;
  document.querySelectorAll('.leg-row').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.id === id);
  });
}

void primaryCity;  // kept for future use (label shortening)
