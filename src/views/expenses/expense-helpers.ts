/* ==========================================================================
   On the Road · Expenses · pure helpers
   --------------------------------------------------------------------------
   Stateless types, constants and functions extracted from expenses.ts.
   Nothing here reads module state.
   ========================================================================== */

export interface Category { id: string; label: string; icon: string; color: string; builtin: boolean; }

export const BUILTIN_CATEGORIES: Category[] = [
  { id: 'accommodation', label: 'Stay',      icon: '🏠', color: '#ddeeff', builtin: true }, // sky blue
  { id: 'food',          label: 'Food',      icon: '🍜', color: '#fdf3dd', builtin: true }, // warm yellow
  { id: 'transport',     label: 'Transport', icon: '🚆', color: '#d1f5e8', builtin: true }, // mint green
  { id: 'activities',    label: 'Activities',icon: '🎭', color: '#fce4e4', builtin: true }, // coral pink
  { id: 'shopping',      label: 'Shopping',  icon: '🛍️', color: '#ede8fb', builtin: true }, // soft purple
  { id: 'health',        label: 'Health',    icon: '💊', color: '#ffecd6', builtin: true }, // peach
  { id: 'misc',          label: 'Misc',      icon: '📌', color: '#e8e8e8', builtin: true }, // neutral
];

/* ── Category colours ───────────────────────────────────────────────────────
   A category stores one literal hex (the 7 builtins below, or the grey custom
   categories are created with). Rather than remapping hex values per theme, the
   known ones resolve to CSS tokens, so light and dark both come from base.css:
     chart  → --cat-*        strokes / dots / bars (≥3:1 on the card surface)
     tint   → --tint-*       chip / tag background
     ink    → --tint-*-ink   text on that tint (same hue, deep)
   Anything unknown (an older custom colour) passes through unchanged. */
const CAT_KEY: Record<string, string> = {
  '#ddeeff': 'stay', '#fdf3dd': 'food', '#d1f5e8': 'transport', '#fce4e4': 'activities',
  '#ede8fb': 'shopping', '#ffecd6': 'health',
  '#e8e8e8': 'misc', '#e5e7eb': 'misc', '#d1d5db': 'misc', '#f3f4f6': 'misc', // misc, custom default, "Unsorted", unresolved
};

/** Soft fill for a chip or tag. */
export function categoryDisplayColor(color: string): string {
  const k = CAT_KEY[color];
  return k ? `var(--tint-${k})` : color;
}

/** Text colour that sits on `categoryDisplayColor(color)`. */
export function categoryInkColor(color: string): string {
  const k = CAT_KEY[color];
  return k ? `var(--tint-${k}-ink)` : 'var(--ink)';
}

/** Stroke / dot / bar colour for charts. */
export function categoryChartColor(color: string): string {
  const k = CAT_KEY[color];
  return k ? `var(--cat-${k})` : color;
}

export const UNCLASSIFIED = '';

export type AnalysisDim = 'category' | 'place' | 'time';
export type BudgetTab = 'total' | 'country' | 'category';

export const ANALYSIS_DIMS: { id: AnalysisDim }[] = [
  { id: 'category' },
  { id: 'place' },
  { id: 'time' },
];

/* ── Pure date math ──────────────────────────────────────────────────────── */

/** Nights stayed: dateFrom is check-in, dateTo is check-out (not counted). */
export function nightCount(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

/* ── SVG donut chart for the category breakdown ──────────────────────────── */
export function renderDonut(rows: Array<{ sum: number; color: string }>, fmt: (n: number) => string): string {
  const totalSum = rows.reduce((s, r) => s + r.sum, 0);
  if (totalSum === 0) return '';
  const R = 54; const cx = 68; const cy = 68; const stroke = 18;
  let offset = 0;
  const circ = 2 * Math.PI * R;
  const slices = rows.map((r) => {
    const frac = r.sum / totalSum;
    const dash = frac * circ;
    const gap = circ - dash;
    const slice = `<circle cx="${cx}" cy="${cy}" r="${R}"
      fill="none" style="stroke:${r.color}" stroke-width="${stroke}"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
      stroke-dashoffset="${(-offset * circ / 1).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})" />`;
    offset += frac;
    return slice;
  }).join('');
  return `
    <svg class="exp-donut" viewBox="0 0 136 136" width="136" height="136">
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>
      ${slices}
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
        class="exp-donut-label">${fmt(totalSum)}</text>
    </svg>`;
}
