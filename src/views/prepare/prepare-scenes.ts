/* ==========================================================================
   On the Road · Prepare — the two scenes
   --------------------------------------------------------------------------
   The Prepare landing's Checklist and Pack panels are the same size and carry
   the same pieces: a header, then one scene that is itself the way in — a
   clipboard (the open items on it) and a floor with the list's bags and a
   scale. Both scenes have a FIXED number of slots (4 clipboard lines, at most 3
   bags + a luggage tag), so neither panel grows with the data and the two stay
   level. Every state is drawn here: nothing yet, an empty list, in progress,
   all done. Markup only — prepare.ts owns state and events; the bag and scale
   artwork is the paper kit's (core/paper/luggage.ts).
   ========================================================================== */

import { renderBag, renderScale, bagWidth } from '../../core/paper/luggage.ts';
import { escHtml } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import type { PackSceneBag } from './pack-section.ts';

/** Lines on the clipboard, and bags on the floor, whatever the data holds. */
export const CLIP_SLOTS = 4;
export const FLOOR_BAGS = 3;

export interface ClipScene {
  id: string;
  name: string;
  done: number;
  total: number;
  pct: number;
  /** Items not yet ticked. */
  left: number;
  /** The open items to show (the done ones once nothing is left). */
  preview: { text: string; done: boolean }[];
  /** How many other lists wait behind this one (drawn as sheets sticking out). */
  behind: number;
}

export interface PackScene {
  id: string;
  name: string;
  bags: PackSceneBag[];
  /** Total weight, already formatted in the user's unit. */
  totalLabel: string;
}

/** "‹ Europe 2026 · 2/3 ›" — how a panel moves between its lists (nothing when there is one). */
export function renderSwitcher(kind: 'cl' | 'pk', name: string, index: number, count: number): string {
  if (count < 2) return '';
  return `
    <div class="prep-switch" data-switch="${kind}">
      <button type="button" class="prep-switch-btn" data-switch-step="-1" aria-label="${escHtml(t('prep.switchPrev'))}">‹</button>
      <span class="prep-switch-name">${escHtml(name)}</span>
      <span class="prep-switch-n">${index + 1}/${count}</span>
      <button type="button" class="prep-switch-btn" data-switch-step="1" aria-label="${escHtml(t('prep.switchNext'))}">›</button>
    </div>`;
}

const CLIP_SVG = `
  <svg viewBox="0 0 90 26" class="prep-clip-metal" aria-hidden="true">
    <rect x="22" y="2" width="46" height="9" rx="4.5" class="m1"/>
    <rect x="22" y="2" width="46" height="4" rx="2" class="m2"/>
    <rect x="12" y="9" width="66" height="15" rx="5" class="m3"/>
    <rect x="12" y="9" width="66" height="6" rx="3" class="m4"/>
    <rect x="30" y="15" width="30" height="3" rx="1.5" class="m5"/>
  </svg>`;

const clipRow = (p: { text: string; done: boolean }) => `
  <div class="prep-clip-row${p.done ? ' is-done' : ''}">
    <span class="prep-clip-box" aria-hidden="true">${p.done ? '✓' : ''}</span>
    <span class="prep-clip-text">${escHtml(p.text)}</span>
  </div>`;
const clipBlank = () => '<div class="prep-clip-row is-blank" aria-hidden="true"><span class="prep-clip-box"></span><span class="prep-clip-text"></span></div>';
const clipMore = (n: number) => `<div class="prep-clip-row is-more"><span class="prep-clip-text">${escHtml(t('prep.clMore', { n }))}</span></div>`;

/** The clipboard's lines: exactly CLIP_SLOTS of them, however many items there are. */
export function clipLines(preview: { text: string; done: boolean }[], left: number): string {
  const lines: string[] = [];
  if (left > CLIP_SLOTS) {
    preview.slice(0, CLIP_SLOTS - 1).forEach((p) => lines.push(clipRow(p)));
    lines.push(clipMore(left - (CLIP_SLOTS - 1)));
  } else {
    preview.slice(0, CLIP_SLOTS).forEach((p) => lines.push(clipRow(p)));
  }
  while (lines.length < CLIP_SLOTS) lines.push(clipBlank());
  return lines.join('');
}

function clipboard(opts: {
  attrs: string; aria: string; head: string; lines: string; bar: number; stamp?: boolean; backs?: number; hint?: string; cta: string; ghost?: boolean;
}): string {
  const backs = Math.min(2, opts.backs ?? 0);
  return `
      <div class="prep-clip-stack">
        ${backs >= 2 ? '<div class="prep-clip-back prep-clip-back--2" aria-hidden="true"></div>' : ''}
        ${backs >= 1 ? '<div class="prep-clip-back prep-clip-back--1" aria-hidden="true"></div>' : ''}
        <div class="prep-clip${opts.ghost ? ' is-ghost' : ''}" role="button" tabindex="0" ${opts.attrs} aria-label="${escHtml(opts.aria)}">
          ${CLIP_SVG}
          <div class="prep-clip-paper">
            ${opts.head}
            ${opts.lines}
            ${opts.hint ? `<div class="prep-scene-hint">${escHtml(opts.hint)}</div>` : ''}
            ${opts.stamp ? `<span class="paper-stamp paper-stamp--good prep-clip-stamp">${escHtml(t('prep.allDone'))}</span>` : ''}
            <div class="prep-clip-bar"><span style="width:${opts.bar}%"></span></div>
          </div>
          <span class="prep-scene-cta">${escHtml(opts.cta)}</span>
        </div>
      </div>`;
}

