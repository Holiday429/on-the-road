/* ==========================================================================
   On the Road · Pack weight helpers
   --------------------------------------------------------------------------
   Small shared helpers for the Pack page: per-item weight math and a kg
   formatter.
   ========================================================================== */

/* ── Weight math ─────────────────────────────────────────────────────────── */

export function itemWeightG(it: { qty: number; unitWeightG: number }): number {
  return it.qty * it.unitWeightG;
}

export function formatKg(grams: number): string {
  return (grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 1) + 'kg';
}
