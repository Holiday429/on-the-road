/* ==========================================================================
   On the Road · Dashboard banner (middle blocks)
   --------------------------------------------------------------------------
   One row: [weather — owned by dashboard.ts] · progress dial + country ·
   tonight's stay over the next transport · two mini clocks (here / home).
   The layout never changes with the trip's stage; only the content does.
   Stay and transport rows open the side drawer.
   ========================================================================== */

import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { appNow } from '../../data/sim-clock.ts';
import { navigateTo } from '../../core/app.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import type { Phase } from '../../data/trip-phase.ts';
import { datePart } from '../../data/day-agenda.ts';
import { resolveHereTimezone } from '../../data/home-timezone.ts';
import { clockAngles, formatOffsetHours, offsetHoursBetween } from '../../data/tz-math.ts';
import {
  arrivalFor, currentStop, nextTransport, tonightStay, tripDial, tripSpan, tripTransports, stayNights,
  type Dial,
} from '../../data/trip-now.ts';
import { bannerDateRange, countdownLabel, nightsLabel } from './banner-format.ts';
import { openStaysDrawer, openTransportDrawer } from './banner-drawers.ts';
import { openCityDrawer } from './city-drawer.ts';
import { openClocksDrawer } from './clock-drawer.ts';

export interface BannerData {
  phase: Phase;
  legs: StoredLeg[];
  trip: { startDate: string; endDate: string } | null;
  today: string;
  homeTz: string | null;
}

const TRANSPORT_ICON: Record<string, string> = { flight: '✈️', train: '🚆', bus: '🚌', ferry: '⛴️' };
const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

/* ── Dial + country ──────────────────────────────────────────────────────── */

function dialCenter(d: Dial): string {
  if (d.kind === 'before') return `D-${d.daysToGo}`;
  if (d.kind === 'after') return '✓';
  return String(d.day);
}

function renderDial(d: Dial, leg: StoredLeg | null, index: number, count: number): string {
  const dash = (RING_C * Math.min(1, Math.max(0, d.fraction))).toFixed(1);
  const stopLabel = count ? t('dash.hero.stop', { i: index, n: count }) : '';
  const sub =
    d.kind === 'during' ? [t('dash.agenda.dayOf', { n: d.day, total: d.total }), stopLabel]
    : d.kind === 'before' ? [t('dash.banner.firstStop'), stopLabel]
    : [t('dash.hero.complete')];
  const title = leg ? `${leg.flag} ${leg.country}`.trim() : '';
  return `
    <div class="td-dial" data-kind="${d.kind}">
      <div class="td-dial-ring" role="img" aria-label="${esc(t('dash.banner.progress'))}">
        <svg viewBox="0 0 52 52" width="48" height="48" aria-hidden="true">
          <circle class="td-dial-track" cx="26" cy="26" r="${RING_R}" />
          <circle class="td-dial-arc" cx="26" cy="26" r="${RING_R}" stroke-dasharray="${dash} ${RING_C.toFixed(1)}" transform="rotate(-90 26 26)" />
        </svg>
        <span class="td-dial-num" data-len="${dialCenter(d).length}">${esc(dialCenter(d))}</span>
      </div>
      <div class="td-dial-text">
        ${title ? `<div class="td-dial-country">${esc(title)}</div>` : ''}
        ${leg ? `<button type="button" class="td-dial-city" data-banner="city" title="${esc(t('dash.city.open', { city: leg.city }))}">${esc(leg.city)}<span aria-hidden="true"> ›</span></button>` : ''}
        <div class="td-dial-sub">${esc(sub.filter(Boolean).join(' · '))}</div>
      </div>
    </div>`;
}

/* ── Stay + transport rows ───────────────────────────────────────────────── */

