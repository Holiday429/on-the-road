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
import { journalStore } from '../../../data/stores/journal-store.ts';
import { expenseStore } from '../../../data/stores/expense-store.ts';
import { nomadStore } from '../../../data/stores/nomad-store.ts';
import { cityStore } from '../../../data/stores/city-store.ts';
import { buildCountryExtras, type ExtrasData } from './country-extras.ts';
import { pickArrival } from './world-motion.ts';
import { mountScrubber, type Scrubber } from '../map-scrubber.ts';
import { timelineRange, msToIso } from '../map-timeline.ts';
import { listTrips, onTripChange, currentTripId } from '../../../data/trip-context.ts';
import { todayIso } from '../../../data/trip-phase.ts';
import { passportFor } from '../../../data/passport.ts';
import type { FootprintLeg } from '../../../data/footprint.ts';
import { unseenStamps, markStampsSeen } from '../../../data/stamp-seen.ts';
import { stampSticker, wirePassportOpeners } from '../../passport/passport-links.ts';
import { buildCountryDetail } from './country-model.ts';
import { buildWorldModel, type ColorMode, type WorldModel, type WorldTripInput } from './world-model.ts';
import { createWorldView, type WorldView } from './world-view.ts';
import { overviewMarkup, countryMarkup, emptyMarkup, replayMarkup, summaryCardsMarkup, hoverCardText, type WorldLayer } from './world-panel.ts';
import { buildTripLines, buildCityPoints, currentSpot } from './world-geo.ts';
import './world.css';

export interface WorldHooks {
  /** Open the Route view — for this trip (switching to it first), or the current one. */
  openRoute(tripId: string | null): void;
}

export interface WorldController {
  /** Re-apply translated text after a language switch. */
  refreshText(): void;
  /** Open a country's detail (deep link). Applied once its data is ready. */
  showCountry(iso: string): void;
  /** Filter to one trip (deep link). */
  filterTrip(tripId: string): void;
  /** The World tab was shown / hidden: nothing should move by itself while hidden. */
  setActive(active: boolean): void;
}

