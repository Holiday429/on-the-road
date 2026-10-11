/* ==========================================================================
   On the Road · Plan-item category → emoji
   --------------------------------------------------------------------------
   The itinerary's built-in plan categories (itinerary-shared.ts) carry a label
   and a colour but no glyph; the Dashboard agenda wants a small icon per row.
   Custom categories (user-made) fall back to the pin.
   ========================================================================== */

const ICONS: Record<string, string> = {
  official: '🗺️',   // Tourism
  social:   '👥',
  food:     '🍽️',
  museum:   '🖼️',
  nature:   '🌿',
  daytrip:  '🚌',
  shopping: '🛍️',
  other:    '📌',
};

export const DEFAULT_PLAN_ICON = '📌';

export function planCategoryIcon(category: string | undefined | null): string {
  return (category && ICONS[category.trim().toLowerCase()]) || DEFAULT_PLAN_ICON;
}
