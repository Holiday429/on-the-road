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

/** A closed passport booklet — cover, globe emblem, text line. Line art, takes the surrounding text colour. */
export const PASSPORT_ICON =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<rect x="4.5" y="2.5" width="15" height="19" rx="2"/>'
  + '<circle cx="12" cy="9.5" r="3.6"/><path d="M8.4 9.5h7.2M12 5.9c-1.5 1.9-1.5 5.3 0 7.2M12 5.9c1.5 1.9 1.5 5.3 0 7.2"/>'
  + '<path d="M8.5 17.5h7"/></svg>';

/** Pack containers, by kind. */
export const BAG_ICON: Record<string, string> = { suitcase: '🧳', backpack: '🎒', personal: '👜' };
export const BAG_FALLBACK_ICON = '🎒';

export function bagIcon(kind: string | undefined | null): string {
  return (kind && BAG_ICON[kind]) || BAG_FALLBACK_ICON;
}

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
