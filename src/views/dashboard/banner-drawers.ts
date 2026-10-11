/* ==========================================================================
   On the Road · Dashboard banner — drawer contents
   --------------------------------------------------------------------------
   What the banner's two rows open in the side drawer: every stay for the
   current stop, and the next transport's full detail (plus how you arrived).
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { navigateTo } from '../../core/app.ts';
import { escHtml as esc, safeUrl } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { appNow } from '../../data/sim-clock.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { datePart, timePart } from '../../data/day-agenda.ts';
import { legStays, stayNights, tonightStay, type Stay, type Transport, type TransportLeg } from '../../data/trip-now.ts';
import { bannerDateRange, countdownLabel, nightsLabel } from './banner-format.ts';

const TRANSPORT_ICON: Record<string, string> = { flight: '✈️', train: '🚆', bus: '🚌', ferry: '⛴️' };

function blank(s: string | undefined | null): string | null {
  const v = s?.trim();
  return v ? v : null;
}

function rows(pairs: Array<[string, string | null | undefined, boolean?]>): string {
  return pairs
    .filter(([, v]) => blank(v ?? ''))
    .map(([k, v, raw]) =>
      `<div class="td-dr"><span class="td-dr-k">${esc(k)}</span><span class="td-dr-v">${raw ? v : esc(v!)}</span></div>`)
    .join('');
}

/** Airbnb/Booking refuse to be framed, so a booking opens in a small popup
 *  window instead of replacing the dashboard. Falls back to a new tab if the
 *  popup is blocked. */
export function openBookingWindow(url: string): void {
  const w = window.open(url, 'otr-booking', 'popup=yes,width=480,height=720,noopener,noreferrer');
  if (!w) window.open(url, '_blank', 'noopener,noreferrer');
}

function bookingButton(rawUrl: string | undefined | null): string {
  const url = safeUrl(rawUrl);
  return url ? `<button type="button" class="btn btn-primary td-dr-book" data-book-url="${url}">${esc(t('dash.banner.openBooking'))}</button>` : '';
}

function wireDrawer(root: HTMLElement, leg: StoredLeg | null): void {
  root.querySelectorAll<HTMLElement>('[data-book-url]').forEach((b) =>
    b.addEventListener('click', () => openBookingWindow(b.dataset.bookUrl!)));
  root.querySelector('[data-open-itinerary]')?.addEventListener('click', () => {
    closeDrawer();
    navigateTo('route', leg ? { legId: leg.id } : undefined);
  });
}

function footer(): string {
  return `<button type="button" class="btn btn-ghost" data-open-itinerary>${esc(t('dash.banner.openItinerary'))}</button>`;
}

/* ── Stays ───────────────────────────────────────────────────────────────── */

function stayCard(s: Stay, isTonight: boolean): string {
  const ci = datePart(s.checkIn), co = datePart(s.checkOut);
  const n = stayNights(s);
  const phone = blank(s.phone);
  const dates = ci ? `${bannerDateRange(ci, co)}${n ? ` · ${nightsLabel(n)}` : ''}` : null;
  const times = [timePart(s.checkIn), timePart(s.checkOut)];
  return `
    <section class="td-dcard${isTonight ? ' is-now' : ''}">
      <div class="td-dcard-head">
        <div class="td-dcard-title">🏠 ${esc(s.name)}</div>
        ${isTonight ? `<span class="td-dbadge">${esc(t('dash.banner.tonight'))}</span>` : ''}
      </div>
      <div class="td-dcard-sub">${dates ? `${esc(dates)} · ` : ''}<span class="${s.confirmed ? 'is-ok' : ''}">${esc(t(s.confirmed ? 'agenda.confirmed' : 'agenda.notConfirmed'))}</span></div>
      ${rows([
        [t('agenda.d.checkIn'), [ci ? bannerDateRange(ci) : '', times[0]].filter(Boolean).join(' · ') || null],
        [t('agenda.d.checkOut'), [co ? bannerDateRange(co) : '', times[1]].filter(Boolean).join(' · ') || null],
        [t('agenda.d.address'), s.address],
        [t('agenda.d.platform'), s.platform],
        [t('agenda.d.phone'), phone ? `<a href="tel:${esc(phone.replace(/[^+0-9]/g, ''))}">${esc(phone)}</a>` : null, true],
        [t('agenda.d.price'), s.priceAmount != null ? `${s.priceAmount} ${s.priceCurrency ?? ''}`.trim() : s.price],
      ])}
      ${bookingButton(s.bookingUrl || s.link)}
    </section>`;
}

