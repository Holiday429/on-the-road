/* ==========================================================================
   On the Road · Itinerary · card renderers
   --------------------------------------------------------------------------
   Pure HTML builders for the visual pieces of the itinerary: the cover art
   (photo or per-city tint), the list card's "Getting here / Stay" tiles, the
   arrival transport drawn as a ticket, and each stay as a little storefront.
   No module state — itinerary.ts owns wiring via the data-act attributes.
   ========================================================================== */

import { t as tr } from '../../core/i18n.ts';
import { escHtml as esc, safeUrl } from '../../core/utils.ts';
import { baseCurrency } from '../../data/trip-context.ts';
import {
  TRANSPORT_ICONS, daysBetween, legStays, mapHref, stayPriceLabel,
  transportPriceLabel, stayBookingHref, baggageLabel, coverPosition, cityHue,
} from './itinerary-utils.ts';
import type { Leg, Transport, Accommodation } from './itinerary-shared.ts';

import { STAY_ICON } from '../../core/icons.ts';
export function nightsLabel(n: number): string {
  return n === 1 ? tr('route.nightsOne') : tr('route.nightsMany', { n });
}

/** Cover art for a leg: the photo (iOS or web upload) cropped to its focal
 *  point, or a per-city tinted gradient with the flag when there's none. */
export function legCoverArt(leg: Leg, cls: string, eager = false): string {
  const src = safeUrl(leg.coverImageUrl);
  if (src) {
    return `<img class="${cls}-img" src="${src}" alt="" loading="${eager ? 'eager' : 'lazy'}" decoding="async"
      style="object-position:${coverPosition(leg)}">`;
  }
  return `<div class="${cls}-fallback" style="--city-hue:${cityHue(leg.city)}">
      <span class="${cls}-fallback-flag">${leg.flag || '🗺️'}</span>
    </div>`;
}

/** "Getting here" + "Stay" rows on the list card. */
export function legSummary(leg: Leg): string {
  const t = leg.arrivalTransport;
  const stays = legStays(leg);

  const transport = t ? `
    <div class="route-info-main">
      <span class="route-info-title">${t.service ? esc(t.service) : esc(t.from)}</span>
      ${t.service ? `<span class="route-info-sub">${tr('route.ticketFrom')} ${esc(t.from)}</span>` : ''}
    </div>
    ${t.time ? `<span class="route-info-time">${esc(t.time)}${t.arrivalTime ? ` → ${esc(t.arrivalTime)}` : ''}</span>` : ''}`
    : `<span class="route-info-empty">${tr('route.noTransportShort')}</span>`;

  const first = stays[0];
  const stay = first ? `
    <a class="route-info-main route-info-link" href="${safeUrl(mapHref(first, leg))}" target="_blank" rel="noopener" data-act="stay-link" title="Open in Google Maps">
      <span class="route-info-title">${esc(first.name)}</span>
      ${stays.length > 1 ? `<span class="route-info-sub">${tr('route.moreStays', { n: stays.length - 1 })}</span>` : ''}
    </a>
    ${first.confirmed ? '<span class="route-info-ok" title="Confirmed">✓</span>' : ''}`
    : `<span class="route-info-empty">${tr('route.noStayShort')}</span>`;

  return `
    <div class="route-leg-info-grid">
      <div class="route-info ${t ? '' : 'is-empty'}">
        <span class="route-info-icon">${t ? TRANSPORT_ICONS[t.type] : '🧭'}</span>
        <div class="route-info-body">
          <span class="route-info-label">${tr('route.gettingHere')}</span>
          <div class="route-info-row">${transport}</div>
        </div>
      </div>
      <div class="route-info route-info--stay ${first ? '' : 'is-empty'}">
        <span class="route-info-icon">${STAY_ICON}</span>
        <div class="route-info-body">
          <span class="route-info-label">${tr('route.stayLabel')}</span>
          <div class="route-info-row">${stay}</div>
        </div>
      </div>
    </div>`;
}

