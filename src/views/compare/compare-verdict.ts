/* ==========================================================================
   On the Road · Compare — verdict attribution
   --------------------------------------------------------------------------
   The matrix already ranks candidates; this module explains *why* the top
   pick won — which dimensions it led on, which it lost, and whether the
   result is fragile (a single dimension's weight could flip the outcome).
   ========================================================================== */

import type { CompareCandidate, CompareGroup } from '../../data/schema.ts';
import type { ScoreResult } from '../../data/stores/compare-store.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';

interface DimContribution {
  label: string;
  /** (topNorm - runnerUpNorm) * weight — signed points-of-100 this dimension
   *  contributed to (or against) the gap between #1 and #2. */
  swing: number;
}

/** Per-dimension swing between the top two candidates, sorted by magnitude.
 *  A positive swing means the dimension favored the top pick; negative means
 *  the runner-up actually led there but was outweighed elsewhere. */
function dimensionSwings(group: CompareGroup, result: ScoreResult, topId: string, runnerUpId: string): DimContribution[] {
  const totalWeight = group.dimensions.reduce((sum, d) => sum + (d.weight > 0 ? d.weight : 0), 0);
  if (totalWeight === 0) return [];

  return group.dimensions
    .filter((d) => d.weight > 0)
    .map((d) => {
      const topNorm = result.cells[topId]?.[d.id]?.norm ?? 0;
      const runnerNorm = result.cells[runnerUpId]?.[d.id]?.norm ?? 0;
      const swing = ((topNorm - runnerNorm) * d.weight / totalWeight) * 100;
      return { label: d.label, swing };
    })
    .sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));
}

function attributionLine(top: CompareCandidate, runnerUp: CompareCandidate, swings: DimContribution[]): string {
  const favoring = swings.filter((s) => s.swing > 0.5).slice(0, 2).map((s) => s.label);
  const against = swings.filter((s) => s.swing < -0.5).slice(0, 2).map((s) => s.label);

  if (!favoring.length && !against.length) return '';

  const parts: string[] = [];
  if (favoring.length) {
    parts.push(t('compare.attribWinsOn', { name: esc(top.name), dims: esc(favoring.join(', ')) }));
  }
  if (against.length) {
    parts.push(t('compare.attribLosesOn', { name: esc(runnerUp.name), dims: esc(against.join(', ')) }));
  }
  return parts.join(' ');
}

/** If raising one dimension's weight to the max (5) would flip the top pick,
 *  surface it — the ranking is more fragile than the score gap alone
 *  suggests. Recomputes the weighted average directly for each candidate
 *  dimension rather than approximating the shift, so it's exact. Returns the
 *  dimension label, or null if no single re-weight would overturn the result. */
function sensitiveDimension(group: CompareGroup, result: ScoreResult, topId: string, runnerUpId: string): string | null {
  const weights = group.dimensions.map((d) => (d.weight > 0 ? d.weight : 0));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return null;

  const normFor = (id: string, dimId: string) => result.cells[id]?.[dimId]?.norm ?? 0;
  const weightedSum = (id: string, overrideIdx: number, overrideWeight: number) =>
    group.dimensions.reduce((sum, d, i) => {
      const w = i === overrideIdx ? overrideWeight : weights[i];
      return sum + normFor(id, d.id) * w;
    }, 0);

  for (let i = 0; i < group.dimensions.length; i++) {
    const d = group.dimensions[i];
    if (weights[i] >= 5) continue; // already maxed — nothing to swing further
    const runnerAhead = normFor(runnerUpId, d.id) > normFor(topId, d.id);
    if (!runnerAhead) continue; // this dimension already favors the top pick

    const newTotal = totalWeight - weights[i] + 5;
    const topTotal = weightedSum(topId, i, 5) / newTotal;
    const runnerTotal = weightedSum(runnerUpId, i, 5) / newTotal;
    if (runnerTotal > topTotal) return d.label;
  }
  return null;
}

export function renderVerdict(group: CompareGroup, result: ScoreResult): string {
  const byId = (id: string) => group.candidates.find((c) => c.id === id);
  const champions = group.dimensions
    .map((dim) => {
      const winId = result.dimWinners[dim.id];
      const c = winId ? byId(winId) : null;
      return c ? `<li><span class="cmp-champ-dim">${esc(dim.label)}</span> → <strong>${esc(c.name)}</strong></li>` : '';
    })
    .filter(Boolean).join('');

  const top = byId(result.ranking[0]);
  const runnerUp = byId(result.ranking[1]);
  const gap = runnerUp
    ? Math.round((result.totals[result.ranking[0]] - result.totals[result.ranking[1]]) * 100)
    : null;

  const attribution = top && runnerUp
    ? attributionLine(top, runnerUp, dimensionSwings(group, result, top.id, runnerUp.id))
    : '';
  const sensitive = top && runnerUp
    ? sensitiveDimension(group, result, top.id, runnerUp.id)
    : null;

  return `
    <div class="cmp-verdict">
      <div class="cmp-verdict-main">
        <div class="cmp-verdict-label">${t('compare.verdictLabel')}</div>
        <div class="cmp-verdict-pick">🏆 ${top ? esc(top.name) : '—'}</div>
        ${gap != null ? `<div class="cmp-verdict-gap">${gap === 0 ? t('compare.tiedWith') : `${gap} ${t('compare.ptsAheadOf')}`} ${esc(runnerUp!.name)}</div>` : ''}
      </div>
      ${attribution ? `<div class="cmp-verdict-why">${attribution}</div>` : ''}
      ${sensitive ? `<div class="cmp-verdict-sensitive">${t('compare.sensitiveHint', { dim: esc(sensitive) })}</div>` : ''}
      ${champions ? `
        <div class="cmp-verdict-champs">
          <div class="cmp-verdict-label">${t('compare.bestOnDimension')}</div>
          <ul>${champions}</ul>
        </div>` : ''}
      <div class="cmp-verdict-hint">${t('compare.verdictHint')}</div>
    </div>`;
}
