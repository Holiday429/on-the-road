/* ==========================================================================
   On the Road · Atlas — the globe
   --------------------------------------------------------------------------
   amCharts5 `geoOrthographic`: a real sphere you turn with a finger — sideways
   to spin, up/down to tip it (limited to ±60° so the poles never come to face
   you), wheel/pinch to zoom. Picking a country turns the globe to bring it to
   the middle and zooms in — one animation, no change of projection; going back
   restores the exact rotation and zoom from before.

   This file only draws. What to draw (visited / planned / levels) comes from the
   WorldModel; the camera maths is globe-focus.ts; when a transition may proceed
   comes from world-state.ts.
   ========================================================================== */

import { createMapRoot, disposeRoot, motionMs, prefersReducedMotion } from '../map/amcharts-boot.ts';
import { loadCountryGeodata, DRILLDOWN_COUNTRIES } from '../map/amcharts-loader.ts';
import { onMapRepaint, worldPalette } from '../map/map-theme.ts';
import type { Am5Obj } from '../map/map-amcharts.ts';
import { countryTone, type ColorMode, type WorldModel } from './world-model.ts';
import type { LineSeg, CityPoint, CurrentSpot } from './world-geo.ts';
import { createWorldState, type WorldState } from './world-state.ts';
import { flingDistance, type RotationSample } from './world-motion.ts';
import { nightCentre } from './sun.ts';
import { clampTilt, focusFor, shortestRotation, MIN_ZOOM, MAX_ZOOM, type GeoBounds, type GlobeCamera } from './globe-focus.ts';

export interface GlobePaint {
  model: WorldModel;
  mode: ColorMode;
  /** Trip id → colour, for "colour by trip". */
  tripColors: ReadonlyMap<string, string>;
  /** Trip lines, city dots and the traveller (empty = layer off). */
  lines: LineSeg[];
  points: CityPoint[];
  current: CurrentSpot | null;
}

export interface GlobeViewHooks {
  /** A country with data was clicked / tapped. */
  onCountryClick(iso: string): void;
  /** The pointer is over a country with data (null = left). x/y are chart pixels. */
  onHover(iso: string | null, x: number, y: number): void;
  /** URL of the traveller picture that marks "you are here". */
  mascotSrc: string;
}

export interface GlobeView {
  readonly state: WorldState;
  paint(p: GlobePaint): void;
  enterCountry(iso: string): Promise<boolean>;
  leaveCountry(): Promise<void>;
  zoom(action: 'in' | 'out' | 'fit'): void;
  /** Slowly turn the globe when it has been left alone for a few seconds (off by default). */
  setSpin(on: boolean): void;
  /** Shade the half of the globe that is in darkness right now. */
  setNight(on: boolean): void;
  /** False while the page is hidden or a replay is running: nothing should move on its own. */
  setActive(active: boolean): void;
  dispose(): void;
}

/** Wait for an amCharts animation to finish (or `fallbackMs`, so a transition can never hang). */
function settled(anims: Array<Am5Obj | undefined>, fallbackMs = 1800): Promise<void> {
  const waits = anims.filter((a) => a?.waitForStop).map((a) => a.waitForStop());
  if (!waits.length) return Promise.resolve();
  return Promise.race([Promise.all(waits), new Promise<void>((r) => window.setTimeout(r, fallbackMs))]).then(() => undefined);
}

