/* ==========================================================================
   On the Road · Map progress status
   --------------------------------------------------------------------------
   Which stops are behind you, which one you're in, and which are still ahead —
   expressed as colour on the dashboard map so the trip's stage reads at a
   glance without changing the page layout. Pure: no DOM, no amCharts.
   ========================================================================== */

import { isoFor } from './geo.ts';

export type LegStatus = 'past' | 'current' | 'future';

interface DatedLeg { country: string; dateFrom: string; dateTo: string }

export function legStatus(leg: Pick<DatedLeg, 'dateFrom' | 'dateTo'>, today: string): LegStatus {
  if (leg.dateTo < today) return 'past';
  if (leg.dateFrom > today) return 'future';
  return 'current';
}

/** Per-country status: current wins; else "future" while any stop there is still
 *  ahead (so a country you'll revisit stays amber); else past. Keyed by ISO2. */
export function countryStatuses(legs: DatedLeg[], today: string): Map<string, LegStatus> {
  const byIso = new Map<string, Set<LegStatus>>();
  for (const leg of legs) {
    const iso = isoFor(leg.country);
    if (!iso) continue;
    let s = byIso.get(iso);
    if (!s) byIso.set(iso, (s = new Set()));
    s.add(legStatus(leg, today));
  }
  const out = new Map<string, LegStatus>();
  for (const [iso, s] of byIso) {
    out.set(iso, s.has('current') ? 'current' : s.has('future') ? 'future' : 'past');
  }
  return out;
}

/** Pin colours (solid) — shared with the dashboard legend. */
export const PIN_COLORS: Record<LegStatus, string> = {
  past: '#a8a29e', current: '#22c55e', future: '#f9b830',
};

/** Country fills: the same hues, softened so the pins stay on top. */
const FILL_LIGHT: Record<LegStatus, string> = { past: '#d9d4cb', current: '#9fe0b5', future: '#fbdc8f' };
const FILL_DARK:  Record<LegStatus, string> = { past: '#4a463e', current: '#2f6b47', future: '#6b5421' };
export function countryFill(status: LegStatus, dark: boolean): string {
  return (dark ? FILL_DARK : FILL_LIGHT)[status];
}
