/* ==========================================================================
   On the Road · Icon registry
   --------------------------------------------------------------------------
   The one place that decides which emoji / glyph stands for what. One concept,
   one symbol: stays are always 🏨, trains always 🚆, "close" is always ✕.

   Interface chrome uses emoji for now. To switch to illustrations later, change
   the values here (or have NAV items carry an image instead — sidebar.ts's
   renderNavIcon already renders `iconSrc` as an <img> when `emoji` is false).
   Emoji inside user-written content is never touched.
   ========================================================================== */

export const NAV_ICON = {
  today:    '🏠',
  agenda:   '🗓️',
  prep:     '📋',
  budget:   '⚖️',   // Compare
  route:    '🧭',   // Itinerary
  cities:   '📖',   // Guide
  map:      '🌍',
  expenses: '🧾',
  journal:  '📔',
} as const;

export const TRANSPORT_ICON: Record<string, string> = {
  flight: '✈️',
  train:  '🚆',
  bus:    '🚌',
  ferry:  '⛴️',
};
export const TRANSPORT_FALLBACK_ICON = '🧭';

export function transportIcon(type: string | undefined | null): string {
  return (type && TRANSPORT_ICON[type]) || TRANSPORT_FALLBACK_ICON;
}

export const STAY_ICON = '🏨';

/** Built-in expense categories, by id. */
export const EXPENSE_ICON = {
  accommodation: STAY_ICON,
  food:          '🍜',
  transport:     TRANSPORT_ICON.train,
  activities:    '🎭',
  shopping:      '🛍️',
  health:        '💊',
  misc:          '📌',
} as const;

/** Built-in itinerary plan categories, by lower-cased id. */
export const PLAN_ICON: Record<string, string> = {
  official: '🗺️',   // Tourism
  social:   '👥',
  food:     '🍽️',
  museum:   '🖼️',
  nature:   '🌿',
  daytrip:  TRANSPORT_ICON.bus,
  shopping: '🛍️',
  other:    '📌',
};
export const DEFAULT_PLAN_ICON = '📌';

/** Dashboard widget headers. Where a widget mirrors a nav item it uses the same emoji. */
export const WIDGET_ICON = {
  agenda:  NAV_ICON.agenda,
  todo:    '☑️',
  pack:    '🎒',
  spend:   NAV_ICON.expenses,
  currency: '💱',
  map:     NAV_ICON.map,
  journal: NAV_ICON.journal,
  whereto: '📍',
} as const;

/** Text glyphs for the same action everywhere (close, edit, open, …). */
export const GLYPH = {
  close:    '✕',
  edit:     '✎',
  expand:   '⤢',
  external: '↗',
  prev:     '‹',
  next:     '›',
  add:      '+',
  check:    '✓',
  arrow:    '→',
} as const;
