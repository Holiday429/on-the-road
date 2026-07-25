/* ==========================================================================
   On the Road · Boot — shell state machine (guest / viewer / authenticated)
   ========================================================================== */

import { initApp, renderSession, navigateTo, reinitForTripChange, setAllowedViews, firstAllowedView, openOnboarding, type ViewId } from './core/app.ts';
import { onAuth, currentUser, signInWithGoogle, signInAnonymously, consumeRedirectResult, type User } from './firebase/auth.ts';
import { ensureDefaultTrip, restoreActiveTrip, currentMemberPages, currentTripId } from './data/trip-context.ts';
import { isCollabMigrated } from './data/migrate-collab.ts';
import { runPreTripMigrations, runPostEntryTasks } from './boot-migrations.ts';
import { initNotificationScheduler } from './core/notifications.ts';
import { initTouchTooltips } from './core/touch.ts';
import {
  decideBootPath, shouldSkipAuthenticatedBoot, decideOnAuthTransition, isAnonymousUpgrade,
} from './boot-flow.ts';
import { INVITE_TOKEN, resolveInviteLink, showAccessRequestToast, showErrorToast } from './boot-invite.ts';

// Consume any pending Google redirect result on iOS PWA. Must resolve before
// the onAuth callback can act on the resulting user — we store the promise and
// gate onAuth on it so the redirect user isn't lost to a race condition.
let _redirectConsumed = false;
const redirectResultPromise = consumeRedirectResult().then((u) => {
  _redirectConsumed = true;
  return u;
}).catch(() => { _redirectConsumed = true; return null; });

const authScreen = document.getElementById('auth-screen') as HTMLElement | null;
const authButton = document.getElementById('auth-google-btn') as HTMLButtonElement | null;
const authStatus = document.getElementById('auth-status') as HTMLElement | null;
const authCard = document.querySelector<HTMLElement>('.auth-card');
const appRoot = document.getElementById('app') as HTMLElement | null;

// Set when a viewer invite boots the app without auth.
let _viewerMode = false;
let _viewerTripId: string | null = null;
export function isViewerMode(): boolean { return _viewerMode; }
export function viewerTripId(): string | null { return _viewerTripId; }

let appEntered = false;

// True while we're still resolving an invite link, so onAuth and the Enter
// button know not to fall back to the landing/guest flow prematurely.
let invitePending = INVITE_TOKEN !== null;

let shellBooted = false;
let signingIn = false;
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

  // Warm the offline cache with every view's chunk. Only meaningful online;
  // if we entered offline, retry once the connection returns.
  if (navigator.onLine) prefetchViewChunks();
  else window.addEventListener('online', prefetchViewChunks, { once: true });
}

// Raw module loaders for the lazy views, injected by main.ts (avoids this
// module needing to know every view's import path).
let _viewChunkLoaders: (() => Promise<unknown>)[] = [];
export function setViewChunkLoaders(loaders: (() => Promise<unknown>)[]): void {
  _viewChunkLoaders = loaders;
}

// Background-prefetch every view chunk once the app is idle after entry, so a
// view opens offline even on its first-ever visit (the SW caches each chunk as
// it downloads). Sequential + idle-scheduled so it never competes with the
// active view's own work or the initial paint. Failures are silent — this is
// pure enhancement, and a missing chunk just falls back to on-demand loading.
let _chunksPrefetched = false;
function prefetchViewChunks(): void {
  if (_chunksPrefetched) return;
  _chunksPrefetched = true;
  const schedule = (fn: () => void) =>
    'requestIdleCallback' in window
      ? (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(fn)
      : setTimeout(fn, 1200);
  let i = 0;
  const next = () => {
    if (i >= _viewChunkLoaders.length) return;
    const load = _viewChunkLoaders[i++];
    load().catch(() => {}).finally(() => schedule(next));
  };
  schedule(next);
}

function bootShellOnce() {
  if (shellBooted) return;
  initApp();
  initTouchTooltips();
  shellBooted = true;
}

function signInFailureMessage(error: unknown): string | null {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup — allow popups for this site and try again.';
    case 'auth/cancelled-popup-request':
    case 'auth/popup-closed-by-user':
      return null; // user dismissed it on purpose — no need to nag
    case 'auth/unauthorized-domain':
      return 'This domain isn’t authorized for Google sign-in yet.';
    default:
      return 'Sign-in failed — please try again.';
  }
}

