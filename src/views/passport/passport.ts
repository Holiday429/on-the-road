/* ==========================================================================
   On the Road · Passport
   --------------------------------------------------------------------------
   The traveller's passport: every stop earns a stamp, the first stop in each
   country an entry stamp. A drawer shows them as passport pages; small
   sticker versions sit on Itinerary cards and the Dashboard banner.

   Stamps are derived from the route (data/stamps.ts) — nothing is stored but
   which ones have already been watched getting pressed (data/stamp-seen.ts).
   Drawing lives in the paper kit (core/paper/stamp.ts).
   ========================================================================== */

import './passport.css';
import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { navigateTo } from '../../core/app.ts';
import { t } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { renderStamp } from '../../core/paper/stamp.ts';
import { routeStore } from '../../data/stores/route-store.ts';
import { currentTrip } from '../../data/trip-context.ts';
import { todayIso } from '../../data/trip-phase.ts';
import { passportSummary, stampsFor, type StampLeg } from '../../data/stamps.ts';
import { markStampsSeen, unseenStamps } from '../../data/stamp-seen.ts';
import { hashStr } from '../../data/palette.ts';
import type { StampSpec } from '../../core/paper/stamp.ts';

/** Stamps per passport page. */
export const SLOTS_PER_PAGE = 4;

/** Splits stamps into pages (the last page may be part-empty). */
export function paginate<T>(items: T[], per = SLOTS_PER_PAGE): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += per) pages.push(items.slice(i, i + per));
  return pages;
}

function slotHtml(s: StampSpec, i: number, press: boolean): string {
  const h = hashStr(s.id);
  const dx = (h % 13) - 6;
  const dy = ((h >> 4) % 11) - 5;
  const legId = s.id.startsWith('city:') ? s.id.slice(5) : '';
  return `<button type="button" class="pp-slot${s.earned ? '' : ' is-ghost'}" data-stamp="${esc(s.id)}"${legId ? ` data-leg="${esc(legId)}"` : ''} style="--dx:${dx}px;--dy:${dy}px;--delay:${i * 120}ms">${renderStamp(s, { size: 150, pressed: press && s.earned })}</button>`;
}

function bookHtml(stamps: StampSpec[], tripName: string, fresh: Set<string>): string {
  const sum = passportSummary(stamps);
  const pages = paginate(stamps);
  const pct = sum.total ? Math.round((sum.earned / sum.total) * 100) : 0;
  let n = 0;
  return `
    <div class="pp-book">
      <div class="pp-cover">
        <div class="pp-cover-emblem" aria-hidden="true">🛂</div>
        <div class="pp-cover-text">
          <div class="pp-cover-name">${esc(tripName)}</div>
          <div class="pp-cover-count">${esc(t('passport.summary', { n: sum.earned, c: sum.countries }))}</div>
          <div class="pp-cover-bar" role="img" aria-label="${pct}%"><span style="width:${pct}%"></span></div>
          ${sum.total > sum.earned ? `<div class="pp-cover-more">${esc(t('passport.toCome', { n: sum.total - sum.earned }))}</div>` : ''}
        </div>
      </div>
      ${pages.map((p, pi) => `
        <section class="pp-page" data-page="${pi + 1}" aria-label="${esc(t('passport.page', { n: pi + 1 }))}">
          ${p.map((s) => slotHtml(s, n++, fresh.has(s.id))).join('')}
        </section>`).join('')}
    </div>`;
}

function legsNow(): StampLeg[] {
  return routeStore.peek() as unknown as StampLeg[];
}

export interface PassportOptions {
  /** Scroll this stamp into view (a stamp id, e.g. `city:<legId>`). */
  focusId?: string;
  returnFocus?: HTMLElement | null;
}

export function openPassport(opts: PassportOptions = {}): void {
  const stamps = stampsFor(legsNow(), todayIso());
  const tripName = currentTrip()?.name ?? '';
  const earnedIds = stamps.filter((s) => s.earned).map((s) => s.id);
  const fresh = new Set(unseenStamps(earnedIds));

  const body = stamps.length
    ? bookHtml(stamps, tripName, fresh)
    : `<div class="pp-empty">${esc(t('passport.empty'))}</div>`;
  const d = openDrawer({ title: t('passport.title'), subtitle: tripName || undefined, body, className: 'pp-drawer', returnFocus: opts.returnFocus });
  // Everything on screen has now been pressed once.
  markStampsSeen(earnedIds);

  d.body.addEventListener('click', (e) => {
    const slot = (e.target as HTMLElement).closest<HTMLElement>('.pp-slot[data-leg]');
    if (!slot) return;
    closeDrawer();
    navigateTo('route', { legId: slot.dataset.leg! });
  });
  if (opts.focusId) {
    const el = [...d.body.querySelectorAll<HTMLElement>('.pp-slot')].find((x) => x.dataset.stamp === opts.focusId);
    el?.scrollIntoView({ block: 'center' });
  }
}

/* ── Small pieces used elsewhere ─────────────────────────────────────────── */

/** A stamp on a little paper sticker — legible on top of a photo. */
export function stampSticker(s: StampSpec, size: number, opts: { open?: boolean; pressed?: boolean } = {}): string {
  const inner = renderStamp(s, { size, pressed: opts.pressed });
  return opts.open === false
    ? `<span class="pp-sticker">${inner}</span>`
    : `<button type="button" class="pp-sticker" data-open-passport="${esc(s.id)}" title="${esc(t('passport.open'))}" aria-label="${esc(t('passport.open'))}">${inner}</button>`;
}

/** The slim "Passport · 12 stamps — Open ›" row at the top of the Itinerary list. */
export function passportStrip(legs: StampLeg[]): string {
  const stamps = stampsFor(legs, todayIso());
  if (!stamps.length) return '';
  const sum = passportSummary(stamps);
  return `<button type="button" class="pp-strip" data-open-passport="">
    <span class="pp-strip-emblem" aria-hidden="true">🛂</span>
    <span class="pp-strip-text"><strong>${esc(t('passport.title'))}</strong> · ${esc(t('passport.summary', { n: sum.earned, c: sum.countries }))}</span>
    <span class="pp-strip-go" aria-hidden="true">›</span>
  </button>`;
}

/** Opens the passport from any element carrying data-open-passport inside `root`. */
export function wirePassportOpeners(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-open-passport]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openPassport({ focusId: el.dataset.openPassport || undefined, returnFocus: el });
    });
  });
}
