/* ==========================================================================
   On the Road · My Map (amCharts5)
   --------------------------------------------------------------------------
   Fully data-driven: plots whatever cities the itinerary contains (bundled
   coords + online geocoding fallback), lights the countries along the route,
   auto-fits the camera, and — when every stop is in one country — drills into
   that country's regions and animates city-to-city inside it.

   The outbound/return "home" flight is derived from the itinerary itself: the
   first leg's arrivalTransport tells us where the traveller came from, and its
   `via[]` carries any connecting-flight stopovers (联程). Nothing is hardcoded
   to a particular trip.
   ========================================================================== */

import './map.css';
import { renderViewTitleMarkup } from '../../core/app.ts';
import { resolveCityLocations, isoFor, EUROPE_CENTER } from './geo.ts';
import { geocode } from './geocode.ts';
import { loadAmCharts, loadCountryGeodata, preloadDrilldownCountries, DRILLDOWN_COUNTRIES } from './amcharts-loader.ts';
import { MAP_COLORS as C, countryColor } from './map-shared.ts';
import { bindHeroOverlay, ensureHeroOverlay } from './hero-overlay.ts';
import { routeStore } from '../../data/stores/route-store.ts';
import { nomadStore, type StoredNomadSpot } from '../../data/stores/nomad-store.ts';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import {
  onTripChange, listTrips, currentTrip, currentTripId,
} from '../../data/trip-context.ts';
import { openTripChooser } from '../../core/trip-chooser.ts';
// Assets live in public/art/. Prefix with Vite's base URL so they resolve under
// any deploy base (e.g. /on-the-road/) instead of the site root.
const ART = `${import.meta.env.BASE_URL}art/`.replace(/\/{2,}/g, '/');
const HERO_GIF  = `${ART}logo.gif`;
const PLANE_PNG = `${ART}plane.png`;

interface StoredLegInput {
  id: string; city: string; country: string; flag: string;
  dateFrom: string; dateTo: string; notes?: string;
  order?: number; lat?: number; lng?: number;
  tripId?: string | null;
  arrivalTransport?: {
    type: string; from: string; to: string; via?: string[];
  };
}
interface PlottedLeg {
  id: string; city: string; country: string; flag: string;
  dateFrom: string; dateTo: string; notes?: string;
  tripId?: string | null;
  tripName?: string;
  lat: number;
  lng: number;
  iso: string | null;
  stops: Array<{ key: string; name: string; lat: number; lng: number }>;
}
interface GeoPt { lat: number; lng: number; }
/** A derived home flight: an ordered chain of city waypoints. */
interface FlightChain {
  label: string;
  sub: string;
  waypoints: GeoPt[];
}
interface CountryStop {
  key: string;
  name: string;
  lat: number;
  lng: number;
}
interface OverlayItem {
  el: HTMLElement;
  lng: number;
  lat: number;
}

/* ── Bézier arc helpers ──────────────────────────────────────────────────── */
/* Quadratic Bézier arc — perpendicular-left bend (flight-map style) */
function arcPoints(
  from: GeoPt, to: GeoPt,
  n = 20, bendFraction = 0.15,
): [number,number][] {
  const dLng = to.lng - from.lng, dLat = to.lat - from.lat;
  const chord = Math.sqrt(dLng*dLng + dLat*dLat);
  if (chord < 0.001) return [[from.lng, from.lat]];
  const pLng = -dLat/chord, pLat = dLng/chord;
  const b = chord * bendFraction;
  const cpLng = (from.lng+to.lng)/2 + pLng*b;
  const cpLat = (from.lat+to.lat)/2 + pLat*b;
  const pts: [number,number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i/n, u = 1-t;
    pts.push([u*u*from.lng + 2*u*t*cpLng + t*t*to.lng,
              u*u*from.lat + 2*u*t*cpLat + t*t*to.lat]);
  }
  return pts;
}
function bezierWaypoints(from:GeoPt, to:GeoPt, bend=0.25, n=30) {
  return arcPoints(from, to, n, bend).map(([lng,lat]) => ({lat, lng}));
}

/* Waypoints whose count is proportional to geo distance, so that with a fixed
   per-waypoint duration the plane moves at a constant *visual* speed across
   segments of different lengths. ~one waypoint per `degPerStep` degrees. */
function evenSpeedWaypoints(from:GeoPt, to:GeoPt, bend=0.25, degPerStep=1.6) {
  const dLng = to.lng - from.lng, dLat = to.lat - from.lat;
  const chord = Math.sqrt(dLng*dLng + dLat*dLat);
  const n = Math.max(2, Math.round(chord / degPerStep));
  return bezierWaypoints(from, to, bend, n);
}

/** Even-speed waypoints through a chain of geo points (for connecting flights). */
function chainWaypoints(chain: GeoPt[], bend = 0.22): GeoPt[] {
  const out: GeoPt[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const seg = evenSpeedWaypoints(chain[i], chain[i + 1], bend);
    out.push(...(i > 0 ? seg.slice(1) : seg));
  }
  return out;
}

/* ── State ────────────────────────────────────────────────────────────────── */
let _initialized = false;
let _root:  any = null;
let _chart: any = null;
let _scope: 'trip' | 'all' = 'trip';
let _unsubLegs: (() => void) | null = null;
let _worldSeries: any = null;
let _polyById    = new Map<string, any>();
let _dataItemById = new Map<string, any>();  // iso → dataItem (unused after zoom refactor)
let _lit         = new Set<string>();
let _drillSeries: any = null;
let _drillCode:   string | null = null;
let _replayTimer:      number | null = null;
let _planeReplayTimer: number | null = null;
let _flightPanTimer: number | null = null;
let _paused = false;
let _playing = false;
let _legsRef: PlottedLeg[] = [];
let _outboundChain: FlightChain | null = null;
let _returnChain: FlightChain | null = null;
let _singleCountryIso: string | null = null;   // set when the whole trip is in one country
let _regionLabelOverlays: OverlayItem[] = [];
let _countryPinOverlays: OverlayItem[] = [];
let _activeMotionId: string | null = null;
let _buildToken = 0;   // guards against stale async builds after teardown/scope switch
let _tripNames  = new Map<string, string>();   // tripId → trip name cache

/* ── Data layers (overlays beyond the route itself) ───────────────────────── */
// Toggleable layers sourced from other features. Pin layers (nomad, journal)
// live in their own DOM container synced like the country pins; the expense
// layer instead tints country polygons by spend.
type LayerId = 'nomad' | 'journal' | 'expenses';
const _layersOn = new Set<LayerId>();

let _nomadPinOverlays: OverlayItem[] = [];
let _nomadUnsub: (() => void) | null = null;
let _nomadSpots: Array<{ spot: StoredNomadSpot; lat: number; lng: number }> = [];

let _journalPinOverlays: OverlayItem[] = [];
let _journalUnsub: (() => void) | null = null;
let _journalPlaces: Array<{ destination: string; count: number; lat: number; lng: number }> = [];

let _expenseUnsub: (() => void) | null = null;
// iso → total spend (base currency). Drives the expense heat tint.
let _expenseByIso = new Map<string, number>();

function setReplayBtnLabel(playing: boolean) {
  const btn = document.getElementById('mapReplay');
  if (btn) btn.textContent = playing ? '⏸ Pause' : '▶ Replay route';
}

/* ── Data ─────────────────────────────────────────────────────────────────── */
/**
 * Resolve every leg's cities to coordinates (bundled + online), persisting the
 * anchor coords back onto the leg so we don't re-geocode next time. Drops legs
 * whose city can't be located at all.
 */
async function plotLegs(stored: StoredLegInput[]): Promise<PlottedLeg[]> {
  const out: PlottedLeg[] = [];
  for (const leg of stored) {
    const { stops, iso } = await resolveCityLocations(leg.city, leg.country);
    let anchor = stops[0];
    // Fall back to any persisted coords on the leg if geocoding came up empty.
    if (!anchor && leg.lat != null && leg.lng != null) {
      anchor = { key: leg.city.toLowerCase(), name: leg.city, lat: leg.lat, lng: leg.lng };
      stops.push(anchor);
    }
    if (!anchor) continue;
    const resolvedIso = iso ?? isoFor(leg.country);
    const tripName = leg.tripId ? _tripNames.get(leg.tripId) : undefined;
    out.push({
      id: leg.id, city: leg.city, country: leg.country, flag: leg.flag,
      dateFrom: leg.dateFrom, dateTo: leg.dateTo, notes: leg.notes,
      tripId: leg.tripId, tripName,
      lat: anchor.lat, lng: anchor.lng, iso: resolvedIso, stops,
    });
    // Persist anchor coords if missing/changed, so subsequent loads are instant.
    if (leg.lat !== anchor.lat || leg.lng !== anchor.lng) {
      routeStore.update(leg.id, { lat: anchor.lat, lng: anchor.lng }).catch(() => {});
    }
  }
  return out;
}

