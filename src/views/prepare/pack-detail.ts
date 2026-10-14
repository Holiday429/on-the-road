/* ==========================================================================
   On the Road · Pack · detail markup
   --------------------------------------------------------------------------
   The pack screen as a scene: each bag is drawn as the kind of bag it is, with
   its own glass readout; items are tags you drop into a bag; a scale stands on
   the bench beside them. This module only builds markup from plain inputs (the
   screen's state arrives in `DetailCtx`) — pack-section.ts owns state, stores
   and events. Nothing here reads or writes pack data.
   ========================================================================== */

import type { PackList, PackContainer, PackItem } from '../../data/schema.ts';
import { renderBag, bagLook, bagWidth } from '../../core/paper/luggage.ts';
import { renderCrumb, renderMenu } from './prepare-ui.ts';
import { paperReceipt } from '../../core/paper/paper.ts';
import { escHtml } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { itemWeightG } from '../../data/packing-formula.ts';
import {
  PACK_CATEGORIES, categoryLabel, categoryOptions, PRIORITIES, kindLabel, priRank,
  containerWeight, isOver,
} from '../pack/pack-helpers.ts';
import { ago, slipCode, type WeighSlip, type WeighStatus } from '../pack/weigh-status.ts';

export interface DetailCtx {
  list: PackList;
  /** Whether the trip has legs (the Record-change button needs them). */
  hasLegs: boolean;
  unit: string;
  packCheck: boolean;
  selectedItemId: string | null;
  /** Whether a bag's contents are showing. */
  bagOpen: (id: string, itemCount: number) => boolean;
  fmt: (grams: number) => string;
  /** A weight as the number to put in an input (user's unit). */
  inputWeight: (grams: number) => string;
  renderItemTag: (item: PackItem, dropCandidate: boolean) => string;
  /** The Pack-check progress block (only called when packCheck is on). */
  packCheckHtml: () => string;
  changeSummaryHtml: string;
  status: WeighStatus;
  slip: WeighSlip | null;
  slips: WeighSlip[];
  slipsOpen: boolean;
  weightUnitLabel: string;
  /** What to take out of an overweight bag, or null. */
  suggest: (bagId: string) => string | null;
}

/* ── Weigh button + status line (also used by the Prepare landing) ───────── */

export function weighBtnLabel(s: WeighStatus): string {
  switch (s.state) {
    case 'none':  return t('pack.weigh.btnNone');
    case 'stale': return t('pack.weigh.btnStale');
    case 'ok':    return t('pack.weigh.btnOk');
    default:      return t('pack.weigh.btnOver', { n: s.over });
  }
}

function agoText(at: number | null, now: number): string {
  if (at == null) return '';
  const a = ago(at, now);
  return t(`pack.weigh.ago.${a.unit}`, { n: a.n });
}

/** The one sentence that says where the weigh-in stands. */
export function weighSentence(s: WeighStatus, now = Date.now()): string {
  switch (s.state) {
    case 'none':  return t('pack.weigh.stNone', { n: s.bags });
    case 'stale': return t('pack.weigh.stStale', { n: s.pending });
    case 'ok':    return t('pack.weigh.stOk', { ago: agoText(s.at, now) });
    default:      return t('pack.weigh.stOver', { n: s.over, ago: agoText(s.at, now) });
  }
}

export function weighBtnInner(s: WeighStatus): string {
  return `<span class="pkd-weigh-dot" aria-hidden="true"></span><span>${escHtml(weighBtnLabel(s))}</span>`;
}

/* ── Bag cards ───────────────────────────────────────────────────────────── */

function sortedItems(list: PackList, id: string | null): PackItem[] {
  return list.items
    .filter((i) => i.containerId === id)
    .sort((a, b) => priRank(a.priority) - priRank(b.priority) || a.order - b.order);
}

function cellsHtml(ctx: DetailCtx, items: PackItem[], dropSet: Set<string>): string {
  if (!items.length) return `<div class="pack-c-empty">${escHtml(t('pack.emptyBagHint'))}</div>`;
  const cats = PACK_CATEGORIES.filter((c) => items.some((i) => i.category === c.value));
  const known = new Set(PACK_CATEGORIES.map((c) => c.value));
  const rest = items.filter((i) => !known.has(i.category));
  const groups: { icon: string; label: string; items: PackItem[] }[] = cats.map((c) => ({
    icon: c.icon, label: c.label, items: items.filter((i) => i.category === c.value),
  }));
  if (rest.length) groups.push({ icon: '📦', label: categoryLabel('other'), items: rest });
  return groups.map((g) => `
    <div class="pkd-cell">
      <div class="pkd-cell-head">
        <span aria-hidden="true">${g.icon}</span>
        <span class="pkd-cell-name">${escHtml(g.label)}</span>
        <span class="pkd-cell-kg">${escHtml(ctx.fmt(g.items.reduce((s, i) => s + itemWeightG(i), 0)))}</span>
      </div>
      <div class="pkd-cell-items">${g.items.map((i) => ctx.renderItemTag(i, dropSet.has(i.id))).join('')}</div>
    </div>`).join('');
}

