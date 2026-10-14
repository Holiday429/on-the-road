/* ==========================================================================
   On the Road · Passport — page markup
   --------------------------------------------------------------------------
   One function per kind of page; each returns the inside of a .pp-face. Pure
   string building from a plain `PageCtx`, so the view owns the data and the
   DOM and this file owns how a passport page looks.
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { renderStamp } from '../../core/paper/stamp.ts';
import { stampDate } from '../../core/paper/stamp-base.ts';
import { nationalityFlag, nationalityLabel } from '../../data/nationalities.ts';
import type { PassportData } from '../../data/passport.ts';
import { barcodeBars, mrz, passportNumber, travelLevel } from './bio.ts';
import { isSafePath } from './signature.ts';
import { VISAS_PER_PAGE, type BookPage, type StampPage } from './book.ts';
import { countryInk } from '../../data/country-ink.ts';
import { SCHENGEN_REGION, regionFlag, regionLabel, type SchengenUsage } from '../../data/visa.ts';
import type { Visa } from '../../data/schema/visa.ts';
import { maskNumber } from './bio.ts';
import { dotMapSvg } from '../../data/dot-map.ts';
import type { PassportCover } from '../../data/schema.ts';

export interface PageCtx {
  data: PassportData;
  nickname: string;
  nationality: string;
  /** '' = "Traveller". */
  occupation: string;
  /** Stored signature path data, '' = unsigned. */
  signature: string;
  photoUrl: string;
  uid: string;
  /** First stamp date, or today when there are none. */
  issued: string;
  /** Stamp ids just pressed: they stay hidden until their page is showing, then land with the "thunk". */
  fresh: ReadonlySet<string>;
  locale: string;
  visas: readonly Visa[];
  /** Per visa: what it was used for and what does not fit it (already translated). */
  visaNotes: ReadonlyMap<string, { uses: string; warns: string[] }>;
  schengen: SchengenUsage | null;
  /** 1-based number of a book page for the page footer; 0 = none. */
  pageNo: (p: BookPage) => number;
  /** How the traveller dressed the booklet (cover face and back cover). */
  cover: PassportCover;
  /** Stamps pressed onto pages so far (of `data.stamps.length` earned). */
  pressed: number;
}

function stat(n: number, label: string): string {
  return `<div class="pp-stat"><div class="pp-stat-n">${n.toLocaleString()}</div><div class="pp-stat-l">${esc(label)}</div></div>`;
}

/** Neutral marks only — never a national emblem. Strokes and fills are the cover's foil colour. */
const EMBLEMS: Record<PassportCover['emblem'], string> = {
  globe: '<circle cx="32" cy="32" r="22"/><ellipse cx="32" cy="32" rx="9" ry="22"/><path d="M10 32h44M14 20h36M14 44h36"/><path d="M32 4v6M32 54v6M4 32h6M54 32h6"/>',
  compass: '<circle cx="32" cy="32" r="22"/><path d="M32 12l5 20-5 20-5-20z"/><path d="M12 32l20-5 20 5-20 5z"/><circle class="f" cx="32" cy="32" r="2.6"/><path d="M32 4v6M32 54v6M4 32h6M54 32h6"/>',
  route: '<path d="M14 50C14 36 50 40 50 26S28 18 28 18" stroke-dasharray="4 4"/><circle class="f" cx="14" cy="50" r="3.6"/><path class="f" d="M28 18l5-4v8z"/><circle cx="32" cy="32" r="27" stroke-dasharray="1 5"/>',
  sign: '<rect x="12" y="14" width="40" height="24" rx="3"/><path d="M20 26h20m0 0l-5-4m5 4l-5 4"/><path d="M32 38v20"/><path d="M24 58h16"/>',
};

export function emblemSvg(kind: PassportCover['emblem']): string {
  return `<svg class="pp-emblem" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${EMBLEMS[kind]}</svg>`;
}

function cover(c: PageCtx): string {
  return `<div class="pp-cover-face">
    <div class="pp-cover-frame">
      ${emblemSvg(c.cover.emblem)}
      <div class="pp-cover-title">${esc(c.cover.title || t('passport.cover.title'))}</div>
      <div class="pp-cover-rule"></div>
      <div class="pp-cover-name">${esc(c.nickname)}</div>
      <div class="pp-cover-count">${esc(t('passport.summary', { n: c.data.stamps.length, c: c.data.countries }))}</div>
    </div>
    <div class="pp-cover-hint">${esc(t('passport.cover.hint'))}</div>
  </div>`;
}

