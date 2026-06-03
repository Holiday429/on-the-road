/* ==========================================================================
   On the Road · Entry point
   ========================================================================== */

import './core/base.css';
import './core/app.css';

import { initApp, registerView, renderSession, openOnboarding, navigateTo, type ViewId } from './core/app.ts';
import { onAuth, signInWithGoogle, type User } from './firebase/auth.ts';
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
const authCardTitle = document.getElementById('auth-card-title') as HTMLElement | null;
const authCardText = document.getElementById('auth-card-text') as HTMLElement | null;
const authUserPreview = document.getElementById('auth-user-preview') as HTMLElement | null;
const authStatus = document.getElementById('auth-status') as HTMLElement | null;
const appRoot = document.getElementById('app') as HTMLElement | null;
const mapContainer = document.getElementById('landingMap') as HTMLElement | null;

let shellBooted = false;
let signingIn = false;
let landingMapInitialized = false;
let bootPromise: Promise<void> | null = null;
let appPrepared = false;
let appEntered = false;
let currentAuthUser: User | null = null;
let preparedUserId: string | null = null;
let guestShellReady = false;

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
  const valid: ViewId[] = ['prep', 'route', 'expenses', 'pack', 'cities', 'budget', 'safety', 'journal', 'map', 'nomad'];
  return valid.includes(hash) ? hash : 'prep';
}

function renderAuthPreview(user: User | null) {
  if (!authUserPreview) return;
  if (!user) {
    authUserPreview.setAttribute('hidden', '');
    authUserPreview.innerHTML = '';
    return;
  }

  const source = user.displayName?.trim() || user.email?.trim() || 'Traveler';
  const initials = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'OT';
  const avatar = user.photoURL?.trim()
    ? `<img src="${user.photoURL}" alt="${source}">`
    : `<div class="auth-user-preview-fallback">${initials}</div>`;

  authUserPreview.innerHTML = `
    <div class="auth-user-preview-avatar">${avatar}</div>
    <div class="auth-user-preview-meta">
      <div class="auth-user-preview-name">${source}</div>
      <div class="auth-user-preview-note">Already connected. Enter whenever you want.</div>
    </div>
  `;
  authUserPreview.removeAttribute('hidden');
}

function renderAuthCard(user: User | null) {
  if (authCardTitle) authCardTitle.textContent = 'Enter the website';
  if (authCardText) {
    authCardText.textContent = user
      ? 'Your workspace is ready in the background. Enter after you click.'
      : 'Enter first. If you want to sync trips later, use the avatar in the sidebar to connect Google.';
  }
  renderAuthPreview(user);
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
  renderAuthCard(currentAuthUser);
  setAuthButtonState('Enter the website', false);
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

async function bootAuthenticatedShell(user: User) {
  if (preparedUserId === user.uid) return;
  if (bootPromise) {
    await bootPromise;
    return;
  }

  prepareAppFrame();

  bootPromise = (async () => {
    let needsOnboarding = false;
    try {
      const trip = await ensureDefaultTrip();
      needsOnboarding = trip === null;
    } catch (e) { console.warn('Default trip bootstrap skipped:', e); }

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
    renderSession(user, handleSidebarAuth);
    navigateTo(currentViewOrDefault());
    preparedUserId = user.uid;
    guestShellReady = false;

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

authButton?.addEventListener('click', async () => {
  if (currentAuthUser) {
    setAuthButtonState('Preparing…', true);
    setAuthStatus('Loading your workspace…');
    await bootAuthenticatedShell(currentAuthUser);
    enterApp();
    setAuthStatus('');
    return;
  }

  setAuthButtonState('Entering…', true);
  setAuthStatus('Opening the website…');
  await bootGuestShell();
  enterApp();
  setAuthStatus('');
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

onAuth(async ({ user, ready }) => {
  if (!ready) {
    setAuthStatus('');
    return;
  }

  currentAuthUser = user;
  renderAuthCard(user);

  if (!user) {
    preparedUserId = null;
    if (appEntered) {
      renderSession(null, handleSidebarAuth);
      navigateTo(currentViewOrDefault());
    } else {
      showLandingState();
    }
    return;
  }

  if (appEntered) {
    await bootAuthenticatedShell(user);
    return;
  }

  setAuthButtonState('Preparing…', true);
  setAuthStatus('Loading your workspace…');
  await bootAuthenticatedShell(user);
  setAuthButtonState('Enter the website', false);
  setAuthStatus('Ready when you are.');
});
