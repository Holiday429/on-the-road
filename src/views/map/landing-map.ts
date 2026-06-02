/* Landing page map — Europe fill animation with walking hero */

import { loadAmCharts } from './amcharts-loader.ts';
import { bindHeroOverlay, ensureHeroOverlay } from './hero-overlay.ts';
import { MAP_COLORS, EUROPE_ROUTE, countryColor } from './map-shared.ts';
import { DEFAULT_ROUTE_LEGS } from '../../data/default-route.ts';
import { cityLocationsFor } from './geo.ts';

const ART = `${import.meta.env.BASE_URL}art/`.replace(/\/{2,}/g, '/');

const LANDING_STOPS = DEFAULT_ROUTE_LEGS
  .map((leg) => {
    const stop = cityLocationsFor(leg.city)[0];
    if (!stop) return null;
    const countryIsoMap: Record<string, string> = {
      Denmark: 'DK',
      Germany: 'DE',
      Netherlands: 'NL',
      Belgium: 'BE',
      France: 'FR',
      Spain: 'ES',
      Portugal: 'PT',
      Switzerland: 'CH',
      Italy: 'IT',
    };
    const code = countryIsoMap[leg.country];
    if (!code) return null;
    return { iso: code, lat: stop.lat, lng: stop.lng };
  })
  .filter(Boolean) as Array<{ iso: string; lat: number; lng: number }>;

const LANDING_FILL_STOPS = LANDING_STOPS.filter(
  (stop, index, all) => all.findIndex((candidate) => candidate.iso === stop.iso) === index,
);

/* Center on western Europe (the route region), zoomed in tight */
const EUROPE_CENTER = { latitude: 47, longitude: 6 };
const EUROPE_ZOOM   = 6.6;

function waitForSize(el: HTMLElement): Promise<void> {
  if (el.clientWidth > 0 && el.clientHeight > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) { ro.disconnect(); resolve(); }
    });
    ro.observe(el);
  });
}

