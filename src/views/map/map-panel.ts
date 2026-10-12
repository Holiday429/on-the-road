/* ==========================================================================
   On the Road · Map — side-panel & stage markup (pure)
   --------------------------------------------------------------------------
   The HTML strings for the map's right-hand panel and its stage, split out of
   map.ts so they can be unit-tested without amCharts or the DOM. Every function
   takes what it needs as arguments; nothing here reads module state.
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { fmtRange, nights } from './map-geo.ts';
import { fmtKm, type FlightChain, type PlottedLeg, type RouteSummary } from './map-stats.ts';
import { legVisitState } from './map-status.ts';
import type { UnlocatedStop } from './map-plot.ts';

export type MapScope = 'trip' | 'all';


export function scopeToggleMarkup(scope: MapScope): string {
  return `
    <div class="map-scope">
      <button class="map-scope-btn${scope === 'trip' ? ' active' : ''}" data-scope="trip">${esc(t('map.scope.trip'))}</button>
      <button class="map-scope-btn${scope === 'all' ? ' active' : ''}" data-scope="all">${esc(t('map.scope.all'))}</button>
    </div>`;
}

export function flightRowMarkup(chain: FlightChain | null, motionId: string, activeId: string | null): string {
  if (!chain) return '';
  return `
    <div class="leg-flight-row ${activeId === motionId ? 'active' : ''}" data-motion-id="${motionId}">
      <span class="leg-flight-icon">✈️</span>
      <span class="leg-flight-main">
        <span class="leg-flight-label">${esc(chain.label)}</span>
        <span class="leg-flight-sub">${esc(chain.sub)}</span>
      </span>
    </div>`;
}

/** Stops geocoding could not place — listed instead of silently dropped. */
export function unlocatedMarkup(stops: UnlocatedStop[]): string {
  if (stops.length === 0) return '';
  const items = stops.map((u) => `<li>${esc(u.place)}</li>`).join('');
  return `
    <div class="map-unlocated">
      <div class="map-unlocated-title">${esc(t('map.unlocated.title', { n: stops.length }))}</div>
      <ul class="map-unlocated-list">${items}</ul>
      <div class="map-unlocated-hint">${esc(t('map.unlocated.hint'))}</div>
    </div>`;
}

export function statsMarkup(s: RouteSummary, scope: MapScope, locale: string): string {
  // Trip scope keeps the familiar two-card summary. "All footprints" adds the
  // lifetime totals (distance / continents / nights) the user asked for.
  const card = (num: string, label: string) =>
    `<div class="map-stat"><div class="map-stat-num">${num}</div><div class="map-stat-label">${esc(label)}</div></div>`;
  if (scope !== 'all') {
    return `<div class="map-stats">
      ${card(String(s.cityCount), t('map.stat.cities'))}
      ${card(String(s.countryCount), t('map.stat.countries'))}
    </div>`;
  }
  return `<div class="map-stats map-stats-all">
    ${card(String(s.cityCount), t('map.stat.cities'))}
    ${card(String(s.countryCount), t('map.stat.countries'))}
    ${card(String(s.continentCount), t(s.continentCount === 1 ? 'map.stat.continent' : 'map.stat.continents'))}
    ${card(fmtKm(s.distanceKm, locale), t('map.stat.km'))}
    ${card(String(s.nightCount), t('map.stat.nights'))}
    ${card(String(s.legCount), t('map.stat.stops'))}
  </div>`;
}

/**
 * The stop list. In "all footprints" mode a trip-label separator is injected
 * whenever the trip changes (legs arrive sorted chronologically). Stops still
 * ahead of `today` carry a "Planned" tag.
 */
export function legListMarkup(
  legs: PlottedLeg[],
  o: { scope: MapScope; activeId: string | null; today: string; locale: string },
): string {
  let lastTripId: string | null | undefined = undefined;
  const items: string[] = [];
  legs.forEach((l, i) => {
    if (o.scope === 'all' && l.tripId !== lastTripId) {
      const label = l.tripName ?? l.tripId ?? t('map.leg.unknownTrip');
      items.push(`<div class="leg-trip-label">${esc(label)}</div>`);
      lastTripId = l.tripId;
    }
    const n = nights(l.dateFrom, l.dateTo);
    const planned = legVisitState(l, o.today) === 'planned';
    items.push(`
      <button class="leg-row ${o.activeId === l.id ? 'active' : ''}${planned ? ' planned' : ''}" data-id="${esc(l.id)}" data-motion-id="${esc(l.id)}">
        <span class="leg-row-num">${i + 1}</span>
        <span class="leg-row-main">
          <span class="leg-row-city">${esc(l.flag)} ${esc(l.city)}${planned ? ` <span class="leg-row-planned">${esc(t('map.leg.planned'))}</span>` : ''}</span>
          <span class="leg-row-meta">${esc(fmtRange(l.dateFrom, l.dateTo, o.locale))} · ${esc(t(n === 1 ? 'map.leg.night' : 'map.leg.nights', { n }))}</span>
        </span>
      </button>`);
  });
  return items.join('');
}

/** The stage's inner markup: chart host, overlay layers, toolbar, zoom, loader. */
export function stageInnerMarkup(): string {
  return `
    <div id="mapChart" class="map-chart"></div>
    <div class="map-region-labels" id="mapRegionLabels"></div>
    <div class="map-data-pins" id="mapDataPins"></div>
    <div class="map-data-pins" id="mapJournalPins"></div>
    <div class="map-data-pins" id="mapGuidePins"></div>
    <div class="map-data-pins" id="mapStayPins"></div>
    <div class="map-country-pins" id="mapCountryPins"></div>
    <div class="map-tooltip" id="mapTooltip">
      <span class="map-tooltip-name" id="mapTooltipName"></span>
      <span class="map-tooltip-meta" id="mapTooltipMeta"></span>
    </div>
    <div class="map-toolbar">
      <button class="map-tool-btn" id="mapReplay" title="${esc(t('map.replayTitle'))}">${esc(t('map.replay'))}</button>
      <button class="map-tool-btn" id="mapExport" title="${esc(t('map.exportTitle'))}">${esc(t('map.export'))}</button>
      <button class="map-tool-btn" id="mapBack" title="${esc(t('map.backTitle'))}" hidden>${esc(t('map.back'))}</button>
    </div>
    <div class="map-zoom-controls">
      <button class="map-zoom-btn" id="mapZoomIn"  title="${esc(t('map.zoomIn'))}">+</button>
      <button class="map-zoom-btn" id="mapZoomFit" title="${esc(t('map.zoomFit'))}">⊡</button>
      <button class="map-zoom-btn" id="mapZoomOut" title="${esc(t('map.zoomOut'))}">−</button>
    </div>
    <div class="map-loading" id="mapLoading">${esc(t('map.loading'))}</div>`;
}