/** The outside of the back of the booklet: the same cloth, the same foil, a barcode strip and a blind-embossed mark. */
function backCover(c: PageCtx): string {
  const bars = barcodeBars(c.uid).map(([w, o]) => `<i style="width:${(w * 0.5).toFixed(1)}cqw;opacity:${(o / 130).toFixed(2)}"></i>`).join('');
  return `<div class="pp-cover-face is-back-cover">
    <div class="pp-backcover-code"><div class="pp-barcode" aria-hidden="true">${bars}</div><div class="pp-backcover-no">${esc(passportNumber(c.uid))} · OTR</div></div>
    <div class="pp-backcover-emboss"><span>ON THE ROAD</span><i></i><span>EST. ${esc(c.issued.slice(0, 4))}</span></div>
    <div class="pp-backcover-note">${esc(t('passport.back.disclaimer'))}</div>
  </div>`;
}

/** Left page of the first spread: whose book this is, and what it adds up to. */
function inside(c: PageCtx): string {
  const d = c.data;
  const total = d.stamps.length;
  const pct = total ? Math.min(1, c.pressed / total) : 0;
  const R = 46;
  const circ = 2 * Math.PI * R;
  const level = travelLevel(d.countries);
  const last = d.stamps[d.stamps.length - 1];
  const isos = d.stamps.map((s) => s.iso);
  return `<div class="pp-sheet pp-inside">
    <div class="pp-page-head"><span>${esc(t('passport.record.title'))}</span><span class="pp-page-range">${esc(t('passport.inside.kicker'))}</span></div>
    <div class="pp-inside-title">${esc(c.nickname)}</div>
    <div class="pp-record">
      <div class="pp-ring" role="img" aria-label="${c.pressed} / ${total}">
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="pp-ring-track" cx="60" cy="60" r="${R}"/><circle class="pp-ring-fill" cx="60" cy="60" r="${R}" stroke-dasharray="${(circ * pct).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 60 60)"/><circle class="pp-ring-dash" cx="60" cy="60" r="36"/></svg>
        <div class="pp-ring-label"><strong>${c.pressed}/${total}</strong><span>${esc(t('passport.record.collected'))}</span></div>
      </div>
      <div class="pp-level">
        <span class="pp-field-l">${esc(t('passport.level'))}</span>
        <div class="pp-level-name"><b>0${level}</b>${esc(t(`passport.level.${level}`))}</div>
        <div class="pp-level-bar" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => `<i${n <= level ? ' class="is-on"' : ''}></i>`).join('')}</div>
      </div>
    </div>
    <div class="pp-stats">
      ${stat(d.countries, t('passport.stat.countries'))}${stat(d.cities, t('passport.stat.cities'))}
      ${stat(d.nights, t('passport.stat.nights'))}${stat(d.trips, t('passport.stat.trips'))}
    </div>
    <div class="pp-dotmap-box">
      <div class="pp-dotmap-head"><span class="pp-field-l">${esc(t('passport.record.visited'))}</span><span class="pp-dotmap-n">${d.countries}</span></div>
      ${dotMapSvg(isos)}
    </div>
    ${last ? `<div class="pp-latest"><span class="pp-field-l">${esc(t('passport.record.latest'))}</span>
      <span class="pp-latest-v">${esc(last.country)} · ${esc(fullDate(last.date))}</span>
      ${last.tripName ? `<span class="pp-latest-trip">${esc(last.tripName)}</span>` : ''}</div>` : ''}
  </div>`;
}