const TICKET_KIND: Record<Transport['type'], string> = {
  flight: 'route.ticketFlight', train: 'route.ticketTrain', bus: 'route.ticketBus', ferry: 'route.ticketFerry',
};

/** Weekday + date for ticket / stay fields, e.g. "Thu 25 Jun". */
function fmtDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Arrival transport drawn as a ticket — a boarding pass for flights, a rail
 *  / coach / ferry ticket otherwise (same layout, accent per mode). The stub
 *  on the right carries the booked toggle and booking ref. */
export function renderTicket(t: Transport): string {
  const price = transportPriceLabel(t, baseCurrency());
  const bags = baggageLabel(t);
  const synced = !!t.expenseId;
  const field = (label: string, value: string) =>
    `<div class="rd-ticket-field"><span class="rd-ticket-lbl">${label}</span><span class="rd-ticket-val">${value}</span></div>`;
  const fields = [
    t.date ? field(tr('route.ticketDate'), esc(fmtDay(t.date))) : '',
    t.duration ? field(tr('route.ticketDuration'), esc(t.duration)) : '',
    price ? field(tr('route.ticketFare'), `${esc(price)}${synced ? ` <small>· ${tr('route.loggedLabel')}</small>` : ''}`) : '',
    bags ? field(tr('route.ticketBaggage'), esc(bags)) : '',
  ].filter(Boolean).join('');
  const end = (cls: string, label: string, city: string, time?: string, place?: string) => `
    <div class="rd-ticket-end ${cls}">
      <span class="rd-ticket-lbl">${label}</span>
      <span class="rd-ticket-city">${esc(city)}</span>
      <span class="rd-ticket-time">${time ? esc(time) : '—'}</span>
      ${place ? `<span class="rd-ticket-place">${esc(place)}</span>` : ''}
    </div>`;
  return `
    <div class="rd-ticket rd-ticket--${t.type}">
      <div class="rd-ticket-top">
        <span class="rd-ticket-kind">${TRANSPORT_ICONS[t.type]} ${tr(TICKET_KIND[t.type])}</span>
        ${t.service ? `<span class="rd-ticket-service">${esc(t.service)}</span>` : ''}
      </div>
      <div class="rd-ticket-main">
        <div class="rd-ticket-route">
          ${end('is-from', tr('route.ticketFrom'), t.from, t.time, t.depPlace)}
          <div class="rd-ticket-path" aria-hidden="true">
            <span class="rd-ticket-track"><span class="rd-ticket-glyph">${TRANSPORT_ICONS[t.type]}</span></span>
            ${t.via?.length ? `<span class="rd-ticket-via">${esc(tr('route.ticketVia', { cities: t.via.join(' · ') }))}</span>` : ''}
          </div>
          ${end('is-to', tr('route.ticketTo'), t.to, t.arrivalTime, t.arrPlace)}
        </div>
        ${fields ? `<div class="rd-ticket-fields">${fields}</div>` : ''}
        ${t.notes ? `<div class="rd-ticket-note">${esc(t.notes)}</div>` : ''}
      </div>
      <div class="rd-ticket-stub">
        <button class="rd-ticket-status ${t.confirmed ? 'is-booked' : ''}" data-act="toggle-transport-confirmed" title="${tr('route.ticketToggleHint')}">
          ${t.confirmed ? tr('route.ticketBooked') : tr('route.ticketNotBooked')}
        </button>
        ${t.bookingRef ? `<div class="rd-ticket-ref"><span class="rd-ticket-lbl">${tr('route.ticketRef')}</span><span class="rd-ticket-val">${esc(t.bookingRef)}</span></div>` : ''}
        <span class="rd-ticket-barcode" aria-hidden="true"></span>
      </div>
    </div>`;
}

