/* ==========================================================================
   On the Road · Boot — data migrations run on sign-in
   ========================================================================== */

import { checkAndAcceptEmailInvites, markAccountMigrationsDone } from './data/trip-context.ts';
import { migrateMultiTrip, isMultiTripMigrated } from './data/migrate-multitrip.ts';
import { migrateRouteToCloud } from './data/migrate-route.ts';
import { migrateExpensesToCloud } from './data/migrate-expenses.ts';
import { migrateStaysToCompares } from './data/migrate-stays.ts';
import { migrateCityShared } from './data/migrate-city-shared.ts';
import { migrateJournalTemplatesToTags } from './data/migrate-journal-templates.ts';
import { migrateCollab, isCollabMigrated } from './data/migrate-collab.ts';
import { migratePublicView, isPublicViewMigrated } from './data/migrate-publicview.ts';

/**
 * Bump when an ACCOUNT-level migration is added or changes, so accounts that
 * recorded the previous version re-run the set once.
 */
export const ACCOUNT_MIGRATIONS_VERSION = 1;

interface Step {
  name: string;
  /** 'account' steps rewrite data that lives on the account (Firestore layout),
   *  so once one device has finished them they're done everywhere and the
   *  server-side marker lets every other device skip them. 'device' steps upload
   *  THIS browser's leftover localStorage, so they must run per device no matter
   *  what the marker says (they're cheap — no network when there's nothing local). */
  scope: 'account' | 'device';
  run: () => Promise<number>;
}

// Order matters: migrateMultiTrip tags legacy flat docs, migrateCollab then
// copies users/{uid}/** into trips/**, and everything after targets trips/**.
// migrateCityShared reads trips/**/legs, so it comes after the route migration.
// Each step is idempotent and early-returns once its own done-flag is set.
const STEPS: Step[] = [
  { name: 'Multi-trip',        scope: 'account', run: migrateMultiTrip },
  { name: 'Collab',            scope: 'account', run: async () => { const r = await migrateCollab(); return r.trips + r.docs; } },
  { name: 'publicView',        scope: 'account', run: migratePublicView },
  { name: 'Route',             scope: 'device',  run: migrateRouteToCloud },
  { name: 'Expense',           scope: 'device',  run: migrateExpensesToCloud },
  { name: 'Stay→compare',      scope: 'account', run: migrateStaysToCompares },
  { name: 'City-shared',       scope: 'account', run: migrateCityShared },
  { name: 'Journal template',  scope: 'account', run: migrateJournalTemplatesToTags },
];

export interface MigrationRun {
  /** Something the user can see moved — callers repaint. */
  dataChanged: boolean;
  /** Every account-level step ran to completion (no throw, silent-failure
   *  steps confirm via their done-flags). Only then is it safe to record. */
  accountComplete: boolean;
}

/**
 * Run the migration sequence. `skipAccountLevel` drops the account steps — for
 * anonymous guests (never had legacy data) and accounts whose server-side marker
 * is current. When the account steps do run and finish cleanly, the completion
 * is recorded on the profile so no other device repeats them.
 *
 * The same sequence serves both boot paths: awaited before entry on a legacy
 * account's first sign-in (trips/** must be populated before the active trip is
 * read), and in the background after entry for everyone else.
 */
export async function runMigrations(opts: { skipAccountLevel: boolean }): Promise<MigrationRun> {
  let dataChanged = false;
  let threw = false;

  for (const step of STEPS) {
    if (opts.skipAccountLevel && step.scope === 'account') continue;
    try {
      const n = await step.run();
      if (n > 0) { dataChanged = true; console.info(`${step.name} migration: ${n} item(s) moved.`); }
    } catch (e) {
      if (step.scope === 'account') threw = true;
      console.warn(`${step.name} migration skipped:`, e);
    }
  }

  const accountComplete = !opts.skipAccountLevel
    && !threw && isCollabMigrated() && isMultiTripMigrated() && isPublicViewMigrated();
  if (accountComplete) await markAccountMigrationsDone(ACCOUNT_MIGRATIONS_VERSION);
  return { dataChanged, accountComplete };
}

/**
 * Migrations that MUST complete before the active trip can be read. Awaited
 * inline only for a legacy account's first sign-in (see boot-shell.ts).
 */
export async function runPreTripMigrations(opts: { skipAccountLevel: boolean }): Promise<void> {
  await runMigrations(opts);
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
export async function runPostEntryTasks(
  opts: { migrationsAlreadyRan: boolean; skipAccountLevel: boolean },
): Promise<PostEntryResult> {
  let dataChanged = false;
  let accessRequestToastPending = false;

  // The migrations didn't run before entry, so run them now in the background
  // and capture whether anything actually moved. (A legacy account's slow path
  // already ran them inline, so skip the redundant re-run.)
  if (!opts.migrationsAlreadyRan) {
    const r = await runMigrations({ skipAccountLevel: opts.skipAccountLevel });
    if (r.dataChanged) dataChanged = true;
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

  // Same deal for the saved theme preference (light/dark/system).
  try {
    const { loadThemeFromProfile } = await import('./core/theme.ts');
    await loadThemeFromProfile();
  } catch (e) { console.warn('Theme load skipped:', e); }

  // If we just came back from a successful checkout, confirm + refresh quota.
  try {
    const { handlePaymentReturn } = await import('./core/payment-return.ts');
    handlePaymentReturn();
  } catch (e) { console.warn('Payment-return handling skipped:', e); }

  return { dataChanged, accessRequestToastPending };
}
