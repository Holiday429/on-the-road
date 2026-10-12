/* Pure numbers for the receipt slip (see expense-slip.ts). */

export interface SlipFigures {
  itemBase: number;
  dayTotal: number;
  tripTotal: number;
  /** Budget minus trip total; null when no budget is set. */
  left: number | null;
}

/** Pure: the numbers on the slip, given the spend that already existed. */
export function slipFigures(existing: Array<{ date: string; base: number }>, itemBase: number, date: string, budget: number | null): SlipFigures {
  const tripTotal = existing.reduce((s, e) => s + e.base, 0) + itemBase;
  const dayTotal = existing.filter((e) => e.date === date).reduce((s, e) => s + e.base, 0) + itemBase;
  return { itemBase, dayTotal, tripTotal, left: budget ? budget - tripTotal : null };
}
