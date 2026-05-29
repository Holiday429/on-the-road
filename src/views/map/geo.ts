/* ==========================================================================
   On the Road · Geo lookup
   --------------------------------------------------------------------------
   City coordinates (lng/lat) for the route's stops, and a mapping from
   country name → ISO2 so we can highlight visited countries and decide which
   ones support province-level drilldown. amCharts handles projection, so we
   pass geo points (longitude/latitude) directly.
   ========================================================================== */

export interface LatLng { lat: number; lng: number; }

// Primary cities on the route. Keys match the first city token of a leg
// (e.g. "Lisbon + Porto" -> "lisbon"), lower-cased.
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

// Country display name (as used in route data) → ISO2 (amCharts polygon id).
export const COUNTRY_ISO: Record<string, string> = {
  'Denmark': 'DK',
  'Germany': 'DE',
  'Netherlands': 'NL',
  'Belgium': 'BE',
  'France': 'FR',
  'Spain': 'ES',
  'Portugal': 'PT',
  'Switzerland': 'CH',
  'Italy': 'IT',
  'Austria': 'AT',
  'Czech Republic': 'CZ',
  'Poland': 'PL',
  'Hungary': 'HU',
  'Croatia': 'HR',
  'Greece': 'GR',
};

/** Pull the first recognizable city name out of a leg's city string. */
export function primaryCity(cityField: string): string {
  return cityField.split(/\s*(?:\/|\+|→|->|,)\s*/)[0].trim();
}

export function coordsFor(cityField: string): LatLng | null {
  return CITY_COORDS[primaryCity(cityField).toLowerCase()] ?? null;
}

export function isoFor(country: string): string | null {
  return COUNTRY_ISO[country] ?? null;
}

// Geographic centre of the trip's footprint — used to centre the Europe view.
export const EUROPE_CENTER = { longitude: 6, latitude: 48 };
