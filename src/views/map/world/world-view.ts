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

import { createMapRoot, disposeRoot, motionMs, prefersReducedMotion } from '../amcharts-boot.ts';
import { loadCountryGeodata, DRILLDOWN_COUNTRIES } from '../amcharts-loader.ts';
import { expandBounds } from '../map-geo.ts';
import { onMapRepaint, worldPalette } from '../map-theme.ts';
import type { Am5Obj } from '../map-amcharts.ts';
import { countryTone, type ColorMode, type WorldModel } from './world-model.ts';
import type { LineSeg, CityPoint, CurrentSpot } from './world-geo.ts';
import { createWorldState, type WorldState } from './world-state.ts';
import { flingDistance, type RotationSample } from './world-motion.ts';

export interface WorldPaint {
  model: WorldModel;
  mode: ColorMode;
  /** Trip id → colour, for "colour by trip". */
  tripColors: ReadonlyMap<string, string>;
  /** Trip lines, city dots and the traveller (empty = layer off). */
  lines: LineSeg[];
  points: CityPoint[];
  current: CurrentSpot | null;
}

export interface WorldViewHooks {
  /** A country with data was clicked / tapped. */
  onCountryClick(iso: string): void;
  /** The pointer is over a country with data (null = left). x/y are chart pixels. */
  onHover(iso: string | null, x: number, y: number): void;
  /** URL of the traveller picture that marks "you are here". */
  mascotSrc: string;
}

export interface WorldView {
  readonly state: WorldState;
  paint(p: WorldPaint): void;
  enterCountry(iso: string): Promise<boolean>;
  leaveCountry(): Promise<void>;
  zoom(action: 'in' | 'out' | 'fit'): void;
  /** Slowly turn the world when it has been left alone for a few seconds (off by default). */
  setSpin(on: boolean): void;
  /** False while the map is hidden or a replay is running: nothing should move on its own. */
  setActive(active: boolean): void;
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
  tpl.setAll({ interactive: true, strokeWidth: 0.6, nonScalingStroke: true });

  /* Trip lines (solid once travelled, dashed while ahead), city dots, the traveller. */
  const lineSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
  const plannedLines = chart.series.push(am5map.MapLineSeries.new(root, {}));
  for (const ls of [lineSeries, plannedLines]) {
    ls.mapLines.template.setAll({ strokeWidth: 2, strokeOpacity: 0.9, nonScalingStroke: true, interactive: false, templateField: 'lineSettings' });
  }
  plannedLines.mapLines.template.setAll({ strokeDasharray: [4, 5], strokeOpacity: 0.6 });
  const dots = chart.series.push(am5map.MapPointSeries.new(root, {}));
  dots.bullets.push((bRoot: Am5Obj, _s: Am5Obj, di: Am5Obj) => {
    const c = di.dataContext as { iso: string | null; planned: boolean };
    const pal = worldPalette();
    const box = am5.Container.new(bRoot, { interactive: !!c.iso, cursorOverStyle: 'pointer' });
    // A generous invisible target (small countries and tight cities are hard to hit)…
    box.children.push(am5.Circle.new(bRoot, { radius: 14, fill: am5.color(pal.land), fillOpacity: 0.001 }));
    // …and the dot itself.
    box.children.push(am5.Circle.new(bRoot, {
      radius: 3.5, strokeWidth: 1.5, stroke: am5.color(pal.plannedLine),
      fill: am5.color(c.planned ? pal.land : pal.visited[3]), fillOpacity: c.planned ? 0.9 : 1,
    }));
    box.events.on('click', () => { if (c.iso) hooks.onCountryClick(c.iso); });
    box.events.on('pointerover', (ev: Am5Obj) => { if (c.iso) hooks.onHover(c.iso, ev.point.x, ev.point.y); });
    box.events.on('pointerout', () => hooks.onHover(null, 0, 0));
    return am5.Bullet.new(bRoot, { sprite: box });
  });
  const here = chart.series.push(am5map.MapPointSeries.new(root, {}));
  here.bullets.push((bRoot: Am5Obj) => am5.Bullet.new(bRoot, {
    sprite: am5.Picture.new(bRoot, { src: hooks.mascotSrc, width: 30, height: 30, centerX: am5.p50, centerY: am5.p100, interactive: false }),
  }));

