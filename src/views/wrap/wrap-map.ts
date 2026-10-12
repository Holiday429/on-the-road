/* ==========================================================================
   On the Road · Wrap · route sketch (pure)
   --------------------------------------------------------------------------
   The route chapter's picture: the stops on a plain equirectangular sketch,
   joined by gentle curves, in the order they were visited. No tiles, no
   amCharts — it has to be instant and to print into the page. Returns SVG
   markup built from CSS classes only (colours live in wrap.css).
   ========================================================================== */

import { escHtml as esc } from '../../core/utils.ts';

export interface SketchStop { legId: string; city: string; lat: number; lng: number }

export interface SketchPoint { x: number; y: number; city: string; legId: string; first: boolean }

export interface Sketch {
  width: number;
  height: number;
  points: SketchPoint[];
  /** SVG path through every point, or '' with fewer than two distinct places. */
  path: string;
}

export const SKETCH_W = 640;
export const SKETCH_H = 320;
const PAD = 36;

/** Longitudes shifted so a route crossing the date line stays in one piece. */
export function unwrapLng(lngs: number[]): number[] {
  if (!lngs.length) return [];
  const span = Math.max(...lngs) - Math.min(...lngs);
  return span > 180 ? lngs.map((l) => (l < 0 ? l + 360 : l)) : lngs;
}

export function sketchRoute(stops: SketchStop[], width = SKETCH_W, height = SKETCH_H): Sketch {
  if (!stops.length) return { width, height, points: [], path: '' };
  const lngs = unwrapLng(stops.map((s) => s.lng));
  const lats = stops.map((s) => s.lat);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));   // a degree of longitude is narrower away from the equator
  const x0 = Math.min(...lngs), x1 = Math.max(...lngs);
  const y0 = Math.min(...lats), y1 = Math.max(...lats);
  const spanX = Math.max((x1 - x0) * kx, 1e-6), spanY = Math.max(y1 - y0, 1e-6);
  // One scale for both axes so the shape isn't squashed; a single place sits in the middle.
  const scale = Math.min((width - PAD * 2) / spanX, (height - PAD * 2) / spanY);
  const single = x1 - x0 < 1e-9 && y1 - y0 < 1e-9;
  const offX = (width - spanX * scale) / 2, offY = (height - spanY * scale) / 2;

  const seen = new Set<string>();
  const points: SketchPoint[] = stops.map((s, i) => {
    const key = s.city.trim().toLowerCase();
    const first = !seen.has(key);
    seen.add(key);
    return {
      x: single ? width / 2 : offX + (lngs[i] - x0) * kx * scale,
      y: single ? height / 2 : height - offY - (s.lat - y0) * scale,
      city: s.city, legId: s.legId, first,
    };
  });

  // Curve between consecutive, distinct points; the control point leans to one side of the chord.
  let path = '';
  let prev: SketchPoint | null = null;
  for (const p of points) {
    if (!prev) { path = `M${p.x.toFixed(1)} ${p.y.toFixed(1)}`; prev = p; continue; }
    const dx = p.x - prev.x, dy = p.y - prev.y;
    if (Math.hypot(dx, dy) < 0.5) { prev = p; continue; }
    const cx = (prev.x + p.x) / 2 - dy * 0.18, cy = (prev.y + p.y) / 2 + dx * 0.18;
    path += ` Q${cx.toFixed(1)} ${cy.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    prev = p;
  }
  return { width, height, points, path: path.includes('Q') ? path : '' };
}

export function sketchSvg(sk: Sketch, ariaLabel: string): string {
  if (!sk.points.length) return '';
  const grid = [0.25, 0.5, 0.75].map((f) =>
    `<line class="wrap-map-grid" x1="0" y1="${(sk.height * f).toFixed(0)}" x2="${sk.width}" y2="${(sk.height * f).toFixed(0)}"/>` +
    `<line class="wrap-map-grid" x1="${(sk.width * f).toFixed(0)}" y1="0" x2="${(sk.width * f).toFixed(0)}" y2="${sk.height}"/>`).join('');
  const dots = sk.points.map((p, i) => `
    <g class="wrap-map-stop" style="--i:${i}">
      <circle class="wrap-map-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.first ? 4.5 : 3}"/>
      ${p.first ? `<text class="wrap-map-label" x="${p.x.toFixed(1)}" y="${(p.y - 9).toFixed(1)}" text-anchor="middle">${esc(p.city)}</text>` : ''}
    </g>`).join('');
  return `<svg class="wrap-map" viewBox="0 0 ${sk.width} ${sk.height}" role="img" aria-label="${esc(ariaLabel)}" focusable="false">
    ${grid}
    ${sk.path ? `<path class="wrap-map-line" pathLength="1" d="${sk.path}"/>` : ''}
    ${dots}
  </svg>`;
}
