/* ==========================================================================
   On the Road · Passport — the map's magnifier
   --------------------------------------------------------------------------
   The dots are too coarse to tell small countries apart, so the glass is a way
   of asking "which one is that?". Hold the pointer (or a finger) over the dotted
   map on the record page and a round glass follows it, showing that corner of
   the world seven times larger: every country outlined, the ones the traveller
   has been to filled and named, and a label under the cross-hairs naming
   whichever country is in the middle of the glass. Outlines and name positions
   come from data/dot-world-shapes.ts, fetched the first time the glass is used.
   Only the glass is magnified; the page itself never changes.
   ========================================================================== */

import { dotMapCells, isoNear, DOT_COLS, DOT_ROWS } from '../../data/dot-map.ts';
import { nationalityFlag } from '../../data/nationalities.ts';

export const MAGNIFIER_ICON =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>';

/** How much larger the glass shows the map. */
export const LENS_ZOOM = 7;

export type Shapes = Readonly<Record<string, string>>;
/** Where a country's name hangs: [x, y, width of its biggest piece], grid units. */
export type Centres = Readonly<Record<string, readonly [number, number, number]>>;

export interface Label { iso: string; name: string; /** % of the map */ left: number; top: number }

/** Size of a country's name on the glass, px. */
const LABEL_PX = 11;

/**
 * Where to write the names of the visited countries on a map `w` × `h` px: at the middle of each, biggest first, and
 * a name that would land on one already written is left out (the label under the cross-hairs still names it).
 */
export function placeLabels(isos: Iterable<string>, centres: Centres, nameOf: (iso: string) => string, w: number, h: number): Label[] {
  const unit = w / DOT_COLS;
  const placed: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  const out: Label[] = [];
  const list = [...new Set(isos)].filter((iso) => centres[iso]).sort((a, b) => centres[b][2] - centres[a][2]);
  for (const iso of list) {
    const [gx, gy] = centres[iso];
    const name = nameOf(iso);
    const halfW = (name.length * LABEL_PX * 0.56) / 2 + 3;
    const halfH = LABEL_PX * 0.7;
    const cx = gx * unit;
    const cy = gy * unit;
    const box = { x0: cx - halfW, x1: cx + halfW, y0: cy - halfH, y1: cy + halfH };
    if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
    placed.push(box);
    out.push({ iso, name, left: (cx / w) * 100, top: (cy / h) * 100 });
  }
  return out;
}

/**
 * The map as the glass shows it: every country as a hairline outline, the dots, and the countries in `isos`
 * filled and outlined in the accent. Same viewBox as dotMapSvg, so the two line up when stacked.
 * `shapes` null = outlines not loaded yet: the glass shows the dots alone.
 */
export function lensMapSvg(isos: Iterable<string>, shapes: Shapes | null, cell = 4): string {
  const want = new Set([...isos].filter(Boolean));
  const dim: string[] = [];
  const hot: string[] = [];
  for (const c of dotMapCells(want)) {
    const circle = `<circle cx="${c.x * cell + cell / 2}" cy="${c.y * cell + cell / 2}" r="${c.lit ? cell * 0.2 : cell * 0.1}"/>`;
    (c.lit ? hot : dim).push(circle);
  }
  let land = '';
  let lit = '';
  if (shapes) {
    land = Object.entries(shapes).filter(([iso]) => !want.has(iso)).map(([, d]) => `<path d="${d}"/>`).join('');
    lit = [...want].filter((iso) => shapes[iso]).map((iso) => `<path d="${shapes[iso]}"/>`).join('');
  }
  return `<svg class="pp-lens-map" preserveAspectRatio="none" viewBox="0 0 ${DOT_COLS * cell} ${DOT_ROWS * cell}" aria-hidden="true" focusable="false">`
    + `<g class="pp-lens-land" transform="scale(${cell})">${land}</g>`
    + `<g class="pp-dot">${dim.join('')}</g>`
    + `<g class="pp-lens-lit" transform="scale(${cell})">${lit}</g>`
    + `<g class="pp-dot is-lit">${hot.join('')}</g></svg>`;
}

interface Glass {
  el: HTMLElement;
  world: HTMLElement;
  chip: HTMLElement;
  isos: string[];
  /** Names are written for this width of map; rewritten when the page is resized. */
  labelsFor: number;
}

let shapesLoad: Promise<{ shapes: Shapes; centres: Centres } | null> | null = null;
/** The outlines and name positions, fetched once; a failed fetch is forgotten so the next use tries again. */
function loadShapes(): Promise<{ shapes: Shapes; centres: Centres } | null> {
  shapesLoad ??= import('../../data/dot-world-shapes.ts').then((m) => ({ shapes: m.DOT_SHAPES, centres: m.DOT_CENTRES })).catch(() => { shapesLoad = null; return null; });
  return shapesLoad;
}

/** A country's name in the reader's language when the passport has no better word for it. */
export function regionName(iso: string, locale: string): string {
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(iso) ?? iso; } catch { return iso; }
}

/**
 * Wires the magnifier to every `.pp-dotmap-host` under `root` (the pages are rebuilt often, so this listens on
 * the root and finds the host from the event). `nameOf` is the passport's own name for a country. Returns the
 * function that takes it off again.
 */
