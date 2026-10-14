/* ==========================================================================
   On the Road · Prepare — readiness hero
   --------------------------------------------------------------------------
   The one place Checklist and Pack data meet, drawn like the Dashboard's trip
   banner: a countdown ring, a line of copy, the two sections' standing as small
   rings (checklist progress, packed weight vs limits) and — only when there is
   something to say — one alert (a bag over its limit / bags still to weigh) that
   takes the place the old "Weigh my bags" card and pre-trip strip used to hold.
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
  /** `pct` is weight against the bags' limits (null when no limit is set anywhere). */
  pack: { lists: number; bags: number; weightLabel: string; over: boolean; pct: number | null };
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

/* ── Alert slot ──────────────────────────────────────────────────────────── */

export interface HeroAlert {
  kind: 'over' | 'weigh';
  listId: string;
  title: string;
  sub: string;
  /** Departure is close: the slot pulses. */
  urgent: boolean;
}

/** Days before departure within which a pending weigh-in is flagged as urgent. */
export const WEIGH_URGENT_DAYS = 14;

/** Pure: the one thing the banner raises. An overweight bag outranks bags merely not weighed. */
export function resolveAlert(a: { kind: 'over' | 'weigh'; listId: string; count: number } | null, daysToGo: number | null): HeroAlert | null {
  if (!a) return null;
  const soon = daysToGo !== null && daysToGo >= 0 && daysToGo <= WEIGH_URGENT_DAYS;
  if (a.kind === 'over') {
    return { kind: 'over', listId: a.listId, title: t('prep.alertOverTitle'), sub: t('prep.alertOverSub', { n: a.count }), urgent: true };
  }
  return {
    kind: 'weigh', listId: a.listId, title: t('prep.alertWeighTitle'),
    sub: soon && daysToGo !== null ? t('prep.alertWeighSoon', { n: a.count, days: daysToGo }) : t('prep.alertWeighSub', { n: a.count }),
    urgent: soon,
  };
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;

/** A small progress ring with a centred label — the same vocabulary as the Dashboard's trip dial. */
export function ring(fraction: number, center: string, tone: 'accent' | 'ok' | 'warn' | 'muted' = 'accent'): string {
  const dash = (RING_C * Math.min(1, Math.max(0, fraction))).toFixed(1);
  return `
    <span class="prep-ring is-${tone}" data-len="${center.length}">
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle class="prep-ring-track" cx="22" cy="22" r="${RING_R}"/>
        <circle class="prep-ring-arc" cx="22" cy="22" r="${RING_R}" stroke-dasharray="${dash} ${RING_C.toFixed(1)}" transform="rotate(-90 22 22)"/>
      </svg>
      <span class="prep-ring-num">${escHtml(center)}</span>
    </span>`;
}

/** Ring + text for the countdown: D-23 before the trip, a plane while travelling, a compass with no dates. */
function dial(focus: PhaseFocus, daysToGo: number | null): string {
  if (focus === 'traveling') return ring(1, '✈️', 'ok');
  if (daysToGo !== null && daysToGo >= 0 && focus !== 'none') {
    // The ring fills over the last 60 days; further out it is just a sliver.
    return ring(daysToGo >= 60 ? 0.04 : 1 - daysToGo / 60, `D-${daysToGo}`);
  }
  return ring(0, '🧭', 'muted');
}

function statCell(ringHtml: string, label: string, value: string, meta: string, warn = false): string {
  return `
    <div class="prep-hero-stat${warn ? ' is-warn' : ''}">
      ${ringHtml}
      <div class="prep-hero-stat-text">
        <div class="prep-hero-stat-label">${escHtml(label)}</div>
        <div class="prep-hero-stat-value">${escHtml(value)}</div>
        <div class="prep-hero-stat-meta">${escHtml(meta)}</div>
      </div>
    </div>`;
}

/** Render the banner. Same structure in every state — only the content changes. */
export function renderHero(focus: PhaseFocus, daysToGo: number | null, stats: HeroStats, alert: HeroAlert | null = null): string {
  const cl = stats.checklist;
  const pk = stats.pack;
  const copy = copyFor(focus);
  const chip = copy && heroChipAction(focus)
    ? `<button class="prep-hero-chip" id="prep-hero-action">${escHtml(copy.chip)}</button>`
    : '';

  const clStat = cl.total > 0
    ? statCell(ring(cl.pct / 100, `${cl.pct}%`, cl.pct >= 100 ? 'ok' : 'accent'), t('prep.statChecklist'), `${cl.done}/${cl.total}`,
      cl.lists === 1 ? t('prep.statChecklistMeta1') : t('prep.statChecklistMeta', { lists: cl.lists }))
    : statCell(ring(0, '📋', 'muted'), t('prep.statChecklist'), t('prep.statNone'), t('prep.statChecklistEmpty'));

  const pkStat = pk.bags > 0
    ? statCell(ring(pk.pct ?? 0, '🎒', pk.over ? 'warn' : 'accent'), t('prep.statPack'), pk.weightLabel,
      pk.bags === 1 ? t('prep.statPackMeta1') : t('prep.statPackMeta', { bags: pk.bags }), pk.over)
    : statCell(ring(0, '🎒', 'muted'), t('prep.statPack'), t('prep.statNone'), t('prep.statPackEmpty'));

  const alertHtml = alert ? `
      <button type="button" class="prep-hero-alert is-${alert.kind}${alert.urgent ? ' is-urgent' : ''}" id="prep-hero-alert"
              data-alert="${alert.kind}" data-alert-list="${escHtml(alert.listId)}">
        <span class="prep-hero-alert-icon" aria-hidden="true">${alert.kind === 'over' ? '⚠️' : '⚖️'}</span>
        <span class="prep-hero-alert-text">
          <span class="prep-hero-alert-title">${escHtml(alert.title)}</span>
          <span class="prep-hero-alert-sub">${escHtml(alert.sub)}</span>
        </span>
        <span class="prep-hero-alert-go" aria-hidden="true">›</span>
      </button>` : '';

  return `
    <div class="prep-hero" data-focus="${escHtml(focus)}">
      <div class="prep-hero-dial">${dial(focus, daysToGo)}</div>
      <div class="prep-hero-copy">
        <div class="prep-hero-eyebrow">${escHtml(copy ? copy.eyebrow : t('prep.heroNoTripEyebrow'))}</div>
        <div class="prep-hero-title">${escHtml(copy ? copy.title : t('prep.heroNoTripTitle'))}</div>
        ${chip}
      </div>
      <div class="prep-hero-stats">
        ${clStat}
        ${pkStat}
      </div>
      ${alertHtml}
    </div>`;
}