/** Right page of the first spread: the data page — portrait, details, signature, machine-readable lines. */
function bio(c: PageCtx): string {
  const [l1, l2] = mrz({ nickname: c.nickname, nationality: c.nationality, uid: c.uid }, c.issued);
  const nat = c.nationality
    ? `${nationalityFlag(c.nationality)} ${esc(nationalityLabel(c.nationality))}`
    : '—';
  const initial = esc([...c.nickname][0]?.toUpperCase() ?? '?');
  const photo = c.photoUrl
    ? `<img src="${esc(c.photoUrl)}" alt="" referrerpolicy="no-referrer" draggable="false">`
    : `<span class="pp-photo-fallback" aria-hidden="true">${initial}</span>`;
  const row = (label: string, value: string, cls = '') =>
    `<div class="pp-field ${cls}"><div class="pp-field-l">${esc(label)}</div><div class="pp-field-v">${value}</div></div>`;
  return `<div class="pp-sheet pp-bio">
    <svg class="pp-guilloche" viewBox="0 0 220 220" aria-hidden="true" focusable="false">${guilloche(220, 22)}</svg>
    <div class="pp-bio-head"><span class="pp-bio-title">${esc(t('passport.cover.title'))}</span><span class="pp-bio-no">N° ${esc(passportNumber(c.uid))}</span></div>
    <div class="pp-bio-main">
      <div class="pp-bio-side">
        <div class="pp-photo">${photo}</div>
        <div class="pp-photo is-ghost" aria-hidden="true">${photo}</div>
      </div>
      <div class="pp-fields">
        ${row(t('passport.bio.nickname'), esc(c.nickname), 'is-name')}
        ${row(t('passport.bio.nationality'), nat)}
        ${row(t('passport.bio.occupation'), esc(c.occupation || t('passport.bio.traveller')))}
        <div class="pp-field-pair">
          ${row(t('passport.bio.issued'), esc(c.issued))}
          ${row(t('passport.bio.number'), esc(passportNumber(c.uid)))}
        </div>
        <div class="pp-field-pair is-trio">
          ${row(t('passport.bio.type'), 'P')}${row(t('passport.bio.code'), 'OTR')}${row(t('passport.bio.authority'), 'ON THE ROAD')}
        </div>
      </div>
    </div>
    <div class="pp-sign"><div class="pp-sign-top"><span class="pp-sign-l">${esc(t('passport.bio.signature'))}</span>
      <button type="button" class="btn btn-ghost pp-bio-edit" data-pp-edit data-no-turn>${esc(t('passport.edit.open'))}</button></div>
      <span class="pp-sign-line">${
        c.signature && isSafePath(c.signature) ? `<svg viewBox="0 0 300 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><path d="${esc(c.signature)}"/></svg>` : ''
      }</span></div>
    <div class="pp-mrz" aria-hidden="true"><div>${esc(l1)}</div><div>${esc(l2)}</div></div>
  </div>`;
}

/** Faint security-print linework: `n` ellipses turned about a centre. */
function guilloche(size: number, n: number): string {
  const c = size / 2;
  return Array.from({ length: n }, (_, i) =>
    `<ellipse cx="${c}" cy="${c}" rx="${(c * 0.95).toFixed(1)}" ry="${(c * 0.42).toFixed(1)}" transform="rotate(${(i * 180 / n).toFixed(1)} ${c} ${c})"/>`).join('');
}

const fullDate = (iso: string): string => (iso ? `${stampDate(iso)} ${iso.slice(0, 4)}` : '—');

function visaSticker(v: Visa, c: PageCtx): string {
  const note = c.visaNotes.get(v.id);
  const label = regionLabel(v.region, c.locale, t('passport.visa.schengen'));
  const ink = v.region === SCHENGEN_REGION ? 'var(--sky-500)' : countryInk(v.region, label);
  const entries = v.entries ? t(`passport.visa.entries.${v.entries}`) : '';
  const stay = v.stayDays ? t('passport.visa.stay', { n: v.stayDays }) : '';
  const line = (l: string, val: string) => (val ? `<div class="pp-visa-line"><span>${esc(l)}</span> ${esc(val)}</div>` : '');
  return `<button type="button" class="pp-visa" data-pp-visa="${esc(v.id)}" data-no-turn style="--ink-c:${esc(ink)}">
    <div class="pp-visa-head"><span class="pp-visa-region">${regionFlag(v.region)} ${esc(label)}</span><span class="pp-visa-type">${esc(v.type || t('passport.visa.title'))}</span></div>
    ${line(t('passport.visa.valid'), `${fullDate(v.validFrom)} – ${fullDate(v.validTo)}`)}
    ${line(t('passport.visa.entries'), [entries, stay].filter(Boolean).join(' · '))}
    ${v.number ? `<div class="pp-visa-no">${esc(maskNumber(v.number))}</div>` : ''}
    ${note?.uses ? `<div class="pp-visa-used">${esc(note.uses)}</div>` : ''}
    ${(note?.warns ?? []).map((w) => `<div class="pp-visa-warn">⚠ ${esc(w)}</div>`).join('')}
  </button>`;
}

function schengenBox(u: SchengenUsage): string {
  const pct = Math.min(100, Math.round((u.used / 90) * 100));
  const over = u.overstayOn ? `<div class="pp-visa-warn">⚠ ${esc(t('passport.visa.schengenOver', { date: u.overstayOn }))}</div>` : '';
  return `<div class="pp-schengen">
    <div class="pp-schengen-head"><span>🇪🇺 ${esc(t('passport.visa.schengenCount'))}</span><strong>${u.used} / 90</strong></div>
    <div class="pp-schengen-bar" role="img" aria-label="${u.used} / 90"><span style="width:${pct}%"></span></div>
    <div class="pp-schengen-note">${esc(t('passport.visa.schengenNote', { n: u.remaining }))}</div>${over}
  </div>`;
}

function visas(p: { index: number }, c: PageCtx): string {
  const from = p.index * VISAS_PER_PAGE;
  const mine = c.visas.slice(from, from + VISAS_PER_PAGE);
  const last = from + VISAS_PER_PAGE >= c.visas.length;
  return `<div class="pp-sheet pp-visas">
    <div class="pp-page-head"><span>${esc(t('passport.visas.title'))}</span></div>
    ${p.index === 0 && c.schengen ? schengenBox(c.schengen) : ''}
    ${mine.length ? `<div class="pp-visa-list">${mine.map((v) => visaSticker(v, c)).join('')}</div>` : `<div class="pp-note">${esc(t('passport.visas.empty'))}</div>`}
    ${last ? `<button type="button" class="btn btn-ghost pp-visa-add" data-pp-visa-add data-no-turn>${esc(t('passport.visa.add'))}</button>` : ''}
  </div>`;
}

function stampsPage(p: StampPage, c: PageCtx): string {
  const items = p.items.map((i) => {
    const st = { ...i.stamp, rotation: i.rot, pressure: i.pressure };
    return `<span class="pp-slot" data-stamp="${esc(i.stamp.id)}"${c.fresh.has(i.stamp.id) ? ' data-fresh' : ''} style="left:${i.x.toFixed(1)}%;top:${i.y.toFixed(1)}%">${renderStamp(st, { size: 160 })}</span>`;
  }).join('');
  const range = p.items.length ? `${stampDate(p.items[0].stamp.date)} – ${stampDate(p.items[p.items.length - 1].stamp.date)}` : '';
  const deleted = p.items.length > 0 && p.items.every((i) => i.stamp.orphan);
  const name = (p.tripName || t('passport.stamps.title')) + (deleted ? ` · ${t('passport.deletedTrip')}` : '');
  return `<div class="pp-sheet pp-stamps" data-page-key="${esc(p.key)}">
    <div class="pp-page-head"><span>${esc(name)}</span><span class="pp-page-range">${esc(range)}</span></div>
    ${p.items.length ? `<div class="pp-field-area">${items}</div>` : `<div class="pp-note">${esc(t('passport.empty'))}</div>`}
    <div class="pp-page-no">${c.pageNo(p) || ''}</div>
  </div>`;
}

function back(c: PageCtx): string {
  return `<div class="pp-sheet pp-backpage">
    <div class="pp-note">${esc(t('passport.back.note'))}</div>
    <div class="pp-backpage-sub">${esc(t('passport.summary', { n: c.data.stamps.length, c: c.data.countries }))}</div>
  </div>`;
}

/** Ruled paper, only there to make the back cover land on the back of a sheet. */
function notes(): string {
  return `<div class="pp-sheet pp-ruled"><div class="pp-page-head"><span>${esc(t('passport.back.notes'))}</span></div></div>`;
}

/** The inside of a face for this page. */
export function pageHtml(p: BookPage | null, c: PageCtx): string {
  if (!p) return '<div class="pp-sheet pp-blank"></div>';
  switch (p.kind) {
    case 'cover': return cover(c);
    case 'inside': return inside(c);
    case 'bio': return bio(c);
    case 'visas': return visas(p, c);
    case 'stamps': return stampsPage(p, c);
    case 'back': return back(c);
    case 'notes': return notes();
    case 'backcover': return backCover(c);
  }
}