/** The checklist panel's scene. `s` is null while the user has no checklist at all. */
export function renderClipboardScene(s: ClipScene | null, switcher = ''): string {
  if (!s) {
    return `
    <div class="prep-scene prep-scene--cl is-empty" data-scene="cl">
      ${clipboard({
        attrs: 'data-act="new-cl"', aria: t('prep.clEmptyTitle'), ghost: true, bar: 0,
        head: `<div class="prep-clip-head"><span class="prep-clip-name">${escHtml(t('prep.clEmptyTitle'))}</span></div>`,
        lines: clipLines([], 0), hint: t('prep.clEmptyHint'), cta: t('prep.clEmptyCta'),
      })}
    </div>`;
  }
  const complete = s.total > 0 && s.left === 0;
  return `
    <div class="prep-scene prep-scene--cl${complete ? ' is-complete' : ''}" data-scene="cl">
      ${switcher}
      ${clipboard({
        attrs: `data-open-cl="${escHtml(s.id)}"`, aria: `${t('prep.sceneOpenChecklist')} ${s.name}`,
        head: `<div class="prep-clip-head"><span class="prep-clip-name">${escHtml(s.name)}</span><span class="prep-clip-count">${s.done}/${s.total}</span></div>`,
        lines: clipLines(s.preview, s.left), bar: s.pct, stamp: complete, backs: s.behind,
        hint: s.total === 0 ? t('prep.clipEmptyList') : undefined,
        cta: t('prep.sceneOpenChecklist'),
      })}
    </div>`;
}

/** The bags shown on the floor: the heaviest few, kept in list order, plus how many are left out. */
export function floorBags(bags: PackSceneBag[]): { shown: PackSceneBag[]; hidden: number } {
  if (bags.length <= FLOOR_BAGS) return { shown: bags, hidden: 0 };
  const keep = new Set([...bags].sort((a, b) => b.weightG - a.weightG).slice(0, FLOOR_BAGS).map((b) => b.id));
  return { shown: bags.filter((b) => keep.has(b.id)), hidden: bags.length - FLOOR_BAGS };
}

/** The shelf under the floor: the scale, and beside it what it is for. */
const shelf = (listId: string | null, reading: string) => `
      <div class="prep-shelf">
        ${listId
          ? `<button type="button" class="prep-scale-obj" data-weigh-pk="${escHtml(listId)}" aria-label="${escHtml(t('pack.weigh.btnNone'))}">
              <span class="prep-scale-art">${renderScale({ reading })}</span>
            </button>
            <span class="prep-scale-label">${escHtml(t('prep.sceneWeighHere'))}</span>`
          : `<div class="prep-scale-obj is-idle" aria-hidden="true"><span class="prep-scale-art">${renderScale({ reading })}</span></div>`}
      </div>`;

/** The pack panel's scene. `p` is null while the user has no pack list at all. */
export function renderPackScene(p: PackScene | null, fmt: (g: number) => string, switcher = ''): string {
  if (!p || !p.bags.length) {
    const noList = !p;
    const attrs = noList ? 'data-act="new-pk"' : `data-open-pk="${escHtml(p.id)}"`;
    return `
    <div class="prep-scene prep-scene--pk is-empty" data-scene="pk">
      ${switcher || (p ? `<div class="prep-scene-label">${escHtml(p.name)}</div>` : '')}
      <div class="prep-floor" role="button" tabindex="0" ${attrs}
           aria-label="${escHtml(noList ? t('prep.pkEmptyTitle') : t('prep.packNoBagsTitle'))}">
        <div class="prep-bag prep-bag--ghost" style="flex-basis:${bagWidth('suitcase', true)}px">
          <div class="prep-bag-art">${renderBag('suitcase', { loadPct: 0, uid: `ghost-${p?.id ?? 'none'}`, tone: 0, ghost: true })}</div>
        </div>
        <div class="prep-scene-hint">${escHtml(noList ? t('prep.pkEmptyHint') : t('pack.noBagsYet'))}</div>
        <span class="prep-scene-cta">${escHtml(noList ? t('prep.pkEmptyCta') : t('prep.sceneOpenPack'))}</span>
      </div>
      ${shelf(null, fmt(0))}
    </div>`;
  }
  const label = switcher || `<div class="prep-scene-label">${escHtml(p.name)}</div>`;
  const { shown, hidden } = floorBags(p.bags);
  const bagHtml = shown.map((b) => `
    <div class="prep-bag" data-over="${b.over}" style="flex:0 1 ${Math.round(bagWidth(b.kind, true, b.size) * 1.6)}px">
      <div class="prep-bag-art">${renderBag(b.kind, { loadPct: b.loadPct, over: b.over, uid: `ln-${b.id}`, tone: b.tone })}</div>
      <div class="prep-bag-kg${b.over ? ' is-over' : ''}">${escHtml(fmt(b.weightG))}</div>
    </div>`).join('');
  return `
    <div class="prep-scene prep-scene--pk" data-scene="pk">
      ${label}
      <div class="prep-floor" role="button" tabindex="0" data-open-pk="${escHtml(p.id)}"
           aria-label="${escHtml(`${t('prep.sceneOpenPack')} ${p.name}`)}">
        ${bagHtml}
        ${hidden > 0 ? `<div class="prep-bag-tag" title="${escHtml(t('prep.sceneMore', { n: hidden }))}"><span class="prep-bag-tag-hole" aria-hidden="true"></span><span>+${hidden}</span></div>` : ''}
        <span class="prep-scene-cta">${escHtml(t('prep.sceneOpenPack'))}</span>
      </div>
      ${shelf(p.id, p.totalLabel)}
    </div>`;
}