export function renderBagCard(ctx: DetailCtx, c: PackContainer): string {
  const l = ctx.list;
  const used = containerWeight(l, c);
  const over = isOver(l, c);
  const pct = c.limitG > 0 ? Math.min(100, (used / c.limitG) * 100) : Math.min(100, used / 100);
  const items = sortedItems(l, c.id);
  const packed = items.filter((i) => i.packed).length;
  const sealed = items.length > 0 && packed === items.length;
  const open = ctx.bagOpen(c.id, items.length);
  const dropSet = new Set<string>();
  if (over) {
    let excess = used - c.limitG;
    for (const it of items.filter((i) => i.source !== 'core')) {
      if (excess <= 0) break;
      dropSet.add(it.id);
      excess -= itemWeightG(it);
    }
  }
  const tip = over ? ctx.suggest(c.id) : null;
  const look = bagLook(c);
  const w = bagWidth(c.kind, true, look.size);
  return `
    <article class="pkd-bag${over ? ' is-over' : ''}" data-id="${escHtml(c.id)}" data-cid="${escHtml(c.id)}">
      <div class="pkd-bag-art" data-bag-art="${escHtml(c.id)}" role="button" tabindex="0"
           aria-label="${escHtml(t('pack.bag.openAria', { name: c.label }))}" style="width:${w}px">
        ${renderBag(c.kind, { loadPct: pct, over, uid: c.id, tone: look.tone })}
      </div>
      <div class="pkd-bag-info">
        <div class="pkd-bag-head">
          <span class="pack-c-name">${escHtml(c.label)}</span>
          <span class="pkd-chip">${escHtml(kindLabel(c.kind))}</span>
          ${sealed ? `<span class="paper-stamp paper-stamp--good pkd-sealed">${escHtml(t('pack.bag.sealed'))}</span>` : ''}
          <button type="button" class="pkd-bag-edit" data-edit-bag="${escHtml(c.id)}" title="${escHtml(t('pack.bag.edit'))}" aria-label="${escHtml(t('pack.bag.edit'))}">✎</button>
          <button class="pk-del-c pkd-bag-del" data-id="${escHtml(c.id)}" title="${escHtml(t('pack.bag.remove'))}">✕</button>
        </div>
        <div class="pkd-bag-meter">
          <span class="paper-led pkd-led${over ? ' is-bad' : ''}"><span class="paper-led-num">${escHtml(ctx.fmt(used))}</span>${c.limitG > 0 ? `<span class="paper-led-aux">${escHtml(t('pack.weigh.limit', { w: ctx.fmt(c.limitG) }))}</span>` : ''}</span>
          <span class="pkd-count">${escHtml(t('pack.bag.count', { n: items.length, p: packed }))}</span>
        </div>
        <div class="pack-bar"><span class="${over ? 'is-over' : ''}" style="width:${Math.round(pct)}%"></span></div>
        ${over ? `<div class="pack-c-warn">${escHtml(t('pack.bag.overBy', { w: ctx.fmt(used - c.limitG) }))}${tip ? ` — ${escHtml(tip)}` : ''}</div>` : ''}
        <div class="pkd-limits">
          <label>${escHtml(t('pack.bag.empty'))} <input class="pk-c-self-edit pk-mini" data-id="${escHtml(c.id)}" type="number" min="0" step="any" value="${c.selfWeightG ? escHtml(ctx.inputWeight(c.selfWeightG)) : ''}" placeholder="0"> ${escHtml(ctx.weightUnitLabel)}</label>
          <label>${escHtml(t('pack.bag.limit'))} <input class="pk-c-limit-edit pk-mini" data-id="${escHtml(c.id)}" type="number" min="0" step="any" value="${c.limitG ? escHtml(ctx.inputWeight(c.limitG)) : ''}" placeholder="0"> ${escHtml(ctx.weightUnitLabel)}</label>
        </div>
        <div class="pkd-bag-actions">
          <button type="button" class="pkd-mini-btn" data-bag-toggle="${escHtml(c.id)}" aria-expanded="${open}">${escHtml(open ? t('pack.bag.close') : t('pack.bag.open'))}</button>
          <button type="button" class="pkd-mini-btn" data-bag-weigh="${escHtml(c.id)}">${escHtml(t('pack.bag.onScale'))}</button>
          ${ctx.selectedItemId ? `<button type="button" class="pkd-mini-btn is-primary" data-move-here="${escHtml(c.id)}">${escHtml(t('pack.moveHere'))}</button>` : ''}
        </div>
        ${open ? `<div class="pkd-bag-items pk-drop-zone" data-container-id="${escHtml(c.id)}">${cellsHtml(ctx, items, dropSet)}</div>` : ''}
      </div>
    </article>`;
}

