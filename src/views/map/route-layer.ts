/* ==========================================================================
   On the Road · Shared route layer
   --------------------------------------------------------------------------
   One drawing of a trip's route, used by both the Route page and the Journal's
   Places view, so the two can never disagree about what the trip looks like.

   It draws three things onto an existing amCharts map chart:
     · the line, in two series — the legs already travelled (or under way) in
       the route colour, the ones still ahead in a faint grey. Where you are is
       the join between them.
     · a numbered postmark pin per stop (hollow while the stop is in the future).
     · the country paint: every country the route touches, or — when `focusIso`
       is set — only that one, with the rest of the route's countries greyed.

   Pure amCharts; no page state, no DOM, no stores. The caller keeps the chart
   and decides the viewport.
   ========================================================================== */

import { arcPoints } from './map-geo.ts';
import { legVisitState } from './map-status.ts';
import { countryColor, mapColors as C, worldPalette } from './map-theme.ts';
import { postmarkPin, repaintPostmarkPin } from './map-chrome.ts';
import type { Am5Obj } from './map-amcharts.ts';

/** The slice of a plotted leg the route layer needs. */
export interface RouteStop {
  lat: number;
  lng: number;
  iso: string | null;
  dateFrom: string;
  dateTo: string;
}

export interface RouteLayerOpts {
  /** Light only this country and grey the other route countries. Null = light them all. */
  focusIso?: string | null;
  /**
   * How the stops are marked: numbered postmark pins (the default), plain dots
   * (Places, whose own place pins sit on top and must not be read as counts), or
   * not at all.
   */
  pins?: boolean | 'dots';
}

export interface RouteLayer {
  /** Re-draw for a new route / focus. */
  update: (stops: RouteStop[], opts: RouteLayerOpts) => void;
  /** Re-read the palette after a theme change (amCharts paints with values, not CSS vars). */
  repaint: () => void;
}

/**
 * Split the route into the part behind you and the part ahead.
 *
 * A leg counts as reached once its first day has come, so the segment leading
 * into the stop you are in is coloured — the line stops where you are, not at
 * the last place you left.
 */
export function splitRoute(stops: RouteStop[], today: string): { done: [number, number][][]; ahead: [number, number][][] } {
  const done: [number, number][][] = [];
  const ahead: [number, number][][] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const seg = arcPoints(stops[i], stops[i + 1], 20, 0.15);
    (legVisitState(stops[i + 1], today) === 'visited' ? done : ahead).push(seg);
  }
  return { done, ahead };
}

/** Every country the route touches, in order, without repeats. */
export function routeCountries(stops: RouteStop[]): string[] {
  return [...new Set(stops.map((s) => s.iso).filter((x): x is string => !!x))];
}

/**
 * Just the two-part line, for a caller that draws its own pins and countries
 * (the Route page, whose pins carry leg ids and whose countries answer to the
 * spend-heat and drill-down layers). Returns the repaint closure to register.
 */
export function drawRouteLines(root: Am5Obj, chart: Am5Obj, stops: RouteStop[], today: string): () => void {
  const am5 = (window as Am5Obj).am5;
  const am5map = (window as Am5Obj).am5map;
  // Ahead first, so the travelled line draws over it where they meet.
  const ahead = chart.series.push(am5map.MapLineSeries.new(root, {}));
  const done = chart.series.push(am5map.MapLineSeries.new(root, {}));
  const paint = () => {
    done.mapLines.template.setAll({ stroke: am5.color(C().route), strokeWidth: 2.5, strokeOpacity: 0.85, strokeDasharray: [4, 6] });
    ahead.mapLines.template.setAll({ stroke: am5.color(worldPalette().border), strokeWidth: 2, strokeOpacity: 0.6, strokeDasharray: [4, 6] });
  };
  const segs = splitRoute(stops, today);
  const asLine = (coordinates: [number, number][]) => ({ geometry: { type: 'LineString', coordinates } });
  done.data.setAll(segs.done.map(asLine));
  ahead.data.setAll(segs.ahead.map(asLine));
  paint();
  return paint;
}

