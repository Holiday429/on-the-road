/* ==========================================================================
   On the Road · World — side panel markup (pure)
   --------------------------------------------------------------------------
   The overview (totals, trips, countries, passport) and the country detail the
   panel switches to. Plain functions from data to an HTML string, so they can be
   tested without a browser; world.ts wires the clicks by `data-*` attributes.
   ========================================================================== */

import { t } from '../../../core/i18n.ts';
import { escHtml as esc } from '../../../core/utils.ts';
import type { StampSpec } from '../../../core/paper/stamp.ts';
import { fmtRange } from '../map-geo.ts';
import { fmtKm } from '../map-stats.ts';
import { unlocatedMarkup } from '../map-panel.ts';
import type { UnlocatedStop } from '../map-plot.ts';
import type { CountryDetail } from './country-model.ts';
import type { ColorMode, TripRecord, WorldModel } from './world-model.ts';

const card = (num: string, label: string) =>
  `<div class="map-stat"><div class="map-stat-num">${esc(num)}</div><div class="map-stat-label">${esc(label)}</div></div>`;

export type WorldLayer = 'routes' | 'cities';

export interface OverviewInput {
  model: WorldModel;
  mode: ColorMode;
  /** Which map layers are switched on. */
  layers: ReadonlySet<WorldLayer>;
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
  const s = o.model.summary;
  const trips = o.model.trips.filter((tr) => tr.legCount > 0);
  const hasCurrent = !!o.currentTripId && trips.some((tr) => tr.id === o.currentTripId);
  const countries = [...o.model.countries.values()].sort((a, b) => a.name.localeCompare(b.name));
  return `
    <div class="map-stats map-stats-all">
      ${card(String(s.countries), t('map.stat.countries'))}
      ${card(String(s.cities), t('map.stat.cities'))}
      ${card(String(s.nights), t('map.stat.nights'))}
      ${card(fmtKm(s.km, o.locale), t('map.stat.km'))}
      ${card(String(s.continents), t(s.continents === 1 ? 'map.stat.continent' : 'map.stat.continents'))}
      ${card(String(s.trips), t('world.stat.trips'))}
    </div>
    <div class="map-scope world-mode" role="group" aria-label="${esc(t('world.color.label'))}">
      <button class="map-scope-btn${o.mode === 'count' ? ' active' : ''}" data-color="count" aria-pressed="${o.mode === 'count'}">${esc(t('world.color.count'))}</button>
      <button class="map-scope-btn${o.mode === 'trip' ? ' active' : ''}" data-color="trip" aria-pressed="${o.mode === 'trip'}">${esc(t('world.color.trip'))}</button>
    </div>
    <div class="world-layers" role="group" aria-label="${esc(t('world.layers'))}">
      ${(['routes', 'cities'] as const).map((id) => `<button class="map-layer-chip${o.layers.has(id) ? ' active' : ''}" data-layer="${id}" role="switch" aria-checked="${o.layers.has(id)}">${esc(t(id === 'routes' ? 'world.layer.routes' : 'world.layer.cities'))}</button>`).join('')}
    </div>
    ${hasCurrent ? `<button class="btn btn-primary world-open-route" data-act="open-route">${esc(t('world.openRoute'))}</button>` : ''}
    ${o.passport ? `<button type="button" class="pp-strip" data-open-passport="">
      <span class="pp-strip-emblem" aria-hidden="true">🛂</span>
      <span class="pp-strip-text"><strong>${esc(t('passport.title'))}</strong> · ${esc(t('passport.summary', { n: o.passport.earned, c: o.passport.countries }))}</span>
      <span class="pp-strip-go" aria-hidden="true">›</span>
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
  locale: string;
  /** Renders one stamp (the controller supplies the clickable passport sticker). */
  stampHtml: (s: StampSpec) => string;
}

export function countryMarkup({ detail: d, locale, stampHtml }: CountryInput): string {
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
    <button class="btn btn-ghost" data-act="guide">${esc(t('world.country.guide'))}</button>`;
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
