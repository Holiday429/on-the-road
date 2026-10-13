/* ==========================================================================
   On the Road · Atlas — globe camera maths (pure)
   --------------------------------------------------------------------------
   Where to point the globe to bring a country to the middle of the screen, and
   how far to zoom. The globe's "camera" is its rotation (longitude in X,
   latitude in Y — amCharts keeps the point at the centre of the disc at
   (-rotationX, -rotationY)) plus a zoom level, so this is all plain numbers.
   ========================================================================== */

export interface GeoBounds { left: number; right: number; top: number; bottom: number; }

export interface GlobeCamera { rotationX: number; rotationY: number; zoom: number; }

/** How far the globe may be tipped towards a pole (owner decision: ±60°). */
export const MAX_TILT = 60;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
/** A focused country should span about this fraction of the globe's diameter. */
const FILL = 0.5;

export const clampTilt = (rotationY: number): number => Math.max(-MAX_TILT, Math.min(MAX_TILT, rotationY));

/** Wrap a longitude into [-180, 180]. */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * The rotation equal to `to` (mod 360) that is nearest `from`, so the globe
 * always turns the short way round instead of unwinding a whole lap.
 */
export function shortestRotation(from: number, to: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta;
}

/** Camera that centres `b` and fits it into FILL of the disc. Handles countries that cross the date line. */
export function focusFor(b: GeoBounds): GlobeCamera {
  const spanLng = b.right >= b.left ? b.right - b.left : b.right + 360 - b.left;
  const lng = wrapLng(b.left + spanLng / 2);
  const lat = (b.top + b.bottom) / 2;
  const spanLat = Math.max(0, b.top - b.bottom);
  // Longitude degrees shrink towards the poles, so measure the width on the ground.
  const size = Math.max(1, spanLng * Math.cos((Math.min(Math.abs(lat), 80) * Math.PI) / 180), spanLat);
  // At zoom 1 the visible disc spans ~180° of arc.
  const zoom = Math.max(1.6, Math.min(MAX_ZOOM, (FILL * 180) / size));
  return { rotationX: -lng, rotationY: -clampTilt(lat), zoom };
}
