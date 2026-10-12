/* ==========================================================================
   On the Road · Map progress status
   --------------------------------------------------------------------------
   Which stops are behind you, which one you're in, and which are still ahead —
   shown by the numbered pin colours on the dashboard map so the stage reads at a
   glance without changing the page layout. Pure: no DOM, no amCharts.
   ========================================================================== */

export type LegStatus = 'past' | 'current' | 'future';

interface DatedLeg { country: string; dateFrom: string; dateTo: string }

export function legStatus(leg: Pick<DatedLeg, 'dateFrom' | 'dateTo'>, today: string): LegStatus {
  if (leg.dateTo < today) return 'past';
  if (leg.dateFrom > today) return 'future';
  return 'current';
}

/** Pin colours (solid) — shared with the dashboard legend. */
export const PIN_COLORS: Record<LegStatus, string> = {
  past: '#9a948a', current: '#4f9a86', future: '#e3b866',
};
