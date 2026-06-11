/* ==========================================================================
   On the Road · Entry point
   ========================================================================== */

import './core/base.css';
import './core/app.css';

import { initApp, registerView, renderSession, openOnboarding, navigateTo, type ViewId } from './core/app.ts';
import { onAuth, authReady, currentUser, signInWithGoogle, consumeRedirectResult, type User } from './firebase/auth.ts';
import { initLandingMap } from './views/map/landing-map.ts';
import { ensureDefaultTrip, restoreActiveTrip } from './data/trip-context.ts';
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
const appRoot = document.getElementById('app') as HTMLElement | null;
const mapContainer = document.getElementById('landingMap') as HTMLElement | null;

let shellBooted = false;
let signingIn = false;
let landingMapInitialized = false;
let bootPromise: Promise<void> | null = null;
let appPrepared = false;
let appEntered = false;
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

    // Handle an invite link (#/join/{token}) before normal trip bootstrap.
    // If it accepts, the page reloads under the joined trip and the rest of
    // this boot is moot.
    try {
      const { openJoinFromHash } = await import('./core/trip-share.ts');
      const joined = await openJoinFromHash();
      if (joined) return; // confirm dialog + reload took over
    } catch (e) { console.warn('Join-from-link skipped:', e); }

    try {
      const trip = await ensureDefaultTrip();
      needsOnboarding = trip === null;
    } catch (e) { console.warn('Default trip bootstrap skipped:', e); }

    try { await restoreActiveTrip(); }
    catch (e) { console.warn('Restore active trip skipped:', e); }

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
// otherwise boot as guest. Google sign-in is handled exclusively via the sidebar avatar.
authButton?.addEventListener('click', async () => {
  setAuthButtonState('Entering…', true);
  setAuthStatus('');
  try {
    const user = await entryUser();
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

  // If the app is already open (user signed in/out after entering), update the shell.
  if (appEntered) {
    if (user) {
      await bootAuthenticatedShell(user);
    } else {
      preparedUserId = null;
      renderSession(null, handleSidebarAuth);
      navigateTo(currentViewOrDefault());
    }
    return;
  }

  // Preload screen is still showing — wait for the user to click Enter.
  // Just record the auth user so the Enter button knows which shell to boot.
  if (!user) {
    preparedUserId = null;
    showLandingState();
  }
});
