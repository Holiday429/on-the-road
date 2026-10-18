/* ==========================================================================
   On the Road · Itinerary board — digital-watch display
   --------------------------------------------------------------------------
   Numbers drawn as upright 7-segment digits, with the words around them (MON, JUL)
   set beside them at the same height. Segments that are
   off are simply not drawn — no ghost "8" and no panel behind the figures, so
   the digits sit straight on the board. Inline SVG: no font file, scales with
   `height`. Colour and glow live in board.css (.rb-led). No DOM, no stores.
   ========================================================================== */

import { escHtml as esc } from '../../core/utils.ts';

/** Which of the seven segments each digit lights: a top, b upper-right, c lower-right,
 *  d bottom, e lower-left, f upper-left, g middle. */
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg',
  '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
  '-': 'g',
};

const W = 9;          // digit width, in viewBox units
const H = 16;         // digit height
const T = 1.9;        // segment thickness
const GAP = 0.28;     // air between neighbouring segments
const PAD = 3.4;      // advance between digits

/** One hexagonal bar along x (horizontal) or y (vertical), centred on (cx, cy). */
function bar(cx: number, cy: number, len: number, vertical: boolean): string {
  const h = T / 2;
  const l = len / 2;
  const pts = vertical
    ? [[cx, cy - l], [cx + h, cy - l + h], [cx + h, cy + l - h], [cx, cy + l], [cx - h, cy + l - h], [cx - h, cy - l + h]]
    : [[cx - l, cy], [cx - l + h, cy - h], [cx + l - h, cy - h], [cx + l, cy], [cx + l - h, cy + h], [cx - l + h, cy + h]];
  return `M${pts.map(([x, y]) => `${+x.toFixed(2)} ${+y.toFixed(2)}`).join('L')}Z`;
}

const mid = H / 2;
const xl = T / 2, xr = W - T / 2;
const horiz = W - T - GAP * 2;            // tip to tip, tucked between the two verticals
const vert = mid - T / 2 - GAP * 2;       // tip to tip, tucked between two horizontals
const SEG_PATH: Record<string, string> = {
  a: bar(W / 2, T / 2, horiz + T, false),
  g: bar(W / 2, mid, horiz + T, false),
  d: bar(W / 2, H - T / 2, horiz + T, false),
  f: bar(xl, (T / 2 + mid) / 2, vert, true),
  b: bar(xr, (T / 2 + mid) / 2, vert, true),
  e: bar(xl, (mid + H - T / 2) / 2, vert, true),
  c: bar(xr, (mid + H - T / 2) / 2, vert, true),
};

/** Leaning digits and punctuation at x offset `x`; returns the path data. */
function glyph(ch: string, x: number): { d: string; w: number } {
  if (ch === ':') {
    const dot = (cy: number) => `M${x + 0.4} ${cy - 0.95}h1.9v1.9h-1.9z`;
    return { d: dot(H * 0.32) + dot(H * 0.68), w: 2.7 };
  }
  if (ch === '.') return { d: `M${x + 0.2} ${H - 1.9}h1.9v1.9h-1.9z`, w: 2.5 };
  const segs = SEGMENTS[ch];
  if (!segs) return { d: '', w: 0 };
  return { d: [...segs].map((s) => shift(SEG_PATH[s], x)).join(''), w: W };
}

/** Move every coordinate pair of a path of absolute "M x y L x y …Z" commands right by `dx`. */
function shift(d: string, dx: number): string {
  return d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_m, x: string, y: string) => `${+(parseFloat(x) + dx).toFixed(2)} ${y}`);
}

/** A run of digits / separators as one SVG. */
function digits(run: string): string {
  let x = 0;
  const parts: string[] = [];
  for (const ch of run) {
    if (ch === ' ') { x += 3; continue; }
    const g = glyph(ch, x);
    if (!g.w) continue;
    parts.push(g.d);
    x += g.w + PAD;
  }
  const w = Math.max(1, x - PAD);
  return `<svg class="rb-led-seg" viewBox="0 0 ${+w.toFixed(2)} ${H}" focusable="false" aria-hidden="true">`
    + `<path class="rb-led-on" d="${parts.join('')}"/></svg>`;
}

/** `text` as a digital-watch strip: digits (and - : .) as segments, any other characters as small
 *  caps beside them. `label` is what a screen reader hears (the figures are decoration). */
export function ledText(text: string, label = text): string {
  const runs = text.toUpperCase().match(/[0-9:.\- ]+|[^0-9:.\- ]+/g) ?? [];
  const html = runs.map((r) => (/^[0-9:.\- ]+$/.test(r)
    ? (r.trim() ? digits(r.trim()) : '')
    : `<span class="rb-led-word">${esc(r.trim())}</span>`)).join('');
  return `<span class="rb-led" role="img" aria-label="${esc(label)}">${html}</span>`;
}
