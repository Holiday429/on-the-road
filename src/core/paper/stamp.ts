/* ==========================================================================
   On the Road · Paper kit · passport stamp
   --------------------------------------------------------------------------
   An ink stamp drawn as inline SVG: a city (or country-entry) mark with its
   date, nights and arrival mode. Six frame shapes, a per-country ink, a slight
   rotation and a worn-ink texture — all derived from data, so no artwork has
   to be made. The generic text stamp (`paperStamp` in paper.ts) is a separate,
   simpler thing.

   Input is a plain `StampSpec`; data/stamps.ts builds those from the route.
   Styles: paper.css (.pp-*). Needs the shared ink filter, which `renderStamp`
   injects once (`ensureStampDefs`).
   ========================================================================== */

import { escHtml as esc } from '../utils.ts';
import { MODE_TEXT, ensureStampDefs, nextUid, stampDate, stampYear, stampText } from './stamp-base.ts';
import { renderCountryStamp } from './stamp-country.ts';

export { stampDate, stampYear, stampText, ensureStampDefs } from './stamp-base.ts';

export type StampShape = 'circle' | 'double' | 'rounded' | 'hex' | 'oval' | 'octagon' | 'entry' | 'cut' | 'tilted' | 'arch' | 'perf';

export interface StampSpec {
  id: string;
  kind: 'city' | 'country';
  city: string;
  /** English country name, shown on the stamp. */
  country: string;
  /** ISO-3166 alpha-2, may be ''. */
  iso: string;
  /** ISO date of arrival. */
  date: string;
  nights: number;
  /** How you arrived: flight / train / bus / ferry. */
  mode?: string;
  shape: StampShape;
  /** Degrees, small. */
  rotation: number;
  /** Ink colour (any CSS colour). Lightened automatically on dark themes. */
  ink: string;
  /** False = a stamp still to come; drawn as a faint ghost. */
  earned: boolean;
  /** Itinerary-card postmarks: which end of the stay this one marks. Absent = a plain city stamp. */
  phase?: 'arrive' | 'depart';
  /** 0–1 — how hard the traveller pressed it (ink strength). Default: a firm press. */
  pressure?: number;
}

export interface StampRenderOpts {
  /** Pixel size of the longest side. Default 110. */
  size?: number;
  /** Plays the "pressed" thunk. */
  pressed?: boolean;
  /** Extra classes on the wrapper. */
  className?: string;
}

/* ── Frames ──────────────────────────────────────────────────────────────── */

interface Frame { frame: string; arc: boolean }

