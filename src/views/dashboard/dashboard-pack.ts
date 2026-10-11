/* ==========================================================================
   On the Road · Dashboard — Pack widget
   --------------------------------------------------------------------------
   Always on. Near a flight with a baggage limit it shows weight vs limit;
   otherwise what you're carrying. Below it, each bag (suitcase, backpack…) with
   its weight and its own + / − — a purchase goes into that bag, a loss comes out of
   it. The corner expand button (or the card) opens the side drawer: the bags side
   by side with what is in each (top ~70%) and the unassigned items (bottom ~30%). The model lives in data/pack-summary.ts.
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import type { PackList } from '../../data/schema.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { packSummary, packContents, type PackChange } from '../../data/pack-summary.ts';
import { formatKg, itemWeightG } from '../../data/packing-formula.ts';
import { openPackBagChangeModal } from './dashboard-modals.ts';

const piecesLabel = (n: number) => (n === 1 ? t('dash.pack.piece1') : t('dash.pack.pieces', { n }));
const KIND_ICON: Record<string, string> = { suitcase: '🧳', backpack: '🎒', personal: '👜' };
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

  const details = `<button type="button" class="td-expand" data-pk-details title="${esc(t('dash.pack.details'))}" aria-label="${esc(t('dash.pack.details'))}">⤢</button>`;
  const contents = packContents(list!, legs, today);
  // Per-bag + / −. With no bags defined yet, fall back to one pair for the whole list.
  const bagBtns = (id = '') => `
    <span class="td-pk-bagbtns">
      <button type="button" class="td-mini" data-pk-action="acquired"${id ? ` data-pk-container="${esc(id)}"` : ''} title="${esc(t('dash.pack.bought'))}" aria-label="${esc(t('dash.pack.bought'))}">+</button>
      <button type="button" class="td-mini td-mini--minus" data-pk-action="left"${id ? ` data-pk-container="${esc(id)}"` : ''} title="${esc(t('dash.pack.lost'))}" aria-label="${esc(t('dash.pack.lost'))}">−</button>
    </span>`;
  const bags = !legs.length ? '' : contents.containers.length ? `
    <div class="td-pk-bags">
      ${contents.containers.map((c) => `
        <div class="td-pk-bag">
          <span class="td-pk-bag-ico" aria-hidden="true">${KIND_ICON[c.container.kind] ?? '🎒'}</span>
          <span class="td-pk-bag-name">${esc(c.container.label)}</span>
          <span class="td-pk-bag-kg">${kg(c.weightG)} kg</span>
          ${bagBtns(c.container.id)}
        </div>`).join('')}
      ${contents.unassigned.length ? `<div class="td-pk-unassigned">${esc(t('dash.pack.unassignedN', { n: contents.unassigned.length }))}</div>` : ''}
    </div>` : `<div class="td-pk-bag td-pk-bag--all"><span class="td-pk-bag-name">${esc(t('dash.pack.allItems'))}</span>${bagBtns()}</div>`;

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
      <div class="td-pk-allowance">${esc(piecesLabel(s.pieces))}</div>
      ${!contents.containers.length && s.recent.length ? `<div class="td-pk-recent">${s.recent.map(chip).join('')}</div>` : ''}`;
  }

  return `
    <div class="td-widget td-w-pack td-w-pack--open" data-pack-open tabindex="0" role="button" aria-label="${esc(t('dash.widget.pack'))}">
      ${head(details)}
      ${body}
      ${bags}
    </div>`;
}

function itemRows(items: ReturnType<typeof packContents>['unassigned']): string {
  if (!items.length) return `<p class="td-dempty">${esc(t('dash.pack.noItems'))}</p>`;
  return items.map((it) => `
    <div class="pk-dr-item">
      <span class="pk-dr-name">${esc(it.name)}</span>
      ${it.qty > 1 ? `<span class="pk-dr-qty">×${it.qty}</span>` : ''}
      <span class="pk-dr-kg">${esc(formatKg(itemWeightG(it)))}</span>
    </div>`).join('');
}

/** Bags side by side (◀ ▶), each one's contents scrolling in the top ~70%; unassigned
 *  items scroll in the bottom ~30%. */
