/* ==========================================================================
   On the Road · Share card — visual spec
   --------------------------------------------------------------------------
   All sizes are in *logical* pixels on a fixed-width canvas; the renderer
   multiplies by SCALE for a crisp @2x export. Colours, fonts and radii mirror
   the site's design tokens (src/core/base.css) so cards feel native.
   ========================================================================== */

import type { CardKind } from './card-layout.ts';

export type CardRatio = '3:4' | '2:3';

export const CARD_WIDTH = 540;
export const SCALE = 2; // export at 1080px wide

export function cardHeight(ratio: CardRatio): number {
  return ratio === '2:3' ? Math.round(CARD_WIDTH * 1.5) : Math.round(CARD_WIDTH * (4 / 3));
}

/** Default export ratio per type (Notes/Places tend to be content-heavy). */
export const DEFAULT_RATIO: Record<CardKind, CardRatio> = {
  moment: '3:4',
  note: '2:3',
  interesting: '3:4',
  place: '3:4',
};

// ── Design tokens (mirrors base.css) ──────────────────────────────────────
export const COLORS = {
  paper:      '#fafaf9', // --surface-2
  ink:        '#1c1917', // --ink
  inkSoft:    '#44403c', // --ink-soft
  inkMuted:   '#78716c', // --ink-muted
  inkFaint:   '#a8a29e', // --ink-faint
  rule:       'rgba(28,25,23,0.10)',
  white:      '#ffffff',
};

export const FONTS = {
  ui:   'Sora, system-ui, sans-serif',
  body: '"DM Sans", system-ui, sans-serif',
  hand: 'Caveat, "DM Sans", cursive',
};

export const PAD = 36;          // outer padding
export const RADIUS = 20;       // image / box radius
export const FOOTER_H = 132;    // reserved footer block height

/**
 * Mix a tint with white to get a soft background, like CSS color-mix().
 * `pct` is how much tint (0–100); the rest is white.
 */
export function tintMix(tint: string, pct: number): string {
  const t = hexToRgb(tint);
  const w = { r: 255, g: 255, b: 255 };
  const k = pct / 100;
  const r = Math.round(t.r * k + w.r * (1 - k));
  const g = Math.round(t.g * k + w.g * (1 - k));
  const b = Math.round(t.b * k + w.b * (1 - k));
  return `rgb(${r},${g},${b})`;
}

/** Darken a tint toward ink for accent text/icons. */
export function tintInk(tint: string, pct = 70): string {
  const t = hexToRgb(tint);
  const ink = hexToRgb(COLORS.ink);
  const k = pct / 100;
  const r = Math.round(t.r * k + ink.r * (1 - k));
  const g = Math.round(t.g * k + ink.g * (1 - k));
  const b = Math.round(t.b * k + ink.b * (1 - k));
  return `rgb(${r},${g},${b})`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Build a canvas font string. */
export function font(weight: number, size: number, family: string): string {
  return `${weight} ${size}px ${family}`;
}