const SPIN_KEY = 'otr:world:autoSpin';
function readSpin(): boolean {
  try { return localStorage.getItem(SPIN_KEY) === '1'; } catch { return false; }
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
        <div class="map-timeline-slot" id="worldTimeline"></div>
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
  let pendingIso: string | null = null;
  let spin = readSpin();
  let active = true;
  let asOf: string | null = null;            // set while replaying: the map shows the world as of this date
  let scrubber: Scrubber | null = null;
  let arrivalDone = false;
  let ceremonyStampId: string | null = null;  // the entry stamp to press when its country panel opens
  const today = () => asOf ?? todayIso();
  const extrasData: ExtrasData = { journal: [], expenses: [], nomad: [], intel: [] };

  /* ── Render ──────────────────────────────────────────────────────────── */
  function renderPanel() {
    const now = today();
    let html: string;
    if (legs.length === 0 && unlocated.length === 0) {
      html = emptyMarkup();
    } else if (scrubber) {
      html = replayMarkup(model.summary, getLocale());
    } else if (selectedIso) {
      const detail = buildCountryDetail(selectedIso, legs, model, now);
      const pressed = ceremonyStampId;
      ceremonyStampId = null;        // the stamp is pressed once, as the panel opens
      html = detail
        ? countryMarkup({
          detail, locale: getLocale(), stampHtml: (s) => stampSticker(s, 76, { pressed: s.id === pressed }),
          extras: buildCountryExtras(selectedIso, legs, extrasData),
        })
        : overviewHtml(now);
    } else {
      html = overviewHtml(now);
    }
    // eslint-disable-next-line no-restricted-syntax -- audited: panel markup escapes every interpolation (world-panel.ts)
    panel.innerHTML = html;
    wirePassportOpeners(panel);
  }

  function overviewHtml(now: string): string {
    const p = passportFor(legs as unknown as FootprintLeg[], now);
    return overviewMarkup({
      model, mode, layers, spin, canReplay: timelineRange(legs) !== null, onlyTripId, currentTripId: currentTripId(), unlocated, locale: getLocale(),
      passport: p.stamps.length ? { earned: p.stamps.length, countries: p.countries } : null,
    });
  }

  function paintMap() {
    if (!view) return;
    const tripColors = new Map(model.trips.filter((tr) => tr.color).map((tr) => [tr.id, tr.color]));
    const now = today();
    view.paint({
      model, mode, tripColors,
      lines: layers.has('routes') ? buildTripLines(legs, now, onlyTripId, tripColors) : [],
      points: layers.has('cities') ? buildCityPoints(legs, now, onlyTripId) : [],
      current: currentSpot(legs, model.trips, now, onlyTripId),
    });
  }

  function rebuild() {
    model = buildWorldModel(legs, trips, today(), onlyTripId);
    paintMap();
    renderPanel();
    flushPending();
    maybeArrival();
  }

  /**
   * A country entered since the traveller last looked: turn the world to it and
   * press its entry stamp. Once per visit to the page, never over a deep link or
   * a trip filter, and only when there is a fresh earned stamp to show.
   */
  function maybeArrival() {
    if (arrivalDone || !view || legs.length === 0 || pendingIso || onlyTripId) return;
    arrivalDone = true;
    const stamps = passportFor(legs as unknown as FootprintLeg[], todayIso()).stamps;
    const fresh = unseenStamps(stamps.map((s) => s.id));
    const pick = pickArrival(stamps, fresh);
    if (!pick || !model.countries.has(pick.iso)) return;
    markStampsSeen([pick.id]);
    ceremonyStampId = pick.id;
    void selectCountry(pick.iso);
  }

  /** Open a deep-linked country as soon as both the chart and the data are ready. */
  function flushPending() {
    if (!pendingIso || !view || !model.countries.has(pendingIso)) return;
    const iso = pendingIso;
    pendingIso = null;
    void selectCountry(iso);
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
    if (!view || !model.countries.has(iso) || scrubber) return;
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
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-color],[data-trip],[data-country],[data-route-trip],[data-layer],[data-spin]');
    if (!el || !panel.contains(el)) return;
    const { act, color, trip, country, routeTrip, layer } = el.dataset;
    if ('spin' in el.dataset) {
      spin = !spin;
      try { localStorage.setItem(SPIN_KEY, spin ? '1' : '0'); } catch { /* preference just won't persist */ }
      view?.setSpin(spin);
      renderPanel();
      return;
    }
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
    else if (act === 'replay') startReplay();
    else if (act === 'replay-close') endReplay();
    else if (act === 'guide') void import('../../../core/app.ts').then(({ navigateTo }) => navigateTo('cities'));
    else if (act === 'journal') void import('../../../core/app.ts').then(({ navigateTo }) => navigateTo('journal'));
  });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selectedIso) void backToWorld(); });

  const on = (id: string, fn: () => void) => host.querySelector(`#${id}`)?.addEventListener('click', fn);
  on('worldZoomIn', () => view?.zoom('in'));
  on('worldZoomOut', () => view?.zoom('out'));
  on('worldZoomFit', () => view?.zoom('fit'));

  /* ── Replay all trips ────────────────────────────────────────────────── */
  function startReplay() {
    const range = timelineRange(legs);
    const slot = host.querySelector<HTMLElement>('#worldTimeline');
    if (!range || !slot || scrubber) return;
    const go = () => {
      view?.setActive(false);                       // no spinning while the timeline drives the map
      scrubber = mountScrubber(slot, range, {
        reveal: (ms) => {
          asOf = msToIso(ms);
          model = buildWorldModel(legs, trips, asOf, onlyTripId);
          paintMap();
          const stats = panel.querySelector('.world-replay-stats');
          // eslint-disable-next-line no-restricted-syntax -- audited: numbers and translated labels, escaped in world-panel.ts
          if (stats) stats.innerHTML = summaryCardsMarkup(model.summary, getLocale());
        },
        onTakeover: () => {},
      });
      renderPanel();
      scrubber.play();
    };
    if (selectedIso) void backToWorld().then(go); else go();
  }

  function endReplay() {
    scrubber?.destroy();
    scrubber = null;
    asOf = null;
    view?.setActive(active);
    rebuild();
  }

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
    view.setSpin(spin);
    view.setActive(active);
    paintMap();
    flushPending();
    maybeArrival();
  }

  void bootChart();
  routeStore.subscribeAll((r) => { rows = r as unknown as StoredLegInput[]; void replot(); });
  // What the country panel adds: the country panel re-renders when any of these change.
  const refreshExtras = () => { if (selectedIso) renderPanel(); };
  journalStore.subscribeAll((r) => { extrasData.journal = r; refreshExtras(); });
  expenseStore.subscribeAll((r) => { extrasData.expenses = r; refreshExtras(); });
  nomadStore.subscribeForTrip(null, (r) => { extrasData.nomad = r; refreshExtras(); });
  cityStore.subscribeAll((r) => { extrasData.intel = r; refreshExtras(); });
  onTripChange(() => { void loadTrips(); });
  void loadTrips();
  renderPanel();

  return {
    showCountry(iso) {
      if (view && model.countries.has(iso)) void selectCountry(iso);
      else pendingIso = iso;     // data (or the chart) isn't ready yet — rebuild() will pick it up
    },
    filterTrip(tripId) {
      onlyTripId = tripId;
      if (selectedIso) void backToWorld();
      rebuild();
    },
    setActive(a) {
      active = a;
      if (!a && scrubber) scrubber.stop();
      view?.setActive(a && !scrubber);
    },
    refreshText() {
      const set = (id: string, title: string) => { const el = host.querySelector<HTMLElement>(`#${id}`); if (el) el.title = title; };
      set('worldZoomIn', t('map.zoomIn')); set('worldZoomOut', t('map.zoomOut')); set('worldZoomFit', t('map.zoomFit'));
      paintMap();
      renderPanel();
    },
  };
}