function openPackDrawer(list: PackList, legs: StoredLeg[], today: string, trigger: HTMLElement | null): void {
  const s = packSummary(list, legs, today);
  const summary = s.kind === 'near'
    ? `${kg(s.carriedG)} / ${kg(s.limitG)} kg · ${s.over ? t('dash.pack.overBy', { kg: kg(-s.remainG) }) : t('dash.pack.left', { kg: kg(s.remainG) })}`
    : s.kind === 'idle' ? `${formatKg(s.carriedG)} · ${piecesLabel(s.pieces)}` : '';
  let idx = 0;

  const render = (): string => {
    const c = packContents(list, legs, today);
    const n = c.containers.length;
    idx = n ? Math.min(idx, n - 1) : 0;
    const cur = c.containers[idx];
    const top = !cur
      ? `<p class="td-dempty">${esc(t('dash.pack.noBags'))}</p>`
      : `
        <div class="pk-dr-pager">
          <button type="button" class="td-expand" data-pk-nav="-1" ${n < 2 ? 'disabled' : ''} aria-label="${esc(t('dash.pack.prevBag'))}">◀</button>
          <div class="pk-dr-bag">
            <div class="pk-dr-bag-name">${KIND_ICON[cur.container.kind] ?? '🎒'} ${esc(cur.container.label)}</div>
            <div class="pk-dr-bag-sub">${esc(kg(cur.weightG))} kg${cur.container.limitG ? ` / ${esc(kg(cur.container.limitG))} kg` : ''} · ${esc(piecesLabel(cur.items.reduce((s2, it) => s2 + it.qty, 0)))}</div>
            ${n > 1 ? `<div class="pk-dr-dots">${c.containers.map((_, i) => `<i class="${i === idx ? 'is-on' : ''}"></i>`).join('')}</div>` : ''}
          </div>
          <button type="button" class="td-expand" data-pk-nav="1" ${n < 2 ? 'disabled' : ''} aria-label="${esc(t('dash.pack.nextBag'))}">▶</button>
          ${legs.length ? `<span class="td-pk-bagbtns">
            <button type="button" class="td-mini" data-d-pk="acquired" title="${esc(t('dash.pack.bought'))}" aria-label="${esc(t('dash.pack.bought'))}">+</button>
            <button type="button" class="td-mini td-mini--minus" data-d-pk="left" title="${esc(t('dash.pack.lost'))}" aria-label="${esc(t('dash.pack.lost'))}">−</button>
          </span>` : ''}
        </div>
        <div class="pk-dr-scroll">${itemRows(cur.items)}</div>`;
    return `
      <section class="pk-dr-top">${top}</section>
      <section class="pk-dr-bottom">
        <h3 class="td-dh">${esc(t('dash.pack.unassigned'))} <span class="pk-dr-count">${c.unassigned.length}</span></h3>
        <div class="pk-dr-scroll">${itemRows(c.unassigned)}</div>
      </section>`;
  };

  const d = openDrawer({
    title: `🎒 ${t('dash.widget.pack')}`,
    subtitle: summary || undefined,
    body: render(),
    className: 'pk-drawer',
    returnFocus: trigger,
  });
  d.root.addEventListener('click', (e) => {
    const nav = (e.target as HTMLElement).closest<HTMLElement>('[data-pk-nav]');
    if (nav) {
      const n = packContents(list, legs, today).containers.length;
      if (n) { idx = (idx + Number(nav.dataset.pkNav) + n) % n; d.setBody(render()); }
      return;
    }
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-d-pk]');
    if (act) {
      const cur = packContents(list, legs, today).containers[idx];
      closeDrawer();
      openPackBagChangeModal(list, act.dataset.dPk as 'acquired' | 'left', legs, cur?.container.id);
    }
  });
}

/** `get` is read at click time so handlers see the latest stores. */
export function wirePack(body: HTMLElement, get: () => { list: PackList | null | undefined; legs: StoredLeg[]; today: string }): void {
  body.querySelectorAll<HTMLElement>('[data-pk-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const { list, legs } = get();
      if (list) openPackBagChangeModal(list, btn.dataset.pkAction as 'acquired' | 'left', legs, btn.dataset.pkContainer || undefined);
    });
  });
  const card = body.querySelector<HTMLElement>('[data-pack-open]');
  const open = () => {
    const { list, legs, today } = get();
    if (list) openPackDrawer(list, legs, today, card);
  };
  card?.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('[data-pk-action]')) open(); });
  card?.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); open(); }
  });
}
