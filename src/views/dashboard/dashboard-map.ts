/* ==========================================================================
   Dashboard map thumbnail — non-interactive amCharts Europe map.
   Every country on the trip is tinted with its own palette colour; the trip's
   stage is carried by the numbered pins: current=green, past=grey, upcoming=amber.
   Reuses loadAmCharts / mapColors / countryColor from the map module, and
   recolours in place when the theme changes.
   ========================================================================== */

import { loadAmCharts } from '../map/amcharts-loader.ts';
import { createMapRoot, disposeRoot, waitForSize, motionMs } from '../map/amcharts-boot.ts';
import { mapColors, countryColor, onMapRepaint } from '../map/map-theme.ts';
import { legStatus, PIN_COLORS } from '../map/map-status.ts';
import { coordsFor } from '../map/geo.ts';
import { isoForCountry, pickAnchor, EUROPE_CENTER } from '../../data/geo-index.ts';
import { todayIso } from '../../data/trip-phase.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';

const EUROPE_ZOOM   = 4.2;

function legStatusColor(leg: StoredLeg): string {
  return PIN_COLORS[legStatus(leg, todayIso())];
}

let _root: any = null;
let _offRepaint: (() => void) | null = null;
let _pinHit = false;   // set by a pin's click so the container click doesn't also open the map

export async function initDashboardMap(
  container: HTMLElement,
  legs: StoredLeg[],
  onPinClick?: (legId: string) => void,
  /** The map itself (not a pin) was clicked — open the full Map page. */
  onOpen?: () => void,
): Promise<void> {
  // Dispose any previous instance (reinit on trip change).
  disposeDashboardMap();

  await loadAmCharts();
  await waitForSize(container);

  const am5    = (window as any).am5;
  const am5map = (window as any).am5map;
  const geodata = (window as any).am5geodata_worldLow;

  // No animation theme — lighter, faster for a thumbnail.
  const root = createMapRoot(container, { animated: false });
  _root = root;

  // A click that is neither on a pin nor the end of a drag opens the Map page.
  if (onOpen) {
    let down: { x: number; y: number } | null = null;
    container.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; _pinHit = false; });
    container.addEventListener('click', (e) => {
      const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 0;
      // The pin's own click handler runs in the canvas layer; give it a tick to flag itself.
      window.setTimeout(() => { if (!_pinHit && moved < 6) onOpen(); }, 0);
    });
    container.style.cursor = 'pointer';
  }

  const chart = root.container.children.push(am5map.MapChart.new(root, {
    projection:    am5map.geoMercator(),
    panX: 'translateX', panY: 'translateY',
    wheelX: 'none', wheelY: 'none',
    homeGeoPoint:  EUROPE_CENTER,
    homeZoomLevel: EUROPE_ZOOM,
    minZoomLevel:  1,
    maxZoomLevel:  16,
    // Each +/- click steps by 1.3× rather than amCharts' default 2×.
    zoomStep:      1.3,
  }));

  // Base world polygons — very subtle.
  const world = chart.series.push(am5map.MapPolygonSeries.new(root, {
    geoJSON: geodata,
    exclude: ['AQ'],
  }));
  world.mapPolygons.template.setAll({
    interactive:      false,
    fill:             am5.color(mapColors().land),
    fillOpacity:      0.9,
    stroke:           am5.color(mapColors().landStroke),
    strokeWidth:      1,
    strokeOpacity:    1,
    nonScalingStroke: true,
  });

  // Light every country on the trip with its own colour.
  const tripCountryISOs = new Set<string>();
  for (const leg of legs) {
    const iso = isoForCountry(leg.country, leg.flag);
    if (iso) tripCountryISOs.add(iso);
  }
  const tintTripCountries = () => {
    world.mapPolygons.each((poly: any) => {
      const id: string | undefined = poly.dataItem?.get('id');
      if (id && tripCountryISOs.has(id)) {
        poly.setAll({ fill: am5.color(countryColor(id)), fillOpacity: 0.85 });
      }
    });
  };
  world.events.on('datavalidated', tintTripCountries);

  // City pins — one per leg with number label, sorted chronologically.
  const pinSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));

  const sortedLegs = [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));

  const pinData = sortedLegs
    .map((leg, idx) => {
      // Saved coordinates first (cheapest, and right for cities outside the
      // bundled table); the bundled table only vetoes a clearly stale point.
      const coords = pickAnchor(leg, coordsFor(leg.city));
      if (!coords) return null;
      return {
        longitude: coords.lng,
        latitude:  coords.lat,
        city:      leg.city,
        legId:     leg.id,
        num:       String(idx + 1),
        fill:      am5.color(legStatusColor(leg)),
      };
    })
    .filter(Boolean);

  pinSeries.bullets.push(function (root2: any, _s: any, dataItem: any) {
    const ctx   = (dataItem.dataContext as any) ?? {};
    const color = ctx.fill ?? am5.color('#e3b866');
    const num   = ctx.num ?? '';

    const container = am5.Container.new(root2, {
      interactive: !!onPinClick,
      cursorOverStyle: onPinClick ? 'pointer' : 'default',
    });
    if (onPinClick) container.events.on('click', () => { _pinHit = true; onPinClick(ctx.legId); });

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

  chart.appear(motionMs(600));

  // Theme switch: recolour in place (land + tinted countries); pins are
  // status-coloured and theme-independent.
  _offRepaint = onMapRepaint(() => {
    const c = mapColors();
    world.mapPolygons.template.setAll({ fill: am5.color(c.land), stroke: am5.color(c.landStroke) });
    world.mapPolygons.each((poly: any) => {
      const id: string | undefined = poly.dataItem?.get('id');
      if (id && tripCountryISOs.has(id)) poly.setAll({ fill: am5.color(countryColor(id)) });
    });
  });
}

export function disposeDashboardMap(): void {
  _offRepaint?.(); _offRepaint = null;
  disposeRoot(_root); _root = null;
}

export function dashboardMapZoom(action: 'in' | 'out' | 'fit'): void {
  if (!_root) return;
  const chart = _root.container.children.getIndex(0);
  if (!chart) return;
  if (action === 'in')  { if (chart.zoomIn) chart.zoomIn(); else chart.set('zoomLevel', (chart.get('zoomLevel') ?? 1) * 1.5); }
  if (action === 'out') { if (chart.zoomOut) chart.zoomOut(); else chart.set('zoomLevel', (chart.get('zoomLevel') ?? 1) / 1.5); }
  if (action === 'fit') { chart.goHome(); }
}
