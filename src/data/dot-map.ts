/* ==========================================================================
   On the Road · Dotted world (pure)
   --------------------------------------------------------------------------
   The little map on the passport's record page: the land as a grid of dots
   (data/dot-world.ts, built from the same country shapes the Atlas draws),
   with the countries the traveller has been to lit up. A country too small
   for a cell of its own is lit by the land cell nearest its centre.
   ========================================================================== */

import { DOT_COLS, DOT_ISOS, DOT_LAT_TOP, DOT_LONE, DOT_ROWS, DOT_ROWS_DATA, DOT_STEP } from './dot-world.ts';

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

/** The dotted world as an inline SVG, the countries in `isos` lit. `cell` = px per grid cell in the viewBox. */
export function dotMapSvg(isos: Iterable<string>, cell = 4): string {
  const lit = litCells(isos);
  const w = DOT_COLS * cell;
  const h = DOT_ROWS * cell;
  const dim: string[] = [];
  const hot: string[] = [];
  for (const c of LAND) {
    const cx = c.x * cell + cell / 2;
    const cy = c.y * cell + cell / 2;
    (lit.has(c) ? hot : dim).push(`<circle cx="${cx}" cy="${cy}" r="${lit.has(c) ? cell * 0.46 : cell * 0.26}"/>`);
  }
  return `<svg class="pp-dotmap" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true" focusable="false">`
    + `<g class="pp-dot">${dim.join('')}</g><g class="pp-dot is-lit">${hot.join('')}</g></svg>`;
}