export function openStaysDrawer(leg: StoredLeg, todayIso: string, trigger?: HTMLElement | null): void {
  const stays = legStays(leg);
  const tonight = tonightStay(leg, todayIso);
  const first = datePart(stays[0]?.checkIn), lastOut = datePart(stays[stays.length - 1]?.checkOut);
  const d = openDrawer({
    title: t('dash.banner.stays', { city: leg.city }),
    subtitle: first ? bannerDateRange(first, lastOut) : `${leg.flag} ${leg.country}`.trim(),
    body: stays.length
      ? stays.map((s) => stayCard(s, s === tonight)).join('')
      : `<p class="td-dempty">${esc(t('dash.banner.stayNone'))}</p>`,
    footer: footer(),
    returnFocus: trigger,
  });
  wireDrawer(d.root, leg);
}

/* ── Transport ───────────────────────────────────────────────────────────── */

function transportBody(tr: Transport): string {
  const bag = [
    [t('dash.banner.bag.checked'), tr.baggageCheckedG],
    [t('dash.banner.bag.carryOn'), tr.baggageCarryOnG ?? tr.baggageAllowanceG],
    [t('dash.banner.bag.personal'), tr.baggagePersonalG],
  ] as Array<[string, number | undefined]>;
  const kg = (g: number) => `${Math.round(g / 100) / 10} kg`;
  return rows([
    [t('agenda.d.service'), tr.service],
    [t('agenda.d.departs'), [blank(tr.time), blank(tr.depPlace)].filter(Boolean).join(' · ') || null],
    [t('agenda.d.arrives'), [blank(tr.arrivalTime), blank(tr.arrPlace)].filter(Boolean).join(' · ') || null],
    [t('agenda.d.duration'), tr.duration],
    [t('agenda.d.via'), tr.via?.filter(Boolean).join(' · ')],
    [t('agenda.d.booking'), tr.bookingRef],
    [t('agenda.d.price'), tr.priceAmount != null ? `${tr.priceAmount} ${tr.priceCurrency ?? ''}`.trim() : tr.price],
    ...bag.map(([k, g]): [string, string | null] => [k, g != null && g > 0 ? kg(g) : null]),
    [t('agenda.d.status'), t(tr.confirmed ? 'agenda.confirmed' : 'agenda.notConfirmed')],
    [t('agenda.d.notes'), tr.notes],
  ]);
}

function transportTitle(tr: Transport): string {
  return `${TRANSPORT_ICON[tr.type] ?? '🚀'} ${[tr.from, tr.to].filter(Boolean).join(' → ')}`;
}

export function openTransportDrawer(
  next: TransportLeg | null,
  arrival: TransportLeg | null,
  todayIso: string,
  trigger?: HTMLElement | null,
): void {
  const main = next ?? arrival;
  if (!main) return;
  const tr = main.transport;
  const when = [tr.date ? bannerDateRange(tr.date) : '', blank(tr.time)].filter(Boolean).join(' · ');
  const cd = next ? countdownLabel(next.depAt, next.transport.date, appNow(), todayIso) : '';
  const showArrival = !!arrival && arrival !== main;
  const d = openDrawer({
    title: transportTitle(tr),
    subtitle: [t(`agenda.transport.${tr.type}`), when, cd].filter(Boolean).join(' · '),
    body: `
      <section class="td-dcard${next ? ' is-now' : ''}">${transportBody(tr)}</section>
      ${showArrival ? `
        <h3 class="td-dh">${esc(t('dash.banner.arrivedBy'))}</h3>
        <section class="td-dcard">
          <div class="td-dcard-title">${esc(transportTitle(arrival!.transport))}</div>
          ${transportBody(arrival!.transport)}
        </section>` : ''}`,
    footer: footer(),
    returnFocus: trigger,
  });
  wireDrawer(d.root, main.leg);
}