/**
 * Build the outbound home flight:
 *   origin →[via…]→ first leg's city.
 * Origin is the trip's `homeCity` when set; otherwise we fall back to the first
 * leg's arrivalTransport.from (legacy behaviour). `via[]` carries any connecting
 * stopovers. Returns null when there's no usable origin.
 */
async function buildOutboundChain(legs: PlottedLeg[], stored: StoredLegInput[]): Promise<FlightChain | null> {
  // Home flights only make sense for a single trip; "all footprints" spans many.
  if (_scope !== 'trip') return null;
  const firstStored = stored.find((s) => s.id === legs[0]?.id);
  const t = firstStored?.arrivalTransport;
  const origin = (currentTrip()?.homeCity ?? '').trim() || t?.from;
  if (!origin) return null;
  const names = [origin, ...(t?.via ?? [])];
  const pts: GeoPt[] = [];
  const labels: string[] = [];
  for (const name of names) {
    const hit = await geocode(name);
    if (!hit) continue;
    pts.push({ lat: hit.lat, lng: hit.lng });
    labels.push(name);
  }
  if (pts.length === 0) return null;
  const dest = legs[0];
  pts.push({ lat: dest.lat, lng: dest.lng });
  labels.push(dest.city);
  return {
    label: `${labels[0]} → ${dest.city}`,
    sub: labels.join(' · '),
    waypoints: chainWaypoints(pts),
  };
}

/**
 * Build the return home flight: last leg's city → returnCity (falling back to
 * homeCity). Explicit and user-controlled — never mirrors the outbound origin,
 * since people often fly home from a different city than they arrived in.
 * Returns null when neither returnCity nor homeCity is set.
 */
async function buildReturnChain(_outbound: FlightChain | null, legs: PlottedLeg[]): Promise<FlightChain | null> {
  if (_scope !== 'trip') return null;
  const trip = currentTrip();
  const dest = ((trip?.returnCity ?? '').trim() || (trip?.homeCity ?? '').trim());
  if (!dest || legs.length === 0) return null;
  const hit = await geocode(dest);
  if (!hit) return null;
  const last = legs[legs.length - 1];
  const pts: GeoPt[] = [
    { lat: last.lat, lng: last.lng },
    { lat: hit.lat, lng: hit.lng },
  ];
  return {
    label: `${last.city} → ${dest}`,
    sub: `${last.city} · ${dest}`,
    waypoints: chainWaypoints(pts),
  };
}

function fmtRange(from: string, to: string): string {
  const o: Intl.DateTimeFormatOptions = { month:'short', day:'numeric' };
  return `${new Date(from).toLocaleDateString('en-US',o)} – ${new Date(to).toLocaleDateString('en-US',o)}`;
}
function nights(from: string, to: string): number {
  return Math.max(0, Math.round((+new Date(to) - +new Date(from)) / 86400000));
}

function wrapMapLabel(text: string, maxLineLength = 12): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return text;
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    if (`${current} ${word}`.length <= maxLineLength) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  lines.push(current);
  return lines.join('\n');
}

function buildCountryStops(legs: PlottedLeg[], code: string): CountryStop[] {
  const stops = new Map<string, CountryStop>();
  for (const leg of legs) {
    if (leg.iso !== code) continue;
    for (const stop of leg.stops) {
      if (!stops.has(stop.key)) {
        stops.set(stop.key, { key: stop.key, name: stop.name, lat: stop.lat, lng: stop.lng });
      }
    }
  }
  return [...stops.values()];
}

function expandBounds(bounds: { left: number; right: number; top: number; bottom: number }, ratio = 0.12) {
  const width = Math.max(0.1, bounds.right - bounds.left);
  const height = Math.max(0.1, bounds.top - bounds.bottom);
  const padLng = Math.max(0.28, width * ratio);
  const padLat = Math.max(0.28, height * ratio);
  return {
    left: bounds.left - padLng,
    right: bounds.right + padLng,
    top: bounds.top + padLat,
    bottom: bounds.bottom - padLat,
  };
}

function fitGeoBounds(bounds: { left: number; right: number; top: number; bottom: number }, duration = 700, ratio = 0.12) {
  if (!_chart) return false;
  try {
    _chart.zoomToGeoBounds(expandBounds(bounds, ratio), duration);
    return true;
  } catch {
    return false;
  }
}

