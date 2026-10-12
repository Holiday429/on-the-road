/* ==========================================================================
   On the Road · Dashboard banner — drawer contents
   --------------------------------------------------------------------------
   What the banner's two rows open in the side drawer: the stop's stays and the
   next transport (plus how you arrived). They are drawn with the Itinerary's own
   card renderers — the storefront stay card and the boarding-pass / rail / coach /
   ferry ticket — and its stylesheet, so the drawer and the Itinerary page look
   alike. Actions that edit are left on the page; the ticket's Booked/Not booked
   stub still toggles (it is one tap, same field), and a booking link opens in a
   small popup window.
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { navigateTo } from '../../core/app.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { datePart } from '../../data/day-agenda.ts';
import { legStays, tonightStay, type Transport, type TransportLeg } from '../../data/trip-now.ts';
import { renderStayCard, renderTicket } from '../itinerary/itinerary-cards.ts';
import { bannerDateRange, countdownLabel } from './banner-format.ts';
import { appNow } from '../../data/sim-clock.ts';


import { transportIcon } from '../../core/icons.ts';
/** The Itinerary's stylesheet (stay cards, tickets, plan feed, hero). Loaded on first use. */
export async function loadItineraryStyles(): Promise<void> {
  await import('../itinerary/itinerary.css');
}

/** Airbnb/Booking refuse to be framed, so a booking opens in a small popup
 *  window instead of replacing the dashboard. Falls back to a new tab if the
 *  popup is blocked. */
export function openBookingWindow(url: string): void {
  const w = window.open(url, 'otr-booking', 'popup=yes,width=480,height=720,noopener,noreferrer');
  if (!w) window.open(url, '_blank', 'noopener,noreferrer');
}

const latest = (leg: StoredLeg): StoredLeg => routeStore.peek().find((l) => l.id === leg.id) ?? leg;

function footer(): string {
  return `<button type="button" class="btn btn-ghost" data-open-itinerary>${esc(t('dash.banner.openItinerary'))}</button>`;
}

/** Shared wiring: booking links in a popup, the ticket's booked toggle, the footer button. */
function wireCards(root: HTMLElement, leg: StoredLeg | null, repaint: () => void): void {
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>('a.rd-map-btn--soft');
    if (link?.href) { e.preventDefault(); openBookingWindow(link.href); return; }
    const toggle = target.closest<HTMLElement>('[data-act="toggle-transport-confirmed"]');
    if (toggle) {
      const owner = toggle.closest<HTMLElement>('[data-leg]');
      const cur = owner ? routeStore.peek().find((l) => l.id === owner.dataset.leg) : null;
      if (cur?.arrivalTransport) {
        void routeStore.update(cur.id, { arrivalTransport: { ...cur.arrivalTransport, confirmed: !cur.arrivalTransport.confirmed } }).then(repaint);
      }
    }
  });
  root.querySelector('[data-open-itinerary]')?.addEventListener('click', () => {
    closeDrawer();
    navigateTo('route', leg ? { legId: leg.id } : undefined);
  });
}

/* ── Stays ───────────────────────────────────────────────────────────────── */

export async function openStaysDrawer(legIn: StoredLeg, todayIso: string, trigger?: HTMLElement | null): Promise<void> {
  await loadItineraryStyles();
  const body = (): string => {
    const leg = latest(legIn);
    const stays = legStays(leg);
    const tonight = tonightStay(leg, todayIso);
    return stays.length
      ? `<div class="td-itn">${stays.map((s, i) => `
          ${s === tonight ? `<span class="td-dbadge td-itn-tag">${esc(t('dash.banner.tonight'))}</span>` : ''}
          ${renderStayCard(leg as never, s as never, i, stays.length)}`).join('')}</div>`
      : `<p class="td-dempty">${esc(t('dash.banner.stayNone'))}</p>`;
  };
  const leg0 = latest(legIn);
  const stays0 = legStays(leg0);
  const first = datePart(stays0[0]?.checkIn), lastOut = datePart(stays0[stays0.length - 1]?.checkOut);
  const d = openDrawer({
    title: t('dash.banner.stays', { city: leg0.city }),
    subtitle: first ? bannerDateRange(first, lastOut) : `${leg0.flag} ${leg0.country}`.trim(),
    body: body(),
    footer: footer(),
    className: 'td-itn-drawer',
    returnFocus: trigger,
  });
  wireCards(d.root, leg0, () => d.setBody(body()));
}

/* ── Transport ───────────────────────────────────────────────────────────── */

export function transportTitle(tr: Transport): string {
  return `${transportIcon(tr.type)} ${[tr.from, tr.to].filter(Boolean).join(' → ')}`;
}

export async function openTransportDrawer(
  next: TransportLeg | null,
  arrival: TransportLeg | null,
  todayIso: string,
  trigger?: HTMLElement | null,
): Promise<void> {
  const main = next ?? arrival;
  if (!main) return;
  await loadItineraryStyles();
  const showArrival = !!arrival && arrival !== main;
  const ticket = (e: TransportLeg): string => {
    const cur = latest(e.leg).arrivalTransport ?? e.transport;
    return `<div class="td-itn-ticket" data-leg="${esc(e.leg.id)}">${renderTicket(cur as never)}</div>`;
  };
  const body = (): string => `
    <div class="td-itn">
      ${ticket(main)}
      ${showArrival ? `<h3 class="td-dh">${esc(t('dash.banner.arrivedBy'))}</h3>${ticket(arrival!)}` : ''}
    </div>`;
  const tr = main.transport;
  const when = [tr.date ? bannerDateRange(tr.date) : '', tr.time?.trim()].filter(Boolean).join(' · ');
  const cd = next ? countdownLabel(next.depAt, next.transport.date, appNow(), todayIso) : '';
  const d = openDrawer({
    title: transportTitle(tr),
    subtitle: [t(`agenda.transport.${tr.type}`), when, cd].filter(Boolean).join(' · '),
    body: body(),
    footer: footer(),
    className: 'td-itn-drawer',
    returnFocus: trigger,
  });
  wireCards(d.root, main.leg, () => d.setBody(body()));
}
