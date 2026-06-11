/* ==========================================================================
   On the Road · Entry point
   ========================================================================== */

import './core/base.css';
import './core/app.css';

import { initApp, registerView, renderSession, openOnboarding, navigateTo, type ViewId } from './core/app.ts';
import { onAuth, authReady, currentUser, signInWithGoogle, signInAsGuest, consumeRedirectResult, type User } from './firebase/auth.ts';
import { initLandingMap } from './views/map/landing-map.ts';
import { ensureDefaultTrip, restoreActiveTrip, checkAndAcceptEmailInvites } from './data/trip-context.ts';
import { migrateMultiTrip } from './data/migrate-multitrip.ts';
import { migrateRouteToCloud } from './data/migrate-route.ts';
import { migrateExpensesToCloud } from './data/migrate-expenses.ts';
import { migrateStaysToCompares } from './data/migrate-stays.ts';
import { migrateCollab } from './data/migrate-collab.ts';
import { initNotificationScheduler } from './core/notifications.ts';
import { initDashboard } from './views/today/dashboard.ts';
import { initCalendar } from './views/calendar/calendar.ts';
import { initPrep }     from './views/prep/prep.ts';
import { initRoute }    from './views/route/route.ts';
import { initExpenses } from './views/expenses/expenses.ts';
import { initCities }   from './views/guide/guide.ts';
import { initJournal }  from './views/journal/index.ts';
import { initMap }      from './views/map/map.ts';
import { initNomad }    from './views/nomad/nomad.ts';
import { initCompare }  from './views/compare/compare.ts';
import { initPack }     from './views/pack/pack.ts';
import { initSafety }   from './views/safety/safety.ts';

// Consume any pending Google redirect result on iOS PWA (runs before auth state settles).
void consumeRedirectResult();

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

  // Always stash the token first. If anything below fails, the token survives
  // the Google sign-in round-trip and consumePendingJoin() picks it up after
  // the user signs in — so we never strand an invited user on a bare page.
  const { savePendingJoin } = await import('./core/trip-share.ts');
  savePendingJoin(tok);

  try {
    // Wait for the Firebase auth state to settle before any Firestore read.
    await authReady();

    // Sign in anonymously up front so we can read the invite under any rules
    // (viewer invites are public, but editor invites require an authenticated
    // read). An anonymous session is harmless and gets upgraded if the user
    // later signs in with Google.
    if (!currentUser()) await signInAsGuest();

    const { getInvite } = await import('./data/trip-invites.ts');
    const inv = await getInvite(tok);

    if (!inv || inv.revoked) {
      clearInviteHash();
      invitePending = false;
      if (!appEntered) showLandingState();
      return;
    }

    if (inv.role === 'viewer') {
      // Viewer: accept the invite to become a viewer member, then auto-enter.
      const { acceptInvite } = await import('./data/trip-invites.ts');
      const { switchTrip } = await import('./data/trip-context.ts');
      await acceptInvite(tok);
      await switchTrip(inv.tripId);

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
      // Editor: personalise the landing card; the user must sign in with Google
      // to accept (the anonymous session can't claim editor rights). The stashed
      // token is consumed by consumePendingJoin() after real sign-in.
      invitePending = false;
      clearInviteHash();
      if (authCard) {
        const titleEl = authCard.querySelector('.auth-card-title');
        const textEl = authCard.querySelector('.auth-card-text');
        if (titleEl) titleEl.textContent = `You're invited to edit "${inv.tripName}"`;
        if (textEl) textEl.textContent = 'Sign in with Google to accept the edit invite and collaborate on this trip.';
      }
      if (!appEntered) showLandingState();
    }
  } catch (e) {
    console.warn('Invite link resolution failed:', e);
    // Token is already stashed; keep the hash so a refresh can retry and stop
    // blocking the UI so the user can at least sign in.
    invitePending = false;
    if (!appEntered) showLandingState();
  }
}

let shellBooted = false;
let signingIn = false;
let landingMapInitialized = false;
let bootPromise: Promise<void> | null = null;
let appPrepared = false;
let preparedUserId: string | null = null;
let guestShellReady = false;

const AUTH_ENTRY_TIMEOUT_MS = 1500;

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
  navigateTo('route'); // sensible default for viewing a shared trip
  await nextFrame();
  guestShellReady = true;
}

