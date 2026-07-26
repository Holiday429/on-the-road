/* ==========================================================================
   On the Road · amCharts 5 — minimal typed facade
   --------------------------------------------------------------------------
   amCharts5 and its geodata are loaded from the CDN as globals (see
   amcharts.d.ts), so the library objects themselves stay loosely typed —
   maintaining full amCharts type defs by hand isn't worth it. What we CAN
   type precisely is our OWN surface: the custom fields map.ts stashes on the
   chart instance (the plane/hero overlay handles). Giving those a real shape
   removes the bulk of the `(chart as any)._x` casts and gives the compiler a
   chance to catch a typo'd field or a wrong overlay type.
   ========================================================================== */

/** A loose handle to an amCharts library object (Root, Series, DataItem, …).
 *  Named rather than bare `any` so intent is clear at each call site: "this is
 *  the CDN library's type, which we deliberately don't model." */
export type Am5Obj = any;

/**
 * The map chart instance plus the overlay state map.ts attaches to it. The
 * amCharts base is `Am5Obj` (untyped library surface); the underscore-prefixed
 * fields are ours and fully typed. Cast the raw chart to this once via
 * `asMapChart()` instead of sprinkling `(chart as any)` everywhere.
 */
export interface MapChart {
  /** The animated hero (logo) marker's amCharts DataItem. */
  _heroItem?: Am5Obj;
  /** The hero image element overlaid on the stage (null until mounted). */
  _heroImg?: HTMLImageElement | null;
  /** The travelling-plane marker's amCharts DataItem. */
  _planeItem?: Am5Obj;
  /** The plane image element overlaid on the stage. */
  _planeImg?: HTMLImageElement | null;
  /** Set the plane's base rotation (degrees) and re-render it. */
  _setPlaneBase?: (angle: number) => void;

  // Everything else is the amCharts library surface (zoomToGeoPoint, convert,
  // series, …). Left as Am5Obj so those calls stay permissive — modelling the
  // full amCharts API by hand isn't worth it. Our own fields above are the
  // part we type precisely.
  [k: string]: Am5Obj;
}

/** View the raw amCharts chart as a `MapChart` (our attachments + library). */
export function asMapChart(chart: Am5Obj): MapChart {
  return chart as MapChart;
}
