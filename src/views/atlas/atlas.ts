/* ==========================================================================
   On the Road · Atlas — controller
   --------------------------------------------------------------------------
   Mounts the Atlas into its page: subscribes to every trip's stops, plots them,
   builds the model and keeps things in step — the globe (globe-view.ts), the
   header line and settings, the side card (world-panel.ts) and the selection (a
   country, a trip filter, the colour mode). Clicks are wired once, by `data-*`
   attribute.
   ========================================================================== */

import { PASSPORT_ICON_HTML } from '../../core/icons.ts';
import { t, getLocale } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { loadAmCharts } from '../map/amcharts-loader.ts';
import { waitForSize } from '../map/amcharts-boot.ts';
import { plotStoredLegs, type StoredLegInput, type UnlocatedStop } from '../map/map-plot.ts';
import type { PlottedLeg } from '../map/map-stats.ts';
import { routeStore } from '../../data/stores/route-store.ts';
import { journalStore } from '../../data/stores/journal-store.ts';
import { expenseStore } from '../../data/stores/expense-store.ts';
import { nomadStore } from '../../data/stores/nomad-store.ts';
import { cityStore } from '../../data/stores/city-store.ts';
import { buildCountryExtras, type ExtrasData } from './country-extras.ts';
import { mountScrubber, type Scrubber } from '../map/map-scrubber.ts';
import { timelineRange, msToIso } from '../map/map-timeline.ts';
import { listTrips, onTripChange, currentTripId } from '../../data/trip-context.ts';
import { todayIso } from '../../data/trip-phase.ts';
import { passportFor } from '../../data/passport.ts';
import type { FootprintLeg } from '../../data/footprint.ts';
import { stampSticker, wirePassportOpeners, openPassport } from '../passport/passport-links.ts';
import { buildCountryDetail } from './country-model.ts';
import { buildWorldModel, type ColorMode, type WorldModel, type WorldTripInput } from './world-model.ts';
import { createGlobeView, type GlobeView } from './globe-view.ts';
import { overviewMarkup, countryMarkup, emptyMarkup, replayMarkup, hudStatsMarkup, nextStopMarkup, settingsMarkup, lensMarkup, ribbonMarkup, hoverCardText, type WorldLayer, type AtlasSwitch, type Lens } from './world-panel.ts';
import { globeSkinSvg } from './atlas-skin.ts';
import { buildTripLines, buildCityPoints, currentSpot, nextStop, yearsOf } from './world-geo.ts';
import { onPassport } from '../../data/passport-feed.ts';
import { prefersReducedMotion } from '../map/amcharts-boot.ts';
import './atlas.css';

export interface AtlasHooks {
  /** Open the Route view — for this trip (switching to it first), or the current one. */
  openRoute(tripId: string | null): void;
}

