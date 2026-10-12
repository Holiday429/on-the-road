/* ==========================================================================
   On the Road · World — controller
   --------------------------------------------------------------------------
   Mounts the World view into the map page: subscribes to every trip's stops,
   plots them, builds the model and keeps three things in step — the oval map
   (world-view.ts), the side panel (world-panel.ts) and the selection (a country,
   a trip filter, the colour mode). Clicks are wired once, by `data-*` attribute.
   ========================================================================== */

import { t, getLocale } from '../../../core/i18n.ts';
import { escHtml as esc } from '../../../core/utils.ts';
import { loadAmCharts } from '../amcharts-loader.ts';
import { waitForSize } from '../amcharts-boot.ts';
import { plotStoredLegs, type StoredLegInput, type UnlocatedStop } from '../map-plot.ts';
import type { PlottedLeg } from '../map-stats.ts';
import { routeStore } from '../../../data/stores/route-store.ts';
import { listTrips, onTripChange, currentTripId } from '../../../data/trip-context.ts';
import { todayIso } from '../../../data/trip-phase.ts';
import { stampsFor, passportSummary, type StampLeg } from '../../../data/stamps.ts';
import { stampSticker, wirePassportOpeners } from '../../passport/passport.ts';
import { buildCountryDetail } from './country-model.ts';
import { buildWorldModel, type ColorMode, type WorldModel, type WorldTripInput } from './world-model.ts';
import { createWorldView, type WorldView } from './world-view.ts';
import { overviewMarkup, countryMarkup, emptyMarkup, hoverCardText, type WorldLayer } from './world-panel.ts';
import { buildTripLines, buildCityPoints, currentSpot } from './world-geo.ts';
import './world.css';

export interface WorldHooks {
  /** Open the Route view — for this trip (switching to it first), or the current one. */
  openRoute(tripId: string | null): void;
}

export interface WorldController {
  /** Re-apply translated text after a language switch. */
  refreshText(): void;
}

function stageMarkup(): string {
  return `
    <div class="world-layout">
      <div class="world-main">
        <div class="world-stage">
          <div id="worldChart" class="world-chart"></div>
          <div class="world-hover" id="worldHover" hidden></div>
          <div class="map-zoom-controls">
            <button class="map-zoom-btn" id="worldZoomIn"  title="${esc(t('map.zoomIn'))}">+</button>
            <button class="map-zoom-btn" id="worldZoomFit" title="${esc(t('map.zoomFit'))}">⊡</button>
            <button class="map-zoom-btn" id="worldZoomOut" title="${esc(t('map.zoomOut'))}">−</button>
          </div>
          <div class="map-loading" id="worldLoading">${esc(t('map.loading'))}</div>
        </div>
      </div>
      <aside class="world-panel" id="worldPanel"></aside>
    </div>`;
}

