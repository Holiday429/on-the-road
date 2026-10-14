/* ==========================================================================
   On the Road · Paper kit · luggage
   --------------------------------------------------------------------------
   Bags and a platform scale, drawn as inline SVG. Pure functions of plain
   props — no state, no DOM access, no page knowledge — so the iOS app can
   port the same shapes (one branch per `kind`; add `duffel`, `sling`, … by
   adding a branch to renderBag). Colour comes from classes in luggage.css
   (tokens only), never from literals, so dark mode and the matte palette
   carry over untouched.
       import '../../core/paper/luggage.css';
   ========================================================================== */

import { escHtml } from '../utils.ts';

export type BagKind = 'suitcase' | 'backpack' | 'personal';
export type ScaleVerdict = 'pass' | 'over' | 'nolimit' | null;

export interface BagProps {
  /** 0–100: how full the bag looks (a darker fill rises inside the shell). */
  loadPct: number;
  over?: boolean;
  /** Namespaces the clipPath; unique per bag on the page. */
  uid: string;
  /** 0–3 picks a matte shell colour (khaki / slate / sage / rose). */
  tone?: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A stable shell colour per bag, so neighbours differ but never flicker between renders. */
export function bagTone(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h % 4;
}

/** Natural width (px) of a bag at the card/scene size, by kind — a suitcase reads wider than a tote. */
export function bagWidth(kind: BagKind, large = false): number {
  const w = kind === 'suitcase' ? 74 : kind === 'backpack' ? 66 : 72;
  return large ? Math.round(w * 1.25) : w;
}

function wrap(kind: BagKind, p: BagProps, viewBox: string, inner: string): string {
  const tone = clamp(Math.round(p.tone ?? 0), 0, 3);
  return `<svg class="lg-bag lg-bag--${kind}${p.over ? ' is-over' : ''}" data-tone="${tone}" viewBox="${viewBox}" width="100%" role="presentation" aria-hidden="true">${inner}</svg>`;
}

export function renderBag(kind: BagKind, p: BagProps): string {
  const uid = escHtml(p.uid);
  const f = clamp(p.loadPct, 0, 100) / 100;
  if (kind === 'backpack') {
    const h = 56 * f;
    return wrap(kind, p, '0 0 110 132', `
      <path d="M30 40C22 30 26 14 40 10" class="lg-strap lg-strap--stroke"/>
      <path d="M80 40C88 30 84 14 70 10" class="lg-strap lg-strap--stroke"/>
      <rect x="18" y="30" width="74" height="92" rx="20" class="lg-body"/>
      <clipPath id="lgb-${uid}"><rect x="18" y="30" width="74" height="92" rx="20"/></clipPath>
      <g clip-path="url(#lgb-${uid})"><rect x="18" y="${122 - h}" width="74" height="${h}" class="lg-fill"/></g>
      <path d="M18 56c12-9 62-9 74 0" class="lg-seam"/>
      <rect x="30" y="66" width="50" height="34" rx="11" class="lg-pocket"/>
      <rect x="42" y="62" width="26" height="6" rx="3" class="lg-metal"/>
      <circle cx="55" cy="83" r="4.4" class="lg-pull"/>
      <rect x="47" y="104" width="16" height="9" rx="2.5" class="lg-metal"/>
      <rect x="24" y="112" width="62" height="4" rx="2" class="lg-hi"/>`);
  }
  if (kind === 'personal') {
    const h = 44 * f;
    return wrap(kind, p, '0 0 120 112', `
      <path d="M40 52V34c0-11 9-19 20-19s20 8 20 19v18" class="lg-strap lg-strap--stroke"/>
      <path d="M22 48h76l-7 58H29z" class="lg-body"/>
      <clipPath id="lgb-${uid}"><path d="M22 48h76l-7 58H29z"/></clipPath>
      <g clip-path="url(#lgb-${uid})"><rect x="20" y="${106 - h}" width="82" height="${h}" class="lg-fill"/></g>
      <path d="M24 58h72" class="lg-seam"/>
      <rect x="46" y="70" width="28" height="18" rx="4" class="lg-pocket"/>
      <circle cx="40" cy="52" r="3" class="lg-pull"/><circle cx="80" cy="52" r="3" class="lg-pull"/>`);
  }
  const h = 62 * f;
  return wrap('suitcase', p, '0 0 120 138', `
    <rect x="49" y="6" width="22" height="9" rx="4" class="lg-metal"/>
    <rect x="53" y="12" width="5" height="22" class="lg-metal"/><rect x="62" y="12" width="5" height="22" class="lg-metal"/>
    <rect x="16" y="32" width="88" height="94" rx="14" class="lg-body"/>
    <clipPath id="lgb-${uid}"><rect x="16" y="32" width="88" height="94" rx="14"/></clipPath>
    <g clip-path="url(#lgb-${uid})"><rect x="16" y="${126 - h}" width="88" height="${h}" class="lg-fill"/></g>
    <g class="lg-rib"><path d="M34 34v92M60 34v92M86 34v92"/></g>
    <rect x="16" y="74" width="88" height="3" class="lg-seam-bar"/>
    <rect x="20" y="36" width="80" height="12" rx="6" class="lg-hi"/>
    <g class="lg-metal"><rect x="16" y="36" width="7" height="14" rx="3"/><rect x="97" y="36" width="7" height="14" rx="3"/><rect x="16" y="108" width="7" height="14" rx="3"/><rect x="97" y="108" width="7" height="14" rx="3"/></g>
    <g class="lg-wheel"><circle cx="30" cy="130" r="6"/><circle cx="52" cy="130" r="6"/><circle cx="70" cy="130" r="6"/><circle cx="92" cy="130" r="6"/></g>
    <circle cx="60" cy="60" r="5" class="lg-pull"/>`);
}

export interface ScaleProps {
  /** Text on the LED glass (already formatted in the user's unit). */
  reading: string;
  verdict?: ScaleVerdict;
  /** Small caption under the digits, e.g. "LIMIT 23 kg". */
  caption?: string;
}

/** A platform scale: brushed deck, rubber feet, dark glass readout. The digits and caption
 *  carry `data-lg="num"` / `data-lg="cap"` so a caller can update them in place while counting. */
export function renderScale(p: ScaleProps): string {
  const v = p.verdict ?? '';
  return `<svg class="lg-scale${v ? ` is-${v}` : ''}" viewBox="0 0 300 150" width="100%" role="presentation" aria-hidden="true">
    <ellipse cx="150" cy="142" rx="118" ry="7" class="lg-shadow"/>
    <g class="lg-foot"><rect x="40" y="128" width="30" height="11" rx="5"/><rect x="230" y="128" width="30" height="11" rx="5"/></g>
    <rect x="28" y="72" width="244" height="58" rx="11" class="lg-base"/>
    <g class="lg-grain"><path d="M40 80h220M40 124h220"/></g>
    <g data-lg="deck">
      <rect x="18" y="56" width="264" height="18" rx="7" class="lg-plate"/>
      <rect x="26" y="58" width="248" height="3" rx="1.5" class="lg-plate-hi"/>
    </g>
    <rect x="86" y="82" width="128" height="42" rx="9" class="lg-led-case"/>
    <rect x="93" y="88" width="114" height="30" rx="5" class="lg-led-glass"/>
    <text x="150" y="108" text-anchor="middle" class="lg-led-num" data-lg="num">${escHtml(p.reading)}</text>
    <text x="150" y="115" text-anchor="middle" class="lg-led-cap" data-lg="cap">${escHtml(p.caption ?? '')}</text>
  </svg>`;
}
