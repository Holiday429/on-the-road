/* ==========================================================================
   On the Road · Google Maps multi-stop deep links
   --------------------------------------------------------------------------
   Builds https://www.google.com/maps/dir/?api=1 links from ExportPlace lists.
   One URL can't carry an arbitrarily long route (2048-char cap, and Google
   limits the number of stops), so long routes are split into consecutive
   segments where each segment starts at the previous one's last stop.

   The stop limits below come from third-party docs, not Google's — verify on a
   real phone and adjust MAX_STOPS_PER_LINK if needed.
   ========================================================================== */

import { resolvePlaceRef, type ExportPlace, type PlaceRef } from './places-export.ts';

export type TravelMode = 'driving' | 'walking' | 'bicycling' | 'transit';

/** Origin + waypoints + destination per link. */
export const MAX_STOPS_PER_LINK = 10;
/** Google's documented URL cap is 2048; keep a margin for encoding drift. */
export const MAX_URL_LENGTH = 2000;

const BASE = 'https://www.google.com/maps';

export interface DeepLinkOptions {
  travelMode?: TravelMode;
  maxStops?: number;
  maxUrlLength?: number;
}

export interface DeepLinkSegment {
  url: string;
  /** Number of stops in this segment (including the shared join stop). */
  count: number;
  /** Index range into the *resolvable* place list, inclusive. */
  from: number;
  to: number;
}

export interface DeepLinkResult {
  segments: DeepLinkSegment[];
  /** Places dropped because they had no name and no coordinates. */
  skipped: ExportPlace[];
}

/** Single-place search/view link. */
export function placeUrl(ref: PlaceRef): string {
  let url = `${BASE}/search/?api=1&query=${encodeURIComponent(ref.query)}`;
  if (ref.placeId) url += `&query_place_id=${encodeURIComponent(ref.placeId)}`;
  return url;
}

function dirUrl(refs: PlaceRef[], travelMode?: TravelMode): string {
  const origin = refs[0];
  const dest = refs[refs.length - 1];
  const mids = refs.slice(1, -1);
  let url = `${BASE}/dir/?api=1`;
  if (travelMode) url += `&travelmode=${travelMode}`;
  url += `&origin=${encodeURIComponent(origin.query)}`;
  if (origin.placeId) url += `&origin_place_id=${encodeURIComponent(origin.placeId)}`;
  url += `&destination=${encodeURIComponent(dest.query)}`;
  if (dest.placeId) url += `&destination_place_id=${encodeURIComponent(dest.placeId)}`;
  if (mids.length) {
    url += `&waypoints=${mids.map(m => encodeURIComponent(m.query)).join('%7C')}`;
    // waypoint_place_ids must line up one-to-one with waypoints, so only send
    // it when every middle stop has an id.
    if (mids.every(m => m.placeId)) {
      url += `&waypoint_place_ids=${mids.map(m => encodeURIComponent(m.placeId!)).join('%7C')}`;
    }
  }
  return url;
}

/**
 * Split places into one or more directions links. A single resolvable place
 * yields a search link; none yields no segments.
 */
export function buildDeepLinks(places: ExportPlace[], opts: DeepLinkOptions = {}): DeepLinkResult {
  const maxStops = Math.max(2, opts.maxStops ?? MAX_STOPS_PER_LINK);
  const maxLen = opts.maxUrlLength ?? MAX_URL_LENGTH;

  const refs: PlaceRef[] = [];
  const skipped: ExportPlace[] = [];
  for (const p of places) {
    const ref = resolvePlaceRef(p);
    if (ref) refs.push(ref); else skipped.push(p);
  }

  if (refs.length === 0) return { segments: [], skipped };
  if (refs.length === 1) {
    return { segments: [{ url: placeUrl(refs[0]), count: 1, from: 0, to: 0 }], skipped };
  }

  const segments: DeepLinkSegment[] = [];
  let start = 0;
  while (start < refs.length - 1) {
    // Greedily extend while within the stop and URL-length limits. A segment
    // always has at least two stops, even if that pair alone exceeds maxLen.
    let end = start + 1;
    while (
      end + 1 < refs.length &&
      end + 1 - start + 1 <= maxStops &&
      dirUrl(refs.slice(start, end + 2), opts.travelMode).length <= maxLen
    ) end++;
    segments.push({
      url: dirUrl(refs.slice(start, end + 1), opts.travelMode),
      count: end - start + 1,
      from: start,
      to: end,
    });
    start = end;
  }
  return { segments, skipped };
}
