/* ==========================================================================
   On the Road · Auth
   --------------------------------------------------------------------------
   Google sign-in wrapper. Single source of truth for "who is signed in".
   Public version-ready: nothing here assumes a single hard-coded user.

   iOS PWA note: signInWithPopup is blocked in iOS standalone mode. We detect
   that context and use signInWithRedirect instead, which survives the
   page-reload round-trip. The redirect result is consumed on app boot via
   consumeRedirectResult(), which main.ts calls once before rendering.
   ========================================================================== */

import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInAnonymously as fbSignInAnonymously,
  linkWithPopup,
  linkWithRedirect,
  signInWithCredential,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { auth } from './config.ts';

export type { User };

const provider = new GoogleAuthProvider();

/** iOS Safari in standalone (PWA) mode blocks popups — use redirect flow instead. */
function isIosPwa(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Current user, or null. Synchronous read for code that runs after `ready`. */
let _user: User | null = null;
let _ready = false;

type Listener = (state: { user: User | null; ready: boolean }) => void;
const listeners = new Set<Listener>();

function publishAuthState(user: User | null) {
  _user = user;
  _ready = true;
  listeners.forEach((fn) => fn({ user: _user, ready: _ready }));
}

onAuthStateChanged(
  auth,
  (user) => publishAuthState(user),
  (error) => {
    console.warn('Auth state initialization failed:', error);
    publishAuthState(null);
  },
);

/** Subscribe to auth changes. Fires immediately with the current state. Returns an unsubscribe fn. */
export function onAuth(fn: Listener): () => void {
  listeners.add(fn);
  fn({ user: _user, ready: _ready });
  return () => listeners.delete(fn);
}

/** Resolves once the first auth state is known (signed in or not). */
export function authReady(): Promise<User | null> {
  if (_ready) return Promise.resolve(_user);
  return new Promise((resolve) => {
    const off = onAuth(({ user, ready }) => {
      if (ready) { off(); resolve(user); }
    });
  });
}

export function currentUser(): User | null {
  return _user;
}

/** True when the current session is an anonymous (guest) account. */
export function isAnonymous(): boolean {
  return !!_user?.isAnonymous;
}

/** True when signed in with a real (non-anonymous) provider. */
export function isSignedInReal(): boolean {
  return !!_user && !_user.isAnonymous;
}

/**
 * Sign in anonymously so a guest gets a real uid and the (uid-keyed) data layer
 * works fully — trips, expenses, etc. all persist to Firestore. The account can
 * later be upgraded to Google in place via signInWithGoogle(), preserving data.
 * No-op if a user is already signed in.
 */
export async function signInAnonymously(): Promise<User> {
  if (_user) return _user;
  const result = await fbSignInAnonymously(auth);
  return result.user;
}

/**
 * Call once on app boot to resolve any pending Google redirect sign-in.
 * On iOS PWA, signInWithGoogle() uses redirect; the result arrives here
 * on the next page load. Safe to call on desktop (returns null quickly).
 */
export async function consumeRedirectResult(): Promise<User | null> {
  try {
    const result = await getRedirectResult(auth);
    return result?.user ?? null;
  } catch (e) {
    // On iOS PWA, a linkWithRedirect upgrade of a guest whose Google account
    // already exists fails here with credential-already-in-use. Fall back to
    // signing into that existing account (the guest's data is abandoned — the
    // standard linking tradeoff, mirroring the popup path in signInWithGoogle).
    const code = (e as { code?: string }).code;
    if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
      const cred = GoogleAuthProvider.credentialFromError(e as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]);
      if (cred) {
        try {
          const result = await signInWithCredential(auth, cred);
          return result.user;
        } catch (e2) {
          console.warn('Redirect credential sign-in fallback failed:', e2);
        }
      }
    }
    console.warn('getRedirectResult error (safe to ignore if no redirect was pending):', e);
    return null;
  }
}

export async function signInWithGoogle(): Promise<User> {
  // Upgrade path: an anonymous guest links Google to their existing account, so
  // the uid (and therefore all their trips/data) is preserved. Falls back to a
  // plain sign-in if no anonymous session is active.
  const anon = _user?.isAnonymous ? _user : null;

  if (isIosPwa()) {
    // Redirect flow — page reloads after Google auth; result consumed by
    // consumeRedirectResult(). linkWithRedirect upgrades the anon account.
    if (anon) await linkWithRedirect(anon, provider);
    else await signInWithRedirect(auth, provider);
    // Navigates away — never reached, but TypeScript needs a return value.
    return new Promise(() => {/* resolved after redirect */});
  }

  if (anon) {
    try {
      const result = await linkWithPopup(anon, provider);
      return result.user;
    } catch (e) {
      // The Google account already exists (returning user). We can't merge two
      // accounts client-side, so switch to the existing one — the guest's local
      // data is abandoned. This is the standard linking tradeoff.
      const code = (e as { code?: string }).code;
      if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
        const cred = GoogleAuthProvider.credentialFromError(e as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]);
        if (cred) {
          const result: UserCredential = await signInWithCredential(auth, cred);
          return result.user;
        }
      }
      throw e;
    }
  }

  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}