export interface AtlasController {
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
const NIGHT_KEY = 'otr:atlas:night';
const INTRO_KEY = 'otr:atlas:intro';            // the setting (default on)
const INTRO_SEEN_KEY = 'otr:atlas:introSeen';   // played once on this device
function readFlag(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
}
function writeFlag(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* the preference just won't persist */ }
}

function stageMarkup(): string {
  return `
    <div class="atlas-desk">
      <header class="atlas-hud">
        <div class="atlas-hud-text">
          <h1 class="atlas-title">${esc(t('atlas.title'))}</h1>
          <div class="atlas-stats" id="atlasStats"></div>
          <div class="atlas-line"><span id="atlasNext"></span><button type="button" class="atlas-pending" id="atlasPending" hidden></button></div>
        </div>
        <div class="atlas-tools">
          <div class="atlas-lenses" id="atlasLenses" role="group" aria-label="${esc(t('atlas.lens.label'))}"></div>
          <button type="button" class="atlas-gear" id="atlasGear" aria-haspopup="true" aria-expanded="false" title="${esc(t('atlas.settings'))}" aria-label="${esc(t('atlas.settings'))}">⚙</button>
          <div class="atlas-settings" id="atlasSettings" role="group" aria-label="${esc(t('atlas.settings'))}" hidden></div>
        </div>
      </header>
      <div class="atlas-stage" id="atlasStage">
        <div class="globe-rig">
          <div class="globe-sphere"><div id="worldChart" class="world-chart"></div><div class="globe-shade"></div></div>
          ${globeSkinSvg()}
        </div>
        <div class="world-hover" id="worldHover" hidden></div>
        <div class="map-zoom-controls">
          <button class="map-zoom-btn" id="worldZoomIn"  title="${esc(t('map.zoomIn'))}">+</button>
          <button class="map-zoom-btn" id="worldZoomFit" title="${esc(t('map.zoomFit'))}">⊡</button>
          <button class="map-zoom-btn" id="worldZoomOut" title="${esc(t('map.zoomOut'))}">−</button>
        </div>
        <div class="map-loading" id="worldLoading">${esc(t('map.loading'))}</div>
      </div>
      <div class="atlas-ribbon" id="atlasRibbon" role="group" aria-label="${esc(t('atlas.ribbon.label'))}"></div>
      <aside class="atlas-card world-panel" id="worldPanel"></aside>
      <div class="map-timeline-slot atlas-timeline" id="worldTimeline"></div>
      <button type="button" class="atlas-prop" id="atlasPassport" title="${esc(t('passport.title'))}" aria-label="${esc(t('passport.title'))}">
        <span class="atlas-prop-cover" aria-hidden="true">${PASSPORT_ICON_HTML}</span>
      </button>
    </div>`;
}

export function mountAtlas(host: HTMLElement, hooks: AtlasHooks): AtlasController {
  // eslint-disable-next-line no-restricted-syntax -- audited: static markup; every interpolation is escaped via esc()
  host.innerHTML = stageMarkup();
  const panel = host.querySelector<HTMLElement>('#worldPanel')!;

  let rows: StoredLegInput[] = [];
  let legs: PlottedLeg[] = [];
  let unlocated: UnlocatedStop[] = [];
  let trips: WorldTripInput[] = [];
  let model: WorldModel = buildWorldModel([], [], todayIso());
  let lens: Lens = 'footprint';
  let yearFilter: number | null = null;          // the year ribbon: only that year's stops show
  let followedLeg = '';                           // replay: the stop the globe last turned to
  const modeOf = (): ColorMode => (lens === 'trips' ? 'trip' : lens === 'years' ? 'year' : 'count');
  /** The stops the globe is showing: everything, or one year of it. */
  const viewLegs = () => (yearFilter === null ? legs : legs.filter((l) => l.dateFrom.startsWith(String(yearFilter))));
  let onlyTripId: string | null = null;
  const layers = new Set<WorldLayer>(['routes', 'cities']);
  let selectedIso: string | null = null;
  let view: GlobeView | null = null;
  let plotToken = 0;
  let pendingIso: string | null = null;
  let spin = readFlag(SPIN_KEY, false);
  let night = readFlag(NIGHT_KEY, true);
  let introOn = readFlag(INTRO_KEY, true);
  let introChecked = false;
  let introToken = 0;
  let reveal: Set<string> | null = null;      // the first-open fill-in: only these countries show colour yet
  let pendingIsos = new Set<string>();          // countries with a stamp still to press
  let active = true;
  let asOf: string | null = null;            // set while replaying: the map shows the world as of this date
  let scrubber: Scrubber | null = null;
  const today = () => asOf ?? todayIso();
  const extrasData: ExtrasData = { journal: [], expenses: [], nomad: [], intel: [] };

  /* ── Render ──────────────────────────────────────────────────────────── */
  function renderPanel() {
    const now = today();
    let html: string;
    if (legs.length === 0 && unlocated.length === 0) {
      html = emptyMarkup();
    } else if (scrubber) {
      html = replayMarkup();
    } else if (selectedIso) {
      const detail = buildCountryDetail(selectedIso, legs, model, now);
      html = detail
        ? countryMarkup({
          detail, pending: pendingIsos.has(selectedIso), locale: getLocale(), stampHtml: (s) => stampSticker(s, 76),
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
      model, canReplay: timelineRange(legs) !== null, onlyTripId, currentTripId: currentTripId(), unlocated, locale: getLocale(),
      passport: p.stamps.length ? { earned: p.stamps.length, countries: p.countries } : null,
    });
  }

  /** Header line: the lifetime totals (they follow the replay cursor too). */
  function renderHud() {
    const el = host.querySelector<HTMLElement>('#atlasStats');
    const nothingYet = legs.length > 0 && model.summary.countries === 0;
    // eslint-disable-next-line no-restricted-syntax -- audited: numbers and translated labels, escaped in world-panel.ts
    if (el) el.innerHTML = nothingYet ? `<span class="atlas-stat">${esc(t('atlas.plannedOnly'))}</span>` : legs.length ? hudStatsMarkup(model.summary, getLocale()) : '';
    const next = host.querySelector<HTMLElement>('#atlasNext');
    // eslint-disable-next-line no-restricted-syntax -- audited: names escaped in world-panel.ts
    if (next) next.innerHTML = scrubber ? '' : nextStopMarkup(nextStop(legs, today(), onlyTripId));
    renderLens();
    renderRibbon();
    const pend = host.querySelector<HTMLButtonElement>('#atlasPending');
    if (pend) {
      const n = [...pendingIsos].filter((iso) => model.countries.get(iso)?.state === 'visited').length;
      pend.hidden = n === 0 || !!scrubber;
      pend.textContent = t('atlas.pending', { n });
    }
  }

  function renderLens() {
    const el = host.querySelector<HTMLElement>('#atlasLenses');
    // eslint-disable-next-line no-restricted-syntax -- audited: static markup with escaped translated labels (world-panel.ts)
    if (el) el.innerHTML = legs.length ? lensMarkup(lens) : '';
  }
  function renderRibbon() {
    const el = host.querySelector<HTMLElement>('#atlasRibbon');
    // eslint-disable-next-line no-restricted-syntax -- audited: numbers and escaped labels (world-panel.ts)
    if (el) el.innerHTML = scrubber ? '' : ribbonMarkup(yearsOf(legs, todayIso()), yearFilter, timelineRange(legs) !== null);
  }

  const switches = (): Set<AtlasSwitch> => {
    const on = new Set<AtlasSwitch>(layers);
    if (spin) on.add('spin');
    if (night) on.add('night');
    if (introOn) on.add('intro');
    return on;
  };
  function renderSettings() {
    const el = host.querySelector<HTMLElement>('#atlasSettings');
    // eslint-disable-next-line no-restricted-syntax -- audited: static markup with escaped translated labels (world-panel.ts)
    if (el) el.innerHTML = settingsMarkup(switches());
  }

  function paintMap() {
    if (!view) return;
    const tripColors = new Map(model.trips.filter((tr) => tr.color).map((tr) => [tr.id, tr.color]));
    const now = today();
    const filling = reveal !== null;     // during the fill-in the map is just colour: no lines, dots or marks yet
    view.paint({
      model, mode: modeOf(), tripColors, reveal, boldLines: lens === 'trips',
      lines: layers.has('routes') && !filling ? buildTripLines(viewLegs(), now, onlyTripId, tripColors) : [],
      points: layers.has('cities') && !filling ? buildCityPoints(viewLegs(), now, onlyTripId) : [],
      current: filling ? null : currentSpot(viewLegs(), model.trips, now, onlyTripId),
      pending: filling || scrubber ? new Set() : new Set([...pendingIsos].filter((iso) => model.countries.get(iso)?.state === 'visited')),
    });
  }

  function rebuild() {
    model = buildWorldModel(viewLegs(), trips, today(), onlyTripId);
    paintMap();
    renderHud();
    renderPanel();
    flushPending();
    maybeIntro();
  }

  /**
   * First time on this device (and unless switched off): the globe starts as plain
   * paper and the countries you have been to take their colour one by one, oldest
   * first, in about two seconds. Any touch skips it; reduced motion never plays it.
   */
  function maybeIntro() {
    if (introChecked || !view || legs.length === 0 || pendingIso || selectedIso) return;
    introChecked = true;
    if (!introOn || prefersReducedMotion() || readFlag(INTRO_SEEN_KEY, false)) return;
    const order = [...model.countries.values()].filter((c) => c.state === 'visited')
      .sort((a, b) => a.firstDate.localeCompare(b.firstDate)).map((c) => c.iso);
    if (order.length === 0) return;
    writeFlag(INTRO_SEEN_KEY, true);
    const token = ++introToken;
    const step = Math.max(60, Math.min(220, 2200 / order.length));
    let i = 0;
    reveal = new Set();
    paintMap();
    const tick = () => {
      if (token !== introToken) return;
      i += 1;
      if (i >= order.length) { reveal = null; paintMap(); renderHud(); return; }
      reveal = new Set(order.slice(0, i));
      paintMap();
      window.setTimeout(tick, step);
    };
    window.setTimeout(tick, 500);
  }

  function skipIntro() {
    introToken += 1;
    if (reveal) { reveal = null; paintMap(); }
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
    skipIntro();
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
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-trip],[data-country],[data-route-trip]');
    if (!el || !panel.contains(el)) return;
    const { act, trip, country, routeTrip } = el.dataset;
    if (country) { void selectCountry(country); return; }
    if (routeTrip) { hooks.openRoute(routeTrip); return; }
    if (trip) {
      onlyTripId = onlyTripId === trip ? null : trip;
      if (selectedIso) void backToWorld();
      rebuild();
      return;
    }
    if (act === 'back') void backToWorld();
    else if (act === 'open-route') hooks.openRoute(currentTripId());
    else if (act === 'replay') startReplay();
    else if (act === 'passport') openPassport({ iso: el.dataset.iso });
    else if (act === 'open-itinerary') void import('../../core/app.ts').then(({ navigateTo }) => navigateTo('route'));
    else if (act === 'replay-close') endReplay();
    else if (act === 'guide') void import('../../core/app.ts').then(({ navigateTo }) => navigateTo('cities'));
    else if (act === 'journal') void import('../../core/app.ts').then(({ navigateTo }) => navigateTo('journal'));
  });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selectedIso) void backToWorld(); });

  /* Settings popover: layers, day/night shading, idle spin. */
  const gear = host.querySelector<HTMLElement>('#atlasGear')!;
  const settingsEl = host.querySelector<HTMLElement>('#atlasSettings')!;
  const setSettingsOpen = (open: boolean) => { settingsEl.hidden = !open; gear.setAttribute('aria-expanded', String(open)); };
  gear.addEventListener('click', (e) => { e.stopPropagation(); setSettingsOpen(settingsEl.hasAttribute('hidden')); });
  document.addEventListener('click', (e) => { if (!settingsEl.hasAttribute('hidden') && !settingsEl.contains(e.target as Node)) setSettingsOpen(false); });
  settingsEl.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-switch]')?.dataset.switch as AtlasSwitch | undefined;
    if (!id) return;
    if (id === 'spin') { spin = !spin; writeFlag(SPIN_KEY, spin); view?.setSpin(spin); }
    else if (id === 'night') { night = !night; writeFlag(NIGHT_KEY, night); view?.setNight(night); }
    else if (id === 'intro') { introOn = !introOn; writeFlag(INTRO_KEY, introOn); }
    else { if (layers.has(id)) layers.delete(id); else layers.add(id); paintMap(); }
    renderSettings();
  });
  host.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !settingsEl.hasAttribute('hidden')) setSettingsOpen(false); });
  host.querySelector('#atlasPassport')?.addEventListener('click', () => openPassport());
  // Lenses (header) and years (ribbon).
  host.querySelector('#atlasLenses')?.addEventListener('click', (e) => {
    const next = (e.target as HTMLElement).closest<HTMLElement>('[data-lens]')?.dataset.lens as Lens | undefined;
    if (!next || next === lens) return;
    lens = next; skipIntro(); paintMap(); renderLens();
  });
  host.querySelector('#atlasRibbon')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-year],[data-act="replay"]');
    if (!btn) return;
    if (btn.dataset.act === 'replay') { startReplay(); return; }
    skipIntro();
    const y = btn.dataset.year ? Number(btn.dataset.year) : null;
    yearFilter = y === yearFilter ? null : y;
    if (selectedIso) void backToWorld();
    rebuild();
  });
  host.querySelector('#atlasPending')?.addEventListener('click', () => openPassport());
  host.querySelector('#atlasNext')?.addEventListener('click', (e) => {
    const iso = (e.target as HTMLElement).closest<HTMLElement>('[data-country]')?.dataset.country;
    if (iso) void selectCountry(iso);
  });
  // A touch anywhere on the globe skips the fill-in.
  host.querySelector('#atlasStage')?.addEventListener('pointerdown', skipIntro);

  const on = (id: string, fn: () => void) => host.querySelector(`#${id}`)?.addEventListener('click', fn);
  on('worldZoomIn', () => view?.zoom('in'));
  on('worldZoomOut', () => view?.zoom('out'));
  on('worldZoomFit', () => view?.zoom('fit'));

  /* ── Replay all trips ────────────────────────────────────────────────── */
  function startReplay() {
    const range = timelineRange(legs);
    const slot = host.querySelector<HTMLElement>('#worldTimeline');
    if (!range || !slot || scrubber) return;
    skipIntro();
    yearFilter = null;                              // the replay tells the whole story
    followedLeg = '';
    const go = () => {
      view?.setActive(false);                       // no spinning while the timeline drives the map
      scrubber = mountScrubber(slot, range, {
        reveal: (ms) => {
          asOf = msToIso(ms);
          model = buildWorldModel(legs, trips, asOf, onlyTripId);
          paintMap();
          renderHud();
          // Follow the traveller: when they reach a new stop, turn the globe to it.
          const spot = currentSpot(legs, model.trips, asOf, onlyTripId);
          if (spot && spot.legId !== followedLeg) { followedLeg = spot.legId; view?.turnTo(spot.lng, spot.lat); }
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
    followedLeg = '';
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
    const stageEl = host.querySelector<HTMLElement>('#atlasStage')!;
    // Hover cards are for a mouse; on touch a tap selects instead.
    const canHover = window.matchMedia?.('(hover: hover)').matches ?? true;
    view = createGlobeView(chartEl, {
      onCountryClick: (iso) => void selectCountry(iso),
      onPendingClick: (iso) => openPassport({ iso }),
      mascotSrc: `${import.meta.env.BASE_URL}art/logo-sm.webp`.replace(/\/{2,}/g, '/'),
      onHover: (iso, x, y) => {
        const rec = iso ? model.countries.get(iso) : undefined;
        if (!canHover || !rec) { hoverEl.hidden = true; return; }
        hoverEl.textContent = hoverCardText(rec);
        // x/y are chart pixels; the card lives in the stage.
        const off = chartEl.getBoundingClientRect();
        const base = stageEl.getBoundingClientRect();
        hoverEl.style.left = `${off.left - base.left + x + 14}px`;
        hoverEl.style.top = `${off.top - base.top + y + 14}px`;
        hoverEl.hidden = false;
      },
    });
    host.querySelector('#worldLoading')?.remove();
    view.setSpin(spin);
    view.setNight(night);
    view.setActive(active);
    paintMap();
    flushPending();
    maybeIntro();
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
  // Stamps waiting to be pressed: marked on the globe, counted in the header.
  onPassport((feed) => {
    pendingIsos = new Set(feed.pending.map((s) => s.iso).filter(Boolean));
    paintMap(); renderHud();
    if (selectedIso) renderPanel();
  });
  void loadTrips();
  renderPanel();
  renderSettings();

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
      set('atlasGear', t('atlas.settings')); set('atlasPassport', t('passport.title'));
      const title = host.querySelector('.atlas-title'); if (title) title.textContent = t('atlas.title');
      paintMap();
      renderHud();
      renderSettings();
      renderPanel();
    },
  };
}
