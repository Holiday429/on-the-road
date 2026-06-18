/* ==========================================================================
   On the Road · Entry point
   ========================================================================== */

import './core/base.css';
import './core/app.css';

import { initApp, registerView, renderSession, openOnboarding, navigateTo, setAllowedViews, firstAllowedView, type ViewId } from './core/app.ts';
import { onAuth, authReady, currentUser, signInWithGoogle, signInAnonymously, consumeRedirectResult, type User } from './firebase/auth.ts';
import { initLandingMap } from './views/map/landing-map.ts';
import { ensureDefaultTrip, restoreActiveTrip, checkAndAcceptEmailInvites, currentMemberPages } from './data/trip-context.ts';
import { migrateMultiTrip } from './data/migrate-multitrip.ts';
import { migrateRouteToCloud } from './data/migrate-route.ts';
import { migrateExpensesToCloud } from './data/migrate-expenses.ts';
import { migrateStaysToCompares } from './data/migrate-stays.ts';
import { migrateCollab, isCollabMigrated } from './data/migrate-collab.ts';
import { migratePublicView } from './data/migrate-publicview.ts';
import { initNotificationScheduler } from './core/notifications.ts';
import { initDashboard } from './views/dashboard/dashboard.ts';
import { initCalendar } from './views/calendar/calendar.ts';
import { initPrep }     from './views/checklist/checklist.ts';
import { initRoute }    from './views/itinerary/itinerary.ts';
import { initExpenses } from './views/expenses/expenses.ts';
import { initCities }   from './views/guide/guide.ts';
import { initJournal }  from './views/journal/index.ts';
import { initMap }      from './views/map/map.ts';
import { initNomad }    from './views/nomad/nomad.ts';
import { initCompare }  from './views/compare/compare.ts';
import { initPack }     from './views/pack/pack.ts';
import { initSafety }   from './views/safety/safety.ts';

// Consume any pending Google redirect result on iOS PWA. Must resolve before
// the onAuth callback can act on the resulting user — we store the promise and
// gate onAuth on it so the redirect user isn't lost to a race condition.
let _redirectConsumed = false;
const redirectResultPromise = consumeRedirectResult().then((u) => {
  _redirectConsumed = true;
  return u;
}).catch(() => { _redirectConsumed = true; return null; });

// Register lazy view inits (fire once on first navigation)
registerView('today',    initDashboard);
registerView('calendar', initCalendar);
registerView('prep',     initPrep);
registerView('route',    initRoute);
registerView('expenses', initExpenses);
registerView('cities',   initCities);
registerView('journal',  initJournal);
registerView('map',      initMap);
registerView('nomad',    initNomad);
registerView('budget',   initCompare);
registerView('pack',     initPack);
registerView('safety',   initSafety);

const authScreen = document.getElementById('auth-screen') as HTMLElement | null;
const authButton = document.getElementById('auth-google-btn') as HTMLButtonElement | null;
const authStatus = document.getElementById('auth-status') as HTMLElement | null;
const authCard = document.querySelector<HTMLElement>('.auth-card');
const appRoot = document.getElementById('app') as HTMLElement | null;
const mapContainer = document.getElementById('landingMap') as HTMLElement | null;

// Set when a viewer invite boots the app without auth.
let _viewerMode = false;
let _viewerTripId: string | null = null;
export function isViewerMode(): boolean { return _viewerMode; }
export function viewerTripId(): string | null { return _viewerTripId; }

let appEntered = false;