function polygon(cx: number, cy: number, r: number, n: number, rot: number): string {
  return Array.from({ length: n }, (_, i) => {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

function frameFor(shape: StampShape): Frame {
  switch (shape) {
    case 'circle':
      return { arc: true, frame: `<circle cx="60" cy="60" r="55" class="pp-line pp-thick"/><circle cx="60" cy="60" r="46" class="pp-line"/>` };
    case 'double':
      return { arc: true, frame: `<circle cx="60" cy="60" r="55" class="pp-line pp-thick"/><circle cx="60" cy="60" r="51" class="pp-line"/><circle cx="60" cy="60" r="39" class="pp-line pp-dash"/>` };
    case 'hex':
      return { arc: false, frame: `<polygon points="${polygon(60, 60, 56, 6, -90)}" class="pp-line pp-thick"/><polygon points="${polygon(60, 60, 48, 6, -90)}" class="pp-line"/>` };
    case 'octagon':
      return { arc: false, frame: `<polygon points="${polygon(60, 60, 56, 8, -67.5)}" class="pp-line pp-thick"/><polygon points="${polygon(60, 60, 49, 8, -67.5)}" class="pp-line"/>` };
    case 'oval':
      return { arc: false, frame: `<ellipse cx="60" cy="60" rx="57" ry="42" class="pp-line pp-thick"/><ellipse cx="60" cy="60" rx="49" ry="34" class="pp-line"/>` };
    case 'entry':
      return { arc: false, frame: `<rect x="4" y="22" width="112" height="76" rx="3" class="pp-line pp-thick"/><rect x="10" y="28" width="100" height="64" rx="1.5" class="pp-line"/>` };
    case 'rounded':
    default:
      return { arc: false, frame: `<rect x="6" y="20" width="108" height="80" rx="16" class="pp-line pp-thick"/><rect x="12" y="26" width="96" height="68" rx="11" class="pp-line"/>` };
  }
}

function fontFor(len: number, base: number): number {
  return len <= 8 ? base : len <= 11 ? base - 1.5 : len <= 14 ? base - 3 : base - 4.5;
}

/** Long names get tighter tracking so they stay inside the frame. */
function trackFor(len: number): number {
  return len <= 8 ? 1.6 : len <= 11 ? 1 : 0.3;
}

function inner(s: StampSpec, arcId: string, frame: Frame): string {
  const date = stampDate(s.date);
  const year = stampYear(s.date);
  const mode = s.mode ? MODE_TEXT[s.mode] ?? 'ARR' : 'ARR';
  const nights = s.nights === 1 ? '1 NIGHT' : `${s.nights} NIGHTS`;
  // Postmarks say which end of the stay they mark instead of how long it was.
  const tail = s.phase ? `${s.phase === 'arrive' ? 'ARRIVED' : 'DEPARTED'}${s.mode ? ` · ${mode}` : ''}` : `${mode} · ${nights}`;

  // Narrow frames (oval / hex / octagon) have less room for the name.
  const city = stampText(s.city, s.shape === 'oval' || s.shape === 'hex' || s.shape === 'octagon' ? 12 : 15);
  const track = trackFor(city.length);
  if (frame.arc) {
    const tight = s.shape === 'double';
    return `
      <path id="${arcId}" d="M 60 60 m -37 0 a 37 37 0 1 1 74 0" fill="none"/>
      <text class="pp-t pp-md" font-size="${fontFor(city.length, 11)}" letter-spacing="${track}"><textPath href="#${arcId}" startOffset="50%" text-anchor="middle">${esc(city)}</textPath></text>
      <text x="60" y="${tight ? 57 : 59}" class="pp-t pp-xl" text-anchor="middle" font-size="${tight ? 15 : 17}">${esc(date)}</text>
      <text x="60" y="${tight ? 68 : 71}" class="pp-t pp-sm" text-anchor="middle" letter-spacing="1.2">${esc(year)}</text>
      <text x="60" y="${tight ? 80 : 85}" class="pp-t pp-xs" text-anchor="middle" letter-spacing=".8">${esc(tail)}</text>`;
  }
  return `
    <text x="60" y="45" class="pp-t pp-md" text-anchor="middle" font-size="${fontFor(city.length, 12)}" letter-spacing="${track}">${esc(city)}</text>
    <text x="60" y="68" class="pp-t pp-xl" text-anchor="middle">${esc(date)}</text>
    <text x="60" y="80" class="pp-t pp-sm" text-anchor="middle" letter-spacing="1.2">${esc(year)}</text>
    <text x="60" y="91" class="pp-t pp-xs" text-anchor="middle" letter-spacing=".8">${esc(tail)}</text>`;
}

/** The stamp as an inline-SVG wrapper. Returns '' for an empty spec. */
export function renderStamp(s: StampSpec, o: StampRenderOpts = {}): string {
  if (s.kind === 'country') return renderCountryStamp(s, o);
  ensureStampDefs();
  const size = o.size ?? 110;
  const frame = frameFor(s.shape);
  const arcId = `pp-arc-${nextUid()}`;
  const label = `${s.city}, ${s.country}, ${s.date}`;
  const cls = ['pp-stamp', s.earned ? '' : 'is-ghost', o.pressed ? 'is-pressed' : '', o.className ?? ''].filter(Boolean).join(' ');
  return `<span class="${cls}" data-shape="${s.shape}" style="--ink-c:${esc(s.ink)};--rot:${s.rotation}deg;--sz:${size}px" role="img" aria-label="${esc(label)}">
    <svg viewBox="0 0 120 120" width="${size}" height="${size}" focusable="false" aria-hidden="true">
      <g filter="url(#pp-ink)">${frame.frame}${inner(s, arcId, frame)}</g>
    </svg></span>`;
}
