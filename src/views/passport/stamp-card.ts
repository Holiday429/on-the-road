/* ==========================================================================
   On the Road · Passport — the back of a stamp
   --------------------------------------------------------------------------
   Tap a stamp and it lifts off the page and turns over: the back is what that
   country was — the cities, the nights, the journal entries and photos, what
   was spent — for this trip and over every trip. All numbers come from
   data/country-memory.ts.
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import { escHtml as esc, safeUrl } from '../../core/utils.ts';
import { renderStamp } from '../../core/paper/stamp.ts';
import { stampDate } from '../../core/paper/stamp-base.ts';
import { currencySymbol } from '../../data/rates.ts';
import type { CountryMemory } from '../../data/country-memory.ts';

export interface CardActions {
  onMap: (iso: string) => void;
  /** Present only for a trip that is still around. */
  onJournal?: () => void;
  onClose: () => void;
}

function money(currency: string, n: number, locale: string): string {
  return `${currencySymbol(currency)}${Math.round(n).toLocaleString(locale)}`;
}

function dateRange(a: string, b: string): string {
  const y = (iso: string) => iso.slice(0, 4);
  return a === b ? `${stampDate(a)} ${y(a)}` : `${stampDate(a)} – ${stampDate(b)} ${y(b)}`;
}

export function cardHtml(m: CountryMemory, locale: string): string {
  const s = m.stamp;
  const row = (label: string, value: string) => `<div class="pp-card-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  const photos = m.covers.map((u) => safeUrl(u)).filter(Boolean)
    .map((u) => `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer">`).join('');
  const spend = m.spend.map((l) => money(l.currency, l.total, locale)).join(' · ');
  const showTotal = m.total.trips > 1;
  return `<div class="pp-card-scrim" data-pp-card-close data-no-turn>
    <div class="pp-card" role="dialog" aria-modal="true" aria-label="${esc(s.country)}">
      <div class="pp-card-stamp">${renderStamp(s, { size: 200 })}</div>
      <div class="pp-card-body">
        <div class="pp-card-title">${esc(s.country)}</div>
        <div class="pp-card-sub">${esc([s.tripName, dateRange(m.trip.dateFrom, m.trip.dateTo)].filter(Boolean).join(' · '))}${s.orphan ? ` · ${esc(t('passport.deletedTrip'))}` : ''}</div>
        <dl class="pp-card-rows">
          ${m.trip.cities.length ? row(t('passport.card.cities'), esc(m.trip.cities.join(' · '))) : ''}
          ${row(t('passport.card.nights'), esc(String(m.trip.nights)))}
          ${showTotal ? row(t('passport.card.total'), esc(t('passport.card.totalValue', { n: m.total.nights, k: m.total.trips }))) : ''}
          ${m.journalCount ? row(t('passport.card.journal'), esc(String(m.journalCount))) : ''}
          ${spend ? row(t('passport.card.spent'), esc(spend)) : ''}
        </dl>
        ${photos ? `<div class="pp-card-photos">${photos}</div>` : ''}
        <div class="pp-card-actions">
          ${s.iso ? `<button type="button" class="btn btn-primary" data-pp-card-map="${esc(s.iso)}">${esc(t('passport.onMap'))}</button>` : ''}
          ${m.journalCount ? `<button type="button" class="btn btn-ghost" data-pp-card-journal>${esc(t('passport.card.openJournal'))}</button>` : ''}
          <button type="button" class="btn btn-ghost" data-pp-card-close>${esc(t('common.close'))}</button>
        </div>
      </div>
    </div>
  </div>`;
}

/** Shows the card inside `host` (the desk); returns a function that closes it. */
export function openStampCard(host: HTMLElement, m: CountryMemory, locale: string, a: CardActions): () => void {
  const wrap = document.createElement('div');
  // eslint-disable-next-line no-restricted-syntax -- audited: cardHtml escapes every interpolation
  wrap.innerHTML = cardHtml(m, locale);
  const scrim = wrap.firstElementChild as HTMLElement;
  host.appendChild(scrim);
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey, true); a.onClose(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    const map = el.closest<HTMLElement>('[data-pp-card-map]');
    if (map) { close(); a.onMap(map.dataset.ppCardMap!); return; }
    if (el.closest('[data-pp-card-journal]')) { close(); a.onJournal?.(); return; }
    if (el === scrim || el.closest('button[data-pp-card-close]')) close();
  });
  scrim.querySelector<HTMLElement>('.btn-primary, button')?.focus({ preventScroll: true });
  return close;
}
