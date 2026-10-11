/* ==========================================================================
   On the Road · Dashboard — Pack widget
   --------------------------------------------------------------------------
   Always on. Near a flight with a baggage limit it shows weight vs limit;
   otherwise what you're carrying. Below it, an icon per bag (suitcase, backpack…)
   with its weight — tap one to open the drawer on that bag — and, at the bottom, the
   Bought / Lost buttons. The corner expand button (or the card) opens the side drawer, drawn like the
   Pack page itself: a bag card (name, kind, weight meter, category-coloured item
   tags) with ◀ ▶ to move between bags in the top ~70%, and the amber dashed
   Unassigned panel in the bottom ~30%. It reuses the Pack page's stylesheet. The model lives in data/pack-summary.ts.
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import type { PackList } from '../../data/schema.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { packSummary, packContents, type PackChange } from '../../data/pack-summary.ts';
import { formatKg, itemWeightG } from '../../data/packing-formula.ts';
import { categoryColor, categoryLabel, displayWeight, kindLabel, priRank, PRIORITIES, type WeightUnit } from '../pack/pack-helpers.ts';
import type { PackContainer, PackItem } from '../../data/schema.ts';
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
  const bags = !legs.length ? '' : `
    <div class="td-pk-bagicons">
      ${contents.containers.map((c, i) => `
        <button type="button" class="td-pk-bagicon" data-pk-bag="${i}" title="${esc(c.container.label)} · ${kg(c.weightG)} kg" aria-label="${esc(c.container.label)}">
          <span class="td-pk-bagicon-glyph" aria-hidden="true">${KIND_ICON[c.container.kind] ?? '🎒'}</span>
          <span class="td-pk-bagicon-kg">${kg(c.weightG)}</span>
        </button>`).join('')}
      ${contents.unassigned.length ? `<span class="td-pk-unassigned">${esc(t('dash.pack.unassignedN', { n: contents.unassigned.length }))}</span>` : ''}
    </div>`;
  const actions = legs.length ? `
    <div class="td-pk-actions">
      <button type="button" class="btn btn-primary td-pk-act" data-pk-action="acquired">＋ ${esc(t('dash.pack.boughtIn'))}</button>
      <button type="button" class="btn btn-ghost td-pk-act" data-pk-action="left">－ ${esc(t('dash.pack.lostIn'))}</button>
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
      <div class="td-pk-allowance">${esc(piecesLabel(s.pieces))}</div>
      ${!contents.containers.length && s.recent.length ? `<div class="td-pk-recent">${s.recent.map(chip).join('')}</div>` : ''}`;
  }

  return `
    <div class="td-widget td-w-pack td-w-pack--open" data-pack-open tabindex="0" role="button" aria-label="${esc(t('dash.widget.pack'))}">
      ${head(details)}
      ${body}
      ${bags}
      ${actions}
    </div>`;
}

/** The Pack page's own unit preference (kg / g / lb / 斤). */
function weightUnit(): WeightUnit {
  try { return (localStorage.getItem('pk-weight-unit') as WeightUnit) || 'kg'; } catch { return 'kg'; }
}

/** An item as the Pack page draws it — a tag on its category's colour — minus the
 *  drag handle and edit/remove buttons (those live on the Pack page). */
function itemTag(i: PackItem): string {
  const unit = weightUnit();
  const pri = PRIORITIES.find((p) => p.value === i.priority)?.label ?? i.priority;
  const tip = `${categoryLabel(i.category)} · ${displayWeight(itemWeightG(i), unit)}${i.qty > 1 ? ` ×${i.qty}` : ''} · ${pri}`;
  return `
    <div class="pack-item-tag ${i.packed ? 'is-packed' : ''}" data-tooltip="${esc(tip)}" style="background:${categoryColor(i.category)}">
      <span class="tag-name">${i.source === 'core' ? '🔒 ' : ''}${esc(i.name)}${i.qty > 1 ? `<span class="tag-qty-badge">×${i.qty}</span>` : ''}</span>
    </div>`;
}

const byPriority = (a: PackItem, b: PackItem) => priRank(a.priority) - priRank(b.priority) || a.order - b.order;

