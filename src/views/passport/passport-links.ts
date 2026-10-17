/* ==========================================================================
   On the Road · Passport — entry points
   --------------------------------------------------------------------------
   The light half of the passport: everything other pages need to point at it
   (open it, show its pocket card, wear a sticker) without loading the book
   itself, which is a lazy view (passport.ts) behind the `#passport` route.
   ========================================================================== */

import './passport-links.css';
import { navigateTo, type NavIntent } from '../../core/app.ts';
import { t, getLocale } from '../../core/i18n.ts';
import { regionLabel } from '../../data/visa.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { renderStamp, type StampSpec } from '../../core/paper/stamp.ts';
import { onPassport } from '../../data/passport-feed.ts';
import type { PassportFeed } from '../../data/passport-state.ts';

/** What to open the book on: a stamp id, a stop (its country's stamp) or a country. */
export interface PassportTarget {
  stamp?: string;
  legId?: string;
  iso?: string;
}

export function openPassport(target: PassportTarget = {}): void {
  const intent: NavIntent = {};
  if (target.stamp) intent.stamp = target.stamp;
  if (target.legId) intent.legId = target.legId;
  if (target.iso) intent.iso = target.iso;
  void navigateTo('passport', intent);
}

/** `data-open-passport` carries a stamp id (`country:…`), a stop (`city:<legId>`) or nothing. */
export function targetFromAttr(v: string): PassportTarget {
  if (v.startsWith('city:')) return { legId: v.slice(5) };
  if (v.startsWith('country:')) return { stamp: v };
  return {};
}

/** Opens the passport from any element carrying data-open-passport inside `root`. */
export function wirePassportOpeners(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-open-passport]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openPassport(targetFromAttr(el.dataset.openPassport ?? ''));
    });
  });
  root.querySelectorAll<HTMLElement>('[data-open-atlas]').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); void navigateTo('atlas'); });
  });
}

/** A stamp on a little paper sticker — legible on top of a photo. */
export function stampSticker(s: StampSpec, size: number, opts: { open?: boolean; pressed?: boolean } = {}): string {
  const inner = renderStamp(s, { size, pressed: opts.pressed });
  return opts.open === false
    ? `<span class="pp-sticker">${inner}</span>`
    : `<button type="button" class="pp-sticker" data-open-passport="${esc(s.id)}" title="${esc(t('passport.open'))}" aria-label="${esc(t('passport.open'))}">${inner}</button>`;
}

/* ── Pocket card ─────────────────────────────────────────────────────────── */

const MAX_DOTS = 14;

/** The slim "Passport · 9 countries" row that opens the book. Empty passport: an invitation. */
export function pocketHtml(p: PassportFeed, withAtlas = false): string {
  const seen = new Set<string>();
  const dots = p.stamps
    .filter((s) => { const k = s.iso || s.country; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, MAX_DOTS)
    .map((s) => `<i style="--ink-c:${esc(s.ink)}" title="${esc(s.country)}"></i>`).join('');
  const text = p.stamps.length
    ? esc(t('passport.summary', { n: p.stamps.length, c: p.countries }))
    : esc(t('passport.pocket.empty'));
  const pending = p.pending.length
    ? `<span class="pp-pocket-badge">${esc(t('passport.pocket.pending', { n: p.pending.length }))}</span>`
    : '';
  const vw = p.visaWarnings[0];
  const warnText = p.warnings.length
    ? t(`passport.doc.warn.${p.warnings[0].kind}`, { trip: p.warnings[0].tripName, date: p.warnings[0].expires })
    : vw ? t(`passport.visa.warn.${vw.kind}`, { region: regionLabel(vw.region, getLocale(), t('passport.visa.schengen')), trip: vw.tripName, date: vw.date, days: String(vw.days ?? '') }) : '';
  const warn = warnText ? `<span class="pp-pocket-warn" title="${esc(warnText)}">⚠</span>` : '';
  const passport = `<button type="button" class="pp-pocket" data-open-passport="">
    <span class="pp-pocket-cover" aria-hidden="true">🛂</span>
    <span class="pp-pocket-text"><strong>${esc(t('passport.title'))}</strong> · ${text}</span>${pending}${warn}
    <span class="pp-pocket-dots" aria-hidden="true">${dots}</span>
    <span class="pp-pocket-go" aria-hidden="true">›</span>
  </button>`;
  return withAtlas ? `<div class="pp-pockets">${passport}${atlasPocketHtml(p)}</div>` : passport;
}

/** The matching row for the globe: where the passport records stamps, the Atlas shows the ground they cover. */
export function atlasPocketHtml(p: PassportFeed): string {
  const text = p.countries
    ? esc(t('atlas.pocket', { c: p.countries, n: p.cities }))
    : esc(t('atlas.pocket.empty'));
  return `<button type="button" class="pp-pocket pp-pocket-atlas" data-open-atlas>
    <span class="pp-pocket-cover pp-atlas-cover" aria-hidden="true">🌍</span>
    <span class="pp-pocket-text"><strong>${esc(t('atlas.title'))}</strong> · ${text}</span>
    <span class="pp-pocket-go" aria-hidden="true">›</span>
  </button>`;
}

/** Keeps a host element showing the live pocket card; stops listening once the host leaves the page. */
export function mountPassportPocket(host: HTMLElement, withAtlas = false): void {
  let off: (() => void) | null = null;
  off = onPassport((p) => {
    if (!host.isConnected && off) { off(); off = null; return; }
    // eslint-disable-next-line no-restricted-syntax -- audited: pocketHtml escapes every interpolation
    host.innerHTML = pocketHtml(p, withAtlas);
    wirePassportOpeners(host);
  });
}

/** Mounts every `[data-pp-pocket]` inside `root`. */
export function mountPassportPockets(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-pp-pocket]').forEach((el) => mountPassportPocket(el));
}

/* ── Icon button ─────────────────────────────────────────────────────────── */

/** The passport as a single icon (Itinerary's action row). A dot when stamps wait to be pressed or a document needs attention. */
export function passportIconHtml(p: PassportFeed): string {
  const attention = p.pending.length > 0 || p.warnings.length > 0 || p.visaWarnings.length > 0;
  const label = esc(t('passport.open'));
  return `<button type="button" class="pp-icon-btn${attention ? ' has-pending' : ''}" data-open-passport="" title="${label}" aria-label="${label}">
    <span class="pp-icon-cover" aria-hidden="true">🛂</span>
  </button>`;
}

/** Keeps `host` showing the live passport icon; stops listening once the host leaves the page. */
export function mountPassportIcon(host: HTMLElement): void {
  let off: (() => void) | null = null;
  off = onPassport((p) => {
    if (!host.isConnected && off) { off(); off = null; return; }
    // eslint-disable-next-line no-restricted-syntax -- audited: passportIconHtml escapes every interpolation
    host.innerHTML = passportIconHtml(p);
    wirePassportOpeners(host);
  });
}
