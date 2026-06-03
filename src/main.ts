/* ==========================================================================
   On the Road · Entry point
   ========================================================================== */

import './core/base.css';
import './core/app.css';

import { initApp, registerView, renderSession } from './core/app.ts';
import { onAuth, signInWithGoogle, signOut } from './firebase/auth.ts';
import { initLandingMap } from './views/map/landing-map.ts';
import { ensureDefaultTrip, restoreActiveTrip } from './data/trip-context.ts';
import { migrateMultiTrip } from './data/migrate-multitrip.ts';
import { migrateRouteToCloud } from './data/migrate-route.ts';
import { migrateExpensesToCloud } from './data/migrate-expenses.ts';
import { initPrep }     from './views/prep/prep.ts';
import { initRoute }    from './views/route/route.ts';
import { initExpenses } from './views/expenses/expenses.ts';
import { initCities }   from './views/guide/guide.ts';
import { initJournal }  from './views/journal/index.ts';
import { initMap }      from './views/map/map.ts';
import { initNomad }    from './views/nomad/nomad.ts';
import { initStay }     from './views/stay/stay.ts';
import { initPack }     from './views/pack/pack.ts';
import { initSafety }   from './views/safety/safety.ts';

// Register lazy view inits (fire once on first navigation)
registerView('prep',     initPrep);
registerView('route',    initRoute);
registerView('expenses', initExpenses);
registerView('cities',   initCities);
registerView('journal',  initJournal);
registerView('map',      initMap);
registerView('nomad',    initNomad);
registerView('budget',   initStay);
registerView('pack',     initPack);
registerView('safety',   initSafety);

const authScreen = document.getElementById('auth-screen') as HTMLElement | null;
const authButton = document.getElementById('auth-google-btn') as HTMLButtonElement | null;
const authStatus = document.getElementById('auth-status') as HTMLElement | null;
const appRoot = document.getElementById('app') as HTMLElement | null;
const mapContainer = document.getElementById('landingMap') as HTMLElement | null;

let shellBooted = false;
let signingIn = false;
let signingOut = false;
let landingMapInitialized = false;
let animationDone = false;
let readyToEnter = false; // returning session: authenticated, waiting for user click

/* navigation 2.5s + hero shrink 1.1s + route fill ≈ 9.5s total */
const ANIMATION_DURATION_MS = 9500;

setTimeout(() => {
  animationDone = true;
  if (readyToEnter) showEnterButton();
}, ANIMATION_DURATION_MS);

function setAuthStatus(message: string, isError = false) {
  if (!authStatus) return;
  authStatus.textContent = message;
  authStatus.classList.toggle('is-error', isError);
}

function setAuthButtonBusy(busy: boolean) {
  if (!authButton) return;
  authButton.disabled = busy;
  if (!authButton.dataset.enterMode) {
    authButton.textContent = busy ? 'Connecting…' : 'Connect with Google';
  }
}

function showEnterButton() {
  if (!authButton) return;
  authButton.dataset.enterMode = '1';
  authButton.disabled = false;
  authButton.textContent = 'Enter the app →';
  setAuthStatus('Signed in. Ready when you are.');
}

function showSignedOut(message = 'Use your Google account to enter the app.') {
  authScreen?.removeAttribute('hidden');
  authScreen?.classList.remove('is-exiting');
  appRoot?.setAttribute('hidden', '');
  appRoot?.classList.remove('is-entering');
  if (authButton) delete authButton.dataset.enterMode;
  setAuthButtonBusy(signingIn);
  setAuthStatus(message);
}

function showSignedIn() {
  if (!authScreen || !appRoot) return;
  appRoot.removeAttribute('hidden');
  // Trigger reflow so the browser registers the starting opacity before the class is added
  void appRoot.offsetHeight;
  appRoot.classList.add('is-entering');
  authScreen.classList.add('is-exiting');
  authScreen.addEventListener('animationend', () => {
    authScreen.setAttribute('hidden', '');
    authScreen.classList.remove('is-exiting');
  }, { once: true });
}

function bootShellOnce() {
  if (shellBooted) return;
  initApp();
  shellBooted = true;
}

authButton?.addEventListener('click', async () => {
  // Returning session — enter directly
  if (authButton?.dataset.enterMode) {
    await bootApp();
    return;
  }

  if (signingIn) return;
  signingIn = true;
  setAuthButtonBusy(true);
  setAuthStatus('');

  try {
    await signInWithGoogle();
    // onAuth will fire and call bootApp() for fresh sign-ins
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sign-in failed. Please try again.';
    setAuthStatus(message, true);
  } finally {
    signingIn = false;
    setAuthButtonBusy(false);
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

let _bootUser: Awaited<Parameters<Parameters<typeof onAuth>[0]>[0]>['user'] | null = null;

async function bootApp() {
  if (!_bootUser) return;
  const user = _bootUser;
  showSignedIn();

  // Resolve the active trip BEFORE the shell mounts any views, so they
  // subscribe under the right tripId (no wrong-trip flash). Also run the
  // one-time migrations: multitrip first (it flattens legacy per-trip legs/
  // journal into the flat collections), then the legacy seeders.
  try { await ensureDefaultTrip(); }
  catch (e) { console.warn('Default trip bootstrap skipped:', e); }

  try {
    const n = await migrateMultiTrip();
    if (n > 0) console.info(`Flattened ${n} legs/journal entries for multi-trip.`);
  } catch (e) { console.warn('Multi-trip migration skipped:', e); }

  try {
    const n = await migrateRouteToCloud();
    if (n > 0) console.info(`Migrated ${n} itinerary legs to the cloud.`);
  } catch (e) { console.warn('Route migration skipped:', e); }

  try {
    const n = await migrateExpensesToCloud();
    if (n > 0) console.info(`Migrated ${n} expenses to the cloud.`);
  } catch (e) { console.warn('Expense migration skipped:', e); }

  try { await restoreActiveTrip(); }
  catch (e) { console.warn('Restore active trip skipped:', e); }

  bootShellOnce();
  renderSession(user, async () => {
    if (signingOut) return;
    signingOut = true;
    setAuthStatus('Signing you out…');
    try {
      await signOut();
    } finally {
      signingOut = false;
    }
  });
}

onAuth(async ({ user, ready }) => {
  if (!ready) {
    setAuthStatus('');
    return;
  }

  if (!user) {
    signingOut = false;
    _bootUser = null;
    showSignedOut();
    return;
  }

  _bootUser = user;

  if (signingIn) {
    // Fresh sign-in via button click — enter immediately after Google popup closes
    await bootApp();
  } else {
    // Returning session (page refresh) — show landing, wait for animation then user click
    readyToEnter = true;
    if (animationDone) showEnterButton();
    // else: the ANIMATION_DURATION_MS timeout will call showEnterButton() when ready
  }
});
