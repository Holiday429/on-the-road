/* ==========================================================================
   On the Road · World — side panel markup (pure)
   --------------------------------------------------------------------------
   The overview (totals, trips, countries, passport) and the country detail the
   panel switches to. Plain functions from data to an HTML string, so they can be
   tested without a browser; world.ts wires the clicks by `data-*` attributes.
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import { escHtml as esc, safeUrl } from '../../core/utils.ts';
import type { StampSpec } from '../../core/paper/stamp.ts';
import { fmtRange } from '../map/map-geo.ts';
import { fmtKm, fmtSpend } from '../map/map-stats.ts';
import { unlocatedMarkup } from '../map/map-panel.ts';
import type { UnlocatedStop } from '../map/map-plot.ts';
import type { CountryDetail } from './country-model.ts';
import type { CountryExtras } from './country-extras.ts';
import type { ColorMode, TripRecord, WorldModel, WorldSummary } from './world-model.ts';

const card = (num: string, label: string) =>
  `<div class="map-stat"><div class="map-stat-num">${esc(num)}</div><div class="map-stat-label">${esc(label)}</div></div>`;

export type WorldLayer = 'routes' | 'cities';

export type AtlasSwitch = WorldLayer | 'spin' | 'night';

/** The lifetime totals as one line under the title (they follow the replay cursor too). */
export function hudStatsMarkup(s: WorldSummary, locale: string): string {
  const item = (num: string, label: string) => `<span class="atlas-stat"><b>${esc(num)}</b> ${esc(label)}</span>`;
  return [
    item(String(s.countries), t('map.stat.countries')),
    item(String(s.continents), t(s.continents === 1 ? 'map.stat.continent' : 'map.stat.continents')),
    item(String(s.cities), t('map.stat.cities')),
    item(String(s.nights), t('map.stat.nights')),
    item(fmtKm(s.km, locale), t('map.stat.km')),
    item(String(s.trips), t('world.stat.trips')),
  ].join('');
}

/** The small settings popover: map layers and the two things that move or shade by themselves. */
export function settingsMarkup(on: ReadonlySet<AtlasSwitch>): string {
  const sw = (id: AtlasSwitch, key: string) =>
    `<button class="map-layer-chip${on.has(id) ? ' active' : ''}" data-switch="${id}" role="switch" aria-checked="${on.has(id)}">${esc(t(key))}</button>`;
  return `
    ${sw('routes', 'world.layer.routes')}
    ${sw('cities', 'world.layer.cities')}
    ${sw('night', 'atlas.night')}
    ${sw('spin', 'world.layer.spin')}`;
}

/** The panel while every trip is being replayed: a title and a way out (the totals are in the header). */
export function replayMarkup(): string {
  return `
    <h2 class="world-chead-name">${esc(t('world.replay.title'))}</h2>
    <button class="btn btn-ghost world-back" data-act="replay-close">${esc(t('world.replay.close'))}</button>`;
}

export interface OverviewInput {
  model: WorldModel;
  mode: ColorMode;
  /** There is more than one date to replay through. */
  canReplay: boolean;
  /** The trip the chips are filtered to, if any. */
  onlyTripId: string | null;
  currentTripId: string | null;
  unlocated: UnlocatedStop[];
  passport: { earned: number; countries: number } | null;
  locale: string;
}

function tripChip(tr: TripRecord, o: OverviewInput): string {
  const active = o.onlyTripId === tr.id;
  const phase = tr.phase === 'current' ? `<span class="world-trip-phase">${esc(t('world.phase.current'))}</span>`
    : tr.phase === 'future' ? `<span class="world-trip-phase">${esc(t('world.phase.future'))}</span>` : '';
  return `
    <button class="world-trip${active ? ' active' : ''}${tr.id === o.currentTripId ? ' is-current' : ''}" data-trip="${esc(tr.id)}" aria-pressed="${active}" style="--trip:${esc(tr.color || 'var(--accent)')}">
      <span class="world-trip-dot" aria-hidden="true"></span>
      <span class="world-trip-main">
        <span class="world-trip-name">${esc(tr.name)} ${phase}</span>
        <span class="world-trip-meta">${esc(fmtRange(tr.startDate, tr.endDate, o.locale))}</span>
      </span>
    </button>`;
}

