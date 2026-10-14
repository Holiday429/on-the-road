/* ==========================================================================
   On the Road · Prepare — the two scenes
   --------------------------------------------------------------------------
   The Prepare landing's Checklist and Pack panels are the same size and carry
   the same pieces: a status card, then a scene that is itself the way in — a
   clipboard (with the list's first items on it) and a floor with the list's
   bags and a scale. Markup only: prepare.ts owns state and events, and the bag
   and scale artwork is the paper kit's (core/paper/luggage.ts).
   ========================================================================== */

import { renderBag, renderScale, bagTone, bagWidth } from '../../core/paper/luggage.ts';
import { escHtml } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import type { PackSceneBag } from './pack-section.ts';
import { weighBtnLabel, weighSentence } from './pack-detail.ts';
import type { WeighStatus } from '../pack/weigh-status.ts';

export interface ClipScene {
  id: string;
  name: string;
  done: number;
  total: number;
  pct: number;
  preview: { text: string; done: boolean }[];
  /** How many other lists wait behind this one (drawn as sheets sticking out). */
  behind: number;
}

const CLIP_SVG = `
  <svg viewBox="0 0 90 26" class="prep-clip-metal" aria-hidden="true">
    <rect x="22" y="2" width="46" height="9" rx="4.5" class="m1"/>
    <rect x="22" y="2" width="46" height="4" rx="2" class="m2"/>
    <rect x="12" y="9" width="66" height="15" rx="5" class="m3"/>
    <rect x="12" y="9" width="66" height="6" rx="3" class="m4"/>
    <rect x="30" y="15" width="30" height="3" rx="1.5" class="m5"/>
  </svg>`;

/** The featured checklist as a clipboard; click opens it. */
export function renderClipboardScene(s: ClipScene): string {
  const rows = s.preview.length
    ? s.preview.map((p) => `
        <div class="prep-clip-row${p.done ? ' is-done' : ''}">
          <span class="prep-clip-box" aria-hidden="true">${p.done ? '✓' : ''}</span>
          <span class="prep-clip-text">${escHtml(p.text)}</span>
        </div>`).join('')
    : `<div class="prep-clip-blank">${escHtml(t('prep.clipEmptyList'))}</div>`;
  const backs = Math.min(2, s.behind);
  return `
    <div class="prep-scene prep-scene--cl" data-scene="cl">
      <div class="prep-clip-stack">
        ${backs >= 2 ? '<div class="prep-clip-back prep-clip-back--2" aria-hidden="true"></div>' : ''}
        ${backs >= 1 ? '<div class="prep-clip-back prep-clip-back--1" aria-hidden="true"></div>' : ''}
        <div class="prep-clip" role="button" tabindex="0" data-open-cl="${escHtml(s.id)}"
             aria-label="${escHtml(`${t('prep.sceneOpenChecklist')} ${s.name}`)}">
          ${CLIP_SVG}
          <div class="prep-clip-paper">
            <div class="prep-clip-head">
              <span class="prep-clip-name">${escHtml(s.name)}</span>
              <span class="prep-clip-count">${s.done}/${s.total}</span>
            </div>
            ${rows}
            <div class="prep-clip-bar"><span style="width:${s.pct}%"></span></div>
          </div>
          <span class="prep-scene-cta">${escHtml(t('prep.sceneOpenChecklist'))}</span>
        </div>
      </div>
    </div>`;
}

const MAX_SCENE_BAGS = 5;

