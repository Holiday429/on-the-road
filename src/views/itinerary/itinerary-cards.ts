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
        <span class="route-info-icon">🏠</span>
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
    <div class="rd-placeholder">
      <span>${tr('route.noTransport')}</span>
      <button class="btn btn-primary rd-sm" data-act="edit-transport">${tr('route.btnAddTransport')}</button>
    </div>`;

  return `
    <section class="rd-section rd-section--transport">
      <div class="rd-section-head"><h3>${tr('route.sectionTransport')}</h3></div>
      ${body}
    </section>`;
}

/** One stay as a little storefront: a striped awning (amber once confirmed,
 *  grey while pending) over a check-in → check-out reservation strip. */
export function renderStayCard(leg: Leg, a: Accommodation, i: number, total: number): string {
  const key = a.id ?? String(i);
  const price = stayPriceLabel(a, baseCurrency());
  const canSync = a.priceAmount != null;
  const synced = !!a.expenseId;
  const nights = a.checkIn && a.checkOut ? daysBetween(a.checkIn, a.checkOut) : null;
  const dateCell = (cls: string, label: string, iso?: string) => {
    const d = iso ? new Date(iso + 'T00:00:00') : null;
    return `
      <div class="rd-stay-date ${cls}">
        <span class="rd-stay-lbl">${label}</span>
        <span class="rd-stay-day">${d ? esc(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) : '—'}</span>
        <span class="rd-stay-wd">${d ? esc(d.toLocaleDateString('en-GB', { weekday: 'long' })) : ''}</span>
      </div>`;
  };
  const facts = [
    price ? `<span>💰 ${esc(price)}${tr('route.perNight')}${synced ? ` · ${tr('route.loggedLabel')}` : ''}</span>` : '',
    a.platform ? `<span>🛎️ ${esc(a.platform)}</span>` : '',
    a.phone ? `<span>📞 ${esc(a.phone)}</span>` : '',
  ].filter(Boolean).join('');
  const booking = stayBookingHref(a);
  return `
    <article class="rd-stay-card ${a.confirmed ? 'is-confirmed' : ''}" data-stay="${esc(key)}">
      <div class="rd-stay-awning" aria-hidden="true"></div>
      <div class="rd-stay-body">
        <div class="rd-stay-head">
          <div class="rd-stay-sign">
            ${total > 1 ? `<span class="rd-stay-no">${i + 1}</span>` : ''}
            <div class="rd-stay-name-wrap">
              <div class="rd-stay-name">${esc(a.name)}</div>
              ${a.address ? `<div class="rd-stay-addr">${esc(a.address)}</div>` : ''}
            </div>
          </div>
          <span class="rd-stay-badge">${a.confirmed ? tr('route.stayConfirmed') : tr('route.stayNotConfirmed')}</span>
        </div>
        <div class="rd-stay-strip">
          ${dateCell('is-in', tr('route.stayCheckIn'), a.checkIn)}
          <div class="rd-stay-nights">
            <span class="rd-stay-moon">🌙</span>
            <span>${nights != null ? nightsLabel(nights) : ''}</span>
          </div>
          ${dateCell('is-out', tr('route.stayCheckOut'), a.checkOut)}
        </div>
        <div class="rd-stay-foot">
          <div class="rd-stay-facts">${facts}</div>
          <div class="rd-stay-actions">
            <a class="rd-map-btn" href="${safeUrl(mapHref(a, leg))}" target="_blank" rel="noopener" title="Navigate in Google Maps">${tr('route.stayNavigate')}</a>
            ${booking ? `<a class="rd-map-btn rd-map-btn--soft" href="${safeUrl(booking)}" target="_blank" rel="noopener" title="Open the booking on ${esc(a.platform || 'the platform')}">${tr('route.stayOrder')}</a>` : ''}
            ${canSync ? `<button class="rd-icon-btn rd-icon-btn--text" data-act="sync-stay" data-stay="${esc(key)}" title="${synced ? 'Update the linked expense' : 'Log this stay in Expenses'}">${synced ? '↻ Expense' : '＋ Expense'}</button>` : ''}
            <button class="rd-icon-btn" data-act="edit-stay" data-stay="${esc(key)}" title="Edit">✎</button>
            <button class="rd-icon-btn rd-danger" data-act="del-stay" data-stay="${esc(key)}" title="Remove">✕</button>
          </div>
        </div>
      </div>
    </article>`;
}

export function renderStaysSection(leg: Leg): string {
  const stays = legStays(leg);
  return `
    <section class="rd-section rd-section--stays">
      <div class="rd-section-head">
        <h3>${tr('route.sectionStays')}</h3>
        <button class="btn btn-ghost rd-sm" data-act="add-stay">${tr('route.btnAddStay')}</button>
      </div>
      ${stays.length ? `<div class="rd-stay-list">${stays.map((a, i) => renderStayCard(leg, a, i, stays.length)).join('')}</div>`
        : `<div class="rd-placeholder"><span>${tr('route.noStays')}</span></div>`}
    </section>`;
}
