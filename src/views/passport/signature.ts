/* ==========================================================================
   On the Road · Passport — signature (pure)
   --------------------------------------------------------------------------
   Turns the strokes drawn on the signature pad into one short SVG path that
   fits a 300 × 100 box: scaled to fill it (aspect kept), centred, points that
   are closer than the eye can tell removed, corners smoothed with quadratic
   curves. The path is what gets stored — a few hundred bytes, no image.
   ========================================================================== */

export type Pt = readonly [number, number];
export const SIG_W = 300;
export const SIG_H = 100;
const MAX_LEN = 4000;
const MARGIN = 4;

function thin(stroke: Pt[], minGap: number): Pt[] {
  const out: Pt[] = [];
  for (const p of stroke) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minGap) out.push(p);
  }
  // Keep the true end of the stroke, or a flourish loses its tail.
  const end = stroke[stroke.length - 1];
  if (out.length > 1 && out[out.length - 1] !== end) out.push(end);
  return out;
}

const r = (n: number): string => String(Math.round(n * 10) / 10);

function pathOf(strokes: Pt[][]): string {
  let d = '';
  for (const s of strokes) {
    if (s.length === 0) continue;
    d += `M${r(s[0][0])} ${r(s[0][1])}`;
    if (s.length === 1) { d += 'l.1 0'; continue; }
    for (let i = 1; i < s.length - 1; i++) {
      const mx = (s[i][0] + s[i + 1][0]) / 2;
      const my = (s[i][1] + s[i + 1][1]) / 2;
      d += `Q${r(s[i][0])} ${r(s[i][1])} ${r(mx)} ${r(my)}`;
    }
    d += `L${r(s[s.length - 1][0])} ${r(s[s.length - 1][1])}`;
  }
  return d;
}

/** The stored path for these strokes ('' when nothing was drawn). */
export function signaturePath(strokes: Pt[][]): string {
  const drawn = strokes.filter((s) => s.length > 0);
  if (drawn.length === 0) return '';
  const all = drawn.flat();
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const k = Math.min((SIG_W - 2 * MARGIN) / w, (SIG_H - 2 * MARGIN) / h);
  const ox = (SIG_W - w * k) / 2 - minX * k;
  const oy = (SIG_H - h * k) / 2 - minY * k;
  const fit = drawn.map((s) => s.map((p): Pt => [p[0] * k + ox, p[1] * k + oy]));

  for (let gap = 1.2; gap < 40; gap *= 1.6) {
    const d = pathOf(fit.map((s) => thin(s, gap)));
    if (d.length <= MAX_LEN) return d;
  }
  return pathOf(fit.map((s) => thin(s, 40)));
}

/** Only ever paint a stored signature that is plain path data — nothing else can reach the page through it. */
export function isSafePath(d: string): boolean {
  return d.length <= MAX_LEN + 200 && /^[MmLlQq0-9.\-\s,]*$/.test(d);
}
