/* ==========================================================================
   On the Road · Paper kit · country stamp (passport)
   --------------------------------------------------------------------------
   One stamp per country per trip, drawn so that no two countries look alike:
   a frame (ten shapes, picked from the country), a landmark in line art
   (stamp-icons.ts), a headline that follows how long the traveller stayed
   ("WEEKEND IN", "A WEEK IN"…), the country's ink and a condensed display
   face. How hard it was pressed (`pressure`) sets the ink strength; one stamp
   in eight is struck twice and lands a hair off. Everything derives from the
   spec, so the same stamp always draws the same.

   Used by renderStamp() whenever spec.kind === 'country'.
   ========================================================================== */

import type { StampRenderOpts, StampShape, StampSpec } from './stamp.ts';
import { INK_FILTERS, ensureStampDefs, nextUid, stampDate, stampText, stampYear } from './stamp-base.ts';
import { ICONS, iconFor } from './stamp-icons.ts';
import { escHtml as esc } from '../utils.ts';
import { hashStr } from '../../data/palette.ts';

/** The shapes a country can be given; data/passport.ts picks one by country. */
export const COUNTRY_SHAPES: StampShape[] = ['circle', 'double', 'rounded', 'cut', 'tilted', 'arch', 'perf', 'oval', 'hex', 'octagon'];

interface Layout {
  /** Where the lines sit (y in a 120 box). */
  phrase: number; name: number; icon: number; date: number;
  /** Longest country name that fits before it is ellipsised. */
  nameMax: number;
  dateFs: number;
}

const BOX: Layout = { phrase: 35, name: 49, icon: 65, date: 88, nameMax: 16, dateFs: 9.5 };
const NARROW: Layout = { ...BOX, nameMax: 13, dateFs: 8.5 };

interface Frame { markup: string; ring: boolean; layout: Layout; /** Frame + text are rotated together. */ turn?: number }

