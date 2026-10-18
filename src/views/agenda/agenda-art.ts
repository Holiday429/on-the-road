/* ==========================================================================
   On the Road · Agenda — the picture on each month's page
   --------------------------------------------------------------------------
   A wall calendar's month has a picture above its dates. Here it is a small
   paper-cut landscape — sky, a sun, layered hills, a few trees, a dotted route
   with a paper plane — drawn in the season's colours and a little different for
   every month (the hills' shapes, where the sun stands, where the trees are
   all come from the month number), so turning the page shows a new picture, not
   the same strip again. Pure SVG, no data: the colours (the sky is the container's own
   gradient) are CSS custom properties set per season in agenda.css, so dark mode and the palette stay in one place.
   ========================================================================== */

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

export function seasonOf(month: number): Season {
  if (month === 11 || month <= 1) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'autumn';
}

const W = 640;
const H = 112;

/** A repeatable pseudo-random 0–1 stream from `seed`, so a month always draws the same picture. */
function rng(seed: number): () => number {
  let s = (seed * 9301 + 49297) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** A ridge: a few slow sine waves summed, closed down to the foot of the picture. */
function ridge(base: number, amp: number, phase: number, seed: number): string {
  const r = rng(seed);
  const f1 = 0.006 + r() * 0.004;
  const f2 = 0.015 + r() * 0.008;
  const p2 = r() * 6;
  let d = `M0 ${H}`;
  for (let x = 0; x <= W; x += 16) {
    const y = base + amp * Math.sin(x * f1 + phase) + amp * 0.38 * Math.sin(x * f2 + p2);
    d += ` L${x} ${y.toFixed(1)}`;
  }
  return `${d} L${W} ${H} Z`;
}

function ridgeY(base: number, amp: number, phase: number, seed: number, x: number): number {
  const r = rng(seed);
  const f1 = 0.006 + r() * 0.004;
  const f2 = 0.015 + r() * 0.008;
  const p2 = r() * 6;
  return base + amp * Math.sin(x * f1 + phase) + amp * 0.38 * Math.sin(x * f2 + p2);
}

function tree(x: number, y: number, size: number, kind: 'pine' | 'round', fill: string): string {
  if (kind === 'pine') {
    const s = size;
    return `<path d="M${x} ${y - s * 2.1} l${s * 0.62} ${s * 1.0} h${-s * 0.3} l${s * 0.5} ${s * 0.9} h${-s * 1.64} l${s * 0.5} ${-s * 0.9} h${-s * 0.3} z" fill="${fill}"/>`;
  }
  return `<rect x="${x - size * 0.09}" y="${y - size * 0.5}" width="${size * 0.18}" height="${size * 0.55}" fill="var(--art-trunk)"/>`
    + `<circle cx="${x}" cy="${y - size * 0.95}" r="${size * 0.62}" fill="${fill}"/>`;
}

/** The month's picture as an `<svg>` (decorative: aria-hidden, no title). */
export function monthArt(month: number): string {
  const season = seasonOf(month);
  const seed = month + 3;
  const r = rng(seed * 17);

  // The sun: further along its path as the year goes.
  const sunX = 90 + (month / 11) * (W - 190);
  const sunY = season === 'winter' ? 40 : season === 'summer' ? 26 : 34;
  const sunR = season === 'summer' ? 17 : 13;

  const farBase = 52, midBase = 70, nearBase = 90;
  const far = ridge(farBase, 12, seed * 0.9, seed + 1);
  const mid = ridge(midBase, 10, seed * 1.3 + 2, seed + 2);
  const near = ridge(nearBase, 7, seed * 0.7 + 4, seed + 3);

  // Trees on the middle ridge (small) and the near one (bigger), never under the sun's halo's line of sight too tightly.
  let midTrees = '';
  let nearTrees = '';
  const kindMid: 'pine' | 'round' = season === 'winter' || (season === 'autumn' && month === 10) ? 'pine' : 'round';
  for (let i = 0, x = 24 + r() * 30; x < W - 12; i++, x += 34 + r() * 52) {
    const y = ridgeY(midBase, 10, seed * 1.3 + 2, seed + 2, x) + 3;
    midTrees += tree(x, y, 6 + r() * 3, kindMid, i % 2 ? 'var(--art-tree-b)' : 'var(--art-tree-a)');
  }
  for (let x = 40 + r() * 70; x < W - 20; x += 90 + r() * 120) {
    const y = ridgeY(nearBase, 7, seed * 0.7 + 4, seed + 3, x) + 4;
    nearTrees += tree(x, y, 9 + r() * 3, season === 'winter' || season === 'autumn' ? 'pine' : 'round', 'var(--art-tree-c)');
  }

  // Seasonal extras: snow flecks, blossom, falling leaves, sun glints.
  let extras = '';
  const count = season === 'summer' ? 5 : 16;
  for (let i = 0; i < count; i++) {
    const x = r() * W;
    const y = 8 + r() * 40;
    if (season === 'winter') extras += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(1 + r() * 1.3).toFixed(1)}" fill="var(--art-fleck)"/>`;
    else if (season === 'spring') extras += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(1.4 + r() * 1.4).toFixed(1)}" fill="var(--art-fleck)"/>`;
    else if (season === 'autumn') extras += `<path d="M${x.toFixed(0)} ${y.toFixed(0)} q3 -4 6 0 q-3 4 -6 0z" fill="var(--art-fleck)" transform="rotate(${(r() * 120 - 60).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`;
    else extras += `<path d="M${x.toFixed(0)} ${(y * 0.6).toFixed(0)} h9" stroke="var(--art-fleck)" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>`;
  }

  // Clouds: two flat paper puffs.
  const cloud = (cx: number, cy: number, k: number) =>
    `<g transform="translate(${cx} ${cy}) scale(${k})" fill="var(--art-cloud)"><rect x="-22" y="-4" width="44" height="9" rx="4.5"/><circle cx="-6" cy="-6" r="7"/><circle cx="7" cy="-4" r="5.5"/></g>`;
  const c1 = 120 + r() * 120;
  const c2 = 360 + r() * 160;

  // The route: a dotted line over the hills ending in a paper plane.
  const planeX = 470 + r() * 110;
  const route = `<path d="M-10 62 C 90 22, 190 80, 300 46 S ${planeX - 60} 18, ${planeX} 24" fill="none" stroke="var(--art-route)" stroke-width="1.7" stroke-linecap="round" stroke-dasharray="1.5 6"/>`
    + `<g transform="translate(${planeX} 24) rotate(-14)"><path d="M0 0 L24 -3 L9 5 Z" fill="var(--art-plane)"/><path d="M9 5 L7 12 L4 3 Z" fill="var(--art-plane-fold)"/></g>`;

  return `<svg class="cal-art-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">`
    + `<circle cx="${sunX.toFixed(0)}" cy="${sunY}" r="${sunR * 2.1}" fill="var(--art-halo)"/><circle cx="${sunX.toFixed(0)}" cy="${sunY}" r="${sunR}" fill="var(--art-sun)"/>`
    + cloud(c1, 30, 1) + cloud(c2, 20, 0.8)
    + extras
    + `<g class="cal-art-cut"><path d="${far}" fill="var(--art-far)"/></g>`
    + `<g class="cal-art-cut"><path d="${mid}" fill="var(--art-mid)"/>${midTrees}</g>`
    + route
    + `<g class="cal-art-cut"><path d="${near}" fill="var(--art-near)"/>${nearTrees}</g>`
    + `</svg>`;
}
