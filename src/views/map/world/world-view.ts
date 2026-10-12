/* ==========================================================================
   On the Road · World — the oval world map
   --------------------------------------------------------------------------
   amCharts5 `geoNaturalEarth1` with `panX: 'rotateX'`: drag sideways and the
   world turns (it wraps), drag up/down to tilt, wheel/pinch to zoom. Picking a
   country switches the same chart to a flat Mercator and zooms in; going back
   restores the exact rotation and zoom from before.

   This file only draws. What to draw (visited / planned / levels) comes from the
   WorldModel; when a transition may proceed comes from world-state.ts.
   ========================================================================== */

import { createMapRoot, disposeRoot, motionMs } from '../amcharts-boot.ts';
import { loadCountryGeodata, DRILLDOWN_COUNTRIES } from '../amcharts-loader.ts';
import { expandBounds } from '../map-geo.ts';
import { onMapRepaint, worldPalette } from '../map-theme.ts';
import type { Am5Obj } from '../map-amcharts.ts';
import { countryTone, type ColorMode, type WorldModel } from './world-model.ts';
import { createWorldState, type WorldState } from './world-state.ts';

export interface WorldPaint {
  model: WorldModel;
  mode: ColorMode;
  /** Trip id → colour, for "colour by trip". */
  tripColors: ReadonlyMap<string, string>;
  /** Tooltip text per country (only countries with data). */
  tooltips: ReadonlyMap<string, string>;
}

export interface WorldViewHooks {
  /** A country with data was clicked / tapped. */
  onCountryClick(iso: string): void;
}

export interface WorldView {
  readonly state: WorldState;
  paint(p: WorldPaint): void;
  enterCountry(iso: string): Promise<boolean>;
  leaveCountry(): Promise<void>;
  zoom(action: 'in' | 'out' | 'fit'): void;
  dispose(): void;
}

/** Resolve on the next rendered frame, or after `fallbackMs` if none comes. */
function nextFrame(root: Am5Obj, fallbackMs = 400): Promise<void> {
  return new Promise((resolve) => {
    const t = window.setTimeout(resolve, fallbackMs);   // safety net only
    root.events.once('frameended', () => { window.clearTimeout(t); resolve(); });
  });
}

/** Wait for an amCharts animation to finish (or `fallbackMs`, so a transition can never hang). */
function settled(anim: Am5Obj, fallbackMs = 1600): Promise<void> {
  if (!anim?.waitForStop) return Promise.resolve();
  return Promise.race([anim.waitForStop(), new Promise<void>((r) => window.setTimeout(r, fallbackMs))]).then(() => undefined);
}

