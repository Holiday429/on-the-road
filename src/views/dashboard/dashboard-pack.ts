/* ==========================================================================
   On the Road · Dashboard — Pack widget
   --------------------------------------------------------------------------
   Always on. Near a flight with a baggage limit it shows weight vs limit;
   otherwise what you're carrying and the latest bought/lost items. The corner
   + / − log a purchase or a loss; the card opens the full change log in the
   side drawer. The model lives in data/pack-summary.ts.
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { navigateTo } from '../../core/app.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import type { PackList } from '../../data/schema.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { packSummary, packChanges, type PackChange } from '../../data/pack-summary.ts';
import { formatKg } from '../../data/packing-formula.ts';
import { openPackBagChangeModal } from './dashboard-modals.ts';

const kg = (g: number) => (g / 1000).toFixed(Math.abs(g) % 1000 === 0 ? 0 : 1);

function chip(c: PackChange): string {
  return `<span class="td-pk-chip td-pk-chip--${c.kind === 'acquired' ? 'add' : 'drop'}">${c.kind === 'acquired' ? '+' : '−'} ${esc(c.name)}</span>`;
}

export function renderPackWidget(list: PackList | null | undefined, legs: StoredLeg[], today: string): string {
  const s = packSummary(list, legs, today);
  const head = (right = '') => `
    <div class="td-widget-header">
      <div class="td-widget-label">🎒 ${esc(t('dash.widget.pack'))}</div>
      ${right}
    </div>`;

  if (s.kind === 'none') {
    return `
      <div class="td-widget td-w-pack">
        ${head()}
        <div class="td-pk-empty">${esc(t('dash.pack.empty'))}</div>
        <button type="button" class="td-link td-pk-create" data-nav="prep">${esc(t('dash.pack.create'))}</button>
      </div>`;
  }

  const buttons = legs.length ? `
    <div class="td-pk-btns">
      <button type="button" class="td-plus" data-pk-action="acquired" title="${esc(t('dash.pack.bought'))}" aria-label="${esc(t('dash.pack.bought'))}">+</button>
      <button type="button" class="td-plus td-plus--minus" data-pk-action="left" title="${esc(t('dash.pack.lost'))}" aria-label="${esc(t('dash.pack.lost'))}">−</button>
    </div>` : '';

  let body: string;
  if (s.kind === 'near') {
    const barClass = s.over ? 'is-over' : s.pct > 85 ? 'is-warn' : '';
    body = `
      <div class="td-pk-weight${s.over ? ' is-over' : ''}">${kg(s.carriedG)}<small> / ${kg(s.limitG)} kg</small></div>
      <div class="td-pk-bar"><span class="${barClass}" style="width:${s.pct.toFixed(0)}%"></span></div>
      <div class="td-pk-allowance">
        ${esc(`${s.leg.flag || ''} ${t('dash.pack.flightTo', { city: s.leg.city })}`.trim())}
        · ${s.over
          ? `<strong class="td-pk-over">${esc(t('dash.pack.overBy', { kg: kg(-s.remainG) }))}</strong>`
          : esc(t('dash.pack.left', { kg: kg(s.remainG) }))}
      </div>`;
  } else {
    body = `
      <div class="td-pk-weight">${kg(s.carriedG)}<small> kg</small></div>
      <div class="td-pk-allowance">${esc(t('dash.pack.pieces', { n: s.pieces }))}</div>
      ${s.recent.length ? `<div class="td-pk-recent">${s.recent.map(chip).join('')}</div>` : ''}`;
  }

  return `
    <div class="td-widget td-w-pack td-w-pack--open" data-pack-open tabindex="0" role="button" aria-label="${esc(t('dash.widget.pack'))}">
      ${head(buttons)}
      ${body}
    </div>`;
}

function openPackDrawer(list: PackList, legs: StoredLeg[], today: string, trigger: HTMLElement | null): void {
  const s = packSummary(list, legs, today);
  const changes = packChanges(list, legs).reverse();
  const summary = s.kind === 'near'
    ? `${kg(s.carriedG)} / ${kg(s.limitG)} kg · ${s.over ? t('dash.pack.overBy', { kg: kg(-s.remainG) }) : t('dash.pack.left', { kg: kg(s.remainG) })}`
    : s.kind === 'idle' ? `${formatKg(s.carriedG)} · ${t('dash.pack.pieces', { n: s.pieces })}` : '';
  const d = openDrawer({
    title: `🎒 ${t('dash.widget.pack')}`,
    subtitle: summary || undefined,
    body: `
      <h3 class="td-dh">${esc(t('dash.pack.recentChanges'))}</h3>
      ${changes.length
        ? `<section class="td-dcard">${changes.map((c) => `
            <div class="td-dr"><span class="td-dr-k">${c.kind === 'acquired' ? '+' : '−'} ${esc(c.kind === 'acquired' ? t('dash.pack.boughtIn') : t('dash.pack.lostIn'))}</span>
            <span class="td-dr-v">${esc(c.name)}${c.city ? ` · ${esc(c.city)}` : ''}</span></div>`).join('')}</section>`
        : `<p class="td-dempty">${esc(t('dash.pack.noChanges'))}</p>`}`,
    footer: `
      ${legs.length ? `<button type="button" class="btn btn-ghost" data-d-pk="left">− ${esc(t('dash.pack.lostIn'))}</button>
      <button type="button" class="btn btn-primary" data-d-pk="acquired">+ ${esc(t('dash.pack.boughtIn'))}</button>` : ''}
      <button type="button" class="btn btn-ghost" data-d-open>${esc(t('dash.link.openPack'))}</button>`,
    returnFocus: trigger,
  });
  d.root.querySelectorAll<HTMLElement>('[data-d-pk]').forEach((b) => b.addEventListener('click', () => {
    closeDrawer();
    openPackBagChangeModal(list, b.dataset.dPk as 'acquired' | 'left', legs);
  }));
  d.root.querySelector('[data-d-open]')?.addEventListener('click', () => {
    closeDrawer();
    navigateTo('prep', { listId: list.id });
  });
}

/** `get` is read at click time so handlers see the latest stores. */
export function wirePack(body: HTMLElement, get: () => { list: PackList | null | undefined; legs: StoredLeg[]; today: string }): void {
  body.querySelectorAll<HTMLElement>('[data-pk-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const { list, legs } = get();
      if (list) openPackBagChangeModal(list, btn.dataset.pkAction as 'acquired' | 'left', legs);
    });
  });
  const card = body.querySelector<HTMLElement>('[data-pack-open]');
  const open = () => {
    const { list, legs, today } = get();
    if (list) openPackDrawer(list, legs, today, card);
  };
  card?.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button')) open(); });
  card?.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); open(); }
  });
}