function bagCard(c: PackContainer, items: PackItem[], weightG: number): string {
  const unit = weightUnit();
  const over = c.limitG > 0 && weightG > c.limitG;
  const pct = c.limitG > 0 ? Math.min(100, (weightG / c.limitG) * 100) : 0;
  return `
    <div class="pack-container-card ${over ? 'is-over' : ''}">
      <div class="pack-c-limits"><span>${esc(t('dash.pack.bagEmpty'))} ${esc(displayWeight(c.selfWeightG, unit))}</span>${c.limitG ? `<span>${esc(t('dash.pack.limit'))} ${esc(displayWeight(c.limitG, unit))}</span>` : ''}</div>
      <div class="pack-c-meter">
        <div class="pack-c-num ${over ? 'is-over' : ''}">${esc(displayWeight(weightG, unit))}${c.limitG > 0 ? ` / ${esc(displayWeight(c.limitG, unit))}` : ''}</div>
        <div class="pack-bar"><span class="${over ? 'is-over' : ''}" style="width:${pct}%"></span></div>
        ${over ? `<div class="pack-c-warn">${esc(t('dash.pack.overBy', { kg: kg(weightG - c.limitG) }))}</div>` : ''}
      </div>
      <div class="pack-c-items">
        ${items.length ? [...items].sort(byPriority).map(itemTag).join('') : `<div class="pack-c-empty">${esc(t('dash.pack.noItems'))}</div>`}
      </div>
    </div>`;
}

function unassignedPanel(items: PackItem[]): string {
  const unit = weightUnit();
  const w = items.reduce((s2, i) => s2 + itemWeightG(i), 0);
  return `
    <div class="pack-unassigned-panel">
      <div class="pack-unassigned-head">
        <span class="pack-unassigned-title">${esc(t('dash.pack.unassigned'))}</span>
        ${items.length ? `<span class="pack-unassigned-note">${esc(displayWeight(w, unit))} ${esc(t('dash.pack.waiting'))}</span>` : ''}
        <span class="pack-unassigned-badge">${esc(t('dash.pack.temp'))}</span>
      </div>
      <div class="pack-c-items pack-unassigned-items">
        ${items.length ? [...items].sort(byPriority).map(itemTag).join('') : `<div class="pack-c-empty">${esc(t('dash.pack.noItems'))}</div>`}
      </div>
    </div>`;
}

/** Drawn like the Pack page: bag card on top (◀ ▶ between bags), Unassigned below. */
async function openPackDrawer(list: PackList, legs: StoredLeg[], today: string, trigger: HTMLElement | null, startIdx = 0): Promise<void> {
  await import('../prepare/styles/pack.css');
  const s = packSummary(list, legs, today);
  const summary = s.kind === 'near'
    ? `${kg(s.carriedG)} / ${kg(s.limitG)} kg · ${s.over ? t('dash.pack.overBy', { kg: kg(-s.remainG) }) : t('dash.pack.left', { kg: kg(s.remainG) })}`
    : s.kind === 'idle' ? `${formatKg(s.carriedG)} · ${piecesLabel(s.pieces)}` : '';
  let idx = startIdx;

  const render = (): string => {
    const c = packContents(list, legs, today);
    const n = c.containers.length;
    idx = n ? Math.min(idx, n - 1) : 0;
    const cur = c.containers[idx];
    const top = !cur
      ? `<p class="td-dempty">${esc(t('dash.pack.noBags'))}</p>`
      : `
        <div class="pk-dr-pager">
          <span></span>
          <div class="pk-dr-pick">
            <button type="button" class="td-expand" data-pk-nav="-1" ${n < 2 ? 'disabled' : ''} aria-label="${esc(t('dash.pack.prevBag'))}">◀</button>
            <div class="pk-dr-bag"><span class="pk-dr-bag-name">${KIND_ICON[cur.container.kind] ?? '🎒'} ${esc(cur.container.label)}</span><span class="pk-dr-bag-kind">${esc(kindLabel(cur.container.kind))}${n > 1 ? ` · ${idx + 1}/${n}` : ''}</span></div>
            <button type="button" class="td-expand" data-pk-nav="1" ${n < 2 ? 'disabled' : ''} aria-label="${esc(t('dash.pack.nextBag'))}">▶</button>
          </div>
          ${legs.length ? `<span class="td-pk-bagbtns">
            <button type="button" class="td-mini" data-d-pk="acquired" title="${esc(t('dash.pack.bought'))}" aria-label="${esc(t('dash.pack.bought'))}">+</button>
            <button type="button" class="td-mini td-mini--minus" data-d-pk="left" title="${esc(t('dash.pack.lost'))}" aria-label="${esc(t('dash.pack.lost'))}">−</button>
          </span>` : '<span></span>'}
        </div>
        ${bagCard(cur.container, cur.items, cur.weightG)}`;
    return `<section class="pk-dr-top">${top}</section><section class="pk-dr-bottom">${unassignedPanel(c.unassigned)}</section>`;
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
  const open = (bag = 0, trigger: HTMLElement | null = card) => {
    const { list, legs, today } = get();
    if (list) void openPackDrawer(list, legs, today, trigger, bag);
  };
  card?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-pk-action]')) return;
    const bag = target.closest<HTMLElement>('[data-pk-bag]');
    open(bag ? Number(bag.dataset.pkBag) : 0, bag ?? card);
  });
  card?.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); open(); }
  });
}
