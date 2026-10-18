/* ==========================================================================
   On the Road · Map theme
   --------------------------------------------------------------------------
   The one place map code reads its colours from, and the one listener for
   theme changes. amCharts paints with JS values (not CSS variables), so each
   chart registers a repaint callback here; on `otr:theme-change` every live
   chart recolours its shapes in place — no rebuild, so zoom and rotation stay.
   ========================================================================== */

import { MAP_PALETTE, hashStr } from '../../data/palette.ts';

const MAP_COLORS_LIGHT = {
  land:        '#f0ead6',
  landStroke:  '#d6c9a8',
  route:       '#b5535a',
  ink:         '#3a1d6e',
  hover:       '#e07b54',
  miniLand:    '#f7f5f0',
  miniStroke:  '#d8d0c0',
  flightArc:   '#7b9bbf',
};

const MAP_COLORS_DARK = {
  land:        '#2f363f',
  landStroke:  '#505b68',
  route:       '#f07a6a',
  ink:         '#d8cbf9',
  hover:       '#f0947e',
  miniLand:    '#2d343c',
  miniStroke:  '#4a5460',
  flightArc:   '#7f9bbd',
};

const COUNTRY_COLORS_LIGHT: Record<string, string> = {
  DK: '#d4a5a5',
  DE: '#9fc5b8',
  NL: '#e8c99a',
  BE: '#c4b7d4',
  FR: '#8fb8d4',
  ES: '#d4b8a8',
  PT: '#b8d49c',
  CH: '#e8d4a0',
  IT: '#c4aad4',
};

function isDark(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

/** Current-theme palette. Call at chart-build time (charts don't self-update). */
export function mapColors() {
  return isDark() ? MAP_COLORS_DARK : MAP_COLORS_LIGHT;
}

/* A country's tone follows the itinerary's category tags (base.css "Category tone"):
   light mode paints its pastel as is, with a deeper rim; dark mode keeps the pastel's
   hue but re-lights it — a deep saturated fill and a bright mid-tone rim — so each
   country stays tellable apart and clearly lifts off the neutral slate land. */
function basePastel(iso: string): string {
  return COUNTRY_COLORS_LIGHT[iso] ?? MAP_PALETTE[hashStr(iso) % MAP_PALETTE.length];
}

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const sat = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, sat * 100, l * 100];
}

function hsl(h: number, s: number, l: number): string {
  const sat = s / 100, light = l / 100, a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Fill of a country on the route. */
export function countryColor(iso: string): string {
  const base = basePastel(iso);
  if (!isDark()) return base;
  const [h, s] = hexToHsl(base);
  return hsl(h, Math.min(s * 1.2, 50), 33);
}

/** Rim of a country on the route — the category "mark" tone. */
export function countryMark(iso: string): string {
  const base = basePastel(iso);
  const [h, s, l] = hexToHsl(base);
  return isDark() ? hsl(h, Math.min(s * 1.3, 62), 64) : hsl(h, Math.min(s * 1.1 + 8, 60), Math.max(l - 28, 38));
}

/* ── World palette ────────────────────────────────────────────────────────────
   The World view paints from the app's CSS tokens (read when called, so a theme
   switch just needs another call) rather than from colour literals. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'rgb(128,128,128)';
}

export interface WorldPalette {
  ocean: string; land: string; border: string; graticule: string;
  /** Visited ramp, 1 visit → 4+ visits. */
  visited: [string, string, string, string];
  planned: string; plannedLine: string;
  /** Colour and opacity of the night half. */
  night: string; nightOpacity: number;
}

/** Dark maps sit on neutral slate: the page's warm browns made sea and unvisited land read as one yellowish wash. */
const DARK_SEA = '#1b222b', DARK_LAND = '#39414b', DARK_BORDER = '#66717e';

export function worldPalette(): WorldPalette {
  return {
    ocean: isDark() ? DARK_SEA : token('--surface'),
    land: isDark() ? DARK_LAND : token('--surface-3'),
    border: isDark() ? DARK_BORDER : token('--ink-faint'),
    graticule: isDark() ? DARK_BORDER : token('--ink-faint'),
    visited: [token('--amber-300'), token('--amber-400'), token('--amber-500'), token('--amber-600')],
    // Planned countries are GREY (owner): clearly not the amber of a country been to, nor the paper of one never visited.
    planned: token('--ink-muted'),
    plannedLine: token('--ink-muted'),
    // Night is a darker wash: ink on the light theme, the deepest surface on the dark one.
    night: token(isDark() ? '--surface-2' : '--ink'),
    nightOpacity: isDark() ? 0.5 : 0.14,
  };
}

/* ── Repaint registry ─────────────────────────────────────────────────────── */
const _repaints = new Set<() => void>();
let _listening = false;

function onThemeChange() {
  for (const fn of [..._repaints]) {
    try { fn(); } catch (err) { console.warn('map repaint failed', err); }
  }
}

/** Register a callback that recolours a live chart. Returns its unregister fn. */
export function onMapRepaint(fn: () => void): () => void {
  _repaints.add(fn);
  if (!_listening) {
    _listening = true;
    window.addEventListener('otr:theme-change', onThemeChange);
  }
  return () => { _repaints.delete(fn); };
}
