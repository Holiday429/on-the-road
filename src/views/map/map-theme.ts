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
  land:        '#3a352a',
  landStroke:  '#524a38',
  route:       '#e0685a',
  ink:         '#c9b8f5',
  hover:       '#f0947e',
  miniLand:    '#26241f',
  miniStroke:  '#3c372c',
  flightArc:   '#5f7a99',
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
  DK: '#5a3a3a', DE: '#33473f', NL: '#5a4a2c', BE: '#3f3650',
  FR: '#2c3f50', ES: '#4a3a2c', PT: '#33472c', CH: '#4a3f22', IT: '#3f2c50',
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
