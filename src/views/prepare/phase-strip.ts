/* ==========================================================================
   On the Road · Prepare — readiness hero
   --------------------------------------------------------------------------
   The one place Checklist and Pack data meet. A countdown sets the framing
   ("what stage am I at"), and beside it the two sections report where they
   stand — total checklist progress and total packed weight — so the page
   answers "am I ready to leave?" instead of just listing two tools.
   ========================================================================== */

import type { Phase } from '../../data/trip-phase.ts';
import { t } from '../../core/i18n.ts';
import { escHtml } from '../../core/utils.ts';

export type PhaseFocus = 'far' | 'packing' | 'imminent' | 'traveling' | 'none';

/** Pure mapping from countdown + trip phase to what the hero should urge.
 *  `daysToGo` is null when there's no trip/leg data at all yet. */
export function resolvePhase(daysToGo: number | null, tripPhase: Phase): PhaseFocus {
  if (tripPhase === 'during') return 'traveling';
  if (tripPhase === 'after') return 'none';
  if (daysToGo === null) return 'none';
  if (daysToGo <= 3) return 'imminent';
  if (daysToGo <= 14) return 'packing';
  return 'far';
}

export interface HeroStats {
  checklist: { done: number; total: number; pct: number; lists: number };
  pack: { lists: number; bags: number; weightLabel: string; over: boolean };
}

interface PhaseCopy { eyebrow: string; title: string; chip: string }

function copyFor(focus: PhaseFocus): PhaseCopy | null {
  switch (focus) {
    case 'far':       return { eyebrow: t('prep.phaseFarEyebrow'),       title: t('prep.phaseFarTitle'),       chip: t('prep.phaseFarChip') };
    case 'packing':   return { eyebrow: t('prep.phasePackingEyebrow'),   title: t('prep.phasePackingTitle'),   chip: t('prep.phasePackingChip') };
    case 'imminent':  return { eyebrow: t('prep.phaseImminentEyebrow'),  title: t('prep.phaseImminentTitle'),  chip: t('prep.phaseImminentChip') };
    case 'traveling': return { eyebrow: t('prep.phaseTravelingEyebrow'), title: t('prep.phaseTravelingTitle'), chip: t('prep.phaseTravelingChip') };
    case 'none':      return null;
  }
}

/** Which action the hero's chip triggers, or null when it shouldn't show one.
 *  Exported so prepare.ts routes the click without re-deriving the mapping. */
export function heroChipAction(focus: PhaseFocus): 'check' | 'bagChange' | null {
  if (focus === 'imminent') return 'check';
  if (focus === 'traveling') return 'bagChange';
  return null;
}

function statCell(label: string, value: string, meta: string, opts: { warn?: boolean; pct?: number } = {}): string {
  return `
    <div class="prep-hero-stat${opts.warn ? ' is-warn' : ''}">
      <div class="prep-hero-stat-label">${escHtml(label)}</div>
      <div class="prep-hero-stat-value">${escHtml(value)}</div>
      ${opts.pct !== undefined
        ? `<div class="prep-hero-bar"><div class="prep-hero-bar-fill" style="width:${opts.pct}%"></div></div>`
        : `<div class="prep-hero-bar is-placeholder"></div>`}
      <div class="prep-hero-stat-meta">${escHtml(meta)}</div>
    </div>`;
}

/**
 * Render the hero.
 *
 * With nothing prepared yet there is no readiness to report, so the hero
 * collapses to a single quiet line rather than a tall card of em-dashes —
 * the empty rails below do the guiding at that point. It grows into the full
 * countdown + stats card as soon as there's either a trip date or any list.
 */
export function renderHero(focus: PhaseFocus, daysToGo: number | null, stats: HeroStats): string {
  const cl = stats.checklist;
  const pk = stats.pack;
  const hasData = cl.total > 0 || pk.lists > 0;

  if (focus === 'none' && !hasData) {
    return `
      <div class="prep-hero prep-hero--bare">
        <span class="prep-hero-bare-icon">🧭</span>
        <span class="prep-hero-bare-text">${escHtml(t('prep.heroNoTripTitle'))}</span>
      </div>`;
  }

  const copy = copyFor(focus);
  const showCount = daysToGo !== null && daysToGo >= 0 && focus !== 'none';
  const chip = copy && heroChipAction(focus)
    ? `<button class="prep-hero-chip" id="prep-hero-action">${escHtml(copy.chip)}</button>`
    : '';

  const clStat = cl.total > 0
    ? statCell(t('prep.statChecklist'), `${cl.done}/${cl.total}`, t('prep.statChecklistMeta', { lists: cl.lists }), { pct: cl.pct })
    : statCell(t('prep.statChecklist'), '—', t('prep.statChecklistEmpty'));

  const pkStat = pk.lists > 0
    ? statCell(t('prep.statPack'), pk.weightLabel, pk.over ? t('prep.statPackOver') : t('prep.statPackMeta', { bags: pk.bags }), { warn: pk.over })
    : statCell(t('prep.statPack'), '—', t('prep.statPackEmpty'));

  return `
    <div class="prep-hero" data-focus="${escHtml(focus)}">
      <div class="prep-hero-lead">
        ${showCount ? `
          <div class="prep-hero-count">
            <span class="prep-hero-count-num">${daysToGo}</span>
            <span class="prep-hero-count-label">${escHtml(t('prep.daysLabel'))}</span>
          </div>` : ''}
        <div class="prep-hero-copy">
          <div class="prep-hero-eyebrow">${escHtml(copy ? copy.eyebrow : t('prep.heroNoTripEyebrow'))}</div>
          <div class="prep-hero-title">${escHtml(copy ? copy.title : t('prep.heroNoTripTitle'))}</div>
        </div>
        ${chip}
      </div>
      <div class="prep-hero-stats">
        ${clStat}
        ${pkStat}
      </div>
    </div>`;
}
