/* ==========================================================================
   On the Road · Passport share image — palette
   --------------------------------------------------------------------------
   An image leaves the app and has to look the same wherever it lands, so it is
   always drawn on cream paper in ink, whatever theme the app is in — which is
   why these are literals and not tokens. A colour table, like country-ink.ts.
   ========================================================================== */

export const SHARE = {
  /** The cover's own navy — the default cloth, so the picture reads as a passport whatever the traveller dressed theirs in. */
  cover: '#34465e',
  /** The desk the book lies on, outside the cover. */
  desk: '#ebe5d6',
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
  /** The portrait frame on the data page: a pale sky wash, like the real page's. */
  photoTop: '#c5d3de',
  photoBottom: '#aebfcf',
  photoGhost: 'rgba(42, 37, 32, 0.08)',
  /** The band the machine-readable lines sit on. */
  mrzBand: 'rgba(160, 182, 196, 0.28)',
  white: '#ffffff',
} as const;
