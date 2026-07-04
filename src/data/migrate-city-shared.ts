/* ==========================================================================
   On the Road · legs → cityShared migration
   --------------------------------------------------------------------------
   Seeds the per-trip "intent layer" (trips/{tripId}/cityShared/{slug}) from the
   legs that already exist. For every city that appears in ≥2 legs of a trip:

     • wishlist plans (dayId == null)  → merged, deduped by title, into shared.plans
     • scheduled plans (dayId != null) → folded into the matching shared item's
                                          `visits[]` footprint (legId + done)
     • clips / clipCategories / noteCards → merged across the legs, deduped

   Only repeated cities get a shared doc — a city visited once keeps working
   exactly as before. Idempotent: skips a slug that already has a shared doc,
   and sets a per-trip done-flag so a re-run is a no-op.
   ========================================================================== */

import {
  collection, getDocs, setDoc, doc as fbDoc, getFirestore,
} from 'firebase/firestore';
import { currentUser } from '../firebase/auth.ts';
import { currentTripId } from './trip-context.ts';
import { slugId } from '../core/utils.ts';
import { SCHEMA_VERSION } from './schema.ts';
import type { Leg } from './schema.ts';
import { buildSharedDoc } from '../views/itinerary/itinerary-city-shared.ts';
import type { Leg as ViewLeg } from '../views/itinerary/itinerary-shared.ts';

const FLAG_PREFIX = 'otr:migrated:city-shared:';

/** Migrate legs → cityShared for the active trip. Idempotent per-trip. */
export async function migrateCityShared(): Promise<number> {
  const user = currentUser();
  if (!user) return 0;

  const tripId = currentTripId();
  if (!tripId) return 0;

  const flagKey = FLAG_PREFIX + tripId;
  if (localStorage.getItem(flagKey)) return 0;

  const db = getFirestore();
  const base = `users/${user.uid}/trips/${tripId}`;

  const legsSnap = await getDocs(collection(db, `${base}/legs`));
  if (legsSnap.empty) {
    localStorage.setItem(flagKey, String(Date.now()));
    return 0;
  }

  const legs = legsSnap.docs.map(d => d.data() as Leg);

  // Group legs by slugged city.
  const byCity = new Map<string, Leg[]>();
  for (const leg of legs) {
    const slug = slugId(leg.city);
    if (!slug) continue;
    (byCity.get(slug) ?? byCity.set(slug, []).get(slug)!).push(leg);
  }

  // Existing shared docs — skip slugs already migrated.
  const sharedSnap = await getDocs(collection(db, `${base}/cityShared`));
  const existing = new Set(sharedSnap.docs.map(d => d.id));

  const now = Date.now();
  let count = 0;

  for (const [slug, cityLegs] of byCity) {
    if (cityLegs.length < 2) continue;      // only repeated cities share
    if (existing.has(slug)) continue;       // already migrated

    // Date-order the legs so "visit 1" footprints read chronologically.
    cityLegs.sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));

    // Reuse the runtime projection so seed + live edits agree on the shape.
    const projected = buildSharedDoc({
      slug,
      siblings: cityLegs as ViewLeg[],
      others: [],
      currentIndex: 1,
      otherVisits: [],
    });

    const sharedDoc = {
      ...projected,
      tripId,
      createdAt: now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
    };

    await setDoc(fbDoc(db, `${base}/cityShared/${slug}`), sharedDoc);
    count++;
  }

  localStorage.setItem(flagKey, String(Date.now()));
  return count;
}
