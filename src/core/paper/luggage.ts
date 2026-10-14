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

export type BagKind = 'suitcase' | 'backpack' | 'personal' | 'duffel';
export type BagSize = 'S' | 'M' | 'L';
/** Matte shell colours: 0 khaki · 1 slate · 2 sage · 3 rose · 4 graphite · 5 plum. */
export const BAG_TONES = 6;
export type ScaleVerdict = 'pass' | 'over' | 'nolimit' | null;

export interface BagProps {
  /** 0–100: how full the bag looks (a darker fill rises inside the shell). */
  loadPct: number;
  over?: boolean;
  /** Namespaces the clipPath; unique per bag on the page. */
  uid: string;
  /** 0–5 picks a matte shell colour (khaki / slate / sage / rose / graphite / plum). */
  tone?: number;
  /** An empty outline — "a bag goes here" — instead of an object. */
  ghost?: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A stable shell colour per bag, so neighbours differ but never flicker between renders. */
export function bagTone(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h % 4;
}

/** A size for a bag that was never given one: read it off the weight limit (carry-on → S, checked → L). */
export function bagSizeFor(limitG: number): BagSize {
  if (!(limitG > 0)) return 'M';
  return limitG <= 10_000 ? 'S' : limitG <= 20_000 ? 'M' : 'L';
}

/** What a bag looks like: the user's choice when they made one, otherwise a stable guess. */
export function bagLook(c: { id: string; limitG: number; tone?: number | null; size?: BagSize | null }): { tone: number; size: BagSize } {
  return { tone: c.tone ?? bagTone(c.id), size: c.size ?? bagSizeFor(c.limitG) };
}

const SIZE_SCALE: Record<BagSize, number> = { S: 0.82, M: 1, L: 1.18 };

/** Natural width (px) of a bag at the card/scene size, by kind and size — a suitcase reads wider than a tote. */
export function bagWidth(kind: BagKind, large = false, size: BagSize = 'M'): number {
  const w = kind === 'suitcase' ? 74 : kind === 'backpack' ? 66 : kind === 'duffel' ? 84 : 72;
  return Math.round((large ? w * 1.25 : w) * SIZE_SCALE[size]);
}

function wrap(kind: BagKind, p: BagProps, viewBox: string, inner: string): string {
  const tone = clamp(Math.round(p.tone ?? 0), 0, BAG_TONES - 1);
  return `<svg class="lg-bag lg-bag--${kind}${p.over ? ' is-over' : ''}${p.ghost ? ' is-ghost' : ''}" data-tone="${tone}" viewBox="${viewBox}" width="100%" role="presentation" aria-hidden="true">${inner}</svg>`;
}

export function renderBag(kind: BagKind, p: BagProps): string {
  const uid = escHtml(p.uid);
  const f = clamp(p.loadPct, 0, 100) / 100;
  if (kind === 'backpack') {
    // Domed top flap with a buckle and two straps, a zipped front pocket, bottle pockets on both sides.
    const body = 'M30 40C30 22 41 15 55 15S80 22 80 40L88 112C88.5 118 84 122 78 122H32C26 122 21.5 118 22 112Z';
    const h = 84 * f;
    return wrap(kind, p, '0 0 110 132', `
      <path d="M44 22C44 4 66 4 66 22" class="lg-strap lg-strap--stroke"/>
      <path d="M23 78C13 79 9 92 12 106C14 113 20 116 25 114V82Z" class="lg-body lg-side"/>
      <path d="M87 78C97 79 101 92 98 106C96 113 90 116 85 114V82Z" class="lg-body lg-side"/>
      <path d="${body}" class="lg-body"/>
      <clipPath id="lgb-${uid}"><path d="${body}"/></clipPath>
      <g clip-path="url(#lgb-${uid})">
        <rect x="20" y="${122 - h}" width="70" height="${h}" class="lg-fill"/>
        <rect x="20" y="108" width="70" height="14" class="lg-shade"/>
      </g>
      <path d="M28 46C28 22 41 16 55 16S82 22 82 46C82 62 70 70 55 70S28 62 28 46Z" class="lg-flap"/>
      <path d="M42 68V98M68 68V98" class="lg-band"/>
      <rect x="49" y="62" width="12" height="11" rx="3" class="lg-metal"/>
      <rect x="31" y="84" width="48" height="30" rx="10" class="lg-pocket"/>
      <path d="M36 92H74" class="lg-seam"/>
      <circle cx="55" cy="92" r="3.2" class="lg-pull"/>
      <ellipse cx="44" cy="31" rx="11" ry="5" class="lg-hi"/>`);
  }
  if (kind === 'duffel') {
    // A barrel on its side: top handle, a zip along the crown, two straps and a side pocket.
    const body = 'M34 32H96C112 32 122 44 122 59S112 86 96 86H34C18 86 8 74 8 59S18 32 34 32Z';
    const h = 54 * f;
    return wrap(kind, p, '0 0 130 100', `
      <path d="M42 36C42 10 88 10 88 36" class="lg-strap lg-strap--stroke"/>
      <path d="${body}" class="lg-body"/>
      <clipPath id="lgb-${uid}"><path d="${body}"/></clipPath>
      <g clip-path="url(#lgb-${uid})">
        <rect x="8" y="${86 - h}" width="114" height="${h}" class="lg-fill"/>
        <rect x="8" y="76" width="114" height="10" class="lg-shade"/>
        <rect x="8" y="32" width="24" height="54" class="lg-side"/>
        <rect x="98" y="32" width="24" height="54" class="lg-side"/>
      </g>
      <path d="M32 34C52 29 78 29 98 34" class="lg-seam"/>
      <path d="M46 31V86M84 31V86" class="lg-band"/>
      <rect x="52" y="54" width="26" height="20" rx="7" class="lg-pocket"/>
      <circle cx="65" cy="58" r="2.6" class="lg-pull"/>
      <circle cx="42" cy="36" r="3.6" class="lg-pull"/><circle cx="88" cy="36" r="3.6" class="lg-pull"/>
      <ellipse cx="48" cy="42" rx="22" ry="4.2" class="lg-hi"/>
      <rect x="30" y="86" width="14" height="4" rx="2" class="lg-metal"/><rect x="86" y="86" width="14" height="4" rx="2" class="lg-metal"/>`);
  }
  if (kind === 'personal') {
    const h = 44 * f;
    const body = 'M22 48h76l-7 58H29z';
    return wrap(kind, p, '0 0 120 112', `
      <path d="M40 52V34c0-11 9-19 20-19s20 8 20 19v18" class="lg-strap lg-strap--stroke"/>
      <path d="${body}" class="lg-body"/>
      <clipPath id="lgb-${uid}"><path d="${body}"/></clipPath>
      <g clip-path="url(#lgb-${uid})">
        <rect x="20" y="${106 - h}" width="82" height="${h}" class="lg-fill"/>
        <rect x="20" y="96" width="82" height="10" class="lg-shade"/>
      </g>
      <path d="M24 58h72" class="lg-seam"/>
      <rect x="46" y="70" width="28" height="18" rx="4" class="lg-pocket"/>
      <circle cx="40" cy="52" r="3" class="lg-pull"/><circle cx="80" cy="52" r="3" class="lg-pull"/>
      <path d="M28 54l-3 30" class="lg-hi-line"/>`);
  }
  const h = 62 * f;
  return wrap('suitcase', p, '0 0 120 138', `
    <rect x="49" y="6" width="22" height="9" rx="4" class="lg-metal"/>
    <rect x="53" y="12" width="5" height="22" class="lg-metal"/><rect x="62" y="12" width="5" height="22" class="lg-metal"/>
    <rect x="16" y="32" width="88" height="94" rx="14" class="lg-body"/>
    <clipPath id="lgb-${uid}"><rect x="16" y="32" width="88" height="94" rx="14"/></clipPath>
    <g clip-path="url(#lgb-${uid})"><rect x="16" y="${126 - h}" width="88" height="${h}" class="lg-fill"/><rect x="16" y="114" width="88" height="12" class="lg-shade"/></g>
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