export function renderTransportSection(leg: Leg): string {
  const t = leg.arrivalTransport;
  const synced = !!t?.expenseId;
  const body = t ? `
    ${renderTicket(t)}
    <div class="rd-section-actions">
      <button class="btn btn-ghost rd-sm" data-act="edit-transport">${tr('route.btnEdit')}</button>
      ${t.priceAmount != null ? `<button class="btn btn-ghost rd-sm" data-act="sync-transport">${synced ? tr('route.btnUpdateExpense') : tr('route.btnLogExpense')}</button>` : ''}
      <button class="btn btn-ghost rd-sm rd-danger" data-act="del-transport">${tr('route.btnRemove')}</button>
    </div>` : `
    <div class="rd-ticket-ghost">
      <span>${tr('route.noTransport')}</span>
      <button class="btn btn-primary rd-sm" data-act="edit-transport">${tr('route.btnAddTransport')}</button>
    </div>`;

  return `
    <section class="rd-section rd-section--transport">
      <div class="rd-section-head"><h3>${tr('route.sectionTransport')}</h3></div>
      ${body}
    </section>`;
}

/** One stay as a hotel voucher — the same ticket as the transport one (top
 *  band, route strip, perforated stub) so the two sit side by side at the same
 *  size. Check-in and check-out take the two route ends, a moon and the night
 *  count sit on the path between them, and the stub carries the confirmed stamp
 *  above a room-key magstripe (the transport ticket has a barcode there).
 *  `interactive` turns the stamp into a toggle; the dashboard / agenda drawers
 *  render the card read-only. */
export function renderStayCard(leg: Leg, a: Accommodation, i: number, total: number, opts: { interactive?: boolean } = {}): string {
  const key = a.id ?? String(i);
  const price = stayPriceLabel(a, baseCurrency());
  const synced = !!a.expenseId;
  const nights = a.checkIn && a.checkOut ? daysBetween(a.checkIn, a.checkOut) : null;
  const end = (cls: string, label: string, iso?: string) => {
    const d = iso ? new Date(iso + 'T00:00:00') : null;
    return `
    <div class="rd-ticket-end ${cls}">
      <span class="rd-ticket-lbl">${label}</span>
      <span class="rd-ticket-time rd-stay-day">${d ? esc(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) : '—'}</span>
      ${d ? `<span class="rd-ticket-place">${esc(d.toLocaleDateString('en-GB', { weekday: 'long' }))}</span>` : ''}
    </div>`;
  };
  const field = (label: string, value: string) =>
    `<div class="rd-ticket-field"><span class="rd-ticket-lbl">${label}</span><span class="rd-ticket-val">${value}</span></div>`;
  const fields = [
    price ? field(tr('route.stayRate'), `${esc(price)}${tr('route.perNight')}${synced ? ` <small>· ${tr('route.loggedLabel')}</small>` : ''}`) : '',
    a.platform ? field(tr('route.stayPlatform'), esc(a.platform)) : '',
    a.phone ? field(tr('route.stayPhone'), esc(a.phone)) : '',
  ].filter(Boolean).join('');
  const booking = stayBookingHref(a);
  const stampText = a.confirmed ? tr('route.stayConfirmed') : tr('route.stayNotConfirmed');
  const stamp = opts.interactive
    ? `<button class="rd-ticket-status ${a.confirmed ? 'is-booked' : ''}" data-act="toggle-stay-confirmed" data-stay="${esc(key)}" title="${tr('route.stayToggleHint')}">${stampText}</button>`
    : `<span class="rd-ticket-status ${a.confirmed ? 'is-booked' : ''}">${stampText}</span>`;
  return `
    <article class="rd-ticket rd-ticket--stay" data-stay="${esc(key)}">
      <div class="rd-ticket-top">
        <span class="rd-ticket-kind">${STAY_ICON} ${tr('route.stayKind')}</span>
        ${total > 1 ? `<span class="rd-ticket-service">${i + 1} / ${total}</span>` : ''}
      </div>
      <div class="rd-ticket-main">
        <div class="rd-stay-name-wrap">
          <div class="rd-stay-name">${esc(a.name)}</div>
          ${a.address ? `<div class="rd-stay-addr">${esc(a.address)}</div>` : ''}
        </div>
        <div class="rd-ticket-route">
          ${end('is-from', tr('route.stayCheckIn'), a.checkIn)}
          <div class="rd-ticket-path" aria-hidden="true">
            <span class="rd-ticket-track"><span class="rd-ticket-glyph">🌙</span></span>
            ${nights != null ? `<span class="rd-ticket-via">${nightsLabel(nights)}</span>` : ''}
          </div>
          ${end('is-to', tr('route.stayCheckOut'), a.checkOut)}
        </div>
        ${fields ? `<div class="rd-ticket-fields">${fields}</div>` : ''}
        <div class="rd-ticket-links">
          <a class="rd-map-btn" href="${safeUrl(mapHref(a, leg))}" target="_blank" rel="noopener" title="Navigate in Google Maps">${tr('route.stayNavigate')}</a>
          ${booking ? `<a class="rd-map-btn rd-map-btn--soft" href="${safeUrl(booking)}" target="_blank" rel="noopener" title="Open the booking on ${esc(a.platform || 'the platform')}">${tr('route.stayOrder')}</a>` : ''}
        </div>
      </div>
      <div class="rd-ticket-stub">
        ${stamp}
        <span class="rd-ticket-keycard" aria-hidden="true"></span>
      </div>
    </article>`;
}