/* ── Loose items, add row, slip, history ─────────────────────────────────── */

export function renderLoose(ctx: DetailCtx): string {
  const items = sortedItems(ctx.list, null);
  const w = items.reduce((s, i) => s + itemWeightG(i), 0);
  return `
    <section class="pkd-loose pack-unassigned-panel" data-cid="">
      <div class="pack-unassigned-head">
        <span class="pack-unassigned-title">${escHtml(t('pack.unassigned'))}</span>
        ${items.length ? `<span class="pack-unassigned-note">${escHtml(t('pack.waiting', { w: ctx.fmt(w) }))}</span>` : ''}
        <span class="pack-unassigned-badge">${escHtml(t('pack.temp'))}</span>
      </div>
      <div class="pack-c-items pk-drop-zone pack-unassigned-items" data-container-id="">
        ${items.length === 0
          ? `<div class="pack-c-empty">${escHtml(t('pack.unassignedHint'))}</div>`
          : items.map((i) => ctx.renderItemTag(i, false)).join('')}
      </div>
      ${ctx.selectedItemId ? `<button type="button" class="pkd-mini-btn pkd-loose-move" data-move-here="">${escHtml(t('pack.moveLoose'))}</button>` : ''}
      <div class="pkd-loose-hint">${escHtml(t('pack.dragHint'))}</div>
    </section>`;
}

export function renderAddPanel(ctx: DetailCtx): string {
  return `
    <section class="pkd-add">
      <div class="pkd-eyebrow">${escHtml(t('pack.newItem'))}</div>
      <div class="pack-add-panel">
        <input class="input pack-add-name" id="pk-add-name" placeholder="${escHtml(t('pack.newItemPh'))}" aria-label="${escHtml(t('pack.newItem'))}">
        <select class="input pack-add-cat" id="pk-add-cat" aria-label="${escHtml(t('pack.colCategory'))}">${categoryOptions('other')}</select>
        <input class="input pack-add-weight" id="pk-add-weight" type="number" min="0" step="any" placeholder="${escHtml(ctx.weightUnitLabel)}" aria-label="${escHtml(t('pack.colWeight', { unit: ctx.weightUnitLabel }))}">
        <select class="input pack-add-pri" id="pk-add-pri" aria-label="${escHtml(t('pack.priority'))}">
          ${PRIORITIES.map((p) => `<option value="${p.value}">${escHtml(p.label)}</option>`).join('')}
        </select>
        <button class="btn btn-primary pk-sm pack-add-btn" id="pk-add-item">${escHtml(t('pack.addItem'))}</button>
      </div>
    </section>`;
}

