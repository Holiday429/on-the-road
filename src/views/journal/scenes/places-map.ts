/* ==========================================================================
   On the Road · Journal places — the country map
   --------------------------------------------------------------------------
   The same amCharts world the Map page and the Dashboard draw — real country
   shapes from the shared geodata, countries lit in the shared country colours,
   one pin per place with its entry count — instead of a separate Leaflet tile
   map. Click a pin (or a lit country) to pick that place on the line below;
   picking on the line flies the map there. One chart at a time; it lives in a
   node marked `data-morph-keep` so the journal's re-renders leave it alone.
   ========================================================================== */

import { loadAmCharts } from '../../map/amcharts-loader.ts';
import { createMapRoot, disposeRoot, waitForSize, motionMs } from '../../map/amcharts-boot.ts';
import { countryColor, mapColors, onMapRepaint } from '../../map/map-theme.ts';
import type { Am5Obj } from '../../map/map-amcharts.ts';
import type { MapPin } from './places-model.ts';

export interface PlacesMapDeps {
  /** A pin or a lit country was clicked: this place key is now the chosen one. */
  onPick: (key: string) => void;
}

interface Live {
  el: HTMLElement;
  root: Am5Obj;
  chart: Am5Obj;
  pinSeries: Am5Obj;
  pinsJson: string;
  selected: string;
  off: () => void;
}

let live: Live | null = null;
let building = 0;

/** Bigger bubble for a place with more to read; the chosen one is larger still and ringed. */
export function pinRadius(count: number, selected: boolean): number {
  const base = 9 + Math.min(6, Math.max(0, count - 1));
  return selected ? base + 4 : base;
}

function readPins(el: HTMLElement): MapPin[] {
  try { return JSON.parse(el.dataset.pins ?? '[]') as MapPin[]; } catch { return []; }
}

function restyle(l: Live): void {
  const am5 = (window as Am5Obj).am5;
  const c = mapColors();
  l.pinSeries.dataItems.forEach((item: Am5Obj) => {
    const ctx = item.dataContext as MapPin;
    const sprite = item.bullets?.[0]?.get('sprite');
    const circle = sprite?.children.getIndex(0);
    if (!circle) return;
    const on = ctx.key === l.selected;
    circle.setAll({
      radius: pinRadius(ctx.count, on),
      fill: am5.color(on ? c.hover : c.route),
      strokeWidth: on ? 3 : 2,
    });
  });
}

function fit(l: Live, pins: MapPin[]): void {
  if (!pins.length) { l.chart.goHome(); return; }
  if (pins.length === 1) { l.chart.zoomToGeoPoint({ longitude: pins[0].lng, latitude: pins[0].lat }, 4, true, motionMs(500)); return; }
  const lats = pins.map((p) => p.lat), lngs = pins.map((p) => p.lng);
  try {
    l.chart.zoomToGeoBounds({
      left: Math.min(...lngs) - 6, right: Math.max(...lngs) + 6,
      top: Math.max(...lats) + 5, bottom: Math.min(...lats) - 5,
    }, motionMs(500));
  } catch { l.chart.goHome(); }
}

export function disposePlacesMap(): void {
  building++;   // cancel any build still waiting on the CDN
  if (live) { live.off(); disposeRoot(live.root); live = null; }
}

/** Call after each render. Builds the chart once per node, then only restyles / re-aims it. */
export async function syncPlacesMap(root: ParentNode, deps: PlacesMapDeps): Promise<void> {
  const el = root.querySelector<HTMLElement>('[data-places-map]');
  if (!el) { disposePlacesMap(); return; }

  const pins = readPins(el);
  const pinsJson = el.dataset.pins ?? '[]';
  const selected = el.dataset.selected ?? '';

  if (live && live.el === el) {
    const moved = live.selected !== selected;
    live.selected = selected;
    if (live.pinsJson !== pinsJson) {
      live.pinsJson = pinsJson;
      live.pinSeries.data.setAll(pins.map(toDatum));
      fit(live, pins);
    }
    restyle(live);
    const pin = pins.find((p) => p.key === selected);
    if (moved && pin) live.chart.zoomToGeoPoint({ longitude: pin.lng, latitude: pin.lat }, Math.max(3.5, live.chart.get('zoomLevel') ?? 1), true, motionMs(600));
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
  const countries = new Set(pins.map((p) => p.iso).filter((x): x is string => !!x));
  const paint = () => {
    const c = mapColors();
    world.mapPolygons.template.setAll({
      fill: am5.color(c.land), fillOpacity: 0.95, stroke: am5.color(c.landStroke), strokeWidth: 1, nonScalingStroke: true,
    });
    world.mapPolygons.each((poly: Am5Obj) => {
      const id: string | undefined = poly.dataItem?.get('id');
      if (id && countries.has(id)) poly.setAll({ fill: am5.color(countryColor(id)), fillOpacity: 0.9, interactive: true, cursorOverStyle: 'pointer' });
      else poly.setAll({ fill: am5.color(c.land), fillOpacity: 0.95 });
    });
  };
  world.mapPolygons.template.setAll({ interactive: false });
  world.mapPolygons.template.events.on('click', (ev: Am5Obj) => {
    const id: string | undefined = ev.target.dataItem?.get('id');
    if (!id || !live) return;
    const here = readPins(live.el).filter((p) => p.iso === id);
    if (here.length) deps.onPick(here[here.length - 1].key);
  });
  world.events.on('datavalidated', paint);

  const pinSeries = chart.series.push(am5map.MapPointSeries.new(r, {}));
  pinSeries.bullets.push((root2: Am5Obj, _s: Am5Obj, item: Am5Obj) => {
    const ctx = item.dataContext as MapPin;
    const box = am5.Container.new(root2, { cursorOverStyle: 'pointer', tooltipText: '{label} · {count}' });
    box.children.push(am5.Circle.new(root2, { radius: pinRadius(ctx.count, false), fill: am5.color(mapColors().route), stroke: am5.color(mapColors().land), strokeWidth: 2 }));
    box.children.push(am5.Label.new(root2, {
      text: String(ctx.count), fontSize: 10, fontWeight: '700', fill: am5.color(mapColors().land),
      centerX: am5.percent(50), centerY: am5.percent(50), interactive: false,
    }));
    box.events.on('click', () => deps.onPick(ctx.key));
    return am5.Bullet.new(root2, { sprite: box });
  });
  pinSeries.data.setAll(pins.map(toDatum));

  const next: Live = {
    el, root: r, chart, pinSeries, pinsJson, selected, off: () => {},
  };
  live = next;
  next.off = onMapRepaint(() => { paint(); restyle(next); });
  chart.events.once('boundschanged', () => {
    requestAnimationFrame(() => {
      restyle(next);
      const pin = pins.find((p) => p.key === selected);
      if (pin && pins.length > 1) {
        // open on the chosen place, with its neighbours still in view
        chart.zoomToGeoPoint({ longitude: pin.lng, latitude: pin.lat }, 3.2, true, 0);
      } else fit(next, pins);
    });
  });
  chart.appear(motionMs(600));
}

function toDatum(p: MapPin) {
  return { ...p, longitude: p.lng, latitude: p.lat };
}
