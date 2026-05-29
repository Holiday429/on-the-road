/* ==========================================================================
   On the Road · Auth
   --------------------------------------------------------------------------
   Google sign-in wrapper. Single source of truth for "who is signed in".
   Public version-ready: nothing here assumes a single hard-coded user.
   ========================================================================== */

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { auth } from './config.ts';

export type { User };

const provider = new GoogleAuthProvider();

/** Current user, or null. Synchronous read for code that runs after `ready`. */
let _user: User | null = null;
let _ready = false;

type Listener = (state: { user: User | null; ready: boolean }) => void;
const listeners = new Set<Listener>();

onAuthStateChanged(auth, (user) => {
  _user = user;
  _ready = true;
  listeners.forEach((fn) => fn({ user: _user, ready: _ready }));
});

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

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOut(): Promise<void> {
  await fbSignOut(auth);
}
