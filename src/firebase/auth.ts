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
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
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
    console.warn('getRedirectResult error (safe to ignore if no redirect was pending):', e);
    return null;
  }
}

export async function signInWithGoogle(): Promise<User> {
  if (isIosPwa()) {
    // Redirect flow — page reloads after Google auth; result consumed by consumeRedirectResult().
    await signInWithRedirect(auth, provider);
    // signInWithRedirect navigates away so this line is never reached,
    // but TypeScript needs a return value.
    return new Promise(() => {/* resolved after redirect */});
  }
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}
