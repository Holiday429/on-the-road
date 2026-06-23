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