async function entryUser(): Promise<User | null> {
  try {
    return await Promise.race([
      authReady(),
      new Promise<User | null>((resolve) => {
        window.setTimeout(() => resolve(currentUser()), AUTH_ENTRY_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.warn('Auth readiness skipped:', error);
    return currentUser();
  }
}

async function bootAuthenticatedShell(user: User) {
  if (user.isAnonymous) return; // anonymous viewers use bootViewerShell instead
  if (preparedUserId === user.uid) return;
  if (bootPromise) {
    await bootPromise;
    return;
  }

  prepareAppFrame();

  bootPromise = (async () => {
    let needsOnboarding = false;

    // Legacy localStorage→cloud migrations first. These read localStorage and,
    // for older accounts, seed the OLD users/{uid}/** layout. They early-return
    // via their own done-flags for accounts already on the cloud. migrateMultiTrip
    // operates entirely on users/{uid}/** (always permitted).
    try {
      const n = await migrateMultiTrip();
      if (n > 0) console.info(`Flattened ${n} legs/journal entries for multi-trip.`);
    } catch (e) { console.warn('Multi-trip migration skipped:', e); }

    // Collaboration migration: copy users/{uid}/trips/** and the flat tagged
    // collections into the new top-level trips/**. Copy-only, non-destructive.
    // MUST run before anything reads/subscribes the new trips/** paths
    // (ensureDefaultTrip, the route/expense legacy migrations, view stores).
    try {
      const r = await migrateCollab();
      if (r.trips > 0 || r.docs > 0) console.info(`Collab migration: ${r.trips} trips, ${r.docs} docs copied to trips/**.`);
    } catch (e) { console.warn('Collab migration skipped:', e); }

    // These now target trips/** (via the repathed stores). They early-return
    // for accounts already migrated; run after collab so the trip docs exist.
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

    // Handle an invite link. The landing IIFE already stashed any #/join/{token}
    // into sessionStorage. openJoinFromHash() handles the case where the user
    // was already signed in at page load (hash still present); consumePendingJoin()
    // handles the case where they signed in after the token was stashed.
    // Both reload on success, so the rest of this boot is moot if they return true.
    try {
      const { openJoinFromHash, consumePendingJoin } = await import('./core/trip-share.ts');
      const joinedFromHash = await openJoinFromHash();
      if (joinedFromHash) return;
      const joinedFromStorage = await consumePendingJoin();
      if (joinedFromStorage) return;
    } catch (e) { console.warn('Join-from-link skipped:', e); }

    try {
      const trip = await ensureDefaultTrip();
      needsOnboarding = trip === null;
    } catch (e) { console.warn('Default trip bootstrap skipped:', e); }

    try { await restoreActiveTrip(); }
    catch (e) { console.warn('Restore active trip skipped:', e); }

    // Check for email-based editor invites and auto-accept them.
    try {
      const joined = await checkAndAcceptEmailInvites();
      if (joined > 0) console.info(`Auto-accepted ${joined} email invite(s).`);
    } catch (e) { console.warn('Email invite check skipped:', e); }

    bootShellOnce();
    renderSession(user, handleSidebarAuth);
    navigateTo(currentViewOrDefault());
    preparedUserId = user.uid;
    guestShellReady = false;

    initNotificationScheduler();

    if (needsOnboarding) {
      openOnboarding();
    }

    await nextFrame();
  })();

  try {
    await bootPromise;
  } finally {
    bootPromise = null;
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
    const user = await entryUser();
    if (user && !user.isAnonymous) {
      await bootAuthenticatedShell(user);
    } else {
      // No user, or only an anonymous session (e.g. from an editor invite that
      // wasn't accepted) — boot as guest.
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

  // If the app is already open (user signed in/out after entering), update the shell.
  if (appEntered) {
    if (user) {
      // Anonymous viewer signs in with Google: upgrade to full authenticated shell.
      if (_viewerMode && !user.isAnonymous) {
        _viewerMode = false;
        _viewerTripId = null;
        appRoot?.removeAttribute('data-viewer');
      }
      // Don't re-boot for anonymous user (viewer shell already running).
      if (user.isAnonymous) return;
      await bootAuthenticatedShell(user);
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
    preparedUserId = null;
    showLandingState();
  }
});

// Kick off invite-link resolution. Defined above; called here so all the
// shell helpers (bootViewerShell, enterApp, showLandingState) are in scope.
void resolveInviteLink();
