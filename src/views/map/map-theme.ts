/* ==========================================================================
   On the Road · Map theme
   --------------------------------------------------------------------------
   The one place map code reads its colours from, and the one listener for
   theme changes. amCharts paints with JS values (not CSS variables), so each
   chart registers a repaint callback here; on `otr:theme-change` every live
   chart recolours its shapes in place — no rebuild, so zoom and rotation stay.
   ========================================================================== */

import { MAP_PALETTE, MAP_PALETTE_DARK, hashStr } from '../../data/palette.ts';

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
  land:        '#4d4637',
  landStroke:  '#7a6e55',
  route:       '#f07a6a',
  ink:         '#d8cbf9',
  hover:       '#f0947e',
  miniLand:    '#38342b',
  miniStroke:  '#554e3e',
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

const COUNTRY_COLORS_DARK: Record<string, string> = {
  DK: '#7d5252', DE: '#4a6b5e', NL: '#80693c', BE: '#5c4f76',
  FR: '#40607a', ES: '#6e5640', PT: '#4b6b40', CH: '#6e5f31', IT: '#5e4276',
};

function isDark(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

/** Current-theme palette. Call at chart-build time (charts don't self-update). */
export function mapColors() {
  return isDark() ? MAP_COLORS_DARK : MAP_COLORS_LIGHT;
}

export function countryColor(iso: string): string {
  const table = isDark() ? COUNTRY_COLORS_DARK : COUNTRY_COLORS_LIGHT;
  const palette = isDark() ? MAP_PALETTE_DARK : MAP_PALETTE;
  return table[iso] ?? palette[hashStr(iso) % palette.length];
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

export function worldPalette(): WorldPalette {
  return {
    ocean: token('--surface'),
    land: token('--surface-3'),
    border: token('--ink-faint'),
    graticule: token('--ink-faint'),
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
