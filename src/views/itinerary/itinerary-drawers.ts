/* ==========================================================================
   On the Road · Itinerary — city guide & map in a side drawer
   --------------------------------------------------------------------------
   "City guide" and "On map" on a stop's header used to leave the page. They now
   slide the same content in from the right (a half sheet on phones): the stop's
   saved guide, and the Map page's route view of the whole trip (just the map), with
   a link on to the full page for when the drawer is not enough.
   ========================================================================== */

import { openDrawer } from '../../core/drawer.ts';
import { t as tr } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { navigateTo, type NavIntent } from '../../core/app.ts';
import type { Leg } from './itinerary-shared.ts';

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

/** The Map page's own route view — the whole trip, not just this stop — in the drawer. The page owns a single
 *  live chart (its DOM is found by id), so rather than build a second one the page's map stage is lent to the
 *  drawer and handed back when it closes. The side panel and layer bar stay on the page. */
export function openCityMapDrawer(leg: Leg): void {
  let home: { parent: Node; next: Node | null } | null = null;
  let stage: HTMLElement | null = null;
  const give = () => {
    if (stage && home && home.parent.isConnected) home.parent.insertBefore(stage, home.next);
    stage = null; home = null;
  };
  const d = openDrawer({
    title: leg.city, subtitle: leg.country, className: 'rd-side-drawer rd-side-drawer--map',
    body: '<div class="rd-side-map"></div>', footer: footer(tr('route.drawer.fullMap')),
    onClose: give,
  });
  d.root.querySelector('[data-act="go-full"]')?.addEventListener('click', () => {
    d.close();
    void navigateTo('map', { mode: 'route', legId: leg.id } satisfies NavIntent);
  });

  void import('../map/map-page.ts').then(async (m) => {
    m.initMap();
    // initMap mounts the route view in a second dynamic import: wait for its stage to exist.
    for (let i = 0; i < 100 && !document.querySelector('#view-map .map-stage'); i++) await new Promise((r) => setTimeout(r, 50));
    const el = document.querySelector<HTMLElement>('#view-map .map-stage');
    const slot = d.body.querySelector('.rd-side-map');
    if (!el || !slot || !d.root.isConnected) return;
    stage = el;
    home = { parent: el.parentNode!, next: el.nextSibling };
    slot.appendChild(el);
  });
}