function polygon(r: number, n: number, rot: number): string {
  return Array.from({ length: n }, (_, i) => {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    return `${(60 + r * Math.cos(a)).toFixed(1)},${(60 + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

function frameFor(shape: StampShape): Frame {
  const ring: Layout = { phrase: 92, name: 0, icon: 56, date: 81, nameMax: 15, dateFs: 9 };
  switch (shape) {
    case 'circle':
      return { ring: true, layout: ring, markup: '<circle cx="60" cy="60" r="55" class="pp-line pp-thick"/><circle cx="60" cy="60" r="47" class="pp-line"/>' };
    case 'double':
      return { ring: true, layout: ring, markup: '<circle cx="60" cy="60" r="55" class="pp-line pp-thick"/><circle cx="60" cy="60" r="51" class="pp-line"/><circle cx="60" cy="60" r="46" class="pp-line pp-dash"/>' };
    case 'cut':
      return { ring: false, layout: BOX, markup: '<path d="M20 20H100L112 32V88L100 100H20L8 88V32Z" class="pp-line pp-thick"/><path d="M24 26H96L106 36V84L96 94H24L14 84V36Z" class="pp-line"/>' };
    case 'tilted':
      return { ring: false, layout: BOX, turn: -7, markup: '<rect x="8" y="20" width="104" height="80" rx="4" class="pp-line pp-thick"/><rect x="14" y="26" width="92" height="68" rx="2" class="pp-line"/>' };
    case 'arch':
      return { ring: false, layout: { ...BOX, phrase: 40, name: 54, icon: 69, date: 90 }, markup: '<path d="M8 100V50A52 36 0 0 1 112 50V100Z" class="pp-line pp-thick"/><path d="M15 94V51A45 30 0 0 1 105 51V94Z" class="pp-line"/>' };
    case 'perf':
      return { ring: false, layout: { ...BOX, phrase: 40, name: 53, icon: 66, date: 87 }, markup: '<rect x="6" y="20" width="108" height="80" rx="3" class="pp-line pp-perf"/><rect x="14" y="28" width="92" height="64" class="pp-line"/>' };
    case 'oval':
      return { ring: false, layout: { ...NARROW, phrase: 37, name: 51, icon: 66, date: 88 }, markup: '<ellipse cx="60" cy="60" rx="57" ry="46" class="pp-line pp-thick"/><ellipse cx="60" cy="60" rx="49" ry="38" class="pp-line"/>' };
    case 'hex':
      return { ring: false, layout: NARROW, markup: `<polygon points="${polygon(56, 6, -90)}" class="pp-line pp-thick"/><polygon points="${polygon(48, 6, -90)}" class="pp-line"/>` };
    case 'octagon':
      return { ring: false, layout: NARROW, markup: `<polygon points="${polygon(56, 8, -67.5)}" class="pp-line pp-thick"/><polygon points="${polygon(49, 8, -67.5)}" class="pp-line"/>` };
    case 'rounded':
    case 'entry':
    default:
      return { ring: false, layout: BOX, markup: '<rect x="6" y="20" width="108" height="80" rx="16" class="pp-line pp-thick"/><rect x="12" y="26" width="96" height="68" rx="11" class="pp-line"/>' };
  }
}

/** The headline above the name — how long the stay was. */
export function stayPhrase(nights: number): string {
  if (nights <= 1) return 'ONE NIGHT IN';
  if (nights <= 3) return 'WEEKEND IN';
  if (nights <= 8) return 'A WEEK IN';
  return `${nights} NIGHTS IN`;
}

function nameSize(len: number, base: number): number {
  return len <= 8 ? base : len <= 11 ? base - 1.5 : len <= 12 ? base - 3 : base - 4.5;
}

function content(s: StampSpec, f: Frame, arcId: string): string {
  const L = f.layout;
  const name = stampText(s.country, L.nameMax);
  const icon = `<g class="pp-icon" transform="translate(${60 - 12.6},${L.icon - 12.6}) scale(1.05)">${ICONS[iconFor(s.iso)]}</g>`;
  const date = `<text x="60" y="${L.date}" class="pp-t pp-date" text-anchor="middle" font-size="${L.dateFs}">${esc(stampDate(s.date))} ${esc(stampYear(s.date))}</text>`;
  const phrase = `<text x="60" y="${L.phrase}" class="pp-t pp-xs" text-anchor="middle" letter-spacing=".9">${esc(stayPhrase(s.nights))}</text>`;
  if (f.ring) {
    return `<path id="${arcId}" d="M 60 60 m -35 0 a 35 35 0 1 1 70 0" fill="none"/>
      <text class="pp-t pp-name" font-size="${nameSize(name.length, 12.5)}" letter-spacing="1.4"><textPath href="#${arcId}" startOffset="50%" text-anchor="middle">${esc(name)}</textPath></text>
      ${icon}${date}${phrase}`;
  }
  return `${phrase}<text x="60" y="${L.name}" class="pp-t pp-name" text-anchor="middle" font-size="${nameSize(name.length, 13)}" letter-spacing="${name.length > 11 ? 0.6 : 1.2}">${esc(name)}</text>${icon}${date}`;
}

export function renderCountryStamp(s: StampSpec, o: StampRenderOpts = {}): string {
  ensureStampDefs();
  const size = o.size ?? 110;
  const f = frameFor(s.shape);
  const seed = hashStr(s.id);
  const filter = INK_FILTERS[seed % INK_FILTERS.length];
  const arcId = `pp-arc-${nextUid()}`;
  const body = `${f.markup}${content(s, f, arcId)}`;
  const turned = f.turn ? `<g transform="rotate(${f.turn} 60 60)">${body}</g>` : body;
  // One in eight is struck twice: a pale second impression a hair off.
  const double = seed % 8 === 0 ? `<g class="pp-ghost" transform="translate(1.4 .9)">${turned}</g>` : '';
  const pressure = Math.min(1, Math.max(0, s.pressure ?? 0.75));
  const label = `${s.country}, ${s.date}`;
  const cls = ['pp-stamp', 'pp-country', s.earned ? '' : 'is-ghost', o.pressed ? 'is-pressed' : '', o.className ?? ''].filter(Boolean).join(' ');
  return `<span class="${cls}" data-shape="${s.shape}" style="--ink-c:${esc(s.ink)};--rot:${s.rotation}deg;--sz:${size}px;--ink-o:${(0.62 + 0.36 * pressure).toFixed(2)}" role="img" aria-label="${esc(label)}">
    <svg viewBox="0 0 120 120" width="${size}" height="${size}" focusable="false" aria-hidden="true">
      <g filter="url(#${filter})">${double}${turned}</g>
    </svg></span>`;
}
