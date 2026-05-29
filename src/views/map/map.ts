/* ==========================================================================
   On the Road · My Map (2D)
   --------------------------------------------------------------------------
   A flat, on-brand map of the European route. Reads the same itinerary legs
   the /route view uses, plots each city, draws the path connecting them, and
   sends the logo.gif protagonist walking along it. A side panel lists the
   legs; clicking a leg (or a pin) focuses that city.

   Built with SVG + CSS only — no map library, no Three.js. The 3D globe from
   Marginalia can layer on later as an enhancement; this keeps /map fast.
   ========================================================================== */

import './map.css';
import { coordsFor, project, MAP_VIEW } from './geo.ts';
import { EUROPE_PATH, EUROPE_ACCENTS } from './europe-svg.ts';

const ROUTE_KEY = 'otr:route:legs';
const HERO_GIF = '/art/logo.gif';

interface Leg {
  id: string;
  city: string;
  country: string;
  flag: string;
  dateFrom: string;
  dateTo: string;
  notes?: string;
}

interface PlottedLeg extends Leg {
  x: number;
  y: number;
}

let _initialized = false;
let _activeId: string | null = null;
let _heroTimer: number | null = null;

function loadLegs(): Leg[] {
  try {
    const raw = localStorage.getItem(ROUTE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function plot(legs: Leg[]): PlottedLeg[] {
  const out: PlottedLeg[] = [];
  for (const leg of legs) {
    const c = coordsFor(leg.city);
    if (!c) continue;                 // skip cities we don't have coords for
    const { x, y } = project(c);
    out.push({ ...leg, x, y });
  }
  return out;
}

function fmtRange(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const f = new Date(from).toLocaleDateString('en-US', opts);
  const t = new Date(to).toLocaleDateString('en-US', opts);
  return `${f} – ${t}`;
}

function nights(from: string, to: string): number {
  return Math.max(0, Math.round((+new Date(to) - +new Date(from)) / 86400000));
}

/* ── Render ──────────────────────────────────────────────────────────────── */

function renderEmpty(root: HTMLElement) {
  root.querySelector('.map-stage')!.innerHTML = `
    <div class="map-empty">
      <img src="/art/earth_trans.png" alt="" class="map-empty-art">
      <div class="map-empty-title">No route yet</div>
      <div class="map-empty-sub">Add cities in <a href="#route">Itinerary</a> and they'll appear here as your footprint.</div>
    </div>`;
}

function pathFrom(plotted: PlottedLeg[]): string {
  if (plotted.length < 2) return '';
  return plotted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

function buildSVG(plotted: PlottedLeg[]): string {
  const accents = EUROPE_ACCENTS
    .map(d => `<path d="${d}" class="map-accent" />`).join('');

  const route = pathFrom(plotted);

  const pins = plotted.map((p, i) => `
    <g class="map-pin ${p.id === _activeId ? 'active' : ''}" data-id="${p.id}"
       transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})" role="button" tabindex="0">
      <circle class="map-pin-halo" r="18" />
      <circle class="map-pin-dot" r="7" />
      <text class="map-pin-num" y="2.5">${i + 1}</text>
      <text class="map-pin-label" y="-22">${p.flag} ${p.city.split(/\s*[\/+→,]\s*/)[0]}</text>
    </g>`).join('');

  return `
    <svg class="map-svg" viewBox="0 0 ${MAP_VIEW.w} ${MAP_VIEW.h}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="landGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--map-land-1)" />
          <stop offset="1" stop-color="var(--map-land-2)" />
        </linearGradient>
      </defs>
      <path d="${EUROPE_PATH}" class="map-land" />
      ${accents}
      <path d="${route}" class="map-route" id="map-route-path" pathLength="1" />
      <image class="map-hero" href="${HERO_GIF}" width="64" height="64" x="-32" y="-58" />
      ${pins}
    </svg>`;
}

function renderPanel(root: HTMLElement, plotted: PlottedLeg[], total: number) {
  const countries = new Set(plotted.map(p => p.country)).size;
  const skipped = total - plotted.length;

  const list = plotted.map((p, i) => `
    <button class="leg-row ${p.id === _activeId ? 'active' : ''}" data-id="${p.id}">
      <span class="leg-row-num">${i + 1}</span>
      <span class="leg-row-main">
        <span class="leg-row-city">${p.flag} ${p.city}</span>
        <span class="leg-row-meta">${fmtRange(p.dateFrom, p.dateTo)} · ${nights(p.dateFrom, p.dateTo)} nights</span>
      </span>
    </button>`).join('');

  root.querySelector('.map-panel')!.innerHTML = `
    <div class="map-stats">
      <div class="map-stat"><div class="map-stat-num">${plotted.length}</div><div class="map-stat-label">Cities</div></div>
      <div class="map-stat"><div class="map-stat-num">${countries}</div><div class="map-stat-label">Countries</div></div>
    </div>
    <div class="map-legs">${list}</div>
    ${skipped > 0 ? `<div class="map-note">${skipped} stop${skipped > 1 ? 's' : ''} not yet on the map (no coordinates).</div>` : ''}
  `;

  root.querySelectorAll<HTMLButtonElement>('.leg-row').forEach(btn => {
    btn.addEventListener('click', () => focusLeg(root, plotted, btn.dataset.id!));
  });
}

function focusLeg(root: HTMLElement, plotted: PlottedLeg[], id: string) {
  _activeId = id;
  root.querySelectorAll('.map-pin, .leg-row').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.id === id);
  });
  const target = plotted.find(p => p.id === id);
  if (target) parkHeroAt(root, target.x, target.y);
}

/* ── Hero (logo.gif) movement ───────────────────────────────────────────── */

function heroEl(root: HTMLElement): SVGImageElement | null {
  return root.querySelector('.map-hero');
}

/** Place the hero at a city, no travel animation (used on focus). */
function parkHeroAt(root: HTMLElement, x: number, y: number) {
  const hero = heroEl(root);
  if (!hero) return;
  if (_heroTimer) { cancelAnimationFrame(_heroTimer); _heroTimer = null; }
  hero.setAttribute('x', String(x - 32));
  hero.setAttribute('y', String(y - 58));
}

/** Walk the hero along the full route once, then park at the last city. */
function travelHero(root: HTMLElement, plotted: PlottedLeg[]) {
  const hero = heroEl(root);
  if (!hero || plotted.length === 0) return;

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    const last = plotted[plotted.length - 1];
    parkHeroAt(root, last.x, last.y);
    return;
  }

  // Build cumulative segment lengths for constant-speed travel.
  const pts = plotted.map(p => ({ x: p.x, y: p.y }));
  const segLen: number[] = [];
  let totalLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segLen.push(d); totalLen += d;
  }
  if (totalLen === 0) { parkHeroAt(root, pts[0].x, pts[0].y); return; }

  const SPEED = 220;                       // svg units per second
  const duration = (totalLen / SPEED) * 1000;
  const start = performance.now();

  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    let dist = t * totalLen;
    let i = 0;
    while (i < segLen.length && dist > segLen[i]) { dist -= segLen[i]; i++; }
    const a = pts[i] ?? pts[pts.length - 1];
    const b = pts[i + 1] ?? a;
    const f = segLen[i] ? dist / segLen[i] : 0;
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    hero.setAttribute('x', String(x - 32));
    hero.setAttribute('y', String(y - 58));
    if (t < 1) _heroTimer = requestAnimationFrame(step);
    else _heroTimer = null;
  };
  _heroTimer = requestAnimationFrame(step);
}

/* ── Entry ───────────────────────────────────────────────────────────────── */

export function initMap() {
  if (_initialized) return;
  _initialized = true;

  const view = document.getElementById('view-map');
  if (!view) return;

  view.querySelector('.view-header')!.innerHTML = `
    <div class="view-title">My map</div>
    <div class="view-subtitle">Your footprint across Europe — every city, in order.</div>`;

  const body = view.querySelector('.stub-body')!;
  body.outerHTML = `
    <div class="map-layout">
      <div class="map-stage"></div>
      <aside class="map-panel"></aside>
    </div>`;

  const root = view as HTMLElement;
  const legs = loadLegs();
  const plotted = plot(legs);

  if (plotted.length === 0) { renderEmpty(root); return; }

  root.querySelector('.map-stage')!.innerHTML = buildSVG(plotted);
  renderPanel(root, plotted, legs.length);

  root.querySelectorAll<SVGGElement>('.map-pin').forEach(pin => {
    pin.addEventListener('click', () => focusLeg(root, plotted, pin.dataset.id!));
  });

  // Animate the route draw, then send the hero traveling.
  requestAnimationFrame(() => {
    root.querySelector('.map-route')?.classList.add('drawn');
    setTimeout(() => travelHero(root, plotted), 600);
  });
}
