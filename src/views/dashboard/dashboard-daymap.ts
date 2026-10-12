/* ==========================================================================
   On the Road · Dashboard — "this day" map (Leaflet)
   --------------------------------------------------------------------------
   Street-level map of the selected day: a house for tonight's stay, numbered
   pins for the plan items, joined in order by a dashed line. The scale follows
   the points (fitBounds): one city → streets, a travel day → the region.

   Leaflet is loaded on first use so the eager dashboard bundle doesn't carry
   it. The map instance outlives re-renders (the dashboard keeps its canvas
   node); only the markers are redrawn, and only when the model's signature
   changes.
   ========================================================================== */

import type { Map as LMap, LayerGroup } from 'leaflet';
import type { DayMapModel, DayMapPoint } from '../../data/day-map.ts';
import { AGENDA_COLORS } from '../../data/day-agenda.ts';
import { escHtml as esc } from '../../core/utils.ts';

import { STAY_ICON } from '../../core/icons.ts';
let _map: LMap | null = null;
let _el: HTMLElement | null = null;
let _layer: LayerGroup | null = null;
let _sig = '';
let _token = 0;

const FALLBACK_VIEW: [number, number] = [48, 10];

export function disposeDayMap(): void {
  _token++;                                       // abandon any in-flight init
  if (_map) { try { _map.remove(); } catch { /* ignore */ } }
  _map = null; _el = null; _layer = null; _sig = '';
}

export function dayMapZoom(action: 'in' | 'out' | 'fit'): void {
  if (!_map) return;
  if (action === 'in') _map.zoomIn();
  else if (action === 'out') _map.zoomOut();
  else fit(_lastPoints, _lastCenter);
}

let _lastPoints: DayMapPoint[] = [];
let _lastCenter: DayMapModel['center'] = null;
let _L: typeof import('leaflet') | null = null;

function fit(points: DayMapPoint[], center: DayMapModel['center']): void {
  if (!_map || !_L) return;
  if (points.length >= 2) {
    _map.fitBounds(_L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])).pad(0.25), { maxZoom: 16, animate: false });
  } else if (points.length === 1) {
    _map.setView([points[0].lat, points[0].lng], 15, { animate: false });
  } else if (center) {
    _map.setView([center.lat, center.lng], 12, { animate: false });
  } else {
    _map.setView(FALLBACK_VIEW, 4, { animate: false });
  }
}

function pinHtml(p: DayMapPoint): string {
  if (p.kind === 'stay') return `<span class="dm-pin dm-pin--stay" style="background:${AGENDA_COLORS.stay}">${STAY_ICON}</span>`;
  if (p.kind === 'city') return `<span class="dm-pin dm-pin--city">${esc(p.label.slice(0, 1).toUpperCase())}</span>`;
  return `<span class="dm-pin dm-pin--plan" style="background:${AGENDA_COLORS.plan}">${p.n}</span>`;
}

/** Create the map on first call (or when the canvas node changed) and redraw
 *  the markers when `model.sig` differs from what is drawn. */
export async function syncDayMap(
  container: HTMLElement,
  model: DayMapModel,
  onPick: (p: DayMapPoint) => void,
): Promise<void> {
  const token = ++_token;
  if (!_L) {
    const [mod] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
    _L = mod.default ?? (mod as unknown as typeof import('leaflet'));
  }
  if (token !== _token || !container.isConnected) return;
  const L = _L;

  if (!_map || _el !== container) {
    if (_map) { try { _map.remove(); } catch { /* ignore */ } }
    _map = L.map(container, { zoomControl: false, attributionControl: false });
    _el = container;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(_map);
    L.control.attribution({ prefix: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM</a>' }).addTo(_map);
    _layer = L.layerGroup().addTo(_map);
    _sig = '';
    _map.setView(FALLBACK_VIEW, 4, { animate: false });
  }
  _map.invalidateSize();
  if (model.sig === _sig) return;
  _sig = model.sig;
  _lastPoints = model.points; _lastCenter = model.center;

  _layer!.clearLayers();
  const coords = model.points.map((p) => [p.lat, p.lng] as [number, number]);
  if (coords.length >= 2) {
    L.polyline(coords, { color: AGENDA_COLORS.plan, weight: 3, opacity: 0.85, dashArray: '6 6' }).addTo(_layer!);
  }
  for (const p of model.points) {
    const icon = L.divIcon({ className: 'dm-pin-wrap', html: pinHtml(p), iconSize: [28, 28], iconAnchor: [14, 14] });
    const m = L.marker([p.lat, p.lng], { icon, title: p.label, keyboard: p.kind !== 'city', riseOnHover: true }).addTo(_layer!);
    if (p.kind !== 'city') m.on('click', () => onPick(p));
  }
  fit(model.points, model.center);
}
