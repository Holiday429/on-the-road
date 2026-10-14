/* ==========================================================================
   On the Road · Passport share image — palette
   --------------------------------------------------------------------------
   An image leaves the app and has to look the same wherever it lands, so it is
   always drawn on cream paper in ink, whatever theme the app is in — which is
   why these are literals and not tokens. A colour table, like country-ink.ts.
   ========================================================================== */

export const SHARE = {
  paper: '#f7f1e2',
  paperEdge: '#e3d9c2',
  ink: '#2a2520',
  inkSoft: '#5b5144',
  inkMuted: '#8a7f70',
  rule: 'rgba(42, 37, 32, 0.18)',
  /** The lit countries and the numbers that matter: the page's terracotta. */
  accent: '#a8543f',
  /** Land that has not been visited yet. */
  dot: 'rgba(42, 37, 32, 0.30)',
  white: '#ffffff',
} as const;
