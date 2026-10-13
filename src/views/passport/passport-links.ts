/* ==========================================================================
   On the Road · Passport — entry points
   --------------------------------------------------------------------------
   The light half of the passport: everything other pages need to point at it
   (open it, show its pocket card, wear a sticker) without loading the book
   itself, which is a lazy view (passport.ts) behind the `#passport` route.
   ========================================================================== */

import './passport-links.css';
import { navigateTo, type NavIntent } from '../../core/app.ts';
import { t } from '../../core/i18n.ts';
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
export function pocketHtml(p: PassportFeed): string {
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
  const warn = p.warnings.length ? `<span class="pp-pocket-warn" title="${esc(t(`passport.doc.warn.${p.warnings[0].kind}`, { trip: p.warnings[0].tripName, date: p.warnings[0].expires }))}">⚠</span>` : '';
  return `<button type="button" class="pp-pocket" data-open-passport="">
    <span class="pp-pocket-cover" aria-hidden="true">🛂</span>
    <span class="pp-pocket-text"><strong>${esc(t('passport.title'))}</strong> · ${text}</span>${pending}${warn}
    <span class="pp-pocket-dots" aria-hidden="true">${dots}</span>
    <span class="pp-pocket-go" aria-hidden="true">›</span>
  </button>`;
}

/** Keeps a host element showing the live pocket card; stops listening once the host leaves the page. */
export function mountPassportPocket(host: HTMLElement): void {
  let off: (() => void) | null = null;
  off = onPassport((p) => {
    if (!host.isConnected && off) { off(); off = null; return; }
    // eslint-disable-next-line no-restricted-syntax -- audited: pocketHtml escapes every interpolation
    host.innerHTML = pocketHtml(p);
    wirePassportOpeners(host);
  });
}

/** Mounts every `[data-pp-pocket]` inside `root`. */
export function mountPassportPockets(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-pp-pocket]').forEach(mountPassportPocket);
}