export function createGlobeView(container: HTMLElement, hooks: GlobeViewHooks): GlobeView {
  const root = createMapRoot(container, { animated: false });
  const state = createWorldState();

  const chart = root.container.children.push(am5map.MapChart.new(root, {
    panX: 'rotateX', panY: 'rotateY',
    projection: am5map.geoOrthographic(),
    wheelY: 'zoom', pinchZoom: true, wheelSensitivity: 0.6,
    zoomStep: 1.4, minZoomLevel: MIN_ZOOM, maxZoomLevel: MAX_ZOOM,
  }));

  /* The sea (the disc itself) and a faint graticule, under the land. */
  const ocean = chart.series.unshift(am5map.MapPolygonSeries.new(root, {}));
  ocean.data.push({ geometry: am5map.getGeoRectangle(90, 180, -90, -180) });
  const graticule = chart.series.push(am5map.GraticuleSeries.new(root, { step: 15 }));

  const world = chart.series.push(am5map.MapPolygonSeries.new(root, { geoJSON: am5geodata_worldLow, exclude: ['AQ'] }));
  const tpl = world.mapPolygons.template;
  tpl.setAll({ interactive: true, strokeWidth: 0.6, nonScalingStroke: true });

  /* The night half: a flat wash over the hemisphere facing away from the sun, redrawn each minute. */
  const night = chart.series.push(am5map.MapPolygonSeries.new(root, {}));
  night.mapPolygons.template.setAll({ interactive: false, strokeOpacity: 0, strokeWidth: 0 });
  let nightOn = false;
  let nightTimer = 0;
  function drawNight() {
    const c = worldPalette();
    night.mapPolygons.template.setAll({ fill: am5.color(c.night), fillOpacity: c.nightOpacity });
    if (!nightOn) { night.data.setAll([]); return; }
    const centre = nightCentre(new Date());
    night.data.setAll([{ geometry: am5map.getGeoCircle(centre, 90) }]);
  }

  /* Trip lines (solid once travelled, grey dashes while ahead), city dots, the traveller. */
  const lineSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
  const plannedLines = chart.series.push(am5map.MapLineSeries.new(root, {}));
  for (const ls of [lineSeries, plannedLines]) {
    ls.mapLines.template.setAll({ strokeWidth: 2, strokeOpacity: 0.9, nonScalingStroke: true, interactive: false, templateField: 'lineSettings' });
  }
  plannedLines.mapLines.template.setAll({ strokeDasharray: [4, 5], strokeOpacity: 0.7 });
  const dots = chart.series.push(am5map.MapPointSeries.new(root, {}));
  dots.bullets.push((bRoot: Am5Obj, _s: Am5Obj, di: Am5Obj) => {
    const c = di.dataContext as { iso: string | null; planned: boolean };
    const pal = worldPalette();
    const box = am5.Container.new(bRoot, { interactive: !!c.iso, cursorOverStyle: 'pointer' });
    // A generous invisible target (small countries and tight cities are hard to hit)…
    box.children.push(am5.Circle.new(bRoot, { radius: 14, fill: am5.color(pal.land), fillOpacity: 0.001 }));
    // …and the dot itself: solid amber once been, hollow grey while ahead.
    box.children.push(am5.Circle.new(bRoot, {
      radius: 3.5, strokeWidth: 1.5,
      stroke: am5.color(c.planned ? pal.plannedLine : pal.border),
      fill: am5.color(c.planned ? pal.land : pal.visited[3]),
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
  let current: GlobePaint | null = null;
  let drill: Am5Obj = null;
  let saved: GlobeCamera | null = null;
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
      else if (tone.kind === 'planned') { fill = c.planned; opacity = 0.45; stroke = c.plannedLine; dash = [3, 3]; }
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
      lineSettings: { stroke: am5.color(l.planned ? c.plannedLine : (l.color || c.visited[2])) },
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
  const offRepaint = onMapRepaint(() => { applyPaint(); drawOverlays(); drawNight(); });

  /* ── Tilt limit ────────────────────────────────────────────────────────── */
  chart.on('rotationY', (y: number) => {
    const c = clampTilt(y);
    if (c !== y) chart.set('rotationY', c);
  });

  /* ── Momentum and idle spin ────────────────────────────────────────────
     Let go of a fast drag and the globe keeps turning on both axes, easing to a
     stop; left alone for a few seconds with auto-spin on, it turns slowly by
     itself. Any touch cancels both. Neither runs under reduced motion. */
  const abort = new AbortController();
  let samplesX: RotationSample[] = [];
  let samplesY: RotationSample[] = [];
  let dragging = false;
  let glide: Am5Obj[] = [];
  let spinOn = false;
  let active = true;
  let spin: Am5Obj = null;
  let idleTimer = 0;

  const stopSpin = () => { window.clearTimeout(idleTimer); spin?.stop?.(); spin = null; };
  const stopGlide = () => { glide.forEach((a) => a?.stop?.()); glide = []; };
  function scheduleSpin() {
    stopSpin();
    if (!spinOn || !active || state.phase !== 'world' || prefersReducedMotion() || document.hidden) return;
    idleTimer = window.setTimeout(() => {
      const from = chart.get('rotationX') ?? 0;
      spin = chart.animate({ key: 'rotationX', from, to: from - 360, duration: 120000, loops: Infinity });
    }, 4000);
  }

  container.addEventListener('pointerdown', () => { stopGlide(); stopSpin(); samplesX = []; samplesY = []; dragging = true; }, { signal: abort.signal });
  const sampler = (list: () => RotationSample[], push: (l: RotationSample[]) => void) => (v: number) => {
    if (!dragging) return;
    const l = list();
    l.push({ t: performance.now(), x: v });
    if (l.length > 12) l.shift();
    push(l);
  };
  chart.on('rotationX', sampler(() => samplesX, (l) => { samplesX = l; }));
  chart.on('rotationY', sampler(() => samplesY, (l) => { samplesY = l; }));
  const release = () => {
    if (!dragging) return;
    dragging = false;
    const calm = state.phase !== 'world' || prefersReducedMotion();
    const now = performance.now();
    const dx = calm ? 0 : flingDistance(samplesX, now);
    const dy = calm ? 0 : flingDistance(samplesY, now);
    samplesX = []; samplesY = [];
    if (!dx && !dy) { scheduleSpin(); return; }
    const ease = am5.ease.out(am5.ease.cubic);
    glide = [
      chart.animate({ key: 'rotationX', to: (chart.get('rotationX') ?? 0) + dx, duration: 900, easing: ease }),
      chart.animate({ key: 'rotationY', to: clampTilt((chart.get('rotationY') ?? 0) + dy), duration: 900, easing: ease }),
    ];
    glide[0]?.events?.on?.('stopped', scheduleSpin);
  };
  window.addEventListener('pointerup', release, { signal: abort.signal });
  window.addEventListener('pointercancel', release, { signal: abort.signal });

  /* ── Camera ────────────────────────────────────────────────────────────── */
  const camera = (): GlobeCamera => ({
    rotationX: chart.get('rotationX') ?? 0, rotationY: chart.get('rotationY') ?? 0, zoom: chart.get('zoomLevel') ?? 1,
  });

  /** Turn to `c` (the short way round) and zoom, as one animation. */
  function flyTo(c: GlobeCamera, duration: number): Array<Am5Obj | undefined> {
    const d = motionMs(duration);
    const from = camera();
    const to = { rotationX: shortestRotation(from.rotationX, c.rotationX), rotationY: clampTilt(c.rotationY), zoom: c.zoom };
    if (d === 0) { chart.setAll({ rotationX: to.rotationX, rotationY: to.rotationY, zoomLevel: to.zoom }); return []; }
    const easing = am5.ease.inOut(am5.ease.cubic);
    return [
      chart.animate({ key: 'rotationX', to: to.rotationX, duration: d, easing }),
      chart.animate({ key: 'rotationY', to: to.rotationY, duration: d, easing }),
      chart.animate({ key: 'zoomLevel', to: to.zoom, duration: d, easing }),
    ];
  }

  function countryBounds(iso: string): GeoBounds | null {
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
    // Remember where the globe was — once, even if the user hops country to country.
    if (!saved) saved = camera();

    if (drill) { drill.dispose(); drill = null; }
    applyPaint();
    await settled(flyTo(focusFor(bounds), 900));
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
    // still animating must restore the real globe, not a half-way one.
    const back = saved ?? { rotationX: camera().rotationX, rotationY: 0, zoom: 1 };
    applyPaint();
    await settled(flyTo(back, 700));
    if (state.isLive(token)) { saved = null; scheduleSpin(); }
  }

  return {
    state,
    paint(p) {
      current = p;
      if (!focused && p.model.countries.size) {
        // First data: turn the globe to face the current / latest trip.
        focused = true;
        chart.setAll({ rotationX: -p.model.focus.longitude, rotationY: -clampTilt(p.model.focus.latitude) });
      }
      applyPaint();
      drawOverlays();
    },
    enterCountry,
    leaveCountry,
    zoom(action) {
      if (action === 'in') chart.zoomIn();
      else if (action === 'out') chart.zoomOut();
      else {
        const b = state.iso ? countryBounds(state.iso) : null;
        void settled(flyTo(b ? focusFor(b) : { rotationX: camera().rotationX, rotationY: camera().rotationY, zoom: 1 }, 600));
      }
    },
    setSpin(on) { spinOn = on; scheduleSpin(); },
    setNight(on) {
      nightOn = on;
      window.clearInterval(nightTimer);
      if (on) nightTimer = window.setInterval(drawNight, 60000);
      drawNight();
    },
    setActive(a) { active = a; if (a) scheduleSpin(); else { stopSpin(); stopGlide(); } },
    dispose() {
      abort.abort();
      window.clearInterval(nightTimer);
      stopSpin(); stopGlide();
      state.leave();
      offRepaint();
      disposeRoot(root);
    },
  };
}