async function handleSidebarAuth() {
  if (signingIn) return;
  signingIn = true;
  try {
    await signInWithGoogle();
  } catch (error) {
    console.warn('Sidebar sign-in failed:', error);
    const message = signInFailureMessage(error);
    if (message) showErrorToast(message);
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
  if (shouldSkipAuthenticatedBoot({ preparedUserId, incomingUserId: user.uid })) return;
  if (bootPromise) {
    await bootPromise;
    return;
  }

  prepareAppFrame();

  // Trip the shell was last built on (if any). When an anonymous guest upgrades
  // to Google in place, the shell is already mounted on the guest's trip; the
  // active trip then changes silently below. We compare against this to rebind
  // the already-mounted views to the new trip after entry.
  const shellWasBooted = shellBooted;
  const prevTripId = currentTripId();

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
    // If the shell was already mounted (guest boot) on a different trip, its
    // views are still subscribed to the old trip's collections. navigateTo()
    // won't re-init an already-mounted view, and the boot-time trip restore
    // doesn't broadcast onTripChange — so rebind mounted views to the new trip
    // here. Without this the Today hero/weather stay stuck on the guest state
    // until a manual refresh.
    if (shellWasBooted && currentTripId() !== prevTripId) {
      reinitForTripChange();
    }
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
    void runPostEntryAndRepaint(user, needsOnboarding, tookSlowPath);
  })();

  try {
    await bootPromise;
  } finally {
    bootPromise = null;
  }
}

async function runPostEntryAndRepaint(user: User, alreadyOnboarding: boolean, migrationsAlreadyRan: boolean): Promise<void> {
  const { dataChanged, accessRequestToastPending: toastPending } = await runPostEntryTasks(migrationsAlreadyRan);
  if (toastPending) accessRequestToastPending = true;

  if (accessRequestToastPending) {
    accessRequestToastPending = false;
    showAccessRequestToast();
  }

  // Repaint only when background migrations / invites actually moved data the
  // user can see, and we're still in this same authenticated session (not
  // onboarding, not switched out).
  if (dataChanged && !alreadyOnboarding && preparedUserId === user.uid) {
    renderSession(user, handleSidebarAuth);
    navigateTo(currentViewOrDefault());
  }
}

// Enter the app — boots the right shell and runs the fade-out. Always just enters,
// no auth state shown on the preload screen. If Firebase already resolved a user in
// the background, boot the authenticated shell; viewer invite → boot viewer shell
// directly without auth. Otherwise boot as guest. Google sign-in is handled
// exclusively via the sidebar avatar.
async function enterAppFlow(): Promise<void> {
  setAuthButtonState('Entering…', true);
  setAuthStatus('');
  try {
    if (decideBootPath({ viewerMode: _viewerMode, user: null }).kind === 'viewer') {
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
    const path = decideBootPath({ viewerMode: false, user: user ? { uid: user.uid } : null });
    if (path.kind === 'authenticated' && user) {
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
}

function upgradeFromViewerMode() {
  _viewerMode = false;
  _viewerTripId = null;
  appRoot?.removeAttribute('data-viewer');
  setAllowedViews(null); // restore full nav for the now-authenticated member
}

export function startBoot(): void {
  authButton?.addEventListener('click', () => { void enterAppFlow(); });

  // Arriving from the marketing page (/app?from=landing): the user already made the
  // "open the app" decision there, so skip the Enter card and boot straight in. Only
  // for the normal entry flow — an invite link owns the UI and must not be bypassed.
  if (!INVITE_TOKEN && new URLSearchParams(window.location.search).get('from') === 'landing') {
    // Drop the query so a refresh/share of the in-app URL doesn't re-trigger the skip.
    history.replaceState(null, '', window.location.pathname + window.location.hash);
    void enterAppFlow();
  }

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

    const transition = decideOnAuthTransition({
      appEntered,
      viewerMode: _viewerMode,
      invitePending,
      user: user ? { uid: user.uid, isAnonymous: !!user.isAnonymous } : null,
    });

    switch (transition.kind) {
      case 'update-shell': {
        if (user) {
          // A viewer signs in with Google: upgrade from read-only to full shell.
          if (_viewerMode) upgradeFromViewerMode();
          const wasAnon = isAnonymousUpgrade({
            lastRenderedAnonymous,
            preparedUserId,
            user: { uid: user.uid, isAnonymous: !!user.isAnonymous },
          });
          await bootAuthenticatedShell(user);
          if (wasAnon) renderSession(user, handleSidebarAuth);
          lastRenderedAnonymous = !!user.isAnonymous;
        } else {
          preparedUserId = null;
          renderSession(null, handleSidebarAuth);
          navigateTo(currentViewOrDefault());
        }
        return;
      }
      case 'viewer-auto-enter': {
        try {
          await bootViewerShell();
          enterApp();
        } catch (e) { console.warn('Viewer auto-enter failed:', e); }
        return;
      }
      case 'wait-for-invite':
        return;
      case 'show-landing': {
        // If a redirect was just consumed, Firebase will fire onAuth again with the
        // real user shortly. Don't flash the landing screen in the interim.
        const redirectUser = await redirectResultPromise;
        if (redirectUser) return;
        preparedUserId = null;
        showLandingState();
        return;
      }
      case 'noop':
        return;
    }
  });

  // Kick off invite-link resolution. Called here so all the shell helpers
  // (bootViewerShell, enterApp, showLandingState) are in scope via the host.
  void resolveInviteLink({
    authCard,
    authButton,
    appRoot,
    isAppEntered: () => appEntered,
    setInvitePending: (p) => { invitePending = p; },
    setViewerMode: (tripId) => { _viewerMode = true; _viewerTripId = tripId; },
    showLandingState,
    bootViewerShell,
    enterApp,
  });
}