export function attachLens(root: HTMLElement, nameOf: (iso: string) => string): () => void {
  const glasses = new WeakMap<HTMLElement, Glass>();
  let active: { host: HTMLElement; glass: Glass } | null = null;
  let data: { shapes: Shapes; centres: Centres } | null = null;
  let lastX = 0;
  let lastY = 0;
  let lastTouch = false;

  const glassFor = (host: HTMLElement): Glass => {
    let g = glasses.get(host);
    if (g) return g;
    const el = document.createElement('div');
    el.className = 'pp-lens';
    el.setAttribute('aria-hidden', 'true');
    const view = document.createElement('div');
    view.className = 'pp-lens-view';
    const world = document.createElement('div');
    world.className = 'pp-lens-world';
    const chip = document.createElement('div');
    chip.className = 'pp-lens-chip';
    view.append(world, chip);
    el.append(view);
    host.append(el);
    g = { el, world, chip, isos: (host.dataset.ppLens ?? '').split(' ').filter(Boolean), labelsFor: 0 };
    paintWorld(g);
    glasses.set(host, g);
    void loadShapes().then((d) => {
      data = d;
      if (!d || !world.isConnected) return;
      paintWorld(g!);
      if (active?.glass === g) place(active.host, lastX, lastY, lastTouch);
    });
    return g;
  };

  /** The map inside the glass: the drawing, and (once the outlines are here) the names written over it. */
  function paintWorld(g: Glass, w = 0, h = 0): void {
    // eslint-disable-next-line no-restricted-syntax -- audited: lensMapSvg builds markup from the map grid and ISO codes only
    g.world.innerHTML = lensMapSvg(g.isos, data?.shapes ?? null);
    g.labelsFor = 0;
    if (data && w > 0) writeLabels(g, w, h);
  }

  function writeLabels(g: Glass, w: number, h: number): void {
    if (!data || g.labelsFor === w) return;
    g.labelsFor = w;
    g.world.querySelectorAll('.pp-lens-name').forEach((n) => n.remove());
    for (const l of placeLabels(g.isos, data.centres, nameOf, w, h)) {
      const span = document.createElement('span');
      span.className = 'pp-lens-name';
      span.textContent = l.name;
      span.style.left = `${l.left}%`;
      span.style.top = `${l.top}%`;
      g.world.append(span);
    }
  }

  function place(host: HTMLElement, x: number, y: number, touch: boolean): void {
    const g = glasses.get(host);
    if (!g) return;
    const hr = host.getBoundingClientRect();
    if (hr.width === 0) return;
    const L = g.el.offsetWidth;
    const fx = Math.min(1, Math.max(0, (x - hr.left) / hr.width));
    const fy = Math.min(1, Math.max(0, (y - hr.top) / hr.height));
    // What the glass shows: the map point under the pointer at its centre, the whole map scaled up behind it.
    const W = hr.width * LENS_ZOOM;
    const H = hr.height * LENS_ZOOM;
    g.world.style.width = `${W}px`;
    g.world.style.height = `${H}px`;
    g.world.style.transform = `translate(${L / 2 - fx * W}px, ${L / 2 - fy * H}px)`;
    writeLabels(g, W, H);
    // Which country is in the middle of the glass.
    const iso = isoNear(fx * DOT_COLS, fy * DOT_ROWS, new Set(g.isos));
    const visited = g.isos.includes(iso);
    g.chip.hidden = !iso;
    g.chip.classList.toggle('is-visited', visited);
    g.chip.textContent = iso ? `${visited ? `${nationalityFlag(iso)} ` : ''}${nameOf(iso)}` : '';
    // Where the glass sits: on the pointer, lifted clear of a finger, and never past the edge of the page.
    const face = host.closest<HTMLElement>('.pp-face')?.getBoundingClientRect();
    let cx = x;
    let cy = touch ? y - L * 0.75 : y;
    if (face) {
      cx = Math.min(face.right - L / 2 - 4, Math.max(face.left + L / 2 + 4, cx));
      cy = Math.min(face.bottom - L / 2 - 4, Math.max(face.top + L / 2 + 4, cy));
    }
    g.el.style.transform = `translate(${cx - hr.left - L / 2}px, ${cy - hr.top - L / 2}px)`;
  }

  const hostOf = (e: Event): HTMLElement | null => (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.pp-dotmap-host') ?? null;

  const show = (e: PointerEvent): void => {
    const host = hostOf(e);
    if (!host) return;
    const glass = glassFor(host);
    if (active && active.glass !== glass) active.glass.el.classList.remove('is-on');
    active = { host, glass };
    host.classList.add('is-magnifying');
    lastX = e.clientX; lastY = e.clientY; lastTouch = e.pointerType === 'touch';
    glass.el.classList.add('is-on');
    place(host, lastX, lastY, lastTouch);
  };
  const hide = (): void => {
    if (!active) return;
    active.glass.el.classList.remove('is-on');
    active.host.classList.remove('is-magnifying');
    active = null;
  };
  const onMove = (e: PointerEvent): void => { if (hostOf(e)) show(e); else hide(); };

  root.addEventListener('pointerover', onMove);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerdown', show);
  root.addEventListener('pointerleave', hide);
  const onUp = (e: PointerEvent): void => { if (e.pointerType === 'touch') hide(); };
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', hide);
  return () => {
    root.removeEventListener('pointerover', onMove);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerdown', show);
    root.removeEventListener('pointerleave', hide);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', hide);
    hide();
  };
}
