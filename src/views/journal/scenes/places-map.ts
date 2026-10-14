/* ==========================================================================
   On the Road · Journal places — the route map
   --------------------------------------------------------------------------
   The same amCharts world the Map page draws, and the same route: the trip's
   legs joined by arcs. Only the country you picked is lit; every other country
   is grey. The line is coloured as far as you have got — the legs behind you and
   the one you are in — and plain dashed grey beyond that. The small places you
   wrote about inside the lit country sit on it as pins with their entry counts.
   Click a pin or the lit country to pick it; picking from the line above flies
   the map there. One chart at a time; it lives in a node marked
   `data-morph-keep` so the journal's re-renders leave it alone.
   ========================================================================== */

import { loadAmCharts } from '../../map/amcharts-loader.ts';
import { createMapRoot, disposeRoot, waitForSize, motionMs } from '../../map/amcharts-boot.ts';
import { countryColor, mapColors, onMapRepaint, worldPalette } from '../../map/map-theme.ts';
import { arcPoints } from '../../map/map-geo.ts';
import type { Am5Obj } from '../../map/map-amcharts.ts';
import { countryKey, type MapPin, type RouteNode } from './places-model.ts';

export interface PlacesMapDeps {
  /** A pin or a lit country was clicked: this pick key ('c:PT' or a place key) is now the chosen one. */
  onPick: (key: string) => void;
}

/** What the markup hands the map: the route, the pins, the countries with entries, and the pick. */
export interface PlacesMapModel {
  route: RouteNode[];
  pins: MapPin[];
  isos: string[];
  /** The lit country ('' when the pick has none). */
  iso: string;
  /** The pick key — a country ('c:PT') or one place. */
  key: string;
}

interface Live {
  el: HTMLElement;
  root: Am5Obj;
  chart: Am5Obj;
  world: Am5Obj;
  pinSeries: Am5Obj;
  doneSeries: Am5Obj;
  aheadSeries: Am5Obj;
  nodeSeries: Am5Obj;
  model: PlacesMapModel;
  json: string;
  off: () => void;
}

let live: Live | null = null;
let building = 0;

/** Bigger bubble for a place with more to read; the chosen one is larger still. */
export function pinRadius(count: number, selected: boolean): number {
  const base = 9 + Math.min(6, Math.max(0, count - 1));
  return selected ? base + 4 : base;
}

/** Route segments split into the part travelled (or under way) and the part still ahead. */
export function routeSegments(route: RouteNode[]): { done: [number, number][][]; ahead: [number, number][][] } {
  const done: [number, number][][] = [], ahead: [number, number][][] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const seg = arcPoints(route[i], route[i + 1], 20, 0.15);
    (route[i + 1].reached ? done : ahead).push(seg);
  }
  return { done, ahead };
}

function readModel(el: HTMLElement): PlacesMapModel {
  try { return JSON.parse(el.dataset.model ?? '') as PlacesMapModel; } catch { return { route: [], pins: [], isos: [], iso: '', key: '' }; }
}

/** The pins of the lit country — the small places inside it. */
function pinsOf(m: PlacesMapModel): MapPin[] {
  return m.iso ? m.pins.filter((p) => p.iso === m.iso) : [];
}

function toDatum(p: MapPin) {
  return { ...p, longitude: p.lng, latitude: p.lat };
}

function paintWorld(l: Live): void {
  const am5 = (window as Am5Obj).am5;
  const w = worldPalette();
  const known = new Set(l.model.isos);
  l.world.mapPolygons.template.setAll({ fill: am5.color(w.land), fillOpacity: 1, stroke: am5.color(w.border), strokeWidth: 0.8, nonScalingStroke: true });
  l.world.mapPolygons.each((poly: Am5Obj) => {
    const id: string | undefined = poly.dataItem?.get('id');
    const lit = !!id && id === l.model.iso;
    poly.setAll({
      fill: am5.color(lit ? countryColor(id!) : w.land),
      stroke: am5.color(lit ? mapColors().ink : w.border),
      strokeWidth: lit ? 1.4 : 0.8,
      interactive: !!id && known.has(id),
      cursorOverStyle: 'pointer',
    });
  });
}

function paintRoute(l: Live): void {
  const am5 = (window as Am5Obj).am5;
  const c = mapColors();
  const w = worldPalette();
  l.doneSeries.mapLines.template.setAll({ stroke: am5.color(c.route), strokeWidth: 2.8, strokeOpacity: 0.95, strokeDasharray: [] });
  l.aheadSeries.mapLines.template.setAll({ stroke: am5.color(w.border), strokeWidth: 2, strokeOpacity: 0.7, strokeDasharray: [3, 6] });
  l.nodeSeries.dataItems.forEach((item: Am5Obj) => {
    const dot = item.bullets?.[0]?.get('sprite');
    const reached = (item.dataContext as RouteNode).reached;
    dot?.setAll({ fill: am5.color(reached ? c.route : w.land), stroke: am5.color(reached ? w.ocean : w.border) });
  });
}

