/* ==========================================================================
   On the Road · Journal places — the route map
   --------------------------------------------------------------------------
   The Route page's own drawing, borrowed: `views/map/route-layer.ts` puts the
   trip's line, its numbered pins and its country paint on this chart, so the
   Journal and the Map can never show different trips.

   What Places adds is the focus. The viewport always frames the WHOLE route —
   picking a country never zooms into it, because the point of the map here is to
   show where that country sits in the trip. Instead the picked country keeps its
   colour while the rest of the route's countries go grey. The small places you
   wrote about inside it sit on the line as pins carrying their entry counts.

   Click a pin or a route country to pick it. One chart at a time; it lives in a
   node marked `data-morph-keep` so the journal's re-renders leave it alone.
   ========================================================================== */

import { loadAmCharts } from '../../map/amcharts-loader.ts';
import { createMapRoot, disposeRoot, waitForSize, motionMs } from '../../map/amcharts-boot.ts';
import { mapColors, onMapRepaint, worldPalette } from '../../map/map-theme.ts';
import { createRouteLayer, type RouteLayer, type RouteStop } from '../../map/route-layer.ts';
import { todayIso } from '../../../data/trip-phase.ts';
import type { Am5Obj } from '../../map/map-amcharts.ts';
import { countryKey, type MapPin } from './places-model.ts';

export interface PlacesMapDeps {
  /** A pin or a route country was clicked: this pick key ('c:PT' or a place key) is now the chosen one. */
  onPick: (key: string) => void;
}

/** What the markup hands the map: the route, the place pins, the countries with entries, and the pick. */
export interface PlacesMapModel {
  route: RouteStop[];
  pins: MapPin[];
  isos: string[];
  /** The focused country ('' when the pick has none). */
  iso: string;
  /** The pick key — a country ('c:PT') or one place. */
  key: string;
}

interface Live {
  el: HTMLElement;
  root: Am5Obj;
  chart: Am5Obj;
  pinSeries: Am5Obj;
  layer: RouteLayer;
  model: PlacesMapModel;
  json: string;
  off: () => void;
}

let live: Live | null = null;
let building = 0;

/** Bigger bubble for a place with more to read; the chosen one is larger still. */
export function pinRadius(count: number, selected: boolean): number {
  const base = 8 + Math.min(5, Math.max(0, count - 1));
  return selected ? base + 3 : base;
}

function readModel(el: HTMLElement): PlacesMapModel {
  try { return JSON.parse(el.dataset.model ?? '') as PlacesMapModel; } catch { return { route: [], pins: [], isos: [], iso: '', key: '' }; }
}

/** The place pins of the focused country — the small spots inside it. */
function pinsOf(m: PlacesMapModel): MapPin[] {
  return m.iso ? m.pins.filter((p) => p.iso === m.iso) : [];
}

function toDatum(p: MapPin) {
  return { ...p, longitude: p.lng, latitude: p.lat };
}

function restylePins(l: Live): void {
  const am5 = (window as Am5Obj).am5;
  const c = mapColors();
  l.pinSeries.dataItems.forEach((item: Am5Obj) => {
    const ctx = item.dataContext as MapPin;
    const circle = item.bullets?.[0]?.get('sprite')?.children.getIndex(0);
    if (!circle) return;
    const on = ctx.key === l.model.key;
    circle.setAll({
      radius: pinRadius(ctx.count, on),
      fill: am5.color(on ? c.hover : c.ink),
      strokeWidth: on ? 3 : 2,
    });
  });
}

/**
 * Frame the whole route, always.
 *
 * Places answers "where in the trip is this country", so the viewport never
 * follows the pick — only the colouring does.
 */
function fitRoute(l: Live, animate: boolean): void {
  const pts = [...l.model.route, ...l.model.pins];
  const ms = animate ? motionMs(600) : 0;
  if (!pts.length) { l.chart.goHome(ms); return; }
  if (pts.length === 1) { l.chart.zoomToGeoPoint({ longitude: pts[0].lng, latitude: pts[0].lat }, 4, true, ms); return; }
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  try {
    l.chart.zoomToGeoBounds({
      left: Math.min(...lngs) - 4, right: Math.max(...lngs) + 4,
      top: Math.max(...lats) + 3, bottom: Math.min(...lats) - 3,
    }, ms);
  } catch { l.chart.goHome(); }
}

