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
import type { FlightChain, PlottedLeg, RouteSummary } from './map-stats.ts';
import { legVisitState } from './map-status.ts';
import type { UnlocatedStop } from './map-plot.ts';

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

export function statsMarkup(s: RouteSummary): string {
  const card = (num: string, label: string) =>
    `<div class="map-stat"><div class="map-stat-num">${num}</div><div class="map-stat-label">${esc(label)}</div></div>`;
  return `<div class="map-stats">
    ${card(String(s.cityCount), t('map.stat.cities'))}
    ${card(String(s.countryCount), t('map.stat.countries'))}
  </div>`;
}

/**
 * The stop list. Stops still ahead of `today` carry a "Planned" tag.
 */
export function legListMarkup(
  legs: PlottedLeg[],
  o: { activeId: string | null; today: string; locale: string },
): string {
  const items: string[] = [];
  legs.forEach((l, i) => {
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