export function createWorldView(container: HTMLElement, hooks: WorldViewHooks): WorldView {
  const root = createMapRoot(container, { animated: false });
  const state = createWorldState();

  const chart = root.container.children.push(am5map.MapChart.new(root, {
    panX: 'rotateX', panY: 'translateY',
    projection: am5map.geoNaturalEarth1(),
    wheelY: 'zoom', pinchZoom: true, wheelSensitivity: 0.6,
    zoomStep: 1.4, minZoomLevel: 1, maxZoomLevel: 8, maxPanOut: 0.2,
  }));

  /* Ocean (the oval itself) and a faint graticule, under the land. */
  const ocean = chart.series.unshift(am5map.MapPolygonSeries.new(root, {}));
  ocean.data.push({ geometry: am5map.getGeoRectangle(90, 180, -90, -180) });
  const graticule = chart.series.push(am5map.GraticuleSeries.new(root, { step: 15 }));

  const world = chart.series.push(am5map.MapPolygonSeries.new(root, { geoJSON: am5geodata_worldLow, exclude: ['AQ'] }));
  const tpl = world.mapPolygons.template;
  tpl.setAll({ interactive: true, strokeWidth: 0.6, nonScalingStroke: true, tooltipText: '' });

  const polyById = new Map<string, Am5Obj>();
  let current: WorldPaint | null = null;
  let drill: Am5Obj = null;
  let saved: { rotationX: number; zoom: number; lat: number } | null = null;
  let focused = false;

  tpl.events.on('click', (ev: Am5Obj) => {
    const id = ev.target.dataItem?.get('id');
    if (id && current?.model.countries.has(id)) hooks.onCountryClick(id);
  });

  /* ── Painting ──────────────────────────────────────────────────────────── */
  function colourBase() {
    const c = worldPalette();
    ocean.mapPolygons.template.setAll({ fill: am5.color(c.ocean), fillOpacity: 1, strokeOpacity: 0, strokeWidth: 0 });
    graticule.mapLines.template.setAll({ stroke: am5.color(c.graticule), strokeOpacity: 0.18, strokeWidth: 0.6 });
    tpl.setAll({ fill: am5.color(c.land), stroke: am5.color(c.border), strokeOpacity: 0.55 });
    return c;
  }

  function applyPaint() {
    const c = colourBase();
    const picked = state.iso;
    polyById.forEach((poly, id) => {
      const rec = current?.model.countries.get(id);
      const tone = countryTone(rec, current?.mode ?? 'count');
      const dim = picked !== null && id !== picked;
      let fill = c.land, opacity = 1, stroke = c.border, dash: number[] = [];
      if (tone.kind === 'visited') fill = c.visited[tone.level - 1];
      else if (tone.kind === 'trip') fill = (tone.tripId && current?.tripColors.get(tone.tripId)) || c.visited[0];
      else if (tone.kind === 'planned') { fill = c.planned; opacity = 0.28; stroke = c.plannedLine; dash = [3, 3]; }
      poly.setAll({
        fill: am5.color(fill), fillOpacity: dim ? opacity * 0.35 : opacity,
        stroke: am5.color(stroke), strokeDasharray: dash,
        strokeOpacity: dim ? 0.25 : (tone.kind === 'none' ? 0.55 : 0.9),
        cursorOverStyle: rec ? 'pointer' : 'default',
        tooltipText: current?.tooltips.get(id) ?? '',
      });
    });
    if (drill) drill.mapPolygons.template.setAll({ stroke: am5.color(c.border) });
  }

  world.events.on('datavalidated', () => {
    polyById.clear();
    world.mapPolygons.each((poly: Am5Obj) => {
      const id = poly.dataItem?.get('id');
      if (id) polyById.set(id, poly);
    });
    applyPaint();
  });
  const offRepaint = onMapRepaint(applyPaint);

  /* ── Camera helpers ────────────────────────────────────────────────────── */
  const centreLat = (): number => {
    try { return chart.invert({ x: container.clientWidth / 2, y: container.clientHeight / 2 })?.latitude ?? 0; }
    catch { return 0; }
  };

  function countryBounds(iso: string) {
    const geo = polyById.get(iso)?.dataItem?.get('geometry');
    try {
      const b = geo && am5map.getGeoBounds(geo);
      if (b && Number.isFinite(b.left) && Number.isFinite(b.right)) return b;
    } catch { /* fall through */ }
    return null;
  }

  async function enterCountry(iso: string): Promise<boolean> {
    const bounds = countryBounds(iso);
    if (!bounds) return false;
    const token = state.begin(iso);
    // Remember where the world was — once, even if the user hops country to country.
    if (!saved) saved = { rotationX: chart.get('rotationX') ?? 0, zoom: chart.get('zoomLevel') ?? 1, lat: centreLat() };

    if (drill) { drill.dispose(); drill = null; }
    // A rotated naturalEarth would tilt a flat Mercator: zero the spin first.
    chart.setAll({ rotationX: 0, rotationY: 0, panX: 'translateX', projection: am5map.geoMercator() });
    applyPaint();
    await nextFrame(root);
    if (!state.isLive(token)) return false;

    await settled(chart.zoomToGeoBounds(expandBounds(bounds, 0.4), motionMs(700)));
    if (!state.isLive(token) || !state.settle(token)) return false;

    // Province outlines (outline only), where geodata exists.
    if (DRILLDOWN_COUNTRIES[iso]) {
      try { await loadCountryGeodata(iso); } catch { return true; }
      if (!state.isLive(token)) return true;
      const geo = (window as unknown as Record<string, Am5Obj>)[DRILLDOWN_COUNTRIES[iso].global];
      if (geo) {
        drill = chart.series.push(am5map.MapPolygonSeries.new(root, { geoJSON: geo }));
        drill.mapPolygons.template.setAll({
          interactive: false, fillOpacity: 0, strokeWidth: 0.8, nonScalingStroke: true,
          stroke: am5.color(worldPalette().border), strokeOpacity: 0.7,
        });
      }
    }
    return true;
  }

  async function leaveCountry(): Promise<void> {
    if (state.phase === 'world') return;
    const token = state.leave();
    if (drill) { drill.dispose(); drill = null; }
    // Keep `saved` until we have actually arrived: a pick made while this leave is
    // still animating must restore the real world view, not a half-way one.
    const back = saved;
    chart.setAll({ projection: am5map.geoNaturalEarth1(), panX: 'rotateX', rotationX: back?.rotationX ?? 0 });
    applyPaint();
    await nextFrame(root);
    if (!state.isLive(token)) return;
    await settled(chart.zoomToGeoPoint(
      { longitude: -(back?.rotationX ?? 0), latitude: back?.lat ?? 0 }, back?.zoom ?? 1, true, motionMs(600),
    ));
    if (state.isLive(token)) saved = null;
  }

  return {
    state,
    paint(p) {
      current = p;
      if (!focused && p.model.countries.size) {
        // First data: turn the world to face the current / latest trip.
        focused = true;
        chart.set('rotationX', -p.model.focus.longitude);
      }
      applyPaint();
    },
    enterCountry,
    leaveCountry,
    zoom(action) {
      if (action === 'in') chart.zoomIn();
      else if (action === 'out') chart.zoomOut();
      else if (state.iso) { const b = countryBounds(state.iso); if (b) chart.zoomToGeoBounds(expandBounds(b, 0.4), motionMs(500)); }
      else chart.zoomToGeoPoint({ longitude: -(chart.get('rotationX') ?? 0), latitude: 0 }, 1, true, motionMs(500));
    },
    dispose() {
      state.leave();
      offRepaint();
      disposeRoot(root);
    },
  };
}
