/* ==========================================================================
   On the Road · Geo lookup
   --------------------------------------------------------------------------
   Lat/lng for European cities, plus a projection from lng/lat to the SVG
   viewBox used by the 2D map. The map shows Western/Central Europe; the
   projection is a simple equirectangular fit tuned to that window.
   ========================================================================== */

export interface LatLng { lat: number; lng: number; }

// Primary cities on the route. Keys are matched case-insensitively against the
// first city token of a leg (e.g. "Lisbon + Porto" -> "lisbon").
export const CITY_COORDS: Record<string, LatLng> = {
  copenhagen: { lat: 55.6761, lng: 12.5683 },
  berlin:     { lat: 52.5200, lng: 13.4050 },
  amsterdam:  { lat: 52.3676, lng: 4.9041 },
  brussels:   { lat: 50.8503, lng: 4.3517 },
  ghent:      { lat: 51.0543, lng: 3.7174 },
  paris:      { lat: 48.8566, lng: 2.3522 },
  barcelona:  { lat: 41.3874, lng: 2.1686 },
  lisbon:     { lat: 38.7223, lng: -9.1393 },
  porto:      { lat: 41.1579, lng: -8.6291 },
  bern:       { lat: 46.9480, lng: 7.4474 },
  grindelwald:{ lat: 46.6242, lng: 8.0414 },
  milan:      { lat: 45.4642, lng: 9.1900 },
  venice:     { lat: 45.4408, lng: 12.3155 },
  florence:   { lat: 43.7696, lng: 11.2558 },
  rome:       { lat: 41.9028, lng: 12.4964 },
};

/** Pull the first recognizable city name out of a leg's city string. */
export function primaryCity(cityField: string): string {
  // Split on common separators: " / ", " + ", " → ", "→", ","
  const first = cityField.split(/\s*(?:\/|\+|→|->|,)\s*/)[0].trim();
  return first;
}

export function coordsFor(cityField: string): LatLng | null {
  const key = primaryCity(cityField).toLowerCase();
  return CITY_COORDS[key] ?? null;
}

/* ── Projection ──────────────────────────────────────────────────────────
   The SVG map uses a 1000 x 760 viewBox covering roughly:
     lng  -11° (W Portugal)  →  19° (E Italy/Adriatic)
     lat   58° (N Denmark)   →  36° (S Italy/Iberia)
   Equirectangular, linear interpolation across that window.
*/
export const MAP_VIEW = { w: 1000, h: 760 };

const LNG_MIN = -11, LNG_MAX = 19;
const LAT_MIN = 36,  LAT_MAX = 58;

export function project({ lat, lng }: LatLng): { x: number; y: number } {
  const x = ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * MAP_VIEW.w;
  const y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * MAP_VIEW.h;
  return { x, y };
}
