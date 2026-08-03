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

/* ── Dark-mode color remap ──────────────────────────────────────────────────
   Category colors are stored/rendered as literal hex (inline style, and as
   SVG stroke on the donut chart) rather than CSS custom properties, so they
   can't just flip via a var() — a dark counterpart has to be looked up and
   substituted at render time. Every color a category can currently have is
   one of these 8 fixed light pastels (the 7 builtins above, plus '#e5e7eb'
   — the single fixed color new custom categories are created with, since
   there's no color picker yet); anything else (e.g. from an older custom
   category) is passed through unchanged. */
const DARK_REMAP: Record<string, string> = {
  '#ddeeff': '#1e3a52', // accommodation
  '#fdf3dd': '#4a3d1a', // food
  '#d1f5e8': '#1a4a3a', // transport
  '#fce4e4': '#4a2530', // activities
  '#ede8fb': '#332a4d', // shopping
  '#ffecd6': '#4d3520', // health
  '#e8e8e8': '#3a3a3a', // misc
  '#d1d5db': '#3a3d42', // "Unsorted" row in analysisRows
  '#e5e7eb': '#35383d', // default color for new custom categories
  '#f3f4f6': '#3a3a3a', // fallback when a record's category id no longer resolves
};

function isDarkTheme(): boolean {
  try { return document.documentElement.dataset.theme === 'dark'; } catch { return false; }
}

/** Resolve a stored category color to the one that should actually render,
 *  given the current theme. Pass any raw category.color through this before
 *  using it as a background/stroke — never read .color directly for display. */
export function categoryDisplayColor(color: string): string {
  return isDarkTheme() ? (DARK_REMAP[color] ?? color) : color;
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