/** The featured pack list as a floor: its bags standing up, a scale beside them. */
export function renderPackScene(listId: string, bags: PackSceneBag[], totalLabel: string, fmt: (g: number) => string): string {
  const shown = bags.slice(0, MAX_SCENE_BAGS);
  const hidden = bags.length - shown.length;
  const bagHtml = shown.map((b) => `
    <div class="prep-bag" data-over="${b.over}" style="flex-basis:${Math.round(bagWidth(b.kind) * (shown.length > 3 ? 1.2 : 1.5))}px">
      <div class="prep-bag-art">${renderBag(b.kind, { loadPct: b.loadPct, over: b.over, uid: `ln-${b.id}`, tone: bagTone(b.id) })}</div>
      <div class="prep-bag-kg${b.over ? ' is-over' : ''}">${escHtml(fmt(b.weightG))}</div>
    </div>`).join('');
  return `
    <div class="prep-scene prep-scene--pk" data-scene="pk">
      <div class="prep-floor" role="button" tabindex="0" data-open-pk="${escHtml(listId)}"
           aria-label="${escHtml(t('prep.sceneOpenPack'))}">
        ${bags.length ? bagHtml : `<div class="prep-bag prep-bag--ghost" aria-hidden="true"><div class="prep-bag-art">${renderBag('suitcase', { loadPct: 0, uid: `ghost-${listId}`, tone: 0 })}</div></div>`}
        ${hidden > 0 ? `<div class="prep-bag-more">${escHtml(t('prep.sceneMore', { n: hidden }))}</div>` : ''}
        <span class="prep-scene-cta">${escHtml(t('prep.sceneOpenPack'))}</span>
      </div>
      ${bags.length
        ? `<button type="button" class="prep-scale-obj" data-weigh-pk="${escHtml(listId)}" aria-label="${escHtml(t('pack.weigh.btnNone'))}">
        <span class="prep-scale-art">${renderScale({ reading: totalLabel })}</span>
        <span class="prep-scale-label">${escHtml(t('prep.sceneWeighHere'))}</span>
      </button>`
        : `<div class="prep-scale-obj is-idle" aria-hidden="true"><span class="prep-scale-art">${renderScale({ reading: totalLabel })}</span></div>`}
    </div>`;
}

/** The Pack panel's status card: it is the Weigh button, and it says where the weigh-in stands. */
export function renderWeighCard(listId: string, status: WeighStatus): string {
  return `
    <button type="button" class="prep-status prep-status--weigh is-${status.state}" data-weigh-pk="${escHtml(listId)}">
      <span class="prep-status-dot" aria-hidden="true"></span>
      <span class="prep-status-text">
        <span class="prep-status-title">${escHtml(weighBtnLabel(status))}</span>
        <span class="prep-status-sub">${escHtml(weighSentence(status))}</span>
      </span>
      <span class="prep-status-go" aria-hidden="true">→</span>
    </button>`;
}

/** The Checklist panel's matching card (same size, same place). */
export function renderChecklistCard(listId: string, done: number, total: number, name: string): string {
  const left = total - done;
  const complete = total > 0 && left === 0;
  return `
    <button type="button" class="prep-status prep-status--cl${complete ? ' is-ok' : ' is-none'}" data-open-cl="${escHtml(listId)}">
      <span class="prep-status-dot" aria-hidden="true"></span>
      <span class="prep-status-text">
        <span class="prep-status-title">${escHtml(t('prep.clStatusTitle', { done, total }))}</span>
        <span class="prep-status-sub">${escHtml(complete ? t('prep.clStatusAll') : t('prep.clStatusSub', { left, name }))}</span>
      </span>
      <span class="prep-status-go" aria-hidden="true">→</span>
    </button>`;
}

/** "Weigh before you fly" — a paper strip at the top of the page in the last two weeks before departure. */
export function renderWeighNotice(listId: string, days: number, status: WeighStatus): string {
  return `
    <div class="prep-notice" role="status" data-notice="weigh">
      <span class="prep-notice-icon" aria-hidden="true">⚖️</span>
      <div class="prep-notice-body"><strong>${escHtml(t('prep.weighNotice'))}</strong> <span>${escHtml(t('prep.weighNoticeBody', { days, status: weighSentence(status) }))}</span></div>
      <button type="button" class="prep-notice-go" data-weigh-pk="${escHtml(listId)}">${escHtml(t('prep.weighNow'))}</button>
      <button type="button" class="prep-notice-x" data-dismiss-notice aria-label="${escHtml(t('prep.dismiss'))}">✕</button>
    </div>`;
}