  const polyById = new Map<string, Am5Obj>();
  // The countries exist only after amCharts has validated the geodata; a country
  // opened by a deep link right after boot must wait for that.
  let polygonsReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => { polygonsReady = resolve; });
  let current: WorldPaint | null = null;
  let drill: Am5Obj = null;
  let saved: { rotationX: number; zoom: number; lat: number } | null = null;
  let focused = false;

  tpl.events.on('click', (ev: Am5Obj) => {
    const id = ev.target.dataItem?.get('id');
    if (id && current?.model.countries.has(id)) hooks.onCountryClick(id);
  });
  tpl.events.on('pointerover', (ev: Am5Obj) => {
    const id = ev.target.dataItem?.get('id');
    if (id && current?.model.countries.has(id)) hooks.onHover(id, ev.point.x, ev.point.y);
  });
  tpl.events.on('globalpointermove', (ev: Am5Obj) => {
    const id = ev.target?.dataItem?.get('id');
    if (id && current?.model.countries.has(id) && ev.point) hooks.onHover(id, ev.point.x, ev.point.y);
  });
  tpl.events.on('pointerout', () => hooks.onHover(null, 0, 0));

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
      });
    });
    if (drill) drill.mapPolygons.template.setAll({ stroke: am5.color(c.border) });
  }

  /** Redraw lines, dots and the traveller (colours come from the palette, so also on theme change). */
  function drawOverlays() {
    const c = worldPalette();
    const seg = (l: LineSeg) => ({
      geometry: { type: 'LineString', coordinates: [l.from, l.to] },
      lineSettings: { stroke: am5.color(l.color || c.visited[2]) },
    });
    const lines = current?.lines ?? [];
    lineSeries.data.setAll(lines.filter((l) => !l.planned).map(seg));
    plannedLines.data.setAll(lines.filter((l) => l.planned).map(seg));
    dots.data.setAll((current?.points ?? []).map((p) => ({
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, iso: p.iso, planned: p.planned,
    })));
    const cur = current?.current;
    here.data.setAll(cur ? [{ geometry: { type: 'Point', coordinates: [cur.lng, cur.lat] } }] : []);
  }

  world.events.on('datavalidated', () => {
    polyById.clear();
    world.mapPolygons.each((poly: Am5Obj) => {
      const id = poly.dataItem?.get('id');
      if (id) polyById.set(id, poly);
    });
    applyPaint();
    polygonsReady();
  });
  const offRepaint = onMapRepaint(() => { applyPaint(); drawOverlays(); });

  /* ── Momentum and idle spin ────────────────────────────────────────────
     Let go of a fast drag and the world keeps turning, easing to a stop; left
     alone for a few seconds with auto-spin on, it turns slowly by itself. Any
     touch cancels both. Neither runs under reduced motion. */
  const abort = new AbortController();
  let samples: RotationSample[] = [];
  let dragging = false;
  let glide: Am5Obj = null;
  let spinOn = false;
  let active = true;
  let spin: Am5Obj = null;
  let idleTimer = 0;

  const stopSpin = () => { window.clearTimeout(idleTimer); spin?.stop?.(); spin = null; };
  const stopGlide = () => { glide?.stop?.(); glide = null; };
  function scheduleSpin() {
    stopSpin();
    if (!spinOn || !active || state.phase !== 'world' || prefersReducedMotion() || document.hidden) return;
    idleTimer = window.setTimeout(() => {
      const from = chart.get('rotationX') ?? 0;
      spin = chart.animate({ key: 'rotationX', from, to: from - 360, duration: 120000, loops: Infinity });
    }, 4000);
  }

  container.addEventListener('pointerdown', () => { stopGlide(); stopSpin(); samples = []; dragging = true; }, { signal: abort.signal });
  chart.on('rotationX', (x: number) => {
    if (!dragging) return;
    samples.push({ t: performance.now(), x });
    if (samples.length > 12) samples.shift();
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    const d = state.phase === 'world' && !prefersReducedMotion() ? flingDistance(samples, performance.now()) : 0;
    samples = [];
    if (!d) { scheduleSpin(); return; }
    glide = chart.animate({ key: 'rotationX', to: (chart.get('rotationX') ?? 0) + d, duration: 900, easing: am5.ease.out(am5.ease.cubic) });
    glide?.events?.on?.('stopped', scheduleSpin);
  };
  window.addEventListener('pointerup', release, { signal: abort.signal });
  window.addEventListener('pointercancel', release, { signal: abort.signal });

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
    await ready;
    const bounds = countryBounds(iso);
    if (!bounds) return false;
    const token = state.begin(iso);
    stopGlide(); stopSpin();
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
    if (state.isLive(token)) { saved = null; scheduleSpin(); }
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
      drawOverlays();
    },
    enterCountry,
    leaveCountry,
    zoom(action) {
      if (action === 'in') chart.zoomIn();
      else if (action === 'out') chart.zoomOut();
      else if (state.iso) { const b = countryBounds(state.iso); if (b) chart.zoomToGeoBounds(expandBounds(b, 0.4), motionMs(500)); }
      else chart.zoomToGeoPoint({ longitude: -(chart.get('rotationX') ?? 0), latitude: 0 }, 1, true, motionMs(500));
    },
    setSpin(on) { spinOn = on; scheduleSpin(); },
    setActive(a) { active = a; if (a) scheduleSpin(); else { stopSpin(); stopGlide(); } },
    dispose() {
      abort.abort();
      stopSpin(); stopGlide();
      state.leave();
      offRepaint();
      disposeRoot(root);
    },
  };
}
