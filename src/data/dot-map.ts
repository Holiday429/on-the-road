/* ==========================================================================
   On the Road · Dotted world (pure)
   --------------------------------------------------------------------------
   The little map on the passport's record page: the land as a grid of dots
   (data/dot-world.ts, built from the same country shapes the Atlas draws),
   with the countries the traveller has been to lit up. A country too small
   for a cell of its own is lit by the land cell nearest its centre.
   ========================================================================== */

import { DOT_COLS, DOT_ISOS, DOT_LAT_TOP, DOT_LONE, DOT_ROWS, DOT_ROWS_DATA, DOT_STEP } from './dot-world.ts';

export { DOT_COLS, DOT_ROWS };

interface Cell { x: number; y: number; iso: string }

/** Every land cell with its country, built once. */
const LAND: readonly Cell[] = (() => {
  const out: Cell[] = [];
  for (let y = 0; y < DOT_ROWS; y++) {
    const row = DOT_ROWS_DATA[y];
    for (let x = 0; x < DOT_COLS; x++) {
      const code = row.slice(x * 2, x * 2 + 2);
      if (code === '..') continue;
      out.push({ x, y, iso: DOT_ISOS[parseInt(code, 36) - 1] ?? '' });
    }
  }
  return out;
})();

/** The cells to light for these countries (ISO alpha-2). */
export function litCells(isos: Iterable<string>): Set<Cell> {
  const lit = new Set<Cell>();
  const want = new Set([...isos].filter(Boolean));
  for (const c of LAND) if (want.has(c.iso)) lit.add(c);
  for (const iso of want) {
    const at = DOT_LONE[iso];
    if (!at || LAND.some((c) => c.iso === iso)) continue;
    const gx = (at[1] + 180) / DOT_STEP - 0.5;
    const gy = (DOT_LAT_TOP - at[0]) / DOT_STEP - 0.5;
    let best: Cell | null = null;
    let d = Infinity;
    for (const c of LAND) {
      const dd = (c.x - gx) ** 2 + (c.y - gy) ** 2;
      if (dd < d) { d = dd; best = c; }
    }
    if (best) lit.add(best);
  }
  return lit;
}

/**
 * The country at a point of the map (grid units, 0…COLS × 0…ROWS): the land cell nearest to it, within a cell and a
 * half — a coast or a narrow country is easy to miss by a hair. A country in `prefer` wins a near tie, so a visited
 * country is never lost to its neighbour. '' for open sea.
 */
export function isoNear(gx: number, gy: number, prefer: ReadonlySet<string> = new Set()): string {
  let best = '';
  let bestD = 1.5 * 1.5;
  for (const c of LAND) {
    const dx = c.x + 0.5 - gx;
    const dy = c.y + 0.5 - gy;
    if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) continue;
    const d = dx * dx + dy * dy - (prefer.has(c.iso) ? 0.6 : 0);
    if (d < bestD) { bestD = d; best = c.iso; }
  }
  return best;
}

/** Every land cell of the dotted world, flagged when it is one of the countries in `isos`. Grid coordinates, not pixels. */
export function dotMapCells(isos: Iterable<string>): Array<{ x: number; y: number; lit: boolean }> {
  const lit = litCells(isos);
  return LAND.map((c) => ({ x: c.x, y: c.y, lit: lit.has(c) }));
}

/** The dotted world as an inline SVG, the countries in `isos` lit. `cell` = px per grid cell in the viewBox. */
export function dotMapSvg(isos: Iterable<string>, cell = 4): string {
  const w = DOT_COLS * cell;
  const h = DOT_ROWS * cell;
  const dim: string[] = [];
  const hot: string[] = [];
  for (const c of dotMapCells(isos)) {
    const cx = c.x * cell + cell / 2;
    const cy = c.y * cell + cell / 2;
    (c.lit ? hot : dim).push(`<circle cx="${cx}" cy="${cy}" r="${c.lit ? cell * 0.46 : cell * 0.26}"/>`);
  }
  return `<svg class="pp-dotmap" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true" focusable="false">`
    + `<g class="pp-dot">${dim.join('')}</g><g class="pp-dot is-lit">${hot.join('')}</g></svg>`;
}
