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
    panX: 'none', panY: 'none',
    wheelX: 'none', wheelY: 'none',
    homeGeoPoint:  EUROPE_CENTER,
    homeZoomLevel: EUROPE_ZOOM,
    minZoomLevel:  EUROPE_ZOOM,
    maxZoomLevel:  EUROPE_ZOOM,
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

  // City pins — one per leg.
  const pinSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
  pinSeries.bullets.push(() =>
    am5.Bullet.new(root, {
      sprite: am5.Circle.new(root, {
        radius:       6,
        strokeWidth:  2,
        stroke:       am5.color('#ffffff'),
        interactive:  false,
        tooltipText:  '{city}',
      }),
    })
  );

  const pinData = legs
    .map((leg) => {
      const coords = coordsFor(leg.city);
      if (!coords) return null;
      return {
        longitude: coords.lng,
        latitude:  coords.lat,
        city:      leg.city,
        fill:      am5.color(legStatusColor(leg)),
      };
    })
    .filter(Boolean);

  // Wire up fill from data.
  pinSeries.bullets.push(function (root: any, _series: any, dataItem: any) {
    const color = dataItem.dataContext?.fill ?? am5.color('#f9b830');
    return am5.Bullet.new(root, {
      sprite: am5.Circle.new(root, {
        radius:      6,
        fill:        color,
        stroke:      am5.color('#ffffff'),
        strokeWidth: 2,
        interactive: false,
      }),
    });
  });
  // Clear the default bullet so only the data-driven one shows.
  pinSeries.bullets.clear();
  pinSeries.bullets.push(function (root2: any, _s: any, dataItem: any) {
    const color = (dataItem.dataContext as any)?.fill ?? am5.color('#f9b830');
    return am5.Bullet.new(root2, {
      sprite: am5.Circle.new(root2, {
        radius:      7,
        fill:        color,
        stroke:      am5.color('#ffffff'),
        strokeWidth: 2,
        interactive: false,
      }),
    });
  });

  pinSeries.data.setAll(pinData);
  chart.appear(400);
}

export function disposeDashboardMap(): void {
  if (_root) { try { _root.dispose(); } catch { /* ignore */ } _root = null; }
}