function overlayLayer(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function clearOverlayItems(items: OverlayItem[], layerId: string) {
  items.forEach(({ el }) => el.remove());
  items = [];
  const layer = overlayLayer(layerId);
  if (layer) layer.innerHTML = '';
  return items;
}

function syncOverlayItems(items: OverlayItem[]) {
  if (!_chart) return;
  for (const item of items) {
    const px = _chart.convert({ longitude: item.lng, latitude: item.lat });
    if (!px) {
      item.el.style.opacity = '0';
      continue;
    }
    item.el.style.opacity = '1';
    item.el.style.left = `${px.x}px`;
    item.el.style.top = `${px.y}px`;
  }
}

function geoCentroid(geometry: any) {
  try {
    const centroid = am5map.getGeoCentroid(geometry);
    if (centroid && Number.isFinite(centroid.longitude) && Number.isFinite(centroid.latitude)) return centroid;
  } catch {}
  try {
    const bounds = am5map.getGeoBounds(geometry);
    if (bounds) return { longitude: (bounds.left + bounds.right) / 2, latitude: (bounds.top + bounds.bottom) / 2 };
  } catch {}
  return { longitude: EUROPE_CENTER.longitude, latitude: EUROPE_CENTER.latitude };
}

// Great-circle-ish distance in degrees (good enough for de-duping nearby labels).
function geoDist(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const dLng = aLng - bLng, dLat = aLat - bLat;
  return Math.sqrt(dLng * dLng + dLat * dLat);
}

function renderRegionLabels(series: any, cityStops: CountryStop[] = []) {
  _regionLabelOverlays = clearOverlayItems(_regionLabelOverlays, 'mapRegionLabels');
  const layer = overlayLayer('mapRegionLabels');
  if (!layer) return;

  // A region label is suppressed when it sits on top of a city pin (the pin
  // already shows that place's name) or too close to another region label.
  const CITY_GAP = 0.9;     // degrees — hide region name near a city pin
  const LABEL_GAP = 1.1;    // degrees — minimum spacing between region labels
  const placed: { lng: number; lat: number }[] = [];

  series.dataItems.forEach((item: any) => {
    const name = String(item.dataContext?.name ?? '').trim();
    if (!name) return;
    const centroid = geoCentroid(item.get('geometry') ?? item.dataContext?.geometry);
    const { longitude: lng, latitude: lat } = centroid;

    // Skip if a city pin already labels roughly this spot.
    if (cityStops.some(s => geoDist(lng, lat, s.lng, s.lat) < CITY_GAP)) return;
    // Skip if it would collide with an already-placed region label.
    if (placed.some(p => geoDist(lng, lat, p.lng, p.lat) < LABEL_GAP)) return;

    const el = document.createElement('div');
    el.className = 'map-region-label';
    el.textContent = wrapMapLabel(name);
    layer.appendChild(el);
    _regionLabelOverlays.push({ el, lng, lat });
    placed.push({ lng, lat });
  });
  syncOverlayItems(_regionLabelOverlays);
}

function renderCountryPins(stops: CountryStop[]) {
  _countryPinOverlays = clearOverlayItems(_countryPinOverlays, 'mapCountryPins');
  const layer = overlayLayer('mapCountryPins');
  if (!layer) return;
  for (const stop of stops) {
    const el = document.createElement('div');
    el.className = 'map-country-pin';

    const icon = document.createElement('span');
    icon.className = 'map-country-pin-icon';
    const core = document.createElement('span');
    core.className = 'map-country-pin-core';
    icon.appendChild(core);

    const label = document.createElement('span');
    label.className = 'map-country-pin-label';
    label.textContent = wrapMapLabel(stop.name, 10);

    el.append(icon, label);
    layer.appendChild(el);
    _countryPinOverlays.push({ el, lng: stop.lng, lat: stop.lat });
  }
  syncOverlayItems(_countryPinOverlays);
}

function clearDrillOverlays() {
  _regionLabelOverlays = clearOverlayItems(_regionLabelOverlays, 'mapRegionLabels');
  _countryPinOverlays = clearOverlayItems(_countryPinOverlays, 'mapCountryPins');
}

/* ── Nomad layer ──────────────────────────────────────────────────────────── */
/** Subscribe to nomad spots for the current scope, resolve coords, render pins. */
function enableNomadLayer() {
  _nomadUnsub?.();
  const tripId = _scope === 'all' ? null : currentTripId();
  _nomadUnsub = nomadStore.subscribeForTrip(tripId, (rows) => {
    void resolveNomadSpots(rows);
  });
}

function disableNomadLayer() {
  _nomadUnsub?.();
  _nomadUnsub = null;
  _nomadSpots = [];
  _nomadPinOverlays = clearOverlayItems(_nomadPinOverlays, 'mapDataPins');
}

/** Resolve each spot to coords by geocoding its address (or name + city), then render. */
async function resolveNomadSpots(rows: StoredNomadSpot[]) {
  const token = _buildToken;
  const resolved: Array<{ spot: StoredNomadSpot; lat: number; lng: number }> = [];
  for (const spot of rows) {
    const q = spot.address?.trim()
      || [spot.name, spot.city, spot.country].filter(Boolean).join(', ');
    const hit = q ? await geocode(q) : null;
    if (token !== _buildToken) return;   // scope/trip changed mid-geocode
    if (!hit) continue;
    resolved.push({ spot, lat: hit.lat, lng: hit.lng });
  }
  if (token !== _buildToken || !_layersOn.has('nomad')) return;
  _nomadSpots = resolved;
  renderNomadPins();
}

function renderNomadPins() {
  _nomadPinOverlays = clearOverlayItems(_nomadPinOverlays, 'mapDataPins');
  const layer = overlayLayer('mapDataPins');
  if (!layer || !_layersOn.has('nomad')) return;
  for (const { spot, lat, lng } of _nomadSpots) {
    const el = document.createElement('button');
    el.className = 'map-nomad-pin';
    el.type = 'button';
    el.title = `${spot.name}${spot.city ? ' · ' + spot.city : ''}`;
    el.innerHTML = `<span class="map-nomad-pin-dot">☕</span>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      import('../nomad/nomad-modal.ts').then(({ openDetailModal }) => {
        openDetailModal(spot, () => {});
      });
    });
    layer.appendChild(el);
    _nomadPinOverlays.push({ el, lng, lat });
  }
  syncOverlayItems(_nomadPinOverlays);
}

/* ── Journal layer ────────────────────────────────────────────────────────── */
/** Subscribe to journal entries for the current scope, group by destination. */
function enableJournalLayer() {
  _journalUnsub?.();
  const subscribe = _scope === 'all' ? journalStore.subscribeAll : journalStore.subscribe;
  _journalUnsub = subscribe((rows) => { void resolveJournalPlaces(rows); });
}

function disableJournalLayer() {
  _journalUnsub?.();
  _journalUnsub = null;
  _journalPlaces = [];
  _journalPinOverlays = clearOverlayItems(_journalPinOverlays, 'mapJournalPins');
}

/** Group entries by their `destination`, geocode each, then render count pins. */
async function resolveJournalPlaces(rows: StoredJournalEntry[]) {
  const token = _buildToken;
  const counts = new Map<string, number>();
  for (const e of rows) {
    const dest = (e.destination ?? '').trim();
    if (!dest) continue;
    counts.set(dest, (counts.get(dest) ?? 0) + 1);
  }
  const resolved: Array<{ destination: string; count: number; lat: number; lng: number }> = [];
  for (const [destination, count] of counts) {
    const hit = await geocode(destination);
    if (token !== _buildToken) return;
    if (!hit) continue;
    resolved.push({ destination, count, lat: hit.lat, lng: hit.lng });
  }
  if (token !== _buildToken || !_layersOn.has('journal')) return;
  _journalPlaces = resolved;
  renderJournalPins();
}

function renderJournalPins() {
  _journalPinOverlays = clearOverlayItems(_journalPinOverlays, 'mapJournalPins');
  const layer = overlayLayer('mapJournalPins');
  if (!layer || !_layersOn.has('journal')) return;
  for (const { destination, count, lat, lng } of _journalPlaces) {
    const el = document.createElement('button');
    el.className = 'map-journal-pin';
    el.type = 'button';
    el.title = `${destination} · ${count} ${count > 1 ? 'entries' : 'entry'}`;
    el.innerHTML = `<span class="map-journal-pin-emoji">✍️</span><span class="map-journal-pin-count">${count}</span>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      import('../../core/app.ts').then(({ navigateTo }) => navigateTo('journal'));
    });
    layer.appendChild(el);
    _journalPinOverlays.push({ el, lng, lat });
  }
  syncOverlayItems(_journalPinOverlays);
}

/* ── Expense layer ────────────────────────────────────────────────────────── */
/** Subscribe to expenses (current trip only), aggregate spend per country ISO. */
function enableExpenseLayer() {
  _expenseUnsub?.();
  // Expense store is per-trip; the heat tint only makes sense for one trip.
  if (_scope !== 'trip') { _expenseByIso = new Map(); applyExpenseHeat(); return; }
  // Ensure every visited country is lit so the heat is visible without replaying.
  _legsRef.forEach((l) => lightCountry(l.iso));
  _expenseUnsub = expenseStore.subscribe((rows) => aggregateExpenses(rows));
}

function disableExpenseLayer() {
  _expenseUnsub?.();
  _expenseUnsub = null;
  _expenseByIso = new Map();
  // Restore the normal "visited" lighting for the countries we tinted.
  _lit.forEach((iso) => paintCountry(iso, countryColor(iso)));
}

function aggregateExpenses(rows: StoredExpense[]) {
  const byIso = new Map<string, number>();
  for (const e of rows) {
    const iso = isoFor(e.country);
    if (!iso) continue;
    byIso.set(iso, (byIso.get(iso) ?? 0) + (e.baseAmount || 0));
  }
  _expenseByIso = byIso;
  if (_layersOn.has('expenses')) applyExpenseHeat();
}

/** Tint each visited country by its share of total spend (light → deep amber). */
function applyExpenseHeat() {
  if (!_layersOn.has('expenses')) return;
  _lit.forEach((iso) => paintCountry(iso, litColorFor(iso)));
}