export async function initLandingMap(container: HTMLElement) {
  await loadAmCharts();
  await waitForSize(container);

  const am5    = (window as any).am5;
  const am5map = (window as any).am5map;
  const am5th  = (window as any).am5themes_Animated;
  const geodata = (window as any).am5geodata_worldLow;

  const root = am5.Root.new(container);
  root.setThemes([am5th.new(root)]);
  if (root._logo) root._logo.dispose();

  const chart = root.container.children.push(am5map.MapChart.new(root, {
    projection:    am5map.geoMercator(),
    panX: 'none',  panY: 'none',
    wheelX: 'none', wheelY: 'none',
    homeGeoPoint:  EUROPE_CENTER,
    homeZoomLevel: EUROPE_ZOOM,
  }));

  const world = chart.series.push(am5map.MapPolygonSeries.new(root, {
    geoJSON: geodata,
    exclude: ['AQ'],
  }));
  world.mapPolygons.template.setAll({
    interactive: false,
    fill:        am5.color(MAP_COLORS.land),
    fillOpacity: 0,
    stroke:      am5.color(MAP_COLORS.landStroke),
    strokeWidth: 0.8,
    strokeOpacity: 0.18,
    nonScalingStroke: true,
  });

  const stageCanvas = container.parentElement!;
  const heroData = chart.series.push(am5map.MapPointSeries.new(root, {}));
  const heroItem = heroData.pushDataItem({
    longitude: LANDING_STOPS[0].lng,
    latitude: LANDING_STOPS[0].lat,
  });
  const heroImg = ensureHeroOverlay(stageCanvas, 'landing-hero-img', `${ART}logo.gif`);
  const syncHero = bindHeroOverlay(root, {
    chart,
    item: heroItem,
    image: heroImg,
    host: stageCanvas,
    chartContainer: container,
  });

  let dataReady = false;
  let chartReady = false;
  let animationBooted = false;
  const routePolys = new Map<string, any>();

  const bootAnimation = () => {
    if (animationBooted || !dataReady || !chartReady || routePolys.size === 0) return;
    animationBooted = true;

    // Show hero at full size; map is not yet visible (CSS delays stage-map to t=4s)
    heroImg.classList.add('is-stage-hero');
    heroImg.classList.remove('is-map-bound', 'facing-right');

    const boundsSeed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    routePolys.forEach((poly) => {
      try {
        const bounds = am5map.getGeoBounds(poly.dataItem?.get('geometry'));
        if (bounds && Number.isFinite(bounds.left)) boundsSeed.push(bounds);
      } catch {}
    });

    if (boundsSeed.length) {
      const b = {
        left:   Math.min(...boundsSeed.map((x) => x.left)),
        right:  Math.max(...boundsSeed.map((x) => x.right)),
        top:    Math.max(...boundsSeed.map((x) => x.top)),
        bottom: Math.min(...boundsSeed.map((x) => x.bottom)),
      };
      const padLng = Math.max(0.08, (b.right - b.left) * 0.0015);
      const padLat = Math.max(0.08, (b.top - b.bottom) * 0.0035);
      chart.zoomToGeoBounds({
        left: b.left - padLng, right: b.right + padLng,
        top:  b.top  + padLat, bottom: b.bottom - padLat,
      }, 900);
    } else {
      chart.goHome(900);
    }

    const homeStop   = LANDING_FILL_STOPS[0];
    const routeStops = LANDING_FILL_STOPS.slice(1);

    const moveHeroTo = (stop: { lat: number; lng: number }, duration: number) => {
      heroItem.animate({ key: 'longitude', to: stop.lng, duration, easing: am5.ease.inOut(am5.ease.cubic) });
      heroItem.animate({ key: 'latitude',  to: stop.lat, duration, easing: am5.ease.inOut(am5.ease.cubic) });
    };

    const lightCountry = (iso: string, duration = 520) => {
      const poly = routePolys.get(iso);
      if (!poly) return;
      poly.set('fill', am5.color(countryColor(iso)));
      poly.animate({ key: 'fillOpacity', from: poly.get('fillOpacity') ?? 0.05, to: 1, duration, easing: am5.ease.out(am5.ease.cubic) });
    };

    // bootAnimation fires at t=4s — CSS has already shown the hero at full size (2.5s–4s)
    // Immediately shrink to 58px while simultaneously moving to Copenhagen.
    // Route walk starts only after the hero has arrived at Copenhagen.
    const SHRINK_MS     = 1100;
    const MOVE_DURATION = 760;
    const STEP_DELAY    = 820;

    window.requestAnimationFrame(() => {
      // Snapshot rendered px size so width/height transition has a concrete px start value
      const { width, height } = heroImg.getBoundingClientRect();
      heroImg.style.width  = `${width}px`;
      heroImg.style.height = `${height}px`;

      window.requestAnimationFrame(() => {
        heroImg.style.transition = [
          `width  ${SHRINK_MS}ms cubic-bezier(0.4,0,0.2,1)`,
          `height ${SHRINK_MS}ms cubic-bezier(0.4,0,0.2,1)`,
        ].join(', ');
        heroImg.style.width  = '58px';
        heroImg.style.height = '58px';
        heroImg.classList.add('is-map-bound');
        heroImg.classList.remove('is-stage-hero', 'facing-right');
        syncHero();
        moveHeroTo(homeStop, SHRINK_MS);
      });
    });

    setTimeout(() => {
      // Shrink + move to Copenhagen done — clear inline overrides, start route walk
      heroImg.style.transition = '';
      heroImg.style.width      = '';
      heroImg.style.height     = '';

      lightCountry(homeStop.iso, 560);

      const allStops = [...routeStops, homeStop];
      let stepIndex = 0;
      const moveNext = () => {
        const stop = allStops[stepIndex];
        if (!stop) return;
        moveHeroTo(stop, MOVE_DURATION);
        if (stop.iso !== homeStop.iso || stepIndex === 0) {
          window.setTimeout(() => lightCountry(stop.iso, 460), MOVE_DURATION * 0.72);
        }
        stepIndex += 1;
        if (stepIndex < allStops.length) window.setTimeout(moveNext, STEP_DELAY);
      };
      window.setTimeout(moveNext, 260);
    }, SHRINK_MS + 80);
  };

  world.events.on('datavalidated', () => {
    routePolys.clear();
    world.mapPolygons.each((poly: any) => {
      const id = poly.dataItem?.get('id');
      const isRouteCountry = Boolean(id && EUROPE_ROUTE.includes(id));
      poly.setAll({
        fill:         am5.color(MAP_COLORS.land),
        fillOpacity:  isRouteCountry ? 0.05 : 0,
        stroke:       am5.color(MAP_COLORS.landStroke),
        strokeWidth:  isRouteCountry ? 1.2 : 0.7,
        strokeOpacity: isRouteCountry ? 0.9 : 0.12,
      });
      if (isRouteCountry && id) routePolys.set(id, poly);
    });
    dataReady = true;
    bootAnimation();
  });

  chart.appear(600, 120).then(() => {
    chartReady = true;
    bootAnimation();
  });
}