export function overviewMarkup(o: OverviewInput): string {
  const trips = o.model.trips.filter((tr) => tr.legCount > 0);
  const hasCurrent = !!o.currentTripId && trips.some((tr) => tr.id === o.currentTripId);
  const countries = [...o.model.countries.values()].sort((a, b) => a.name.localeCompare(b.name));
  return `
    <div class="map-scope world-mode" role="group" aria-label="${esc(t('world.color.label'))}">
      <button class="map-scope-btn${o.mode === 'count' ? ' active' : ''}" data-color="count" aria-pressed="${o.mode === 'count'}">${esc(t('world.color.count'))}</button>
      <button class="map-scope-btn${o.mode === 'trip' ? ' active' : ''}" data-color="trip" aria-pressed="${o.mode === 'trip'}">${esc(t('world.color.trip'))}</button>
    </div>
    ${o.canReplay ? `<button class="btn btn-ghost world-replay" data-act="replay">${esc(t('world.replay.start'))}</button>` : ''}
    ${hasCurrent ? `<button class="btn btn-primary world-open-route" data-act="open-route">${esc(t('world.openRoute'))}</button>` : ''}
    ${o.passport ? `<button type="button" class="pp-pocket" data-open-passport="">
      <span class="pp-pocket-cover" aria-hidden="true">🛂</span>
      <span class="pp-pocket-text"><strong>${esc(t('passport.title'))}</strong> · ${esc(t('passport.summary', { n: o.passport.earned, c: o.passport.countries }))}</span>
      <span class="pp-pocket-go" aria-hidden="true">›</span>
    </button>` : ''}
    <section class="world-section">
      <h3 class="world-h">${esc(t('world.trips'))}</h3>
      <div class="world-trips">${trips.map((tr) => tripChip(tr, o)).join('')}</div>
    </section>
    <section class="world-section">
      <h3 class="world-h">${esc(t('world.countries'))}</h3>
      <div class="world-countries">${countries.map((c) => `
        <button class="world-country${c.state === 'planned' ? ' planned' : ''}" data-country="${esc(c.iso)}">${esc(c.flag)} ${esc(c.name)}${c.state === 'planned' ? ` <span class="world-trip-phase">${esc(t('map.leg.planned'))}</span>` : ''}</button>`).join('')}
      </div>
    </section>
    ${unlocatedMarkup(o.unlocated)}`;
}

export function emptyMarkup(): string {
  return `<div class="world-empty">${esc(t('world.empty'))}</div>`;
}

export interface CountryInput {
  detail: CountryDetail;
  /** Journal / spend / saved places for this country; null until the stores have answered. */
  extras: CountryExtras | null;
  locale: string;
  /** Renders one stamp (the controller supplies the clickable passport sticker). */
  stampHtml: (s: StampSpec) => string;
}

