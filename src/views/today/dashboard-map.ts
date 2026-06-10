/* ==========================================================================
   Dashboard map thumbnail — non-interactive amCharts Europe map.
   Shows trip legs as coloured pins: current=green, past=grey, future=amber.
   Reuses loadAmCharts / MAP_COLORS / countryColor from the map module.
   ========================================================================== */

import { loadAmCharts } from '../map/amcharts-loader.ts';
import { MAP_COLORS, countryColor } from '../map/map-shared.ts';
import { coordsFor } from '../map/geo.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';

const EUROPE_CENTER = { latitude: 54, longitude: 15 };
const EUROPE_ZOOM   = 4.2;

function legStatusColor(leg: StoredLeg): string {
  const today = new Date().toISOString().slice(0, 10);
  if (leg.dateTo < today)   return '#a8a29e'; // past  → ink-faint grey
  if (leg.dateFrom > today) return '#f9b830'; // future → amber
  return '#22c55e';                            // current → sage green
}

let _root: any = null;

export async function initDashboardMap(
  container: HTMLElement,
  legs: StoredLeg[],
): Promise<void> {
  // Dispose any previous instance (reinit on trip change).
  if (_root) { try { _root.dispose(); } catch { /* ignore */ } _root = null; }

  await loadAmCharts();
  // Wait until the container has real dimensions.
  if (container.clientWidth === 0) {
    await new Promise<void>((resolve) => {
      const ro = new ResizeObserver(() => {
        if (container.clientWidth > 0) { ro.disconnect(); resolve(); }
      });
      ro.observe(container);
    });
  }

  const am5    = (window as any).am5;
  const am5map = (window as any).am5map;
  const geodata = (window as any).am5geodata_worldLow;

  const root = am5.Root.new(container);
  // No animation theme — lighter, faster for a thumbnail.
  if (root._logo) root._logo.dispose();
  _root = root;

  const chart = root.container.children.push(am5map.MapChart.new(root, {
    projection:    am5map.geoMercator(),
    panX: 'translateX', panY: 'translateY',
    wheelX: 'none', wheelY: 'none',
    homeGeoPoint:  EUROPE_CENTER,
    homeZoomLevel: EUROPE_ZOOM,
    minZoomLevel:  1,
    maxZoomLevel:  16,
  }));

  // Base world polygons — very subtle.
  const world = chart.series.push(am5map.MapPolygonSeries.new(root, {
    geoJSON: geodata,
    exclude: ['AQ'],
  }));
  world.mapPolygons.template.setAll({
    interactive:      false,
    fill:             am5.color(MAP_COLORS.land),
    fillOpacity:      0.9,
    stroke:           am5.color(MAP_COLORS.landStroke),
    strokeWidth:      1,
    strokeOpacity:    1,
    nonScalingStroke: true,
  });

  // Light the trip countries.
  const tripCountryISOs = new Set<string>();
  world.events.on('datavalidated', () => {
    world.mapPolygons.each((poly: any) => {
      const id: string | undefined = poly.dataItem?.get('id');
      if (id && tripCountryISOs.has(id)) {
        poly.setAll({ fill: am5.color(countryColor(id)), fillOpacity: 0.85 });
      }
    });
  });

  // Build the country ISO set from leg countries using a simple mapping.
  const COUNTRY_ISO: Record<string, string> = {
    Denmark: 'DK', Germany: 'DE', Netherlands: 'NL', Belgium: 'BE',
    France: 'FR', Spain: 'ES', Portugal: 'PT', Switzerland: 'CH',
    Italy: 'IT', Sweden: 'SE', Norway: 'NO', Czech: 'CZ', Austria: 'AT',
    Greece: 'GR', Hungary: 'HU', Poland: 'PL', Croatia: 'HR',
  };
  for (const leg of legs) {
    const iso = Object.entries(COUNTRY_ISO).find(([k]) => leg.country.includes(k))?.[1];
    if (iso) tripCountryISOs.add(iso);
  }

  // City pins — one per leg with number label, sorted chronologically.
  const pinSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));

  const sortedLegs = [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));

  const pinData = sortedLegs
    .map((leg, idx) => {
      const coords = coordsFor(leg.city);
      if (!coords) return null;
      return {
        longitude: coords.lng,
        latitude:  coords.lat,
        city:      leg.city,
        num:       String(idx + 1),
        fill:      am5.color(legStatusColor(leg)),
      };
    })
    .filter(Boolean);

  pinSeries.bullets.push(function (root2: any, _s: any, dataItem: any) {
    const ctx   = (dataItem.dataContext as any) ?? {};
    const color = ctx.fill ?? am5.color('#f9b830');
    const num   = ctx.num ?? '';

    const container = am5.Container.new(root2, { interactive: false });

    container.children.push(am5.Circle.new(root2, {
      radius:      11,
      fill:        color,
      stroke:      am5.color('#ffffff'),
      strokeWidth: 2,
      tooltipText: `${num}. {city}`,
    }));

    container.children.push(am5.Label.new(root2, {
      text:              num,
      fontSize:          9,
      fontWeight:        '700',
      fill:              am5.color('#ffffff'),
      centerX:           am5.percent(50),
      centerY:           am5.percent(50),
      x:                 0,
      y:                 0,
      interactive:       false,
      oversizedBehavior: 'hide',
    }));

    return am5.Bullet.new(root2, { sprite: container });
  });

  pinSeries.data.setAll(pinData);

  // Auto-fit: zoom to bounding box of all pins once the chart has dimensions.
  chart.events.once('boundschanged', () => {
    requestAnimationFrame(() => {
      if (pinData.length >= 2) {
        const lats = pinData.map((d: any) => d.latitude);
        const lngs = pinData.map((d: any) => d.longitude);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        try {
          chart.zoomToGeoBounds({
            left: minLng - 5, right: maxLng + 5,
            top: maxLat + 4, bottom: minLat - 4,
          });
        } catch { chart.goHome(); }
      } else {
        chart.goHome();
      }
    });
  });

  chart.appear(600);
}

export function disposeDashboardMap(): void {
  if (_root) { try { _root.dispose(); } catch { /* ignore */ } _root = null; }
}

export function dashboardMapZoom(action: 'in' | 'out' | 'fit'): void {
  if (!_root) return;
  const chart = _root.container.children.getIndex(0);
  if (!chart) return;
  if (action === 'in')  { if (chart.zoomIn) chart.zoomIn(); else chart.set('zoomLevel', (chart.get('zoomLevel') ?? 1) * 1.5); }
  if (action === 'out') { if (chart.zoomOut) chart.zoomOut(); else chart.set('zoomLevel', (chart.get('zoomLevel') ?? 1) / 1.5); }
  if (action === 'fit') { chart.goHome(); }
}
