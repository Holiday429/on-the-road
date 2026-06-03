/* ==========================================================================
   On the Road · Route migration (localStorage → Firestore)
   --------------------------------------------------------------------------
   Self-healing, non-destructive, idempotent. Runs once after sign-in:
   if the cloud `legs` collection is empty, upload whatever real itinerary
   data we can find in localStorage (live key, archived key, or the resolved
   default seed). localStorage is never deleted.
   ========================================================================== */

import { createTaggedCollectionStore } from '../firebase/db.ts';
import { currentTripId } from './trip-context.ts';
import { LegSchema, type Leg } from './schema.ts';
// default-route is no longer used for seeding; kept only so the import doesn't
// break if referenced elsewhere. Safe to delete when migrate-route is retired.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {} from './default-route.ts';

const FLAG_MAP: Record<string, string> = {
  'Denmark': '🇩🇰', 'Germany': '🇩🇪', 'Netherlands': '🇳🇱',
  'Belgium': '🇧🇪', 'France': '🇫🇷', 'Spain': '🇪🇸',
  'Portugal': '🇵🇹', 'Switzerland': '🇨🇭', 'Italy': '🇮🇹',
};

function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

/** Drop undefined keys — Firestore rejects undefined values. */
function clean<T extends object>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

const MIGRATION_DONE_FLAG = 'otr:route:migrated:v1';

function readLegacyLegs(): any[] {
  for (const key of ['otr:route:legs', 'otr:route:legs:migrated']) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
  }
  // No localStorage data — return empty so we don't re-seed from the hardcoded
  // default. The user may have deliberately deleted all their legs.
  return [];
}

/** Returns number of legs uploaded (0 if cloud already had data). */
export async function migrateRouteToCloud(): Promise<number> {
  // Skip entirely if we've already run this migration once for this browser.
  // This prevents re-seeding when the user deliberately deletes all their legs.
  if (localStorage.getItem(MIGRATION_DONE_FLAG) === '1') return 0;

  // Flat, tripId-tagged legs collection (users/{uid}/legs).
  const tripId = currentTripId();
  const store = createTaggedCollectionStore('legs', LegSchema);
  const cloud = await store.list();
  // Only seed if this trip has no legs yet (other trips' legs may coexist).
  if (cloud.some((l) => (l as { tripId?: string | null }).tripId === tripId)) {
    localStorage.setItem(MIGRATION_DONE_FLAG, '1');
    return 0;
  }
  // Also bail if the flattened collection already has unclassified legs the
  // multitrip migration will tag — avoids double-seeding the default trip.
  if (cloud.length > 0) {
    localStorage.setItem(MIGRATION_DONE_FLAG, '1');
    return 0;
  }

  const source = readLegacyLegs();
  if (source.length === 0) return 0;

  const rows = source.map((l, i) => clean({
    id: l.id || uid(),
    tripId,
    city: l.city,
    country: l.country,
    flag: l.flag || FLAG_MAP[l.country] || '🗺️',
    dateFrom: l.dateFrom,
    dateTo: l.dateTo,
    accommodation: l.accommodation,
    arrivalTransport: l.arrivalTransport,
    notes: l.notes,
    order: l.order ?? i,
  })) as (Partial<Leg> & { id: string })[];

  for (const row of rows) await store.set(row);
  localStorage.setItem(MIGRATION_DONE_FLAG, '1');
  return rows.length;
}
