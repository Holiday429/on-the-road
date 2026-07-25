/* ==========================================================================
   On the Road · Boot — invite-link resolution
   ========================================================================== */

import { authReady, currentUser } from './firebase/auth.ts';
import { setAllowedViews, type ViewId } from './core/app.ts';
import { getInvite } from './data/trip-invites.ts';

// Capture any invite token from the URL SYNCHRONOUSLY, at module-eval time,
// before any await yields control. This is the single source of truth for
// "is this an invite link" — nothing else reads window.location.hash for
// joins, and the hash is NOT cleared here. We clear it only after the invite
// has been acted on, so a failed/slow read never loses the token.
export const INVITE_TOKEN: string | null = (() => {
  const m = window.location.hash.match(/^#\/join\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
})();

function clearInviteHash() {
  if (window.location.hash.startsWith('#/join/')) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

/** Transient toast confirming an edit-access request was submitted. */
export function showAccessRequestToast(): void {
  const el = document.createElement('div');
  el.textContent = '✓ Edit access requested — the owner will approve it.';
  el.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#16a34a;color:#fff;padding:.6rem 1.25rem;border-radius:9999px;font-size:.875rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.2)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/** Transient error toast — e.g. the Google sign-in popup was blocked or failed. */
export function showErrorToast(message: string): void {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#dc2626;color:#fff;padding:.6rem 1.25rem;border-radius:9999px;font-size:.875rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.2);max-width:calc(100vw - 2rem);text-align:center';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/** Replace the landing card with a "request sent" confirmation (reveals
 *  nothing about the trip beyond its name). */
function showRequestSentCard(authCard: HTMLElement | null, authButton: HTMLButtonElement | null, tripName: string, created: boolean): void {
  if (!authCard) return;
  const titleEl = authCard.querySelector('.auth-card-title');
  const textEl = authCard.querySelector('.auth-card-text');
  if (titleEl) titleEl.textContent = created ? 'Request sent' : 'Already requested';
  if (textEl) {
    textEl.textContent = created
      ? `Your request to edit "${tripName}" was sent. You'll get access once the owner approves it.`
      : `You've already requested access to "${tripName}". Hang tight for the owner to approve.`;
  }
  // Hide the Enter/sign-in button — nothing to do until approval.
  authButton?.setAttribute('hidden', '');
}

export interface InviteResolutionHost {
  authCard: HTMLElement | null;
  authButton: HTMLButtonElement | null;
  appRoot: HTMLElement | null;
  isAppEntered(): boolean;
  setInvitePending(pending: boolean): void;
  setViewerMode(tripId: string): void;
  showLandingState(): void;
  bootViewerShell(): Promise<void>;
  enterApp(): void;
}

/**
 * Resolve the invite link captured in INVITE_TOKEN. Runs once on boot. Waits
 * for Firebase auth to be ready before touching Firestore (an unauthenticated
 * read fired before auth initialises is what previously failed and dropped
 * us back to "/").
 */
export async function resolveInviteLink(host: InviteResolutionHost): Promise<void> {
  if (!INVITE_TOKEN) return;
  const tok = INVITE_TOKEN;

  try {
    // Wait for the Firebase auth state to settle before any Firestore read.
    await authReady();

    const inv = await getInvite(tok);

    if (!inv || inv.revoked) {
      clearInviteHash();
      host.setInvitePending(false);
      if (!host.isAppEntered()) host.showLandingState();
      return;
    }

    // If a real (non-anonymous) user is already signed in AND is a member of
    // the invited trip — e.g. the owner opening their own share link — never
    // enter read-only viewer mode. Drop the invite and let the normal
    // authenticated shell boot with full edit rights.
    const signedInUser = currentUser();
    if (signedInUser) {
      const { getTrip } = await import('./data/trip-context.ts');
      const trip = await getTrip(inv.tripId);
      const members = (trip as { members?: Record<string, string> } | null)?.members;
      if (members && members[signedInUser.uid]) {
        host.setInvitePending(false);
        clearInviteHash();
        return; // normal boot (Enter button / onAuth) handles the rest
      }
    }

    if (inv.role === 'viewer') {
      // Viewer: read the trip publicly (no login, no membership write). The trip
      // doc and its sub-collections are readable when publicView.enabled is set,
      // which every viewer invite guarantees. switchTrip() loads it into context.
      const { switchTrip } = await import('./data/trip-context.ts');
      await switchTrip(inv.tripId);

      // Restrict the nav to the pages this specific link exposes. An empty
      // pages list (legacy viewer invite) means "all pages" → null restriction.
      setAllowedViews(inv.pages?.length ? (inv.pages as ViewId[]) : null);

      host.setViewerMode(inv.tripId);
      host.appRoot?.setAttribute('data-viewer', 'true');
      host.setInvitePending(false);
      clearInviteHash();

      if (!host.isAppEntered()) {
        await host.bootViewerShell();
        host.enterApp();
      }
    } else {
      // Editor link: never auto-grants. Requires login + owner approval.
      const { savePendingAccessRequest, submitAccessRequest } = await import('./core/trip-share.ts');
      host.setInvitePending(false);
      clearInviteHash();

      if (currentUser()) {
        // Signed-in non-member (the member short-circuit above already returned
        // for existing members): submit an access request and show confirmation.
        const created = await submitAccessRequest(tok);
        showRequestSentCard(host.authCard, host.authButton, inv.tripName, created);
      } else {
        // Not signed in: stash the token so the request is created right after
        // Google sign-in (consumePendingAccessRequest), and prompt to sign in.
        savePendingAccessRequest(tok);
        if (host.authCard) {
          const titleEl = host.authCard.querySelector('.auth-card-title');
          const textEl = host.authCard.querySelector('.auth-card-text');
          if (titleEl) titleEl.textContent = `You've been invited to edit "${inv.tripName}"`;
          if (textEl) textEl.textContent = 'Sign in with Google to request edit access. The owner will approve your request.';
        }
      }
      if (!host.isAppEntered()) host.showLandingState();
    }
  } catch (e) {
    console.warn('Invite link resolution failed:', e);
    host.setInvitePending(false);
    if (!host.isAppEntered()) host.showLandingState();
  }
}
