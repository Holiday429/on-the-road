/* ==========================================================================
   On the Road · Passport — the map's magnifier
   --------------------------------------------------------------------------
   Hold the pointer (or a finger) over the dotted map on the record page and a
   round glass follows it, showing that corner of the world about five times
   larger. The dots are too coarse to show a country's shape, so inside the
   glass the countries the traveller has been to are drawn with their real
   outline (data/dot-world-shapes.ts, fetched the first time the glass is used).
   Only the glass is magnified; the page itself never changes.
   ========================================================================== */

import { dotMapCells, DOT_COLS, DOT_ROWS } from '../../data/dot-map.ts';

export const MAGNIFIER_ICON =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>';

/** How much larger the glass shows the map. */
export const LENS_ZOOM = 5;

export type Shapes = Readonly<Record<string, string>>;

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
    const circle = `<circle cx="${c.x * cell + cell / 2}" cy="${c.y * cell + cell / 2}" r="${c.lit ? cell * 0.4 : cell * 0.2}"/>`;
    (c.lit ? hot : dim).push(circle);
  }
  let land = '';
  let lit = '';
  if (shapes) {
    land = Object.entries(shapes).filter(([iso]) => !want.has(iso)).map(([, d]) => `<path d="${d}"/>`).join('');
    lit = [...want].filter((iso) => shapes[iso]).map((iso) => `<path d="${shapes[iso]}"/>`).join('');
  }
  return `<svg class="pp-lens-map" viewBox="0 0 ${DOT_COLS * cell} ${DOT_ROWS * cell}" aria-hidden="true" focusable="false">`
    + `<g class="pp-lens-land" transform="scale(${cell})">${land}</g>`
    + `<g class="pp-dot">${dim.join('')}</g>`
    + `<g class="pp-lens-lit" transform="scale(${cell})">${lit}</g>`
    + `<g class="pp-dot is-lit">${hot.join('')}</g></svg>`;
}

interface Glass {
  el: HTMLElement;
  view: HTMLElement;
  isos: string;
}

let shapesLoad: Promise<Shapes | null> | null = null;
/** The outlines, fetched once; a failed fetch is forgotten so the next use tries again. */
function loadShapes(): Promise<Shapes | null> {
  shapesLoad ??= import('../../data/dot-world-shapes.ts').then((m) => m.DOT_SHAPES).catch(() => { shapesLoad = null; return null; });
  return shapesLoad;
}

/**
 * Wires the magnifier to every `.pp-dotmap-host` under `root` (the pages are rebuilt often, so this listens on
 * the root and finds the host from the event). Returns the function that takes it off again.
 */
export function attachLens(root: HTMLElement): () => void {
  const glasses = new WeakMap<HTMLElement, Glass>();
  let active: { host: HTMLElement; glass: Glass } | null = null;

  const glassFor = (host: HTMLElement): Glass => {
    let g = glasses.get(host);
    if (g) return g;
    const el = document.createElement('div');
    el.className = 'pp-lens';
    el.setAttribute('aria-hidden', 'true');
    const view = document.createElement('div');
    view.className = 'pp-lens-view';
    el.append(view);
    host.append(el);
    g = { el, view, isos: host.dataset.ppLens ?? '' };
    const isos = g.isos.split(' ').filter(Boolean);
    // eslint-disable-next-line no-restricted-syntax -- audited: lensMapSvg builds markup from the map grid and ISO codes only
    view.innerHTML = lensMapSvg(isos, null);
    void loadShapes().then((shapes) => {
      // eslint-disable-next-line no-restricted-syntax -- audited: as above
      if (shapes && view.isConnected) view.innerHTML = lensMapSvg(isos, shapes);
      if (active?.glass === g) place(active.host, lastX, lastY, lastTouch);
    });
    glasses.set(host, g);
    return g;
  };

  let lastX = 0;
  let lastY = 0;
  let lastTouch = false;

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
    const svg = g.view.firstElementChild as HTMLElement | null;
    if (svg) { svg.style.width = `${W}px`; svg.style.height = `${H}px`; svg.style.transform = `translate(${L / 2 - fx * W}px, ${L / 2 - fy * H}px)`; }
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