export function mountWorld(host: HTMLElement, hooks: WorldHooks): WorldController {
  // eslint-disable-next-line no-restricted-syntax -- audited: static markup; every interpolation is escaped via esc()
  host.innerHTML = stageMarkup();
  const panel = host.querySelector<HTMLElement>('#worldPanel')!;

  let rows: StoredLegInput[] = [];
  let legs: PlottedLeg[] = [];
  let unlocated: UnlocatedStop[] = [];
  let trips: WorldTripInput[] = [];
  let model: WorldModel = buildWorldModel([], [], todayIso());
  let mode: ColorMode = 'count';
  let onlyTripId: string | null = null;
  const layers = new Set<WorldLayer>(['routes', 'cities']);
  let selectedIso: string | null = null;
  let view: WorldView | null = null;
  let plotToken = 0;

  /* ── Render ──────────────────────────────────────────────────────────── */
  function renderPanel() {
    const today = todayIso();
    let html: string;
    if (legs.length === 0 && unlocated.length === 0) {
      html = emptyMarkup();
    } else if (selectedIso) {
      const detail = buildCountryDetail(selectedIso, legs, model, today);
      html = detail
        ? countryMarkup({ detail, locale: getLocale(), stampHtml: (s) => stampSticker(s, 76) })
        : overviewHtml(today);
    } else {
      html = overviewHtml(today);
    }
    // eslint-disable-next-line no-restricted-syntax -- audited: panel markup escapes every interpolation (world-panel.ts)
    panel.innerHTML = html;
    wirePassportOpeners(panel);
  }

  function overviewHtml(today: string): string {
    const stamps = stampsFor(legs as unknown as StampLeg[], today);
    const sum = passportSummary(stamps);
    return overviewMarkup({
      model, mode, layers, onlyTripId, currentTripId: currentTripId(), unlocated, locale: getLocale(),
      passport: stamps.length ? { earned: sum.earned, countries: sum.countries } : null,
    });
  }

  function paintMap() {
    if (!view) return;
    const tripColors = new Map(model.trips.filter((tr) => tr.color).map((tr) => [tr.id, tr.color]));
    const today = todayIso();
    view.paint({
      model, mode, tripColors,
      lines: layers.has('routes') ? buildTripLines(legs, today, onlyTripId, tripColors) : [],
      points: layers.has('cities') ? buildCityPoints(legs, today, onlyTripId) : [],
      current: currentSpot(legs, model.trips, today, onlyTripId),
    });
  }

  function rebuild() {
    model = buildWorldModel(legs, trips, todayIso(), onlyTripId);
    paintMap();
    renderPanel();
  }

  /* ── Data ────────────────────────────────────────────────────────────── */
  async function replot() {
    const token = ++plotToken;
    const names = new Map(trips.map((tr) => [tr.id, tr.name]));
    const sorted = rows.slice().sort((a, b) => (a.dateFrom ?? '').localeCompare(b.dateFrom ?? ''));
    const r = await plotStoredLegs(sorted, names);
    if (token !== plotToken) return;       // newer data arrived while geocoding
    legs = r.legs;
    unlocated = r.unlocated;
    rebuild();
  }

  async function loadTrips() {
    try {
      trips = (await listTrips()).map((tr) => ({
        id: tr.id, name: tr.name, color: tr.coverColor, startDate: tr.startDate, endDate: tr.endDate,
      }));
    } catch { trips = []; }
    void replot();
  }

  /* ── Selection ───────────────────────────────────────────────────────── */
  async function selectCountry(iso: string) {
    if (!view || !model.countries.has(iso)) return;
    selectedIso = iso;
    renderPanel();
    const ok = await view.enterCountry(iso);
    if (!ok && view.state.iso === null) { selectedIso = null; renderPanel(); }
  }

  async function backToWorld() {
    selectedIso = null;
    renderPanel();
    await view?.leaveCountry();
  }

  panel.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-color],[data-trip],[data-country],[data-route-trip],[data-layer]');
    if (!el || !panel.contains(el)) return;
    const { act, color, trip, country, routeTrip, layer } = el.dataset;
    if (layer) {
      const id = layer as WorldLayer;
      if (layers.has(id)) layers.delete(id); else layers.add(id);
      paintMap(); renderPanel();
      return;
    }
    if (country) { void selectCountry(country); return; }
    if (routeTrip) { hooks.openRoute(routeTrip); return; }
    if (color) { mode = color as ColorMode; paintMap(); renderPanel(); return; }
    if (trip) {
      onlyTripId = onlyTripId === trip ? null : trip;
      if (selectedIso) void backToWorld();
      rebuild();
      return;
    }
    if (act === 'back') void backToWorld();
    else if (act === 'open-route') hooks.openRoute(currentTripId());
    else if (act === 'guide') void import('../../../core/app.ts').then(({ navigateTo }) => navigateTo('cities'));
  });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selectedIso) void backToWorld(); });

  const on = (id: string, fn: () => void) => host.querySelector(`#${id}`)?.addEventListener('click', fn);
  on('worldZoomIn', () => view?.zoom('in'));
  on('worldZoomOut', () => view?.zoom('out'));
  on('worldZoomFit', () => view?.zoom('fit'));

  /* ── Boot ────────────────────────────────────────────────────────────── */
  async function bootChart() {
    const chartEl = host.querySelector<HTMLElement>('#worldChart')!;
    try {
      await loadAmCharts();
      await waitForSize(chartEl);
    } catch (err) {
      console.error('amCharts load failed', err);
      const el = host.querySelector<HTMLElement>('#worldLoading');
      if (el) {
        // eslint-disable-next-line no-restricted-syntax -- audited: static markup, text escaped via esc()
        el.innerHTML = `<div class="map-load-failed"><span>${esc(t('map.loadFailed'))}</span><button class="btn btn-ghost" type="button">${esc(t('map.retry'))}</button></div>`;
        el.querySelector('button')?.addEventListener('click', () => { el.textContent = t('map.loading'); void bootChart(); });
      }
      return;
    }
    const hoverEl = host.querySelector<HTMLElement>('#worldHover')!;
    // Hover cards are for a mouse; on touch a tap selects instead.
    const canHover = window.matchMedia?.('(hover: hover)').matches ?? true;
    view = createWorldView(chartEl, {
      onCountryClick: (iso) => void selectCountry(iso),
      mascotSrc: `${import.meta.env.BASE_URL}art/logo-sm.webp`.replace(/\/{2,}/g, '/'),
      onHover: (iso, x, y) => {
        const rec = iso ? model.countries.get(iso) : undefined;
        if (!canHover || !rec) { hoverEl.hidden = true; return; }
        hoverEl.textContent = hoverCardText(rec);
        hoverEl.style.left = `${x + 14}px`;
        hoverEl.style.top = `${y + 14}px`;
        hoverEl.hidden = false;
      },
    });
    host.querySelector('#worldLoading')?.remove();
    paintMap();
  }

  void bootChart();
  routeStore.subscribeAll((r) => { rows = r as unknown as StoredLegInput[]; void replot(); });
  onTripChange(() => { void loadTrips(); });
  void loadTrips();
  renderPanel();

  return {
    refreshText() {
      const set = (id: string, title: string) => { const el = host.querySelector<HTMLElement>(`#${id}`); if (el) el.title = title; };
      set('worldZoomIn', t('map.zoomIn')); set('worldZoomOut', t('map.zoomOut')); set('worldZoomFit', t('map.zoomFit'));
      paintMap();
      renderPanel();
    },
  };
}
