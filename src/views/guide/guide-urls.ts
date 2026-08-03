/* ==========================================================================
   On the Road · Guide — Google Maps URL builders
   --------------------------------------------------------------------------
   Pure functions, extracted from guide.ts to keep it under its max-lines
   ratchet (see eslint.config.js) — these have no dependency on view state.
   ========================================================================== */

import type { Waypoint } from '../../data/schema.ts';

/** Build a Google Maps search/place URL for a card (view details + navigate). */
export function mapsUrl(card: { title: string; address?: string }, city: string): string {
  const q = [card.title, card.address, city].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Multi-stop Google Maps walking-directions URL built from waypoint NAMES (no
 *  coordinates needed) — always valid, used as the initial link before
 *  geocoding upgrades it to a precise lat/lng version. */
export function walkRouteUrlByName(waypoints: Waypoint[], city: string): string {
  const pts = waypoints.map(w => encodeURIComponent(`${w.name}, ${city}`));
  if (pts.length < 2) return `https://www.google.com/maps/search/?api=1&query=${pts[0] ?? ''}`;
  const origin = pts[0];
  const destination = pts[pts.length - 1];
  const mids = pts.slice(1, -1).join('|');
  let url = `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${origin}&destination=${destination}`;
  if (mids) url += `&waypoints=${mids}`;
  return url;
}
