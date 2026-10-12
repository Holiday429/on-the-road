/* ==========================================================================
   On the Road · Map — plotting stored legs
   --------------------------------------------------------------------------
   Turns stored itinerary legs (any trips) into plotted ones: coordinates for
   every city, an ISO per country, and the trip's name. Shared by the Route view
   and the World view so both place a stop in the same spot. Saved coordinates
   are written back onto the leg so the next load is instant.
   ========================================================================== */

import { resolveCityLocations } from './geo.ts';
import { isoForCountry } from '../../data/geo-index.ts';
import { routeStore } from '../../data/stores/route-store.ts';
import type { PlottedLeg } from './map-stats.ts';

export interface StoredLegInput {
  id: string; city: string; country: string; flag: string;
  dateFrom: string; dateTo: string; notes?: string;
  order?: number; lat?: number; lng?: number;
  tripId?: string | null;
  arrivalTransport?: {
    type: string; from: string; to: string; via?: string[];
  };
}

/** A stop geocoding could not place (shown instead of silently dropped). */
export interface UnlocatedStop { legId: string; place: string; }

export interface PlotResult { legs: PlottedLeg[]; unlocated: UnlocatedStop[]; }

/**
 * Resolve every leg's cities to coordinates (saved → bundled → online),
 * persisting the anchor coords back onto the leg. Legs whose city can't be
 * located at all are left out of `legs` but reported in `unlocated`.
 */
export async function plotStoredLegs(
  stored: StoredLegInput[],
  tripNames?: ReadonlyMap<string, string>,
): Promise<PlotResult> {
  const legs: PlottedLeg[] = [];
  const unlocated: UnlocatedStop[] = [];
  for (const leg of stored) {
    // Saved coords anchor the first stop for free; the rest go through geo.ts.
    const { stops, iso, missing } = await resolveCityLocations(leg.city, leg.country, { lat: leg.lat, lng: leg.lng });
    for (const place of missing) unlocated.push({ legId: leg.id, place });
    const anchor = stops[0];
    if (!anchor) continue;
    legs.push({
      id: leg.id, city: leg.city, country: leg.country, flag: leg.flag,
      dateFrom: leg.dateFrom, dateTo: leg.dateTo, notes: leg.notes,
      tripId: leg.tripId, tripName: leg.tripId ? tripNames?.get(leg.tripId) : undefined,
      lat: anchor.lat, lng: anchor.lng, iso: iso ?? isoForCountry(leg.country, leg.flag), stops,
    });
    // Persist anchor coords if missing/changed, so subsequent loads are instant.
    if (leg.lat !== anchor.lat || leg.lng !== anchor.lng) {
      routeStore.update(leg.id, { lat: anchor.lat, lng: anchor.lng }).catch(() => {});
    }
  }
  return { legs, unlocated };
}