export function slipDate(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The weigh-in slip: one tape line per bag, a total, a PASS/OVER stamp and a barcode. */
export function renderSlip(slip: WeighSlip, fmt: (g: number) => string, listName: string, saved: boolean): string {
  const receipt = paperReceipt({
    title: t('pack.slip.title'),
    meta: `${listName} · ${slipDate(slip.at)}`,
    rows: slip.rows.map((r) => ({
      label: r.label,
      value: `${fmt(r.g)}${r.limitG ? ` / ${fmt(r.limitG)}` : ''} ${r.verdict === 'over' ? '▲' : r.verdict === 'pass' ? '✓' : ''}`.trim(),
      tone: r.verdict === 'over' ? 'bad' : r.verdict === 'pass' ? 'good' : 'neutral',
    })),
    total: { label: t('pack.slip.total'), value: fmt(slip.totalG), tone: slip.over ? 'bad' : 'good' },
    stamp: { text: slip.over ? t('pack.weigh.over') : t('pack.weigh.pass'), tone: slip.over ? 'bad' : 'good', pressed: true },
    barcode: true,
    footer: slipCode(slip),
    zigzag: true,
  });
  return `
    <section class="pkd-slip" data-slip="${escHtml(slip.id)}">
      ${receipt}
      <div class="pkd-slip-actions">
        <button type="button" class="btn btn-primary pk-sm" data-slip-save ${saved ? 'disabled' : ''}>${escHtml(saved ? t('pack.slip.saved') : t('pack.slip.save'))}</button>
        <button type="button" class="btn btn-ghost pk-sm" data-slip-dismiss>${escHtml(t('pack.slip.dismiss'))}</button>
      </div>
    </section>`;
}

export function renderHistory(ctx: DetailCtx): string {
  if (!ctx.slips.length) return '';
  return `
    <section class="pkd-history">
      <button type="button" class="pkd-history-head" data-history-toggle aria-expanded="${ctx.slipsOpen}">
        <span aria-hidden="true">🗄</span><span class="pkd-history-title">${escHtml(t('pack.slip.history'))}</span>
        <span class="pkd-history-count">${ctx.slips.length}</span><span aria-hidden="true">${ctx.slipsOpen ? '▴' : '▾'}</span>
      </button>
      ${ctx.slipsOpen ? `<div class="pkd-history-rows">${ctx.slips.map((s) => `
        <div class="pkd-history-row${s.over ? ' is-over' : ''}">
          <span>${escHtml(slipDate(s.at))}</span><span class="pkd-history-gap"></span>
          <span>${escHtml(ctx.fmt(s.totalG))}</span><span class="pkd-history-v">${escHtml(s.over ? t('pack.weigh.over') : t('pack.weigh.pass'))}</span>
        </div>`).join('')}</div>` : ''}
    </section>`;
}

/* ── The whole screen ────────────────────────────────────────────────────── */

export function renderDetailMarkup(ctx: DetailCtx, savedSlipIds: Set<string>): string {
  const l = ctx.list;
  const hasBags = l.containers.length > 0;
  return `
    <div class="pack-detail pkd">
      <div class="pack-detail-bar pkd-bar">
        ${renderCrumb('🎒', 'pk-back')}
        <div class="pack-detail-title">${escHtml(l.name)}</div>
        <div class="pack-detail-actions pkd-actions">
          ${ctx.hasLegs ? `<button class="btn btn-ghost pk-sm" id="pk-record-change">${escHtml(t('pack.btnRecordChange'))}</button>` : ''}
          <button class="btn btn-ghost pk-sm" id="pk-open-add-bag">${escHtml(t('pack.btnAddBag'))}</button>
          <label class="pk-toggle"><input type="checkbox" id="pk-check-mode" ${ctx.packCheck ? 'checked' : ''}> ${escHtml(t('pack.packCheck'))}</label>
          ${hasBags ? `<button type="button" class="pkd-weigh is-${ctx.status.state}" id="pk-weigh">${weighBtnInner(ctx.status)}</button>` : ''}
          ${renderMenu('⋯', [{ act: 'delete-pk', label: t('pack.deleteList'), icon: '🗑️', danger: true }], { variant: 'icon', title: t('prep.moreActions') })}
        </div>
      </div>
      ${hasBags ? `<div class="pkd-status is-${ctx.status.state}" id="pk-weigh-status" role="status">${escHtml(weighSentence(ctx.status))}</div>` : ''}

      ${ctx.packCheck ? ctx.packCheckHtml() : ''}
      ${ctx.changeSummaryHtml}

      <div class="pkd-grid">
        <div class="pkd-main">
          ${hasBags
            ? l.containers.map((c) => renderBagCard(ctx, c)).join('')
            : `<div class="pkd-nobags"><div class="pkd-nobags-art">${renderBag('suitcase', { loadPct: 0, uid: 'empty', tone: 0, ghost: true })}</div><p>${escHtml(t('pack.noBagsYet'))}</p></div>`}
        </div>
        <div class="pkd-side">
          <div data-stage-slot></div>
          ${ctx.slip ? renderSlip(ctx.slip, ctx.fmt, l.name, savedSlipIds.has(ctx.slip.id)) : ''}
          ${renderLoose(ctx)}
          ${renderAddPanel(ctx)}
          ${renderHistory(ctx)}
        </div>
      </div>
    </div>

    <div id="pk-drag-ghost" class="pk-drag-ghost" hidden></div>`;
}
