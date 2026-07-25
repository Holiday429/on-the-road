/* ==========================================================================
   On the Road · Boot — pure state-machine decisions (no DOM, no Firebase)

   Extracted so the branching that decides which shell to boot can be unit
   tested directly, without mounting the real app or mocking Firestore.
   ========================================================================== */

export interface BootInputs {
  /** A viewer invite link resolved before entry and set viewer mode. */
  viewerMode: boolean;
  /** The Firebase user known at the moment entry is attempted (possibly
   *  anonymous — a signed-in guest still counts as "known"). */
  user: { uid: string } | null;
}

export type BootPath =
  | { kind: 'viewer' }
  | { kind: 'authenticated'; uid: string }
  | { kind: 'guest' };

/** Which shell enterAppFlow() should boot, given what's known at call time. */
export function decideBootPath(inputs: BootInputs): BootPath {
  if (inputs.viewerMode) return { kind: 'viewer' };
  if (inputs.user) return { kind: 'authenticated', uid: inputs.user.uid };
  return { kind: 'guest' };
}

export interface AuthenticatedShellInputs {
  /** uid the shell was last mounted for, if any (null on first boot). */
  preparedUserId: string | null;
  /** uid of the user now signing in. */
  incomingUserId: string;
}

/**
 * bootAuthenticatedShell no-ops when the shell is already mounted for this
 * exact uid (re-entrant onAuth firings, e.g. after a redirect resolves).
 */
export function shouldSkipAuthenticatedBoot(inputs: AuthenticatedShellInputs): boolean {
  return inputs.preparedUserId === inputs.incomingUserId;
}

export interface OnAuthTransitionInputs {
  appEntered: boolean;
  viewerMode: boolean;
  invitePending: boolean;
  user: { uid: string; isAnonymous: boolean } | null;
}

export type OnAuthTransition =
  // App already open — update the shell in place for the new/cleared user.
  | { kind: 'update-shell'; user: { uid: string; isAnonymous: boolean } | null }
  // Viewer link resolved and the app hasn't entered yet — auto-enter.
  | { kind: 'viewer-auto-enter' }
  // An invite is still resolving — let it own the UI, do nothing.
  | { kind: 'wait-for-invite' }
  // No user yet and nothing else pending — show the landing/enter screen.
  | { kind: 'show-landing' }
  // A user is already known pre-entry — nothing to do until Enter is clicked.
  | { kind: 'noop' };

/** Mirrors the branching inside main.ts's onAuth callback, minus the actual
 *  DOM/shell side effects, so the routing decision can be tested in isolation. */
export function decideOnAuthTransition(inputs: OnAuthTransitionInputs): OnAuthTransition {
  if (inputs.appEntered) return { kind: 'update-shell', user: inputs.user };
  if (inputs.viewerMode) return { kind: 'viewer-auto-enter' };
  if (inputs.invitePending) return { kind: 'wait-for-invite' };
  if (!inputs.user) return { kind: 'show-landing' };
  return { kind: 'noop' };
}

export interface AnonUpgradeInputs {
  lastRenderedAnonymous: boolean;
  preparedUserId: string | null;
  user: { uid: string; isAnonymous: boolean };
}

/**
 * Detects an anonymous guest upgrading to a real Google account in place
 * (linkWithPopup keeps the same uid, so bootAuthenticatedShell early-returns
 * and the sidebar never re-renders on its own). True means the caller should
 * force a session re-render so the avatar swaps from "guest" to the real account.
 */
export function isAnonymousUpgrade(inputs: AnonUpgradeInputs): boolean {
  return inputs.lastRenderedAnonymous
    && inputs.preparedUserId === inputs.user.uid
    && !inputs.user.isAnonymous;
}
