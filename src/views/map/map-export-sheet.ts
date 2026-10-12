/* ==========================================================================
   On the Road · Map — "Export ↗" toolbar action
   --------------------------------------------------------------------------
   Gathers the current trip's legs + nomad spots from the stores and hands the
   resulting scopes to the shared Google Maps export sheet.
   ========================================================================== */

import { openExportSheet } from '../../core/export-sheet.ts';
import { exportScopes } from '../../data/places-export.ts';
import { routeStore } from '../../data/stores/route-store.ts';
import { nomadStore } from '../../data/stores/nomad-store.ts';
import { currentTripId } from '../../data/trip-context.ts';

export function openMapExport(): void {
  const tripId = currentTripId();
  const nomad = nomadStore.peek().filter(s => s.tripId === tripId);
  openExportSheet({ title: 'Export to Google Maps', scopes: exportScopes(routeStore.peek(), nomad) });
}