/**
 * Attach the route layer to a chart.
 *
 * `world` is the polygon series the countries live on; it is painted in place,
 * so the caller should not also paint it. Series are created once and refilled
 * on update, which keeps the chart's zoom and any running animation.
 */
export function createRouteLayer(
  root: Am5Obj,
  chart: Am5Obj,
  world: Am5Obj,
  today: string,
  initial: RouteStop[] = [],
  initialOpts: RouteLayerOpts = {},
): RouteLayer {
  const am5 = (window as Am5Obj).am5;
  const am5map = (window as Am5Obj).am5map;

  // Ahead first so the travelled line draws over it where they meet.
  const aheadSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
  const doneSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
  const pinSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));

  let stops = initial;
  let opts = initialOpts;

  pinSeries.bullets.push((bRoot: Am5Obj, _s: Am5Obj, item: Am5Obj) => {
    const ctx = item.dataContext as { index: number; planned: boolean; dot: boolean };
    if (ctx.dot) {
      // A stop, unnumbered: filled once reached, hollow while still ahead.
      return am5.Bullet.new(bRoot, {
        sprite: am5.Circle.new(bRoot, {
          radius: 4, strokeWidth: 1.5,
          fill: am5.color(ctx.planned ? worldPalette().land : C().route),
          stroke: am5.color(ctx.planned ? worldPalette().border : C().route),
        }),
      });
    }
    return am5.Bullet.new(bRoot, { sprite: postmarkPin(bRoot, ctx.index + 1, ctx.planned) });
  });

  function paintLines(): void {
    const w = worldPalette();
    doneSeries.mapLines.template.setAll({
      stroke: am5.color(C().route), strokeWidth: 2.5, strokeOpacity: 0.9, strokeDasharray: [4, 6],
    });
    aheadSeries.mapLines.template.setAll({
      stroke: am5.color(w.border), strokeWidth: 2, strokeOpacity: 0.65, strokeDasharray: [4, 6],
    });
  }

  /** Countries: the focused one in its own colour, the rest of the route grey, everything else land. */
  function paintCountries(): void {
    const w = worldPalette();
    const onRoute = new Set(routeCountries(stops));
    const focus = opts.focusIso ?? null;
    world.mapPolygons.each((poly: Am5Obj) => {
      const id: string | undefined = poly.dataItem?.get('id');
      if (!id) return;
      const lit = onRoute.has(id) && (!focus || id === focus);
      // On the route but not the focus: grey, so the focused country reads alone.
      const greyed = onRoute.has(id) && !!focus && id !== focus;
      poly.setAll({
        fill: am5.color(lit ? countryColor(id) : greyed ? w.planned : w.land),
        fillOpacity: lit ? 1 : greyed ? 0.45 : 1,
        stroke: am5.color(lit ? C().landStroke : w.border),
        strokeWidth: lit ? 1.2 : 0.8,
      });
    });
  }

  function draw(): void {
    const { done, ahead } = splitRoute(stops, today);
    doneSeries.data.setAll(done.map((coordinates) => ({ geometry: { type: 'LineString', coordinates } })));
    aheadSeries.data.setAll(ahead.map((coordinates) => ({ geometry: { type: 'LineString', coordinates } })));
    pinSeries.data.setAll(opts.pins === false ? [] : stops.map((s, index) => ({
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      index,
      planned: legVisitState(s, today) === 'planned',
      dot: opts.pins === 'dots',
    })));
    paintLines();
    paintCountries();
  }

  draw();

  return {
    update(nextStops, nextOpts) {
      stops = nextStops;
      opts = nextOpts;
      draw();
    },
    repaint() {
      paintLines();
      paintCountries();
      pinSeries.dataItems.forEach((di: Am5Obj) => di.bullets?.forEach((b: Am5Obj) => {
        const ctx = di.dataContext as { planned: boolean; dot: boolean };
        const sprite = b.get('sprite');
        if (ctx.dot) {
          sprite?.setAll({
            fill: am5.color(ctx.planned ? worldPalette().land : C().route),
            stroke: am5.color(ctx.planned ? worldPalette().border : C().route),
          });
        } else repaintPostmarkPin(sprite, ctx.planned);
      }));
    },
  };
}
