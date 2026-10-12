/* ==========================================================================
   On the Road · Plan-item category → emoji
   --------------------------------------------------------------------------
   The itinerary's built-in plan categories (itinerary-shared.ts) carry a label
   and a colour but no glyph; the Dashboard agenda wants a small icon per row.
   Custom categories (user-made) fall back to the pin.
   ========================================================================== */

import { PLAN_ICON, DEFAULT_PLAN_ICON } from '../core/icons.ts';

export { DEFAULT_PLAN_ICON };

export function planCategoryIcon(category: string | undefined | null): string {
  return (category && PLAN_ICON[category.trim().toLowerCase()]) || DEFAULT_PLAN_ICON;
}
