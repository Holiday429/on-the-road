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

/** The passport as the Itinerary shows it: a small closed booklet (cloth, foil globe, title line, chip). Sized by font-size
 *  (1.15em tall), so it drops in wherever an emoji did. Styles: .pp-bk in core/paper/paper.css. */
export const PASSPORT_ICON_HTML =
  '<span class="pp-bk" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.6" ry="8.5"/><path d="M3.5 12h17M5 7.5h14M5 16.5h14"/></svg><i></i><i></i></span>';

export const NAV_ICON = {
  today:    '🏠',
  agenda:   '🗓️',
  prep:     '📋',
  budget:   '⚖️',   // Compare
  route:    '🧭',   // Itinerary
  cities:   '📖',   // Guide
  // The Map is one trip's route — a folded paper map; the Atlas is the globe
  // standing on the traveller's own shelf, so it keeps 🌍.
  map:      '🗺️',
  expenses: '🧾',
  journal:  '📔',
  // Me
  passport: PASSPORT_ICON_HTML,
  atlas:    '🌍',
  profile:  '⚙️',
  wrap:     '🎞️',
  world:    '🌏',
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

/** Pack containers, by kind. */
export const BAG_ICON: Record<string, string> = { suitcase: '🧳', backpack: '🎒', personal: '👜', duffel: '💼' };
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