/** Edit / expense / remove row under one stay ticket (the detail page only). */
function stayActions(a: Accommodation, i: number): string {
  const key = esc(a.id ?? String(i));
  const synced = !!a.expenseId;
  return `
    <div class="rd-section-actions">
      <button class="btn btn-ghost rd-sm" data-act="edit-stay" data-stay="${key}">${tr('route.btnEdit')}</button>
      ${a.priceAmount != null ? `<button class="btn btn-ghost rd-sm" data-act="sync-stay" data-stay="${key}">${synced ? tr('route.btnUpdateExpense') : tr('route.btnLogExpense')}</button>` : ''}
      <button class="btn btn-ghost rd-sm rd-danger" data-act="del-stay" data-stay="${key}">${tr('route.btnRemove')}</button>
    </div>`;
}

/** The stays column. One ticket at a time: with several stays a pager steps
 *  through them so the column keeps the transport ticket's height. */
export function renderStaysSection(leg: Leg, page = 0): string {
  const stays = legStays(leg);
  const at = Math.min(Math.max(page, 0), Math.max(stays.length - 1, 0));
  const pager = stays.length > 1 ? `
    <div class="rd-stay-pager" role="group" aria-label="${tr('route.sectionStays')}">
      <button class="rd-icon-btn" data-act="stay-page" data-dir="-1" aria-label="Previous stay" ${at === 0 ? 'disabled' : ''}>‹</button>
      <span class="rd-stay-pager-n">${at + 1} / ${stays.length}</span>
      <button class="rd-icon-btn" data-act="stay-page" data-dir="1" aria-label="Next stay" ${at === stays.length - 1 ? 'disabled' : ''}>›</button>
    </div>` : '';
  const body = stays.length ? `
    ${renderStayCard(leg, stays[at], at, stays.length, { interactive: true })}
    ${stayActions(stays[at], at)}` : `
    <div class="rd-ticket-ghost">
      <span>${tr('route.noStays')}</span>
      <button class="btn btn-primary rd-sm" data-act="add-stay">${tr('route.btnAddStay')}</button>
    </div>`;
  return `
    <section class="rd-section rd-section--stays">
      <div class="rd-section-head">
        <h3>${tr('route.sectionStays')}</h3>
        ${pager}
        ${stays.length ? `<button class="btn btn-ghost rd-sm" data-act="add-stay">${tr('route.btnAddStay')}</button>` : ''}
      </div>
      ${body}
    </section>`;
}
