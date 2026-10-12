/* ==========================================================================
   On the Road · Itinerary — export a day / city to Google Maps
   ========================================================================== */

import { openExportSheet } from '../../core/export-sheet.ts';
import { t as tr } from '../../core/i18n.ts';
import { legGroups, type ExportScope } from '../../data/places-export.ts';
import type { Leg } from '../../data/schema.ts';

/** Open the export sheet for one plan day, with the whole city as a second scope. */
export function openLegExport(leg: Leg, dayId?: string): void {
  const groups = legGroups(leg);
  const scopes: ExportScope[] = [];
  const day = dayId ? groups.find(g => g.id === `${leg.id}:${dayId}`) : undefined;
  if (day) scopes.push({ id: day.id, label: day.title, groups: [day] });
  scopes.push({ id: leg.id, label: leg.city, groups });
  openExportSheet({ title: tr('export.title'), scopes, initialScope: day?.id, travelMode: 'walking' });
}
