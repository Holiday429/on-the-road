/* ==========================================================================
   On the Road · Paper kit · stamp basics
   --------------------------------------------------------------------------
   Text helpers and the shared worn-ink filters used by every stamp renderer
   (stamp.ts for city marks, stamp-country.ts for passport country stamps).
   ========================================================================== */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const MODE_TEXT: Record<string, string> = { flight: 'AIR', train: 'RAIL', bus: 'COACH', ferry: 'SEA' };

/** "25 JUN" from an ISO date, no timezone surprises. */
export function stampDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return m && d ? `${d} ${MONTHS[m - 1]}` : iso;
}

export function stampYear(iso: string): string {
  return iso.slice(0, 4);
}

/** Upper-cased, trimmed to fit a stamp, with an ellipsis when it had to be cut. */
export function stampText(s: string, max: number): string {
  const t = s.trim().toUpperCase();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

let defsAdded = false;
let uid = 0;
/** A document-unique id for SVG defs (arc paths). */
export function nextUid(): number { return ++uid; }

/** Ids of the worn-ink filters; a stamp picks one by its seed so no two neighbours wear alike. */
export const INK_FILTERS = ['pp-ink', 'pp-ink-b', 'pp-ink-c'] as const;

/** [noise seed, grain frequency, hole threshold, wobble seed] per filter. */
const INK_PARAMS: Array<[number, number, number, number]> = [[7, 0.85, 2.2, 3], [19, 0.7, 2.5, 11], [41, 1.0, 1.9, 27]];

function inkFilter(id: string, [seed, freq, cut, wseed]: [number, number, number, number]): string {
  return `<filter id="${id}" x="-6%" y="-6%" width="112%" height="112%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  8 0 0 0 -${cut}" result="holes"/>
      <feComposite in="SourceGraphic" in2="holes" operator="in" result="worn"/>
      <feTurbulence type="turbulence" baseFrequency="0.04" numOctaves="1" seed="${wseed}" result="w"/>
      <feDisplacementMap in="worn" in2="w" scale="1.1" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`;
}

/** The shared worn-ink filters, added to the page once. */
export function ensureStampDefs(): void {
  if (defsAdded || typeof document === 'undefined') return;
  defsAdded = true;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  // eslint-disable-next-line no-restricted-syntax -- static markup, numbers only
  host.innerHTML = `<svg width="0" height="0" focusable="false"><defs>${INK_FILTERS.map((id, i) => inkFilter(id, INK_PARAMS[i])).join('')}</defs></svg>`;
  document.body.appendChild(host);
}
