/* ==========================================================================
   On the Road · Boot — data migrations run on sign-in
   ========================================================================== */

import { checkAndAcceptEmailInvites } from './data/trip-context.ts';
import { migrateMultiTrip } from './data/migrate-multitrip.ts';
import { migrateRouteToCloud } from './data/migrate-route.ts';
import { migrateExpensesToCloud } from './data/migrate-expenses.ts';
import { migrateStaysToCompares } from './data/migrate-stays.ts';
import { migrateCityShared } from './data/migrate-city-shared.ts';
import { migrateCollab } from './data/migrate-collab.ts';
import { migratePublicView } from './data/migrate-publicview.ts';

/**
 * Data migrations that MUST complete before the active trip can be read.
 * Order matters: migrateCollab copies users/{uid}/** into trips/**, and the
 * route/expense/stay/publicView migrations all target trips/**, so they run
 * after it. Each is idempotent and early-returns once its own done-flag is set.
 * Run inline (blocking entry) only on a legacy account's first sign-in; on the
 * fast path the same set runs in the background via runPostEntryTasks.
 */
export async function runPreTripMigrations(): Promise<void> {
  // Legacy localStorage→cloud; operates entirely on users/{uid}/** (always permitted).
  try {
    const n = await migrateMultiTrip();
    if (n > 0) console.info(`Flattened ${n} legs/journal entries for multi-trip.`);
  } catch (e) { console.warn('Multi-trip migration skipped:', e); }

  // Collaboration migration: copy users/{uid}/** into top-level trips/**.
  // Copy-only, non-destructive. MUST precede any read of trips/**.
  try {
    const r = await migrateCollab();
    if (r.trips > 0 || r.docs > 0) console.info(`Collab migration: ${r.trips} trips, ${r.docs} docs copied to trips/**.`);
  } catch (e) { console.warn('Collab migration skipped:', e); }

  // Convert owned trips from the coarse hasPublicView flag to page-level
  // publicView. Owner-only; other members' trips migrate when their owner logs in.
  try {
    const n = await migratePublicView();
    if (n > 0) console.info(`Converted ${n} trip(s) to page-level public view.`);
  } catch (e) { console.warn('publicView migration skipped:', e); }

  // These target trips/** via the repathed stores; run after collab.
  try {
    const n = await migrateRouteToCloud();
    if (n > 0) console.info(`Migrated ${n} itinerary legs to the cloud.`);
  } catch (e) { console.warn('Route migration skipped:', e); }

  try {
    const n = await migrateExpensesToCloud();
    if (n > 0) console.info(`Migrated ${n} expenses to the cloud.`);
  } catch (e) { console.warn('Expense migration skipped:', e); }

  try {
    const n = await migrateStaysToCompares();
    if (n > 0) console.info(`Migrated ${n} stay groups to compare format.`);
  } catch (e) { console.warn('Stay→compare migration skipped:', e); }

  // Seed the shared "intent layer" for cities that repeat within a trip.
  // Reads trips/**/legs, so it runs after the route migration above.
  try {
    const n = await migrateCityShared();
    if (n > 0) console.info(`Seeded ${n} shared-city doc(s) for repeated cities.`);
  } catch (e) { console.warn('City-shared migration skipped:', e); }
}

export interface PostEntryResult {
  dataChanged: boolean;
  accessRequestToastPending: boolean;
}

/**
 * Side-effects that run AFTER the user is already in the app — so they never
 * gate entry on the fast path. Runs the (idempotent) data migrations in the
 * background, then the access-request / email-invite / locale / payment-return
 * follow-ups. Returns whether anything changed that the caller should repaint
 * for, and whether an access-request confirmation toast should be shown.
 */
export async function runPostEntryTasks(migrationsAlreadyRan: boolean): Promise<PostEntryResult> {
  let dataChanged = false;
  let accessRequestToastPending = false;

  // Fast path only: the migrations didn't run before entry, so run them now in
  // the background and capture whether anything actually moved. (The slow path
  // already ran them inline before entry, so we skip the redundant re-run.)
  if (!migrationsAlreadyRan) {
    try {
      const r = await migrateCollab();
      if (r.trips > 0 || r.docs > 0) { dataChanged = true; console.info(`Collab migration: ${r.trips} trips, ${r.docs} docs.`); }
    } catch (e) { console.warn('Collab migration (bg) skipped:', e); }
    try { if (await migratePublicView() > 0) dataChanged = true; } catch (e) { console.warn('publicView migration (bg) skipped:', e); }
    try { if (await migrateRouteToCloud() > 0) dataChanged = true; } catch (e) { console.warn('Route migration (bg) skipped:', e); }
    try { if (await migrateExpensesToCloud() > 0) dataChanged = true; } catch (e) { console.warn('Expense migration (bg) skipped:', e); }
    try { if (await migrateStaysToCompares() > 0) dataChanged = true; } catch (e) { console.warn('Stay→compare migration (bg) skipped:', e); }
    try { if (await migrateCityShared() > 0) dataChanged = true; } catch (e) { console.warn('City-shared migration (bg) skipped:', e); }
    try { await migrateMultiTrip(); } catch (e) { console.warn('Multi-trip migration (bg) skipped:', e); }
  }

  // If an editor link was opened before this sign-in, record the access request
  // (the owner must approve before access is granted). Viewer links are handled
  // entirely in resolveInviteLink() (public read).
  try {
    const { consumePendingAccessRequest } = await import('./core/trip-share.ts');
    if (await consumePendingAccessRequest()) accessRequestToastPending = true;
  } catch (e) { console.warn('Access-request handling skipped:', e); }

  // Email-based editor invites matching this user → auto-accept (may add a trip).
  try {
    const joined = await checkAndAcceptEmailInvites();
    if (joined > 0) { dataChanged = true; console.info(`Auto-accepted ${joined} email invite(s).`); }
  } catch (e) { console.warn('Email invite check skipped:', e); }

  // Adopt the saved UI/AI language from the profile (only if this device has no
  // explicit local choice yet). It notifies its own i18n listeners on change,
  // so no extra repaint is needed here.
  try {
    const { loadLocaleFromProfile } = await import('./core/i18n.ts');
    await loadLocaleFromProfile();
  } catch (e) { console.warn('Locale load skipped:', e); }

  // If we just came back from a successful checkout, confirm + refresh quota.
  try {
    const { handlePaymentReturn } = await import('./core/payment-return.ts');
    handlePaymentReturn();
  } catch (e) { console.warn('Payment-return handling skipped:', e); }

  return { dataChanged, accessRequestToastPending };
}