function drawRoute(l: Live): void {
  const { done, ahead } = routeSegments(l.model.route);
  l.doneSeries.data.setAll(done.map((coordinates) => ({ geometry: { type: 'LineString', coordinates } })));
  l.aheadSeries.data.setAll(ahead.map((coordinates) => ({ geometry: { type: 'LineString', coordinates } })));
  l.nodeSeries.data.setAll(l.model.route.map((n) => ({ ...n, longitude: n.lng, latitude: n.lat })));
  paintRoute(l);
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
      fill: am5.color(on ? c.hover : c.route),
      strokeWidth: on ? 3 : 2,
    });
  });
}

/** Bring the lit country (or the chosen place inside it) into view. */
function fit(l: Live, animate: boolean): void {
  const m = l.model;
  const pin = m.pins.find((p) => p.key === m.key);
  const ms = animate ? motionMs(600) : 0;
  if (pin) { l.chart.zoomToGeoPoint({ longitude: pin.lng, latitude: pin.lat }, Math.max(5, l.chart.get('zoomLevel') ?? 1), true, ms); return; }
  const pts = [
    ...m.route.filter((n) => n.iso === m.iso).map((n) => ({ lat: n.lat, lng: n.lng })),
    ...pinsOf(m).map((p) => ({ lat: p.lat, lng: p.lng })),
  ];
  if (!m.iso || !pts.length) { l.chart.goHome(ms); return; }
  if (pts.length === 1) { l.chart.zoomToGeoPoint({ longitude: pts[0].lng, latitude: pts[0].lat }, 5, true, ms); return; }
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  try {
    l.chart.zoomToGeoBounds({
      left: Math.min(...lngs) - 3, right: Math.max(...lngs) + 3,
      top: Math.max(...lats) + 2.5, bottom: Math.min(...lats) - 2.5,
    }, ms);
  } catch { l.chart.goHome(); }
}

export function disposePlacesMap(): void {
  building++;   // cancel any build still waiting on the CDN
  if (live) { live.off(); disposeRoot(live.root); live = null; }
}

/** Call after each render. Builds the chart once per node, then only repaints / re-aims it. */
export async function syncPlacesMap(root: ParentNode, deps: PlacesMapDeps): Promise<void> {
  const el = root.querySelector<HTMLElement>('[data-places-map]');
  if (!el) { disposePlacesMap(); return; }

  const json = el.dataset.model ?? '';
  const model = readModel(el);

  if (live && live.el === el) {
    if (live.json === json) return;
    const moved = live.model.key !== model.key;
    const reroute = JSON.stringify(live.model.route) !== JSON.stringify(model.route);
    live.json = json;
    live.model = model;
    paintWorld(live);
    if (reroute) drawRoute(live);
    live.pinSeries.data.setAll(pinsOf(model).map(toDatum));
    restylePins(live);
    if (moved) fit(live, true);
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
  const aheadSeries = chart.series.push(am5map.MapLineSeries.new(r, {}));
  const doneSeries = chart.series.push(am5map.MapLineSeries.new(r, {}));
  const nodeSeries = chart.series.push(am5map.MapPointSeries.new(r, {}));
  nodeSeries.bullets.push((root2: Am5Obj) => am5.Bullet.new(root2, {
    sprite: am5.Circle.new(root2, { radius: 4, strokeWidth: 1.5, interactive: false }),
  }));
  const pinSeries = chart.series.push(am5map.MapPointSeries.new(r, {}));
  pinSeries.bullets.push((root2: Am5Obj, _s: Am5Obj, item: Am5Obj) => {
    const ctx = item.dataContext as MapPin;
    const box = am5.Container.new(root2, { cursorOverStyle: 'pointer', tooltipText: '{label} · {count}' });
    box.children.push(am5.Circle.new(root2, { radius: pinRadius(ctx.count, false), fill: am5.color(mapColors().route), stroke: am5.color(worldPalette().ocean), strokeWidth: 2 }));
    box.children.push(am5.Label.new(root2, {
      text: String(ctx.count), fontSize: 10, fontWeight: '700', fill: am5.color(worldPalette().ocean),
      centerX: am5.percent(50), centerY: am5.percent(50), interactive: false,
    }));
    box.events.on('click', () => deps.onPick(ctx.key));
    return am5.Bullet.new(root2, { sprite: box });
  });

  world.mapPolygons.template.setAll({ interactive: false });
  world.mapPolygons.template.events.on('click', (ev: Am5Obj) => {
    const id: string | undefined = ev.target.dataItem?.get('id');
    if (id && live && live.model.isos.includes(id)) deps.onPick(countryKey(id));
  });

  const next: Live = { el, root: r, chart, world, pinSeries, doneSeries, aheadSeries, nodeSeries, model, json, off: () => {} };
  live = next;
  const repaint = () => { paintWorld(next); paintRoute(next); restylePins(next); };
  world.events.on('datavalidated', () => paintWorld(next));
  next.off = onMapRepaint(repaint);
  drawRoute(next);
  pinSeries.data.setAll(pinsOf(model).map(toDatum));
  chart.events.once('boundschanged', () => {
    requestAnimationFrame(() => { paintWorld(next); restylePins(next); fit(next, false); });
  });
  chart.appear(motionMs(600));
}
