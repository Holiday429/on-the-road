/* ==========================================================================
   On the Road · Entry point
   ========================================================================== */

import './core/base.css';
import './core/app.css';

import { initApp, registerView, renderSession } from './core/app.ts';
import { onAuth, signInWithGoogle, signOut } from './firebase/auth.ts';
import { ensureDefaultTrip } from './data/trip-context.ts';
import { initPrep }     from './views/prep/prep.ts';
import { initRoute }    from './views/route/route.ts';
import { initExpenses } from './views/expenses/expenses.ts';
import { initCities }   from './views/cities/cities.ts';
import { initMap }      from './views/map/map.ts';
import { initStubs }    from './views/stubs.ts';

// Register lazy view inits (fire once on first navigation)
registerView('prep',     initPrep);
registerView('route',    initRoute);
registerView('expenses', initExpenses);
registerView('cities',   initCities);
registerView('map',      initMap);

const authScreen = document.getElementById('auth-screen') as HTMLElement | null;
const authButton = document.getElementById('auth-google-btn') as HTMLButtonElement | null;
const authStatus = document.getElementById('auth-status') as HTMLElement | null;
const appRoot = document.getElementById('app') as HTMLElement | null;

let shellBooted = false;
let signingIn = false;
let signingOut = false;

function setAuthStatus(message: string, isError = false) {
  if (!authStatus) return;
  authStatus.textContent = message;
  authStatus.classList.toggle('is-error', isError);
}

function setAuthButtonBusy(busy: boolean) {
  if (!authButton) return;
  authButton.disabled = busy;
  authButton.textContent = busy ? 'Connecting…' : 'Continue with Google';
}

function showSignedOut(message = 'Use your Google account to enter the app.') {
  authScreen?.removeAttribute('hidden');
  appRoot?.setAttribute('hidden', '');
  setAuthButtonBusy(signingIn);
  setAuthStatus(message);
}

function showSignedIn() {
  authScreen?.setAttribute('hidden', '');
  appRoot?.removeAttribute('hidden');
}

function bootShellOnce() {
  if (shellBooted) return;
  initApp();
  initStubs();
  shellBooted = true;
}

authButton?.addEventListener('click', async () => {
  if (signingIn) return;
  signingIn = true;
  setAuthButtonBusy(true);
  setAuthStatus('Opening Google sign-in…');

  try {
    await signInWithGoogle();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google sign-in failed.';
    setAuthStatus(message, true);
  } finally {
    signingIn = false;
    setAuthButtonBusy(false);
  }
});

onAuth(async ({ user, ready }) => {
  if (!ready) {
    setAuthButtonBusy(true);
    setAuthStatus('Checking your session…');
    return;
  }

  if (!user) {
    signingOut = false;
    showSignedOut();
    return;
  }

  showSignedIn();
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

  try {
    await ensureDefaultTrip();
  } catch (error) {
    console.warn('Default trip bootstrap skipped:', error);
  }
});