// Capture any invite token from the URL SYNCHRONOUSLY, at the very top of the
// module, before any await yields control. This is the single source of truth
// for "is this an invite link" — nothing else reads window.location.hash for
// joins, and the hash is NOT cleared here. We clear it only after the invite
// has been acted on, so a failed/slow read never loses the token.
const INVITE_TOKEN: string | null = (() => {
  const m = window.location.hash.match(/^#\/join\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
})();

// True while we're still resolving an invite link, so onAuth and the Enter
// button know not to fall back to the landing/guest flow prematurely.
let invitePending = INVITE_TOKEN !== null;

function clearInviteHash() {
  if (window.location.hash.startsWith('#/join/')) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

// Resolve the invite link. Runs once on boot. Waits for Firebase auth to be
// ready before touching Firestore (an unauthenticated read fired before auth
// initialises is what previously failed and dropped us back to "/").
async function resolveInviteLink(): Promise<void> {
  if (!INVITE_TOKEN) return;
  const tok = INVITE_TOKEN;

  try {
    // Wait for the Firebase auth state to settle before any Firestore read.
    await authReady();

    const { getInvite } = await import('./data/trip-invites.ts');
    const inv = await getInvite(tok);

    if (!inv || inv.revoked) {
      clearInviteHash();
      invitePending = false;
      if (!appEntered) showLandingState();
      return;
    }

    // If a real (non-anonymous) user is already signed in AND is a member of
    // the invited trip — e.g. the owner opening their own share link — never
    // enter read-only viewer mode. Drop the invite and let the normal
    // authenticated shell boot with full edit rights.
    const signedInUser = currentUser();
    if (signedInUser) {
      const { getTrip } = await import('./data/trip-context.ts');
      const trip = await getTrip(inv.tripId);
      const members = (trip as { members?: Record<string, string> } | null)?.members;
      if (members && members[signedInUser.uid]) {
        invitePending = false;
        clearInviteHash();
        return; // normal boot (Enter button / onAuth) handles the rest
      }
    }

    if (inv.role === 'viewer') {
      // Viewer: read the trip publicly (no login, no membership write). The trip
      // doc and its sub-collections are readable when publicView.enabled is set,
      // which every viewer invite guarantees. switchTrip() loads it into context.
      const { switchTrip } = await import('./data/trip-context.ts');
      await switchTrip(inv.tripId);

      // Restrict the nav to the pages this specific link exposes. An empty
      // pages list (legacy viewer invite) means "all pages" → null restriction.
      setAllowedViews(inv.pages?.length ? (inv.pages as ViewId[]) : null);

      _viewerMode = true;
      _viewerTripId = inv.tripId;
      appRoot?.setAttribute('data-viewer', 'true');
      invitePending = false;
      clearInviteHash();

      if (!appEntered) {
        await bootViewerShell();
        enterApp();
      }
    } else {
      // Editor link: never auto-grants. Requires login + owner approval.
      const { savePendingAccessRequest, submitAccessRequest } = await import('./core/trip-share.ts');
      invitePending = false;
      clearInviteHash();

      if (currentUser()) {
        // Signed-in non-member (the member short-circuit above already returned
        // for existing members): submit an access request and show confirmation.
        const created = await submitAccessRequest(tok);
        showRequestSentCard(inv.tripName, created);
      } else {
        // Not signed in: stash the token so the request is created right after
        // Google sign-in (consumePendingAccessRequest), and prompt to sign in.
        savePendingAccessRequest(tok);
        if (authCard) {
          const titleEl = authCard.querySelector('.auth-card-title');
          const textEl = authCard.querySelector('.auth-card-text');
          if (titleEl) titleEl.textContent = `You've been invited to edit "${inv.tripName}"`;
          if (textEl) textEl.textContent = 'Sign in with Google to request edit access. The owner will approve your request.';
        }
      }
      if (!appEntered) showLandingState();
    }
  } catch (e) {
    console.warn('Invite link resolution failed:', e);
    invitePending = false;
    if (!appEntered) showLandingState();
  }
}

/** Transient toast confirming an edit-access request was submitted. */
function showAccessRequestToast(): void {
  const el = document.createElement('div');
  el.textContent = '✓ Edit access requested — the owner will approve it.';
  el.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#16a34a;color:#fff;padding:.6rem 1.25rem;border-radius:9999px;font-size:.875rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.2)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/** Replace the landing card with a "request sent" confirmation (reveals
 *  nothing about the trip beyond its name). */
function showRequestSentCard(tripName: string, created: boolean): void {
  if (!authCard) return;
  const titleEl = authCard.querySelector('.auth-card-title');
  const textEl = authCard.querySelector('.auth-card-text');
  if (titleEl) titleEl.textContent = created ? 'Request sent' : 'Already requested';
  if (textEl) {
    textEl.textContent = created
      ? `Your request to edit "${tripName}" was sent. You'll get access once the owner approves it.`
      : `You've already requested access to "${tripName}". Hang tight for the owner to approve.`;
  }
  // Hide the Enter/sign-in button — nothing to do until approval.
  authButton?.setAttribute('hidden', '');
}

let shellBooted = false;
let signingIn = false;
let landingMapInitialized = false;
let bootPromise: Promise<void> | null = null;
let appPrepared = false;
let preparedUserId: string | null = null;
let guestShellReady = false;
// Tracks whether the last authenticated render was for an anonymous (guest)
// account, so onAuth can detect an in-place anon→Google upgrade (same uid) and
// re-render the sidebar avatar.
let lastRenderedAnonymous = false;
// Set when a pending editor-link access request was just submitted on sign-in;
// a confirmation toast is shown once the shell is up.
let accessRequestToastPending = false;

function setAuthStatus(message: string, isError = false) {
  if (!authStatus) return;
  authStatus.textContent = message;
  authStatus.classList.toggle('is-error', isError);
}

function setAuthButtonState(label: string, busy = false) {
  if (!authButton) return;
  authButton.disabled = busy;
  authButton.textContent = label;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function currentViewOrDefault(): ViewId {
  const hash = window.location.hash.replace('#', '') as ViewId;
  const valid: ViewId[] = ['today', 'prep', 'route', 'expenses', 'pack', 'cities', 'budget', 'safety', 'journal', 'map', 'nomad', 'calendar'];
  return valid.includes(hash) ? hash : 'today';
}

function showLandingState() {
  authScreen?.removeAttribute('hidden');
  authScreen?.classList.remove('is-exiting');
  appRoot?.setAttribute('hidden', '');
  appRoot?.classList.remove('is-preparing', 'is-entering');
  appPrepared = false;
  appEntered = false;
  guestShellReady = false;
  preparedUserId = null;
  setAuthButtonState('Enter', false);
  setAuthStatus('');
}

function prepareAppFrame() {
  if (!appRoot || appPrepared) return;
  appRoot.removeAttribute('hidden');
  appRoot.classList.add('is-preparing');
  appPrepared = true;
}

function enterApp() {
  if (appEntered || !authScreen || !appRoot) return;
  prepareAppFrame();
  void appRoot.offsetHeight;
  appRoot.classList.add('is-entering');
  authScreen.classList.add('is-exiting');
  authScreen.addEventListener('animationend', () => {
    authScreen.setAttribute('hidden', '');
    authScreen.classList.remove('is-exiting');
    appRoot.classList.remove('is-preparing', 'is-entering');
  }, { once: true });
  appEntered = true;
}

function bootShellOnce() {
  if (shellBooted) return;
  initApp();
  shellBooted = true;
}

async function handleSidebarAuth() {
  if (signingIn) return;
  signingIn = true;
  try {
    await signInWithGoogle();
  } catch (error) {
    console.warn('Sidebar sign-in failed:', error);
  } finally {
    signingIn = false;
  }
}

async function bootGuestShell() {
  if (guestShellReady) return;
  prepareAppFrame();
  bootShellOnce();
  renderSession(null, handleSidebarAuth);
  navigateTo(currentViewOrDefault());
  await nextFrame();
  guestShellReady = true;
}

async function bootViewerShell() {
  prepareAppFrame();
  bootShellOnce();
  renderSession(null, handleSidebarAuth);
  navigateTo(firstAllowedView()); // land on the first page this link exposes
  await nextFrame();
  guestShellReady = true;
}

async function bootAuthenticatedShell(user: User) {
  if (preparedUserId === user.uid) return;
  if (bootPromise) {
    await bootPromise;
    return;
  }

  prepareAppFrame();

  bootPromise = (async () => {
    // FAST PATH: this device already ran the collab migration, so the trips/**
    // layout is populated. We can read the active trip and enter immediately,
    // then run the remaining (idempotent) migrations in the background. This is
    // the common case — keeps Enter near-instant for returning users.
    //
    // SLOW PATH (legacy account's first sign-in): the collab migration hasn't
    // run, so trips/** is still empty. We MUST migrate before reading the active
    // trip, or ensureDefaultTrip would see no trips and wrongly trigger
    // onboarding. This blocks entry once; subsequent boots take the fast path.
    const tookSlowPath = !isCollabMigrated();
    if (tookSlowPath) {
      await runPreTripMigrations();
    }

    // Minimal set needed to know WHICH trip to show — always awaited before entry.
    let needsOnboarding = false;
    try {
      const trip = await ensureDefaultTrip();
      needsOnboarding = trip === null;
    } catch (e) { console.warn('Default trip bootstrap skipped:', e); }

    try { await restoreActiveTrip(); }
    catch (e) { console.warn('Restore active trip skipped:', e); }

    // Apply any page restriction for this member (editor limited to some pages).
    // null = full access. Owners are always unrestricted.
    setAllowedViews(currentMemberPages() as ViewId[] | null);

    bootShellOnce();
    renderSession(user, handleSidebarAuth);
    navigateTo(currentViewOrDefault());
    preparedUserId = user.uid;
    lastRenderedAnonymous = !!user.isAnonymous;
    guestShellReady = false;

    initNotificationScheduler();

    if (needsOnboarding) {
      openOnboarding();
    }

    await nextFrame();

    // Everything below is non-blocking: it runs AFTER the user is already in the
    // app. On the fast path these migrations + side-effects no longer gate entry.
    // (On the slow path the migrations already ran inline above, so skip them.)
    void runPostEntryTasks(user, needsOnboarding, tookSlowPath);
  })();

  try {
    await bootPromise;
  } finally {
    bootPromise = null;
  }
}

/**
 * Data migrations that MUST complete before the active trip can be read.
 * Order matters: migrateCollab copies users/{uid}/** into trips/**, and the
 * route/expense/stay/publicView migrations all target trips/**, so they run
 * after it. Each is idempotent and early-returns once its own done-flag is set.
 * Run inline (blocking entry) only on a legacy account's first sign-in; on the
 * fast path the same set runs in the background via runPostEntryTasks.
 */
async function runPreTripMigrations(): Promise<void> {
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
}

/**
 * Side-effects that run AFTER the user is already in the app — so they never
 * gate entry on the fast path. Runs the (idempotent) data migrations in the
 * background, then the access-request / email-invite / locale / payment-return
 * follow-ups. If the background migrations actually moved data, or an email
 * invite joined a new trip, the active view is refreshed so the new data shows.
 */
async function runPostEntryTasks(user: User, alreadyOnboarding: boolean, migrationsAlreadyRan: boolean): Promise<void> {
  let dataChanged = false;

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

  if (accessRequestToastPending) {
    accessRequestToastPending = false;
    showAccessRequestToast();
  }

  // If we just came back from a successful checkout, confirm + refresh quota.
  try {
    const { handlePaymentReturn } = await import('./core/payment-return.ts');
    handlePaymentReturn();
  } catch (e) { console.warn('Payment-return handling skipped:', e); }

  // Repaint only when background migrations / invites actually moved data the
  // user can see, and we're still in this same authenticated session (not
  // onboarding, not switched out).
  if (dataChanged && !alreadyOnboarding && preparedUserId === user.uid) {
    renderSession(user, handleSidebarAuth);
    navigateTo(currentViewOrDefault());
  }
}

// Enter button: always just enters the app — no auth state shown on preload screen.
// If Firebase already resolved a user in the background, boot the authenticated shell;
// viewer invite → boot viewer shell directly without auth.
// Otherwise boot as guest. Google sign-in is handled exclusively via the sidebar avatar.
authButton?.addEventListener('click', async () => {
  setAuthButtonState('Entering…', true);
  setAuthStatus('');
  try {
    if (_viewerMode) {
      await bootViewerShell();
      enterApp();
      return;
    }
    // Only block on the redirect result when one is actually pending (iOS PWA
    // returning from a Google sign-in redirect) — otherwise the user could be
    // lost to a race. On a normal load it's already consumed, so this is a no-op.
    if (!_redirectConsumed) await redirectResultPromise;

    // Enter immediately using whatever auth state we already know. If a user is
    // already known (returning Google user, or a redirect just resolved) boot
    // the authenticated shell. Otherwise sign in anonymously so the guest gets a
    // real uid and the data layer works fully — they can create & save trips
    // without an account, then upgrade to Google later (linkWithPopup preserves
    // their data). Anonymous sign-in failing (e.g. provider disabled) degrades
    // to the old read-only guest shell rather than blocking entry.
    let user = currentUser();
    if (!user) {
      try { user = await signInAnonymously(); }
      catch (e) { console.warn('Anonymous sign-in failed; entering as read-only guest:', e); }
    }
    if (user) {
      await bootAuthenticatedShell(user);
    } else {
      await bootGuestShell();
    }
    enterApp();
  } catch (error) {
    console.warn('Enter failed:', error);
    try {
      await bootGuestShell();
      enterApp();
    } catch (fallbackError) {
      console.warn('Guest boot failed:', fallbackError);
      setAuthButtonState('Enter', false);
      setAuthStatus('Could not enter. Try again or sign in from a refreshed page.', true);
    }
  }
});

/* Init map when hero starts shrinking (travel.gif 2.5s + hero walk 1.5s). */
setTimeout(async () => {
  if (!landingMapInitialized && mapContainer && authScreen) {
    landingMapInitialized = true;
    try {
      await initLandingMap(mapContainer);
    } catch (error) {
      console.warn('Landing map init failed:', error);
    }
  }
}, 4000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

onAuth(async ({ user, ready }) => {
  if (!ready) return;

  // On iOS PWA a sign-in redirect just landed. Wait for consumeRedirectResult()
  // to finish so Firebase auth state is fully resolved before we act on it.
  if (!_redirectConsumed) {
    await redirectResultPromise;
    // After the redirect result is consumed, onAuthStateChanged fires again with
    // the real user — let that second callback do the work.
    return;
  }

  // If the app is already open (user signed in/out after entering), update the shell.
  if (appEntered) {
    if (user) {
      // A viewer signs in with Google: upgrade from read-only to full shell.
      if (_viewerMode) {
        _viewerMode = false;
        _viewerTripId = null;
        appRoot?.removeAttribute('data-viewer');
        setAllowedViews(null); // restore full nav for the now-authenticated member
      }
      // Anonymous guest just upgraded to Google (linkWithPopup keeps the same
      // uid, so bootAuthenticatedShell early-returns and won't rebuild). Force a
      // session re-render so the sidebar avatar swaps from "Sign in to sync" to
      // the real account. Detected via the isAnonymous flag flipping false while
      // the uid is unchanged.
      const wasAnon = lastRenderedAnonymous && preparedUserId === user.uid && !user.isAnonymous;
      await bootAuthenticatedShell(user);
      if (wasAnon) {
        renderSession(user, handleSidebarAuth);
      }
      lastRenderedAnonymous = !!user.isAnonymous;
    } else {
      preparedUserId = null;
      renderSession(null, handleSidebarAuth);
      navigateTo(currentViewOrDefault());
    }
    return;
  }

  // Viewer mode: auto-enter without waiting for the Enter button click.
  if (_viewerMode && !appEntered) {
    try {
      await bootViewerShell();
      enterApp();
    } catch (e) { console.warn('Viewer auto-enter failed:', e); }
    return;
  }

  // An invite link is still being resolved (e.g. anonymous sign-in just fired
  // this callback). Don't flash the landing screen — resolveInviteLink() owns
  // the UI until it finishes.
  if (invitePending) return;

  // Preload screen is still showing — wait for the user to click Enter.
  if (!user) {
    // If a redirect was just consumed, Firebase will fire onAuth again with the
    // real user shortly. Don't flash the landing screen in the interim.
    const redirectUser = await redirectResultPromise;
    if (redirectUser) return;
    preparedUserId = null;
    showLandingState();
  }
});

// Kick off invite-link resolution. Defined above; called here so all the
// shell helpers (bootViewerShell, enterApp, showLandingState) are in scope.
void resolveInviteLink();