/** Format a spend total in the trip's base currency for the tooltip. */
function fmtSpend(n: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currentTrip()?.baseCurrency || 'EUR',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)}`;
  }
}

/** Map a 0..1 intensity to an amber heat colour (light cream → deep orange). */
function heatColor(t: number): string {
  const lo = { r: 0xfd, g: 0xee, b: 0xd0 };  // pale amber
  const hi = { r: 0xe0, g: 0x6b, b: 0x1a };  // deep orange
  const k = Math.sqrt(Math.min(1, Math.max(0, t)));   // sqrt so small spends still read
  const ch = (a: number, b: number) => Math.round(a + (b - a) * k);
  return `rgb(${ch(lo.r, hi.r)}, ${ch(lo.g, hi.g)}, ${ch(lo.b, hi.b)})`;
}

function zoomToCountryPoly(poly: any) {
  const di = poly?.dataItem;
  if (!_worldSeries || !_chart || !di) return;
  // Jump straight to the country's bounds with no animation, so the detailed
  // (region-labelled) view appears instantly instead of flashing through zooms.
  try {
    const bounds = am5map.getGeoBounds(di.get('geometry'));
    if (bounds && Number.isFinite(bounds.left)) {
      fitGeoBounds(bounds, 0, 0.1);
      return;
    }
  } catch {}
  _chart.zoomToGeoPoint(geoCentroid(di.get('geometry')), 6.5, true, 0);
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */
export function initMap() {
  if (_initialized) return; _initialized = true;
  const view = document.getElementById('view-map'); if (!view) return;

  view.querySelector('.view-header')!.innerHTML = `
    <div class="view-title">${renderViewTitleMarkup('map', 'My Map')}</div>
    <div class="view-subtitle">Your footprint, plotted from your itinerary — click a country to zoom into its regions.</div>`;

  const body = view.querySelector('.stub-body');
  if (body) {
    body.outerHTML = stageMarkup();
  }

  // Subscribe to legs for the active scope. Re-runnable: on scope change or
  // trip switch we tear down the chart and re-subscribe so the route rebuilds.
  subscribeLegs(view as HTMLElement);

  // Trip switch: re-subscribe under the new trip (unless viewing all trips).
  onTripChange(() => {
    if (_scope === 'trip') subscribeLegs(view as HTMLElement);
  });
}

function stageMarkup(): string {
  return `
    <div class="map-layout">
      <div class="map-stage">
        ${stageInnerMarkup()}
      </div>
      <aside class="map-panel"></aside>
    </div>`;
}

function stageInnerMarkup(): string {
  return `
    <div id="mapChart" class="map-chart"></div>
    <div class="map-region-labels" id="mapRegionLabels"></div>
    <div class="map-data-pins" id="mapDataPins"></div>
    <div class="map-data-pins" id="mapJournalPins"></div>
    <div class="map-country-pins" id="mapCountryPins"></div>
    <div class="map-tooltip" id="mapTooltip">
      <span class="map-tooltip-name" id="mapTooltipName"></span>
      <span class="map-tooltip-meta" id="mapTooltipMeta"></span>
    </div>
    <div class="map-toolbar">
      <button class="map-tool-btn" id="mapReplay" title="Replay route">▶ Replay route</button>
      <button class="map-tool-btn" id="mapBack" title="Back to overview" hidden>← Back</button>
    </div>
    <div class="map-zoom-controls">
      <button class="map-zoom-btn" id="mapZoomIn"  title="Zoom in">+</button>
      <button class="map-zoom-btn" id="mapZoomFit" title="Fit to route">⊡</button>
      <button class="map-zoom-btn" id="mapZoomOut" title="Zoom out">−</button>
    </div>
    <div class="map-loading" id="mapLoading">Loading map…</div>`;
}

/** Dispose the amCharts root so the next leg snapshot reboots the chart. */
function teardownChart() {
  if (_root) { try { _root.dispose(); } catch { /* ignore */ } }
  _root = null;
  _chart = null;
}

/**
 * Render a minimal "outline only" world map into #mapChart — no fills, no
 * route, no pins. Used for the empty / setup state so the stage always shows
 * a real globe instead of a loading spinner.
 */
async function bootIdleChart() {
  if (_chart) return;
  const el = document.getElementById('mapChart');
  if (!el) return;
  const idleToken = _buildToken;
  try {
    await loadAmCharts();
  } catch { return; }
  // Bail if legs arrived during the async load (buildAndBoot already took over).
  if (_chart || idleToken !== _buildToken) return;
  // Also bail if the DOM element is gone (buildAndBoot replaced the stage HTML).
  if (!document.getElementById('mapChart')) return;

  const root = am5.Root.new('mapChart');
  _root = root;
  if (root._logo) root._logo.dispose();

  const chart = root.container.children.push(am5map.MapChart.new(root, {
    projection: am5map.geoMercator(),
    panX: 'translateX', panY: 'translateY',
    wheelY: 'zoom', pinchZoom: true,
    zoomStep: 1.4, maxZoomLevel: 16, minZoomLevel: 0.8,
    wheelSensitivity: 0.6,
    homeGeoPoint: EUROPE_CENTER,
  }));
  _chart = chart;

  const world = chart.series.push(am5map.MapPolygonSeries.new(root, {
    geoJSON: am5geodata_worldLow, exclude: ['AQ'],
  }));
  world.mapPolygons.template.setAll({
    interactive: false,
    fill: am5.color('#f7f5f0'),
    stroke: am5.color('#d8d0c0'),
    strokeWidth: 0.7,
    nonScalingStroke: true,
  });

  chart.appear(600, 80);
  document.getElementById('mapLoading')?.remove();
}

function subscribeLegs(view: HTMLElement) {
  _unsubLegs?.();
  teardownChart();
  // Clear trip-name cache on scope switch so it re-fetches fresh names.
  _tripNames.clear();
  const token = ++_buildToken;
  // Re-subscribe active data layers under the (possibly new) scope.
  _nomadPinOverlays = clearOverlayItems(_nomadPinOverlays, 'mapDataPins');
  _journalPinOverlays = clearOverlayItems(_journalPinOverlays, 'mapJournalPins');
  if (_layersOn.has('nomad')) enableNomadLayer();
  if (_layersOn.has('journal')) enableJournalLayer();
  if (_layersOn.has('expenses')) enableExpenseLayer();
  const subscribe = _scope === 'all' ? routeStore.subscribeAll : routeStore.subscribe;
  _unsubLegs = subscribe((storedLegs) => {
    if (token !== _buildToken) return;
    // All-footprints: sort chronologically across trips by start date.
    // Single-trip: preserve the user's custom order within the trip.
    const stored = (storedLegs as unknown as StoredLegInput[]).slice().sort(
      _scope === 'all'
        ? (a, b) => (a.dateFrom ?? '').localeCompare(b.dateFrom ?? '')
        : (a, b) => (a.dateFrom ?? '').localeCompare(b.dateFrom ?? '') || (a.order ?? 0) - (b.order ?? 0),
    );

    // Chart already running with real legs — refresh the side panel.
    if (_chart && _legsRef.length > 0) {
      renderPanel(view, _legsRef);
      return;
    }

    // No legs for this trip yet — show the setup panel.
    if (stored.length === 0 && _scope === 'trip') {
      showSetupPanel(view, token);
      return;
    }

    // No footprints at all in "all" mode — simple empty state.
    if (stored.length === 0) {
      showEmpty(view);
      return;
    }

    // Plot asynchronously (geocoding may hit the network), then boot the chart.
    buildAndBoot(view, stored, token);
  });
}

function showEmpty(view: HTMLElement) {
  const panel = view.querySelector<HTMLElement>('.map-panel');
  if (panel) panel.innerHTML = scopeToggleMarkup();
  wireScopeToggle(view);
  const stage = view.querySelector<HTMLElement>('.map-stage');
  if (!stage) return;
  if (!stage.querySelector('.map-idle-hint')) {
    teardownChart();
    stage.innerHTML = `
      <div id="mapChart" class="map-chart"></div>
      <div class="map-idle-hint">
        <span class="map-idle-hint-text">No footprints yet — add cities in <a href="#route">Itinerary</a> to build your travel history.</span>
      </div>`;
    bootIdleChart();
  }
}

/** Show when the current trip has no legs: let user link a trip or add stops manually. */
async function showSetupPanel(view: HTMLElement, token: number) {
  const stage = view.querySelector<HTMLElement>('.map-stage');
  const panel = view.querySelector<HTMLElement>('.map-panel');
  if (!stage || !panel) return;

  // Stage: outline world map + hint banner overlay.
  if (!stage.querySelector('.map-idle-hint')) {
    teardownChart();
    stage.innerHTML = `
      <div id="mapChart" class="map-chart"></div>
      <div class="map-idle-hint">
        <span class="map-idle-hint-text">No itinerary yet — link a trip or add stops to plot your route.</span>
      </div>`;
    bootIdleChart();
  }

  if (token !== _buildToken) return;

  panel.innerHTML = `
    ${scopeToggleMarkup()}
    <div class="map-setup">
      <div class="map-setup-section">
        <button class="btn btn-primary map-setup-btn" id="mapLinkTrip">Link a trip</button>
      </div>
      <div class="map-setup-divider"><span>or</span></div>
      <div class="map-setup-section">
        <div class="map-setup-label">Add stops manually</div>
        <div class="map-setup-hint">Go to Itinerary to add your first city</div>
        <button class="btn btn-ghost map-setup-btn" id="mapAddManual">Go to Itinerary →</button>
      </div>
    </div>`;

  wireScopeToggle(view);

  document.getElementById('mapLinkTrip')?.addEventListener('click', () => {
    openTripChooser({ title: 'Link a trip', subtitle: 'Linking a trip plots its itinerary stops on the map.' });
  });

  document.getElementById('mapAddManual')?.addEventListener('click', () => {
    import('../../core/app.ts').then(({ navigateTo }) => navigateTo('route'));
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
}

async function buildAndBoot(view: HTMLElement, stored: StoredLegInput[], token: number) {
  const stage = view.querySelector<HTMLElement>('.map-stage');
  // If we were showing an idle outline chart, tear it down and rebuild with full markup.
  if (stage?.querySelector('.map-empty, .map-setup-idle, .map-idle-hint')) {
    teardownChart();
    stage.innerHTML = stageInnerMarkup();
  }

  // Pre-load trip names for "all footprints" so leg rows can show the trip label.
  if (_scope === 'all' && _tripNames.size === 0) {
    try {
      const trips = await listTrips();
      for (const t of trips) _tripNames.set(t.id, t.name);
    } catch { /* best-effort */ }
    if (token !== _buildToken) return;
  }

  const legs = await plotLegs(stored);
  if (token !== _buildToken) return;   // scope/trip changed mid-geocode
  if (legs.length === 0) { showEmpty(view); return; }

  _outboundChain = await buildOutboundChain(legs, stored);
  if (token !== _buildToken) return;
  _returnChain   = await buildReturnChain(_outboundChain, legs);
  if (token !== _buildToken) return;

  // Single-country trip → we'll drill into its regions for the animation.
  const isos = new Set(legs.map((l) => l.iso).filter(Boolean) as string[]);
  _singleCountryIso = (isos.size === 1 && DRILLDOWN_COUNTRIES[[...isos][0]]) ? [...isos][0] : null;

  renderPanel(view, legs);
  try {
    await loadAmCharts();
    if (token !== _buildToken) return;
    bootChart(view, legs);
    preloadDrilldownCountries(legs.map((l) => l.iso).filter(Boolean) as string[]);
  } catch (err) {
    console.error('amCharts load failed', err);
    const el = document.getElementById('mapLoading'); if (el) el.textContent = 'Map failed to load.';
  }
}

/* ── Chart ────────────────────────────────────────────────────────────────── */
function bootChart(view: HTMLElement, legs: PlottedLeg[]) {
  _legsRef = legs;
  const root = am5.Root.new('mapChart');
  _root = root;
  root.setThemes([am5themes_Animated.new(root)]);
  if (root._logo) root._logo.dispose();

  const chart = root.container.children.push(am5map.MapChart.new(root, {
    projection: am5map.geoMercator(),
    panX:'translateX', panY:'translateY',
    wheelY:'zoom', pinchZoom:true,
    zoomStep:1.4, maxZoomLevel:64, minZoomLevel:1,
    wheelSensitivity:0.6, homeGeoPoint:routeCenter(legs),
  }));
  _chart = chart;

  /* World polygons */
  const world = chart.series.push(am5map.MapPolygonSeries.new(root, {
    geoJSON: am5geodata_worldLow, exclude:['AQ'],
  }));
  _worldSeries = world;
  world.mapPolygons.template.setAll({
    interactive:true, fill:am5.color(C.land),
    stroke:am5.color(C.landStroke), strokeWidth:0.6, nonScalingStroke:true,
  });
  world.mapPolygons.template.states.create('hover', { fill:am5.color(C.hover) });
  world.events.on('datavalidated', () => {
    _polyById.clear(); _dataItemById.clear();
    world.mapPolygons.each((poly:any) => {
      const id = poly.dataItem?.get('id');
      if (id) { _polyById.set(id, poly); _dataItemById.set(id, poly.dataItem); }
      poly.set('cursorOverStyle', DRILLDOWN_COUNTRIES[id] ? 'pointer' : 'default');
    });
    _lit.forEach((iso) => paintCountry(iso, countryColor(iso)));
  });

  const tooltip = document.getElementById('mapTooltip')!;
  const tipName = document.getElementById('mapTooltipName')!;
  const tipMeta = document.getElementById('mapTooltipMeta')!;
  world.mapPolygons.template.events.on('pointerover', (ev:any) => {
    const id = ev.target.dataItem.get('id');
    const legHere = legs.filter((l) => l.iso === id);
    tipName.textContent = ev.target.dataItem.dataContext?.name ?? id;
    const base = legHere.length
      ? `${legHere.length} stop${legHere.length>1?'s':''}${DRILLDOWN_COUNTRIES[id]?' · click to zoom in':''}`
      : (DRILLDOWN_COUNTRIES[id] ? 'click to zoom in' : '');
    // When the spend-heat layer is on, lead with the country's total spend.
    const spend = _layersOn.has('expenses') ? (_expenseByIso.get(id) ?? 0) : 0;
    tipMeta.textContent = spend > 0 ? `${fmtSpend(spend)}${base ? ' · ' + base : ''}` : base;
    tooltip.classList.add('visible');
  });
  world.mapPolygons.template.events.on('globalpointermove', (ev:any) => positionTooltip(view, ev));
  world.mapPolygons.template.events.on('pointerout', () => tooltip.classList.remove('visible'));
  world.mapPolygons.template.events.on('click', (ev:any) => {
    const id = ev.target.dataItem.get('id');
    if (!DRILLDOWN_COUNTRIES[id]) return;
    stopReplayMotion();
    drillCountry(id, ev.target.dataItem.dataContext?.name??id, legs, ev.target);
  });

  /* Home (outbound + return) flight arcs — only when derived from the trip */
  if (_outboundChain || _returnChain) {
    const flightSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
    flightSeries.mapLines.template.setAll({
      stroke:am5.color('#7b9bbf'), strokeWidth:2, strokeOpacity:0.65, strokeDasharray:[5,7],
    });
    for (const chain of [_outboundChain, _returnChain]) {
      if (!chain) continue;
      flightSeries.pushDataItem({ geometry:{ type:'LineString',
        coordinates: chain.waypoints.map((w) => [w.lng, w.lat]) }});
    }
  }

  /* Trip route arcs */
  const lineSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
  lineSeries.mapLines.template.setAll({
    stroke:am5.color(C.route), strokeWidth:2.5, strokeOpacity:0.85, strokeDasharray:[4,6],
  });
  const routeCoords: [number,number][] = [];
  for (let i = 0; i < legs.length-1; i++) {
    const seg = arcPoints({lat:legs[i].lat,lng:legs[i].lng},{lat:legs[i+1].lat,lng:legs[i+1].lng},20,0.15);
    if (i>0) seg.shift();
    routeCoords.push(...seg);
  }
  if (routeCoords.length) lineSeries.pushDataItem({ geometry:{ type:'LineString', coordinates:routeCoords }});

  /* City number pins */
  const pinSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
  pinSeries.bullets.push((bRoot:any, _s:any, dataItem:any) => {
    const idx = dataItem.dataContext.index;
    const c = am5.Container.new(bRoot, {});
    c.children.push(am5.Circle.new(bRoot, { radius:9, fill:am5.color('#fff'), stroke:am5.color(C.route), strokeWidth:3 }));
    c.children.push(am5.Label.new(bRoot, {
      text:String(idx+1), centerX:am5.p50, centerY:am5.p50,
      fontSize:10, fontWeight:'700', fill:am5.color(C.route), populateText:false,
    }));
    return am5.Bullet.new(bRoot, { sprite:c });
  });
  pinSeries.data.setAll(legs.map((l,index) => ({
    geometry:{ type:'Point', coordinates:[l.lng, l.lat] }, index, id:l.id,
  })));

  /* Plane overlay */
  const planeData = chart.series.push(am5map.MapPointSeries.new(root, {}));
  const planeStart = _outboundChain?.waypoints[0] ?? legs[0];
  const planeItem = planeData.pushDataItem({ longitude:planeStart.lng, latitude:planeStart.lat });
  (chart as any)._planeItem = planeItem;
  let planeImg = document.querySelector('.map-plane-img') as HTMLImageElement|null;
  if (!planeImg) {
    planeImg = document.createElement('img');
    planeImg.className = 'map-plane-img';
    planeImg.src = PLANE_PNG; planeImg.alt = '';
    (document.querySelector('.map-stage') as HTMLElement).appendChild(planeImg);
  }
  // Hidden until an outbound/return flight chain actually flies it.
  planeImg.style.opacity = '0';
  (chart as any)._planeImg = planeImg;
  // Track position history to compute heading; no bob/pulse effects.
  let _prevPlanePx: {x:number;y:number}|null = null;
  let _planeBaseAngle = 180;
  let _planeCurrentAngle = 180;
  const syncPlane = () => {
    const img = (chart as any)._planeImg as HTMLImageElement;
    const it  = (chart as any)._planeItem;
    if (!img||!it) return;
    const lng = it.get('longitude'), lat = it.get('latitude');
    if (lng==null||lat==null) return;
    const px = chart.convert({ longitude:lng, latitude:lat }); if (!px) return;
    if (_prevPlanePx) {
      const dx = px.x - _prevPlanePx.x;
      const dy = px.y - _prevPlanePx.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        const rawAngle = Math.atan2(dy, dx) * 180 / Math.PI;
        let delta = rawAngle - _planeBaseAngle;
        while (delta > 180)  delta -= 360;
        while (delta < -180) delta += 360;
        delta = Math.max(-6, Math.min(6, delta));
        const targetAngle = _planeBaseAngle + delta;
        _planeCurrentAngle += (targetAngle - _planeCurrentAngle) * 0.1;
      }
    }
    img.style.transform = `translate(-50%, -50%) rotate(${_planeCurrentAngle.toFixed(2)}deg)`;
    _prevPlanePx = { x:px.x, y:px.y };
    img.style.left = `${px.x}px`; img.style.top = `${px.y}px`;
  };
  (chart as any)._setPlaneBase = (angle: number) => {
    _planeBaseAngle    = angle;
    _planeCurrentAngle = angle;
    const img = (chart as any)._planeImg as HTMLImageElement;
    if (img) img.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
  };
  root.events.on('frameended', syncPlane);

  /* Hero overlay */
  const heroData = chart.series.push(am5map.MapPointSeries.new(root, {}));
  const heroItem = heroData.pushDataItem({ longitude:legs[0].lng, latitude:legs[0].lat });
  (chart as any)._heroItem = heroItem;
  const heroImg = ensureHeroOverlay(
    document.querySelector('.map-stage') as HTMLElement,
    'map-hero-img',
    HERO_GIF,
  );
  (chart as any)._heroImg = heroImg;
  const syncHero = bindHeroOverlay(root, {
    chart,
    item: heroItem,
    image: heroImg,
    host: document.querySelector('.map-stage') as HTMLElement,
  });
  root.events.on('frameended', () => {
    syncOverlayItems(_regionLabelOverlays);
    syncOverlayItems(_countryPinOverlays);
    syncOverlayItems(_nomadPinOverlays);
    syncOverlayItems(_journalPinOverlays);
  });

  chart.appear(700, 100).then(() => {
    document.getElementById('mapLoading')?.remove();
    // Fit the whole route on load; animation only starts when the user clicks Play.
    setTimeout(() => { syncHero(); syncPlane(); fitToRoute(legs, 700); }, 400);
    // Re-paint any active data layers onto the freshly-booted chart.
    if (_layersOn.has('nomad') && _nomadSpots.length) renderNomadPins();
    if (_layersOn.has('journal') && _journalPlaces.length) renderJournalPins();
    if (_layersOn.has('expenses')) applyExpenseHeat();
  });

  // Replay / Pause button — toggles between playing and paused/stopped.
  const replayBtn = document.getElementById('mapReplay')!;
  replayBtn.addEventListener('click', () => {
    if (_playing) {
      stopReplayMotion();
    } else {
      travelSequence(legs, true);
    }
  });

  document.getElementById('mapBack')?.addEventListener('click', () => {
    stopReplayMotion();
    backToOverview();
  });
  document.getElementById('mapZoomIn')?.addEventListener('click', () => {
    stopReplayMotion();
    if (chart.zoomIn) chart.zoomIn();
    else chart.set('zoomLevel', (chart.get('zoomLevel') ?? 1) * 1.5);
  });
  document.getElementById('mapZoomOut')?.addEventListener('click', () => {
    stopReplayMotion();
    if (chart.zoomOut) chart.zoomOut();
    else chart.set('zoomLevel', (chart.get('zoomLevel') ?? 1) / 1.5);
  });
  document.getElementById('mapZoomFit')?.addEventListener('click', () => {
    stopReplayMotion();
    fitToRoute(_legsRef, 700);
  });
}

/* Centre of the route's footprint — used as the chart's home point. */
function routeCenter(legs: PlottedLeg[]) {
  if (legs.length === 0) return EUROPE_CENTER;
  let n=-90,s=90,e=-180,w=180;
  for (const l of legs) { n=Math.max(n,l.lat);s=Math.min(s,l.lat);e=Math.max(e,l.lng);w=Math.min(w,l.lng); }
  return { longitude: (e+w)/2, latitude: (n+s)/2 };
}

/* ── Tooltip ──────────────────────────────────────────────────────────────── */
function positionTooltip(view: HTMLElement, ev: any) {
  const tooltip = document.getElementById('mapTooltip');
  if (!tooltip||!ev?.point) return;
  tooltip.style.left = `${ev.point.x}px`; tooltip.style.top = `${ev.point.y}px`;
  void view;
}

/* ── Drilldown ────────────────────────────────────────────────────────────── */
function fitDrilledCountry(series: any, duration = 760) {
  try {
    const bounds = series.geoBounds();
    if (!bounds || !Number.isFinite(bounds.left) || !Number.isFinite(bounds.right)) return false;
    return fitGeoBounds(bounds, duration, 0.1);
  } catch {
    return false;
  }
}

async function drillCountry(code: string, name: string, legs: PlottedLeg[], worldPoly?: any): Promise<boolean> {
  if (_drillCode === code && _drillSeries) {
    if (worldPoly) zoomToCountryPoly(worldPoly);
    else window.setTimeout(() => fitDrilledCountry(_drillSeries), 420);
    return true;
  }
  try { await loadCountryGeodata(code); } catch { return false; }
  const meta = DRILLDOWN_COUNTRIES[code];
  const geo  = (window as any)[meta.global];
  if (!geo) { console.warn('geodata missing for', code); return false; }

  if (_drillSeries) { _drillSeries.dispose(); _drillSeries = null; }
  clearDrillOverlays();

  const series = _chart.series.push(am5map.MapPolygonSeries.new(_root, { geoJSON:geo, visible:false }));
  series.mapPolygons.template.setAll({
    interactive:true,
    cursorOverStyle:'pointer',
    fill:am5.color(countryColor(code)),
    stroke:am5.color('#ffffff'),
    strokeWidth:1.2,
    nonScalingStroke:true,
    shadowColor:am5.color(C.ink), shadowBlur:6, shadowOpacity:0.12,
    tooltipText: '',
  });
  series.mapPolygons.template.states.create('hover', {
    fill:am5.color(C.hover), stroke:am5.color('#ffffff'), strokeWidth:1.5,
  });

  const tooltip = document.getElementById('mapTooltip')!;
  const tipName = document.getElementById('mapTooltipName')!;
  const tipMeta = document.getElementById('mapTooltipMeta')!;
  series.mapPolygons.template.events.on('pointerover', (ev:any) => {
    tipName.textContent = ev.target.dataItem.dataContext?.name ?? '';
    tipMeta.textContent = name;
    tooltip.classList.add('visible');
  });
  series.mapPolygons.template.events.on('globalpointermove', (ev:any) => {
    positionTooltip(document.getElementById('view-map') as HTMLElement, ev);
  });
  series.mapPolygons.template.events.on('pointerout', () => tooltip.classList.remove('visible'));

  _drillSeries = series;
  _drillCode   = code;

  return await new Promise<boolean>((resolve) => {
    let finalized = false;
    const finalizeDrill = () => {
      if (finalized || _drillSeries !== series) { resolve(false); return; }
      finalized = true;
      const cityStops = buildCountryStops(legs, code);
      // Region labels first dedupe against the city pins (which show city names).
      renderRegionLabels(series, cityStops);
      renderCountryPins(cityStops);
      (document.getElementById('mapBack') as HTMLElement).hidden = false;

      // Show the detailed country polygons immediately (no fade), then snap the
      // camera to its bounds with no animation.
      series.show(0);

      if (worldPoly) {
        zoomToCountryPoly(worldPoly);
      } else {
        if (!fitDrilledCountry(series, 0)) {
          _chart.zoomToGeoPoint(geoCentroidOf(series), 6.5, true, 0);
        }
      }
      resolve(true);
    };

    series.events.on('datavalidated', finalizeDrill);
    window.setTimeout(finalizeDrill, 0);
    _root.events.once('frameended', finalizeDrill);
  });
}

function geoCentroidOf(series: any) {
  try { const b = series.geoBounds(); return { longitude:(b.left+b.right)/2, latitude:(b.top+b.bottom)/2 }; }
  catch { return EUROPE_CENTER; }
}

function fitToRoute(legs: PlottedLeg[], duration = 700) {
  if (!_chart||legs.length===0) return;
  let n=-90,s=90,e=-180,w=180;
  for (const l of legs) { n=Math.max(n,l.lat);s=Math.min(s,l.lat);e=Math.max(e,l.lng);w=Math.min(w,l.lng); }
  const padLat=Math.max(1.2,(n-s)*0.18), padLng=Math.max(1.2,(e-w)*0.18);
  try { _chart.zoomToGeoBounds({ left:w-padLng,right:e+padLng,top:n+padLat,bottom:s-padLat }, duration); }
  catch { _chart.zoomToGeoPoint?.(routeCenter(legs), 4.8, true, duration); }
}

function backToOverview() {
  if (_drillSeries) { _drillSeries.dispose(); _drillSeries = null; _drillCode = null; }
  clearDrillOverlays();
  (document.getElementById('mapBack') as HTMLElement).hidden = true;
  fitToRoute(_legsRef, 800);
}

/* ── Country lighting ─────────────────────────────────────────────────────── */
function paintCountry(iso: string, color: string) {
  const poly = _polyById.get(iso); if (!poly) return;
  poly.set('fill', am5.color(color));
  poly.states.create('hover', { fill:am5.color(C.hover) });
}
/** The fill a lit country should have right now — heat tint if the expense layer
 *  is on and we have spend for it, otherwise its normal visited colour. */
function litColorFor(iso: string): string {
  if (_layersOn.has('expenses')) {
    const max = Math.max(0, ..._expenseByIso.values());
    const spend = _expenseByIso.get(iso) ?? 0;
    if (max > 0 && spend > 0) return heatColor(spend / max);
  }
  return countryColor(iso);
}
function lightCountry(iso: string|null) {
  if (!iso||_lit.has(iso)) return; _lit.add(iso);
  const poly = _polyById.get(iso); if (!poly) return;
  paintCountry(iso, litColorFor(iso));
  poly.animate({ key:'fillOpacity', from:0.4, to:1, duration:700, easing:am5.ease.out(am5.ease.cubic) });
}
function resetLit() {
  _lit.forEach((iso) => { const p = _polyById.get(iso); if (p) p.set('fill', am5.color(C.land)); });
  _lit.clear();
}

/* ── Timer helpers ────────────────────────────────────────────────────────── */
function clearAllTimers() {
  if (_replayTimer)      { clearTimeout(_replayTimer);      _replayTimer      = null; }
  if (_planeReplayTimer) { clearTimeout(_planeReplayTimer); _planeReplayTimer = null; }
  if (_flightPanTimer)   { clearInterval(_flightPanTimer);  _flightPanTimer   = null; }
}

function stopReplayMotion() {
  _paused = true;
  _playing = false;
  setReplayBtnLabel(false);
  clearAllTimers();
  const heroImg  = (_chart as any)?._heroImg  as HTMLImageElement|null;
  const planeImg = (_chart as any)?._planeImg as HTMLImageElement|null;
  if (planeImg) planeImg.style.opacity = '0';
  if (heroImg)  heroImg.style.opacity  = '1';
}

function focusMotion(id: string | null) {
  _activeMotionId = id;
  const rows = document.querySelectorAll<HTMLElement>('.leg-row, .leg-flight-row');
  rows.forEach((el) => {
    const isActive = el.dataset.motionId === id;
    el.classList.toggle('active', isActive);
    if (isActive) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

/* ── Plane animation ──────────────────────────────────────────────────────── */
function animatePlaneThrough(waypoints:GeoPt[], segDuration:number): Promise<void> {
  const item = (_chart as any)?._planeItem;
  if (!item||waypoints.length<2) return Promise.resolve();
  return new Promise((resolve) => {
    let idx = 0;
    item.set('longitude', waypoints[0].lng); item.set('latitude', waypoints[0].lat);
    const next = () => {
      if (_paused) { resolve(); return; }
      idx++; if (idx>=waypoints.length) { resolve(); return; }
      const w = waypoints[idx];
      item.animate({ key:'longitude', to:w.lng, duration:segDuration, easing:am5.ease.linear });
      item.animate({ key:'latitude',  to:w.lat, duration:segDuration, easing:am5.ease.linear });
      _replayTimer = window.setTimeout(next, segDuration);
    };
    _replayTimer = window.setTimeout(next, segDuration);
  });
}

/* ── Pan map to follow a geo point ───────────────────────────────────────── */
function panToGeoPoint(lng: number, lat: number, duration = 600, zoomLevel?: number) {
  if (!_chart) return;
  try {
    const level = zoomLevel ?? Math.min(_chart.get('zoomLevel') ?? 3, 3);
    _chart.zoomToGeoPoint({ longitude: lng, latitude: lat }, level, true, duration);
  } catch {}
}

/** Pan the camera to keep up with the plane while a flight chain animates. */
function startFlightPan(segMs: number) {
  let idx = 0;
  _flightPanTimer = window.setInterval(() => {
    if (_paused) { clearAllTimers(); return; }
    const item = (_chart as any)?._planeItem;
    if (!item) { clearAllTimers(); return; }
    const lng = item.get('longitude');
    const lat = item.get('latitude');
    if (lng != null && lat != null) panToGeoPoint(lng, lat, 800);
    idx++;
    if (idx > 400 && _flightPanTimer) { clearInterval(_flightPanTimer); _flightPanTimer = null; }
  }, segMs * 4);
}
function stopFlightPan() {
  if (_flightPanTimer) { clearInterval(_flightPanTimer); _flightPanTimer = null; }
}

/* ── Travel sequence ──────────────────────────────────────────────────────── */
async function travelSequence(legs: PlottedLeg[], replay = false) {
  const heroItem = (_chart as any)?._heroItem;
  if (!heroItem||legs.length===0) return;
  clearAllTimers();
  _paused = false;
  _playing = true;
  setReplayBtnLabel(true);
  if (replay) resetLit();

  const heroImg  = (_chart as any)?._heroImg  as HTMLImageElement|null;
  const planeImg = (_chart as any)?._planeImg as HTMLImageElement|null;
  const planeItem = (_chart as any)?._planeItem;

  // Reduced-motion: skip animation, just light everything and fit.
  if (!replay && window.matchMedia?.('(prefers-reduced-motion:reduce)').matches) {
    const last = legs[legs.length-1];
    heroItem.set('longitude',last.lng); heroItem.set('latitude',last.lat);
    legs.forEach((l)=>lightCountry(l.iso));
    await settleView(legs);
    _playing = false;
    setReplayBtnLabel(false);
    return;
  }

  const FLIGHT_SEG = 45;

  // ── 1. Outbound home flight (if derived from the itinerary) ───────────────
  if (_outboundChain && _outboundChain.waypoints.length > 1) {
    const wpts = _outboundChain.waypoints;
    if (planeItem) { planeItem.set('longitude',wpts[0].lng); planeItem.set('latitude',wpts[0].lat); }
    // Heading: leftward if the flight trends west, else rightward.
    (_chart as any)._setPlaneBase?.(wpts[wpts.length-1].lng < wpts[0].lng ? 180 : 0);
    if (planeImg) planeImg.style.opacity = '1';
    if (heroImg) heroImg.style.opacity = '0';
    focusMotion('flight-outbound');
    panToGeoPoint(wpts[0].lng, wpts[0].lat, 0);
    startFlightPan(FLIGHT_SEG);
    await animatePlaneThrough(wpts, FLIGHT_SEG);
    stopFlightPan();
    if (_paused) return;
    if (planeImg) planeImg.style.opacity = '0';
    if (heroImg)  heroImg.style.opacity  = '1';
  }

  // ── 2. Settle on the route (fit / drill into a single country) ────────────
  await settleView(legs);
  if (_paused) return;

  // ── 3. Hero hops through the legs in order ────────────────────────────────
  await new Promise<void>((resolve) => { _replayTimer = window.setTimeout(resolve, 500); });
  if (_paused) return;
  await travelHeroLegs(legs);
  if (_paused) return;

  // ── 4. Return home flight ─────────────────────────────────────────────────
  if (_returnChain && _returnChain.waypoints.length > 1) {
    await new Promise<void>((resolve) => { _replayTimer = window.setTimeout(resolve, 600); });
    if (_paused) return;
    // If we drilled into a country, pop back out to the world view first.
    if (_drillSeries) backToOverview();
    const wpts = _returnChain.waypoints;
    if (heroImg)  heroImg.style.opacity  = '0';
    (_chart as any)._setPlaneBase?.(wpts[wpts.length-1].lng < wpts[0].lng ? 180 : 0);
    if (planeImg) planeImg.style.opacity = '1';
    if (planeItem) { planeItem.set('longitude',wpts[0].lng); planeItem.set('latitude',wpts[0].lat); }
    focusMotion('flight-return');
    panToGeoPoint(wpts[0].lng, wpts[0].lat, 400);
    startFlightPan(FLIGHT_SEG);
    await animatePlaneThrough(wpts, FLIGHT_SEG);
    stopFlightPan();
    if (_paused) return;
    if (planeImg) planeImg.style.opacity = '0';
    if (heroImg)  heroImg.style.opacity  = '1';
    const home = wpts[wpts.length-1];
    panToGeoPoint(home.lng, home.lat, 600);
    await new Promise<void>((resolve) => { _replayTimer = window.setTimeout(resolve, 1200); });
  }

  if (_paused) return;
  // Finish: frame the whole route and reset to replayable state.
  if (_drillSeries) backToOverview();
  else fitToRoute(legs, 1100);
  focusMotion(legs[legs.length - 1].id);
  _playing = false;
  setReplayBtnLabel(false);
}

/** After the outbound flight lands, fit the route — drilling into the country
 *  when the whole trip lives in one. */
async function settleView(legs: PlottedLeg[]) {
  if (_singleCountryIso) {
    const ok = await drillCountry(_singleCountryIso, _singleCountryIso, legs);
    if (ok) return;
  }
  fitToRoute(legs, 800);
}

function travelHeroLegs(legs: PlottedLeg[]): Promise<void> {
  const item = (_chart as any)?._heroItem;
  if (!item||legs.length===0) return Promise.resolve();
  const LEG_DURATION = 1800, STEP_DELAY = LEG_DURATION + 300;
  return new Promise((resolve) => {
    let i = 0;
    item.set('longitude',legs[0].lng); item.set('latitude',legs[0].lat);
    focusLeg(legs[0].id); lightCountry(legs[0].iso);
    const stepTo = (idx:number) => {
      if (_paused) return;
      const l = legs[idx];
      item.animate({ key:'longitude', to:l.lng, duration:LEG_DURATION, easing:am5.ease.inOut(am5.ease.cubic) });
      item.animate({ key:'latitude',  to:l.lat, duration:LEG_DURATION, easing:am5.ease.inOut(am5.ease.cubic) });
      // In a single-country view, keep the camera gently tracking the traveller.
      if (_singleCountryIso) {
        setTimeout(() => { if (!_paused) panToGeoPoint(l.lng, l.lat, LEG_DURATION); }, 0);
      }
      // Sync the country fill and the right-hand list when the traveller arrives.
      setTimeout(() => {
        if (_paused) return;
        lightCountry(l.iso);
        focusLeg(l.id);
      }, LEG_DURATION * 0.7);
    };
    const tick = () => {
      if (_paused) { resolve(); return; }
      i++; if (i>=legs.length) { resolve(); return; }
      stepTo(i);
      _replayTimer=window.setTimeout(tick,STEP_DELAY);
    };
    _replayTimer = window.setTimeout(tick, 700);
  });
}

/* ── Side panel helpers ───────────────────────────────────────────────────── */
function scopeToggleMarkup(): string {
  return `
    <div class="map-scope">
      <button class="map-scope-btn${_scope === 'trip' ? ' active' : ''}" data-scope="trip">This trip</button>
      <button class="map-scope-btn${_scope === 'all' ? ' active' : ''}" data-scope="all">All footprints</button>
    </div>`;
}

function wireScopeToggle(view: HTMLElement) {
  view.querySelectorAll<HTMLButtonElement>('.map-scope-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.scope as 'trip' | 'all';
      if (next === _scope) return;
      _scope = next;
      subscribeLegs(view);
    });
  });
}

/* ── Layer toggles ────────────────────────────────────────────────────────── */
const LAYER_META: Record<LayerId, { icon: string; label: string }> = {
  nomad:    { icon: '☕',  label: 'Work spots' },
  journal:  { icon: '✍️', label: 'Journal'    },
  expenses: { icon: '💸', label: 'Spend heat' },
};

function layersMarkup(): string {
  const rows = (Object.keys(LAYER_META) as LayerId[]).map((id) => {
    const m = LAYER_META[id];
    const on = _layersOn.has(id);
    return `
      <button class="map-layer-btn${on ? ' active' : ''}" data-layer="${id}" role="switch" aria-checked="${on}">
        <span class="map-layer-icon">${m.icon}</span>
        <span class="map-layer-label">${m.label}</span>
        <span class="map-layer-switch"></span>
      </button>`;
  }).join('');
  return `<div class="map-layers">${rows}</div>`;
}

function wireLayerToggles(view: HTMLElement) {
  view.querySelectorAll<HTMLButtonElement>('.map-layer-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.layer as LayerId;
      const on = !_layersOn.has(id);
      if (on) _layersOn.add(id); else _layersOn.delete(id);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
      if (id === 'nomad')    { on ? enableNomadLayer()   : disableNomadLayer(); }
      if (id === 'journal')  { on ? enableJournalLayer() : disableJournalLayer(); }
      if (id === 'expenses') { on ? enableExpenseLayer() : disableExpenseLayer(); }
    });
  });
}

/* ── Side panel ───────────────────────────────────────────────────────────── */
function summarizeRoute(legs: PlottedLeg[]) {
  const uniqueCountries = new Set<string>();
  const uniqueCities = new Set<string>();

  for (const leg of legs) {
    uniqueCountries.add(leg.iso ?? leg.country);
    for (const stop of leg.stops) {
      uniqueCities.add(`${leg.iso ?? leg.country}:${stop.key}`);
    }
  }

  return {
    cityCount: uniqueCities.size,
    countryCount: uniqueCountries.size,
  };
}

function flightRowMarkup(chain: FlightChain | null, motionId: string): string {
  if (!chain) return '';
  return `
    <div class="leg-flight-row ${_activeMotionId === motionId ? 'active' : ''}" data-motion-id="${motionId}">
      <span class="leg-flight-icon">✈️</span>
      <span class="leg-flight-main">
        <span class="leg-flight-label">${chain.label}</span>
        <span class="leg-flight-sub">${chain.sub}</span>
      </span>
    </div>`;
}

function renderPanel(view: HTMLElement, legs: PlottedLeg[]) {
  const { cityCount, countryCount } = summarizeRoute(legs);

  // Build leg list. In "all footprints" mode, inject a trip-label separator
  // whenever the trip changes (legs are sorted chronologically by dateFrom).
  let lastTripId: string | null | undefined = undefined;
  const listItems: string[] = [];
  legs.forEach((l, i) => {
    if (_scope === 'all' && l.tripId !== lastTripId) {
      const label = l.tripName ?? l.tripId ?? 'Unknown trip';
      listItems.push(`<div class="leg-trip-label">${esc(label)}</div>`);
      lastTripId = l.tripId;
    }
    listItems.push(`
      <button class="leg-row ${_activeMotionId===l.id ? 'active' : ''}" data-id="${l.id}" data-motion-id="${l.id}">
        <span class="leg-row-num">${i+1}</span>
        <span class="leg-row-main">
          <span class="leg-row-city">${l.flag} ${l.city}</span>
          <span class="leg-row-meta">${fmtRange(l.dateFrom,l.dateTo)} · ${nights(l.dateFrom,l.dateTo)} nights</span>
        </span>
      </button>`);
  });

  (view.querySelector('.map-panel') as HTMLElement).innerHTML = `
    ${scopeToggleMarkup()}
    <div class="map-stats">
      <div class="map-stat"><div class="map-stat-num">${cityCount}</div><div class="map-stat-label">Cities</div></div>
      <div class="map-stat"><div class="map-stat-num">${countryCount}</div><div class="map-stat-label">Countries</div></div>
    </div>
    ${layersMarkup()}
    <div class="map-legs">
      ${_scope === 'trip' ? flightRowMarkup(_outboundChain, 'flight-outbound') : ''}
      ${listItems.join('')}
      ${_scope === 'trip' ? flightRowMarkup(_returnChain, 'flight-return') : ''}
    </div>`;

  wireScopeToggle(view);
  wireLayerToggles(view);

  view.querySelectorAll<HTMLButtonElement>('.leg-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      stopReplayMotion();
      const id = btn.dataset.id!;
      focusLeg(id);
      const leg = legs.find((l)=>l.id===id); if (!leg) return;
      lightCountry(leg.iso);
      if (_chart) _chart.zoomToGeoPoint?.({ longitude:leg.lng, latitude:leg.lat }, 6, true, 700);
    });
  });
}

function focusLeg(id: string) {
  focusMotion(id);
}