function renderStayRow(leg: StoredLeg | null, iso: string): string {
  const stay = leg ? tonightStay(leg, iso) : null;
  const caret = '<span class="td-banner-caret" aria-hidden="true">›</span>';
  if (!leg) return '';
  if (!stay) {
    return `<button type="button" class="td-banner-row td-banner-row--empty" data-banner="stay"><span class="td-banner-ico">🏠</span><span class="td-banner-text">${esc(t('dash.banner.stayNone'))}</span>${caret}</button>`;
  }
  const ci = datePart(stay.checkIn), co = datePart(stay.checkOut);
  const n = stayNights(stay);
  const meta = [ci ? bannerDateRange(ci, co) : '', n ? nightsLabel(n) : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="td-banner-row" data-banner="stay"><span class="td-banner-ico">🏠</span><span class="td-banner-text"><strong>${esc(stay.name)}</strong>${meta ? `<span class="td-banner-meta"> · ${esc(meta)}</span>` : ''}</span>${caret}</button>`;
}

function renderTransportRow(next: ReturnType<typeof nextTransport>, now: Date, iso: string): string {
  const caret = '<span class="td-banner-caret" aria-hidden="true">›</span>';
  if (!next) {
    return `<div class="td-banner-row td-banner-row--none"><span class="td-banner-ico">🧭</span><span class="td-banner-text">${esc(t('dash.banner.noTransport'))}</span></div>`;
  }
  const tr = next.transport;
  const route = [tr.from, tr.to].filter(Boolean).join(' → ');
  const cd = countdownLabel(next.depAt, tr.date, now, iso);
  const cdAttr = next.depAt ? `data-cd-at="${next.depAt.getTime()}"` : `data-cd-date="${esc(tr.date)}"`;
  return `<button type="button" class="td-banner-row" data-banner="transport"><span class="td-banner-ico">${TRANSPORT_ICON[tr.type] ?? '🚀'}</span><span class="td-banner-text"><strong>${esc(route)}</strong> · <span class="td-banner-cd" ${cdAttr}>${esc(cd)}</span></span>${caret}</button>`;
}

function renderSummary(d: Extract<Dial, { kind: 'after' }>, legs: StoredLeg[]): string {
  const countries = new Set(legs.map((l) => l.country)).size;
  const parts = [
    d.total ? t('dash.hero.days', { n: d.total }) : '',
    countries ? t('dash.hero.countries', { n: countries }) : '',
    legs.length ? t('dash.hero.stops', { n: legs.length }) : '',
  ].filter(Boolean);
  return `<div class="td-banner-summary">${esc(parts.join(' · '))}</div>`;
}

/* ── Clocks ──────────────────────────────────────────────────────────────── */

function renderClock(tz: string, now: Date, caption: string, extra = ''): string {
  const a = clockAngles(tz, now);
  let ticks = '';
  for (const h of [0, 3, 6, 9]) ticks += `<line x1="22" y1="4.5" x2="22" y2="7" transform="rotate(${h * 30} 22 22)" />`;
  return `
    <div class="td-clock" data-tz="${esc(tz)}">
      <svg viewBox="0 0 44 44" width="56" height="56" aria-hidden="true">
        <circle class="td-clock-face" cx="22" cy="22" r="20" />
        <g class="td-clock-ticks">${ticks}</g>
        <line class="td-clock-h" data-hand="h" x1="22" y1="22" x2="22" y2="11.5" transform="rotate(${a.hour.toFixed(1)} 22 22)" />
        <line class="td-clock-m" data-hand="m" x1="22" y1="22" x2="22" y2="7.5" transform="rotate(${a.minute.toFixed(1)} 22 22)" />
        <circle class="td-clock-pin" cx="22" cy="22" r="1.6" />
      </svg>
      <div class="td-clock-cap"><span class="td-clock-name">${esc(caption)}</span>${extra}</div>
    </div>`;
}

/** Two clocks — here and home — as one button that opens the clocks drawer.
 *  The offset rides on the Home caption (home relative to here), not its own row. */
function renderClocks(leg: StoredLeg | null, homeTz: string | null, now: Date): string {
  const here = leg ? resolveHereTimezone(leg) : null;
  if (!here && !homeTz) return '';
  const diff = here && homeTz ? offsetHoursBetween(homeTz, here, now) : null;
  const diffHtml = diff != null
    ? `<span class="td-clock-diff" data-home-tz="${esc(homeTz!)}" data-here-tz="${esc(here!)}">${esc(formatOffsetHours(diff))}</span>` : '';
  return `
    <button type="button" class="td-hero-clocks" data-banner="clocks" title="${esc(t('dash.clocks.title'))}"${diff != null ? ` aria-label="${esc(t('dash.banner.tzHint', { diff: formatOffsetHours(diff) }))}"` : ''}>
      ${here ? renderClock(here, now, leg!.city) : ''}
      ${homeTz ? renderClock(homeTz, now, t('dash.banner.home'), diffHtml) : ''}
    </button>`;
}

/* ── Public ──────────────────────────────────────────────────────────────── */

export function renderBanner(d: BannerData, now: Date = appNow()): string {
  const stop = currentStop(d.legs, d.today, d.phase);
  const dial = tripDial(d.phase, tripSpan(d.trip, d.legs), d.today);
  const transports = tripTransports(d.legs, d.homeTz, resolveHereTimezone);
  const next = nextTransport(transports, now, d.today);
  const anchorIso = d.phase === 'before' && stop ? stop.leg.dateFrom : d.today;

  const middle = d.phase === 'after'
    ? renderSummary(dial as Extract<Dial, { kind: 'after' }>, d.legs)
    : `<div class="td-banner-rows">${renderStayRow(stop?.leg ?? null, anchorIso)}${renderTransportRow(next, now, d.today)}</div>`;

  return `
    ${renderDial(dial, stop?.leg ?? null, stop?.index ?? 0, stop?.count ?? 0)}
    <div class="td-hero-info">${middle}</div>
    ${renderClocks(stop?.leg ?? null, d.homeTz, now)}`;
}

/** Wire the banner's drawer triggers. `getData` is read at click time so the
 *  drawer reflects the latest stores, not the render the click handler came from. */
export function wireBanner(root: HTMLElement, getData: () => BannerData, onChange: () => void): void {
  root.querySelector<HTMLElement>('[data-banner="stay"]')?.addEventListener('click', (e) => {
    const d = getData();
    const stop = currentStop(d.legs, d.today, d.phase);
    if (!stop) return;
    const iso = d.phase === 'before' ? stop.leg.dateFrom : d.today;
    void openStaysDrawer(stop.leg, iso, e.currentTarget as HTMLElement);
  });
  root.querySelector<HTMLElement>('[data-banner="city"]')?.addEventListener('click', (e) => {
    const d = getData();
    const stop = currentStop(d.legs, d.today, d.phase);
    if (stop) void openCityDrawer(stop.leg, d.today, e.currentTarget as HTMLElement);
  });
  root.querySelector<HTMLElement>('[data-banner="clocks"]')?.addEventListener('click', (e) => {
    const d = getData();
    const stop = currentStop(d.legs, d.today, d.phase);
    openClocksDrawer({ leg: stop?.leg ?? null, homeTz: d.homeTz, onChange, trigger: e.currentTarget as HTMLElement });
  });
  root.querySelector<HTMLElement>('[data-banner="transport"]')?.addEventListener('click', (e) => {
    const d = getData();
    const stop = currentStop(d.legs, d.today, d.phase);
    const list = tripTransports(d.legs, d.homeTz, resolveHereTimezone);
    const next = nextTransport(list, appNow(), d.today);
    const arrival = stop ? arrivalFor(list, stop.leg) : null;
    if (!next && !arrival) { navigateTo('route'); return; }
    void openTransportDrawer(next, arrival, d.today, e.currentTarget as HTMLElement);
  });
}

/* ── Live ticking ────────────────────────────────────────────────────────── */
// Clock hands and countdowns advance in place; a full dashboard re-render once
// a minute would be wasteful (and would re-morph the whole page).

let _tick: ReturnType<typeof setInterval> | null = null;

function tickBanner(getToday: () => string): void {
  if (document.hidden) return;
  const now = appNow();
  document.querySelectorAll<SVGElement>('.td-clock[data-tz] svg').forEach((svg) => {
    const tz = (svg.closest('.td-clock') as HTMLElement).dataset.tz!;
    const a = clockAngles(tz, now);
    svg.querySelector('[data-hand="h"]')?.setAttribute('transform', `rotate(${a.hour.toFixed(1)} 22 22)`);
    svg.querySelector('[data-hand="m"]')?.setAttribute('transform', `rotate(${a.minute.toFixed(1)} 22 22)`);
  });
  document.querySelectorAll<HTMLElement>('.td-clock-diff[data-home-tz]').forEach((el) => {
    el.textContent = formatOffsetHours(offsetHoursBetween(el.dataset.homeTz!, el.dataset.hereTz!, now));
  });
  const today = getToday();
  document.querySelectorAll<HTMLElement>('.td-banner-cd').forEach((el) => {
    const at = el.dataset.cdAt, date = el.dataset.cdDate;
    el.textContent = countdownLabel(at ? new Date(Number(at)) : null, date ?? today, now, today);
  });
}

export function startBannerClock(getToday: () => string): void {
  if (_tick) return;
  _tick = setInterval(() => tickBanner(getToday), 20_000);
}
