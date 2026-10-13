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
import { mrz, passportNumber } from './bio.ts';
import type { BookPage, StampPage } from './book.ts';

export interface PageCtx {
  data: PassportData;
  nickname: string;
  nationality: string;
  photoUrl: string;
  uid: string;
  /** First stamp date, or today when there are none. */
  issued: string;
  /** Stamp ids not yet seen on this device: they stay hidden until their page is turned to, then land with the "thunk". */
  fresh: ReadonlySet<string>;
  locale: string;
  /** 1-based number of a book page for the page footer; 0 = none. */
  pageNo: (p: BookPage) => number;
}

function stat(n: number, label: string): string {
  return `<div class="pp-stat"><div class="pp-stat-n">${n.toLocaleString()}</div><div class="pp-stat-l">${esc(label)}</div></div>`;
}

function emblem(): string {
  return `<svg class="pp-emblem" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <circle cx="32" cy="32" r="22"/><ellipse cx="32" cy="32" rx="9" ry="22"/><path d="M10 32h44M14 20h36M14 44h36"/>
    <path d="M32 4v6M32 54v6M4 32h6M54 32h6"/></svg>`;
}

function cover(c: PageCtx): string {
  return `<div class="pp-cover-face">
    <div class="pp-cover-frame">
      ${emblem()}
      <div class="pp-cover-title">${esc(t('passport.cover.title'))}</div>
      <div class="pp-cover-rule"></div>
      <div class="pp-cover-name">${esc(c.nickname)}</div>
      <div class="pp-cover-count">${esc(t('passport.summary', { n: c.data.stamps.length, c: c.data.countries }))}</div>
    </div>
    <div class="pp-cover-hint">${esc(t('passport.cover.hint'))}</div>
  </div>`;
}

function inside(c: PageCtx): string {
  const d = c.data;
  return `<div class="pp-sheet pp-inside">
    <div class="pp-kicker">${esc(t('passport.inside.kicker'))}</div>
    <div class="pp-inside-title">${esc(c.nickname)}</div>
    <div class="pp-stats">
      ${stat(d.countries, t('passport.stat.countries'))}${stat(d.cities, t('passport.stat.cities'))}
      ${stat(d.nights, t('passport.stat.nights'))}${stat(d.trips, t('passport.stat.trips'))}
    </div>
    <button type="button" class="btn btn-ghost pp-inside-map" data-pp-map data-no-turn>${esc(t('passport.onMap'))}</button>
  </div>`;
}

function bio(c: PageCtx): string {
  const [l1, l2] = mrz({ nickname: c.nickname, nationality: c.nationality, uid: c.uid }, c.issued);
  const nat = c.nationality
    ? `${nationalityFlag(c.nationality)} ${esc(nationalityLabel(c.nationality))}`
    : '—';
  const photo = c.photoUrl
    ? `<img src="${esc(c.photoUrl)}" alt="" referrerpolicy="no-referrer" draggable="false">`
    : `<span class="pp-photo-fallback" aria-hidden="true">${esc([...c.nickname][0]?.toUpperCase() ?? '?')}</span>`;
  const row = (label: string, value: string) =>
    `<div class="pp-field"><div class="pp-field-l">${esc(label)}</div><div class="pp-field-v">${value}</div></div>`;
  return `<div class="pp-sheet pp-bio">
    <div class="pp-bio-head"><span>${esc(t('passport.cover.title'))}</span><span class="pp-bio-no">N° ${esc(passportNumber(c.uid))}</span></div>
    <div class="pp-bio-main">
      <div class="pp-photo">${photo}</div>
      <div class="pp-fields">
        ${row(t('passport.bio.nickname'), esc(c.nickname))}
        ${row(t('passport.bio.nationality'), nat)}
        ${row(t('passport.bio.occupation'), esc(t('passport.bio.traveller')))}
        ${row(t('passport.bio.issued'), esc(c.issued))}
      </div>
    </div>
    <div class="pp-sign"><span class="pp-sign-l">${esc(t('passport.bio.signature'))}</span><span class="pp-sign-line"></span></div>
    <div class="pp-mrz" aria-hidden="true"><div>${esc(l1)}</div><div>${esc(l2)}</div></div>
  </div>`;
}

function visas(): string {
  return `<div class="pp-sheet pp-visas">
    <div class="pp-page-head"><span>${esc(t('passport.visas.title'))}</span></div>
    <div class="pp-note">${esc(t('passport.visas.empty'))}</div>
  </div>`;
}

function stampsPage(p: StampPage, c: PageCtx): string {
  const items = p.items.map((i) => {
    const st = { ...i.stamp, rotation: i.rot, pressure: i.pressure };
    return `<span class="pp-slot" data-stamp="${esc(i.stamp.id)}"${c.fresh.has(i.stamp.id) ? ' data-fresh' : ''} style="left:${i.x.toFixed(1)}%;top:${i.y.toFixed(1)}%">${renderStamp(st, { size: 160 })}</span>`;
  }).join('');
  const range = p.items.length ? `${stampDate(p.items[0].stamp.date)} – ${stampDate(p.items[p.items.length - 1].stamp.date)}` : '';
  return `<div class="pp-sheet pp-stamps">
    <div class="pp-page-head"><span>${esc(p.tripName || t('passport.stamps.title'))}</span><span class="pp-page-range">${esc(range)}</span></div>
    ${p.items.length ? `<div class="pp-field-area">${items}</div>` : `<div class="pp-note">${esc(t('passport.empty'))}</div>`}
    <div class="pp-page-no">${c.pageNo(p) || ''}</div>
  </div>`;
}

function back(c: PageCtx): string {
  return `<div class="pp-sheet pp-backpage">
    <div class="pp-note">${esc(t('passport.back.note'))}</div>
    <button type="button" class="btn btn-primary" data-pp-map data-no-turn>${esc(t('passport.back.map'))}</button>
    <div class="pp-backpage-sub">${esc(t('passport.summary', { n: c.data.stamps.length, c: c.data.countries }))}</div>
  </div>`;
}

/** The inside of a face for this page. */
export function pageHtml(p: BookPage | null, c: PageCtx): string {
  if (!p) return '<div class="pp-sheet pp-blank"></div>';
  switch (p.kind) {
    case 'cover': return cover(c);
    case 'inside': return inside(c);
    case 'bio': return bio(c);
    case 'visas': return visas();
    case 'stamps': return stampsPage(p, c);
    case 'back': return back(c);
  }
}