export function disposePlacesMap(): void {
  building++;   // cancel any build still waiting on the CDN
  if (live) { live.off(); disposeRoot(live.root); live = null; }
}

/** Call after each render. Builds the chart once per node, then only repaints it. */
export async function syncPlacesMap(root: ParentNode, deps: PlacesMapDeps): Promise<void> {
  const el = root.querySelector<HTMLElement>('[data-places-map]');
  if (!el) { disposePlacesMap(); return; }

  const json = el.dataset.model ?? '';
  const model = readModel(el);

  if (live && live.el === el) {
    if (live.json === json) return;
    const rerouted = JSON.stringify(live.model.route) !== JSON.stringify(model.route);
    live.json = json;
    live.model = model;
    live.layer.update(model.route, { focusIso: model.iso || null, pins: true });
    live.pinSeries.data.setAll(pinsOf(model).map(toDatum));
    restylePins(live);
    if (rerouted) fitRoute(live, true);
    return;
  }

  disposePlacesMap();
  const ticket = ++building;
  try {
    await loadAmCharts();
    await waitForSize(el);
  } catch {
    if (ticket === building) el.dataset.failed = '1';
    return;
  }
  if (ticket !== building || !el.isConnected) return;

  const am5 = (window as Am5Obj).am5;
  const am5map = (window as Am5Obj).am5map;
  const geodata = (window as Am5Obj).am5geodata_worldLow;
  const r = createMapRoot(el, { animated: false });

  const chart = r.container.children.push(am5map.MapChart.new(r, {
    projection: am5map.geoMercator(),
    panX: 'translateX', panY: 'translateY', wheelX: 'none', wheelY: 'none',
    minZoomLevel: 1, maxZoomLevel: 16, zoomStep: 1.3,
  }));
  const world = chart.series.push(am5map.MapPolygonSeries.new(r, { geoJSON: geodata, exclude: ['AQ'] }));
  world.mapPolygons.template.setAll({ interactive: true, cursorOverStyle: 'default', nonScalingStroke: true });
  world.mapPolygons.template.events.on('click', (ev: Am5Obj) => {
    const id: string | undefined = ev.target.dataItem?.get('id');
    if (id && live && live.model.isos.includes(id)) deps.onPick(countryKey(id));
  });

  const layer = createRouteLayer(r, chart, world, todayIso(), model.route, { focusIso: model.iso || null, pins: true });

  // The journal's own pins: one per place written about inside the focused country.
  const pinSeries = chart.series.push(am5map.MapPointSeries.new(r, {}));
  pinSeries.bullets.push((root2: Am5Obj, _s: Am5Obj, item: Am5Obj) => {
    const ctx = item.dataContext as MapPin;
    const box = am5.Container.new(root2, { cursorOverStyle: 'pointer', tooltipText: '{label} · {count}' });
    box.children.push(am5.Circle.new(root2, { radius: pinRadius(ctx.count, false), fill: am5.color(mapColors().ink), stroke: am5.color(worldPalette().ocean), strokeWidth: 2 }));
    box.children.push(am5.Label.new(root2, {
      text: String(ctx.count), fontSize: 10, fontWeight: '700', fill: am5.color(worldPalette().ocean),
      centerX: am5.percent(50), centerY: am5.percent(50), interactive: false,
    }));
    box.events.on('click', () => deps.onPick(ctx.key));
    return am5.Bullet.new(root2, { sprite: box });
  });

  const next: Live = { el, root: r, chart, pinSeries, layer, model, json, off: () => {} };
  live = next;
  next.off = onMapRepaint(() => { layer.repaint(); restylePins(next); });
  // The world series validates its data asynchronously; paint once it has polygons.
  world.events.on('datavalidated', () => layer.update(next.model.route, { focusIso: next.model.iso || null, pins: true }));
  pinSeries.data.setAll(pinsOf(model).map(toDatum));
  chart.events.once('boundschanged', () => {
    requestAnimationFrame(() => { restylePins(next); fitRoute(next, false); });
  });
  chart.appear(motionMs(600));
}
