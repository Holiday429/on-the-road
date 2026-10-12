/* ==========================================================================
   On the Road · Pack · weigh-in
   --------------------------------------------------------------------------
   Turns a pack list into one verdict per bag for the luggage-scale animation
   (views/prepare/weigh-scale.ts). Pure and read-only: it reuses
   containerWeight() from pack-helpers, so there is no second weight formula
   and nothing here changes pack data.
   ========================================================================== */

import type { PackList, PackContainer } from '../../data/schema.ts';
import { containerWeight } from './pack-helpers.ts';

export type Verdict = 'pass' | 'over' | 'nolimit';

export interface BagWeighIn {
  id: string;
  label: string;
  kind: PackContainer['kind'];
  /** Items inside + the empty bag. */
  weightG: number;
  /** 0 = no limit set. */
  limitG: number;
  verdict: Verdict;
  /** limit − weight: positive = grams to spare, negative = grams over. 0 when there is no limit. */
  diffG: number;
}

/** One row per bag (or just `onlyId`), in the order the bags are listed. */
export function weighIn(list: PackList, onlyId?: string): BagWeighIn[] {
  return list.containers
    .filter((c) => !onlyId || c.id === onlyId)
    .map((c) => {
      const weightG = containerWeight(list, c);
      const limitG = c.limitG > 0 ? c.limitG : 0;
      const verdict: Verdict = !limitG ? 'nolimit' : weightG > limitG ? 'over' : 'pass';
      return { id: c.id, label: c.label, kind: c.kind, weightG, limitG, verdict, diffG: limitG ? limitG - weightG : 0 };
    });
}

export interface WeighSummary { total: number; pass: number; over: number; nolimit: number }

export function weighSummary(rows: BagWeighIn[]): WeighSummary {
  return {
    total: rows.length,
    pass: rows.filter((r) => r.verdict === 'pass').length,
    over: rows.filter((r) => r.verdict === 'over').length,
    nolimit: rows.filter((r) => r.verdict === 'nolimit').length,
  };
}