export function countryMarkup({ detail: d, extras: x, locale, stampHtml }: CountryInput): string {
  const planned = d.state === 'planned';
  const trips = d.trips.map((tr) => `
    <div class="world-ctrip" style="--trip:${esc(tr.color || 'var(--accent)')}">
      <div class="world-ctrip-head">
        <span class="world-trip-dot" aria-hidden="true"></span>
        <span class="world-trip-name">${esc(tr.name)}</span>
      </div>
      <div class="world-trip-meta">${esc(fmtRange(tr.dateFrom, tr.dateTo, locale))} · ${esc(t(tr.nights === 1 ? 'map.leg.night' : 'map.leg.nights', { n: tr.nights }))}</div>
      <div class="world-trip-meta">${esc(tr.cities.join(' · '))}</div>
      <button class="btn btn-ghost world-ctrip-go" data-route-trip="${esc(tr.id)}">${esc(t('world.country.viewRoute'))}</button>
    </div>`).join('');
  return `
    <button class="btn btn-ghost world-back" data-act="back">${esc(t('world.country.back'))}</button>
    <div class="world-chead">
      <span class="world-chead-flag" aria-hidden="true">${esc(d.flag)}</span>
      <div>
        <h2 class="world-chead-name">${esc(d.name)}</h2>
        ${planned ? `<div class="world-trip-meta">${esc(t('world.country.planned'))}</div>` : ''}
      </div>
    </div>
    <div class="map-stats map-stats-all">
      ${card(String(d.visits), t('world.country.visits'))}
      ${card(String(d.nights), t('map.stat.nights'))}
      ${card(String(d.cities.length), t('map.stat.cities'))}
    </div>
    ${d.stamps.length ? `<section class="world-section">
      <h3 class="world-h">${esc(t('world.country.stamps'))}</h3>
      <div class="world-stamps">${d.stamps.map(stampHtml).join('')}</div>
    </section>` : ''}
    <section class="world-section">
      <h3 class="world-h">${esc(t('world.country.trips'))}</h3>
      <div class="world-ctrips">${trips}</div>
    </section>
    ${x ? extrasMarkup(d, x, locale) : ''}
    <div class="world-actions">
      <button class="btn btn-ghost" data-act="journal">${esc(t('world.country.journalOpen'))}</button>
      <button class="btn btn-ghost" data-act="guide">${esc(t('world.country.guide'))}</button>
    </div>`;
}

/** Journal, spend and saved places — each section only when there is something to show. */
function extrasMarkup(d: CountryDetail, x: CountryExtras, locale: string): string {
  const tripName = (id: string) => d.trips.find((tr) => tr.id === id)?.name ?? '';
  const journal = x.journalCount ? `
    <section class="world-section">
      <h3 class="world-h">${esc(t('world.country.journal'))} · ${esc(t(x.journalCount === 1 ? 'map.pin.entry' : 'map.pin.entries', { n: x.journalCount }))}</h3>
      ${x.covers.length ? `<div class="world-covers">${x.covers.map((u) => `<img class="world-cover" src="${safeUrl(u)}" alt="" loading="lazy">`).join('')}</div>` : ''}
    </section>` : '';
  const spend = x.spend.length ? `
    <section class="world-section">
      <h3 class="world-h">${esc(t('world.country.spend'))}</h3>
      <div class="world-spend">
        ${x.spend.map((l) => `<div class="world-spend-row"><span>${esc(tripName(l.tripId) || '—')}</span><strong>${esc(fmtSpend(l.total, l.currency || undefined, locale))}</strong></div>`).join('')}
        ${x.spendTotal && x.spend.length > 1 ? `<div class="world-spend-row world-spend-total"><span>${esc(t('world.country.spendTotal'))}</span><strong>${esc(fmtSpend(x.spendTotal.total, x.spendTotal.currency || undefined, locale))}</strong></div>` : ''}
      </div>
    </section>` : '';
  const saved = x.nomadCount || x.guideCount ? `
    <section class="world-section">
      <h3 class="world-h">${esc(t('world.country.saved'))}</h3>
      <div class="world-saved">
        ${x.nomadCount ? `<span>☕ ${esc(t('world.country.nomad', { n: x.nomadCount }))}</span>` : ''}
        ${x.guideCount ? `<span>📍 ${esc(t(x.guideCount === 1 ? 'map.pin.idea' : 'map.pin.ideas', { n: x.guideCount }))}</span>` : ''}
      </div>
    </section>` : '';
  return journal + spend + saved;
}

/** Hover / aria text for a country on the map. */
export function countryTip(name: string, flag: string, visits: number, planned: boolean): string {
  const label = `${flag} ${name}`.trim();
  if (planned) return t('world.tip.planned', { name: label });
  return t(visits === 1 ? 'world.tip.visit' : 'world.tip.visits', { name: label, n: visits });
}

/** Text of the hover card for a country: name, visits and nights. */
export function hoverCardText(rec: { name: string; flag: string; state: 'visited' | 'planned'; visits: number; nights: number }): string {
  const head = countryTip(rec.name, rec.flag, rec.visits, rec.state === 'planned');
  if (rec.state === 'planned') return head;
  return `${head} · ${t(rec.nights === 1 ? 'map.leg.night' : 'map.leg.nights', { n: rec.nights })}`;
}
