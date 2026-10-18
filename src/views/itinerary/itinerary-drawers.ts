/* ==========================================================================
   On the Road · Itinerary — city guide & map in a side drawer
   --------------------------------------------------------------------------
   "City guide" and "On map" on a stop's header used to leave the page. They now
   slide the same content in from the right (a half sheet on phones): the stop's
   saved guide, and just the map — the stop, its stays and its plan items — with
   a link on to the full page for when the drawer is not enough.
   ========================================================================== */

import L from 'leaflet';
import { openDrawer } from '../../core/drawer.ts';
import { t as tr } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { navigateTo, type NavIntent } from '../../core/app.ts';
import { coordsFor } from '../map/geo.ts';
import { geocodeLocal } from '../map/geocode.ts';
import type { Leg } from './itinerary-shared.ts';
import { dayColour, legStays } from './itinerary-utils.ts';
import { ensurePlanDays } from './itinerary-plan-views.ts';

const footer = (label: string) => `<button type="button" class="btn btn-ghost" data-act="go-full">${esc(label)}</button>`;

/** The stop's saved guide, in the drawer. */
export function openCityGuideDrawer(leg: Leg): void {
  let stop: (() => void) | null = null;
  const d = openDrawer({
    title: leg.city, subtitle: leg.country, className: 'rd-side-drawer',
    body: '<div class="rd-side-guide"></div>', footer: footer(tr('route.drawer.fullGuide')),
    onClose: () => stop?.(),
  });
  const full = async () => {
    d.close();
    await navigateTo('cities');
    void import('../guide/guide.ts').then((m) => m.openGuideCity(leg.city));
  };
  d.root.querySelector('[data-act="go-full"]')?.addEventListener('click', () => void full());
  void import('../guide/guide-embed.ts').then((m) => {
    stop = m.mountGuideEmbed(d.body.querySelector<HTMLElement>('.rd-side-guide')!, leg.city, () => void full());
  });
}

interface Pin { lat: number; lng: number; html: string }

/** Everything on this stop that has a place: the city, each stay, each plan item. */
function pinsFor(leg: Leg): Pin[] {
  const pins: Pin[] = [];
  const city = coordsFor(leg.city);
  if (city) pins.push({ ...city, html: `<span class="rd-pmap-pin-label">${esc(leg.city)}</span>` });
  for (const s of legStays(leg)) {
    const at = geocodeLocal(s.address || s.name, leg.country);
    if (at) pins.push({ lat: at.lat, lng: at.lng, html: `<span class="rd-pmap-pin-badge rd-side-pin--stay">🛏</span><span class="rd-pmap-pin-label">${esc(s.name)}</span>` });
  }
  const days = ensurePlanDays(leg);
  for (const p of leg.plans ?? []) {
    const at = p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : geocodeLocal(p.address || p.title, leg.country);
    if (!at) continue;
    const i = p.dayId ? days.findIndex((x) => x.id === p.dayId) : -1;
    const colour = i >= 0 ? dayColour(i) : '#94a3b8';
    pins.push({ lat: at.lat, lng: at.lng, html: `<span class="rd-pmap-pin-badge" style="background:${colour}">${i >= 0 ? `D${i + 1}` : '?'}</span><span class="rd-pmap-pin-label">${esc(p.title)}</span>` });
  }
  return pins;
}

/** Just the map: this stop and what is on it, with no panels around it. */
export function openCityMapDrawer(leg: Leg): void {
  let map: L.Map | null = null;
  const d = openDrawer({
    title: leg.city, subtitle: leg.country, className: 'rd-side-drawer rd-side-drawer--map',
    body: '<div class="rd-side-map"></div>', footer: footer(tr('route.drawer.fullMap')),
    onClose: () => { map?.remove(); map = null; },
  });
  d.root.querySelector('[data-act="go-full"]')?.addEventListener('click', () => {
    d.close();
    void navigateTo('map', { mode: 'route', legId: leg.id } satisfies NavIntent);
  });

  const el = d.body.querySelector<HTMLElement>('.rd-side-map')!;
  map = L.map(el, { zoomControl: true, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  L.control.attribution({ prefix: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>' }).addTo(map);

  const pins = pinsFor(leg);
  const markers = pins.map((p) => L.marker([p.lat, p.lng], {
    icon: L.divIcon({ className: 'rd-pmap-pin', html: p.html, iconSize: [0, 0], iconAnchor: [0, 0] }),
  }).addTo(map!));
  if (markers.length > 1) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.3));
  else if (pins.length) map.setView([pins[0].lat, pins[0].lng], 13);
  else map.setView([48, 6], 4);
  // The drawer slides in; measure again once it has settled.
  setTimeout(() => map?.invalidateSize(), 320);
}
