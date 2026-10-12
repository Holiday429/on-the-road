/* ==========================================================================
   On the Road · Places export — coordinate completion
   --------------------------------------------------------------------------
   KML / GPX need lat+lng; many plan items only have a name. This fills in the
   missing coordinates through an injected geocoder (the app passes the cached,
   rate-limited Nominatim queue from views/map/geocode.ts) and reports exactly
   which places could not be resolved so the export can say so instead of
   silently dropping them.
   ========================================================================== */

import { hasCoords, textQuery, type ExportPlace } from './places-export.ts';

export type Geocoder = (query: string) => Promise<{ lat: number; lng: number } | null>;

export interface CompletionProgress {
  done: number;
  total: number;
}

export interface CompletionOptions {
  geocoder: Geocoder;
  onProgress?: (p: CompletionProgress) => void;
  signal?: AbortSignal;
}

export interface CompletionResult {
  /** Same order as the input; resolved places carry lat/lng (inputs are not mutated). */
  places: ExportPlace[];
  /** Places still lacking coordinates after geocoding. */
  unresolved: ExportPlace[];
  /** True if the run was cut short by the abort signal. */
  aborted: boolean;
}

export async function completeCoords(places: ExportPlace[], opts: CompletionOptions): Promise<CompletionResult> {
  const { geocoder, onProgress, signal } = opts;
  const pending = places.filter(p => !hasCoords(p) && textQuery(p));
  const total = pending.length;
  const cache = new Map<string, { lat: number; lng: number } | null>();
  let done = 0;
  let aborted = false;
  onProgress?.({ done, total });

  const resolved = new Map<ExportPlace, { lat: number; lng: number }>();
  for (const p of pending) {
    if (signal?.aborted) { aborted = true; break; }
    const q = textQuery(p);
    if (!cache.has(q)) {
      try { cache.set(q, await geocoder(q)); } catch { cache.set(q, null); }
    }
    const hit = cache.get(q);
    if (hit) resolved.set(p, hit);
    onProgress?.({ done: ++done, total });
  }

  const out = places.map(p => {
    const hit = resolved.get(p);
    return hit ? { ...p, lat: hit.lat, lng: hit.lng } : p;
  });
  return { places: out, unresolved: out.filter(p => !hasCoords(p)), aborted };
}

/** Apply completion to every group, geocoding each distinct place once. */
export async function completeGroupCoords<G extends { places: ExportPlace[] }>(
  groups: G[], opts: CompletionOptions,
): Promise<{ groups: G[]; unresolved: ExportPlace[]; aborted: boolean }> {
  const flat = groups.flatMap(g => g.places);
  const res = await completeCoords(flat, opts);
  let i = 0;
  const next = groups.map(g => ({ ...g, places: g.places.map(() => res.places[i++]) }));
  return { groups: next, unresolved: res.unresolved, aborted: res.aborted };
}
