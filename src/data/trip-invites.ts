/* ==========================================================================
   On the Road · Trip invites
   --------------------------------------------------------------------------
   Invite links let a trip owner share a trip with collaborators.

   An invite is a doc at tripInvites/{token}; the token is the doc id and the
   shareable code. Anyone signed in can read an invite (to see what it grants),
   and accepting it adds the accepting user to the trip's members — gated by
   security rules (see firestore.rules, isSelfJoin).
   ========================================================================== */

import {
  doc as fbDoc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, arrayUnion, deleteField,
} from 'firebase/firestore';
import { db as firestore } from '../firebase/config.ts';
import { currentUser } from '../firebase/auth.ts';
import { SCHEMA_VERSION, TripInviteSchema, type TripInvite, type TripRole } from './schema.ts';
import { getTrip } from './trip-context.ts';

function token(): string {
  // URL-safe, unguessable enough for an invite code.
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

/** Create a share invite for a trip. Returns the token (the URL code). */
export async function createInvite(
  tripId: string,
  role: Exclude<TripRole, 'owner'> = 'editor',
): Promise<string> {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');
  const trip = await getTrip(tripId);
  if (!trip) throw new Error('Trip not found.');

  const t = token();
  const invite = TripInviteSchema.parse({
    id: t,
    tripId,
    tripName: trip.name,
    role,
    createdByUid: u.uid,
    expiresAt: null,
    revoked: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
  });
  await setDoc(fbDoc(firestore, `tripInvites/${t}`), invite as object);
  // If this is a viewer invite, flag the trip as publicly readable.
  if (role === 'viewer') {
    await updateDoc(fbDoc(firestore, `trips/${tripId}`), { hasPublicView: true, updatedAt: Date.now() });
  }
  return t;
}

/** Read an invite by its token (used by the join screen). */
export async function getInvite(tok: string): Promise<TripInvite | null> {
  const snap = await getDoc(fbDoc(firestore, `tripInvites/${tok}`));
  return snap.exists() ? (snap.data() as TripInvite) : null;
}

/** Revoke an invite so it can no longer be accepted. */
export async function revokeInvite(tok: string): Promise<void> {
  const snap = await getDoc(fbDoc(firestore, `tripInvites/${tok}`));
  if (!snap.exists()) return;
  const existing = snap.data() as TripInvite;
  await setDoc(fbDoc(firestore, `tripInvites/${tok}`), {
    ...existing, revoked: true, updatedAt: Date.now(),
  } as object);
  // If this was a viewer invite, check if any other live viewer invites remain.
  // If none, clear the hasPublicView flag on the trip.
  if (existing.role === 'viewer') {
    const remaining = await getDocs(
      query(collection(firestore, 'tripInvites'),
        where('tripId', '==', existing.tripId),
        where('role', '==', 'viewer'),
        where('revoked', '==', false),
      ),
    );
    if (remaining.empty) {
      await updateDoc(fbDoc(firestore, `trips/${existing.tripId}`), {
        hasPublicView: deleteField(),
        updatedAt: Date.now(),
      });
    }
  }
}

/** All live invites for a trip (owner's share panel). */
export async function listInvites(tripId: string): Promise<TripInvite[]> {
  const snap = await getDocs(
    query(collection(firestore, 'tripInvites'), where('tripId', '==', tripId)),
  );
  const invites = snap.docs.map((d) => d.data() as TripInvite).filter((i) => !i.revoked);
  // Backfill: if live viewer invites exist but hasPublicView isn't set on the
  // trip yet (e.g. invites created before this flag was introduced), write it now.
  const hasViewer = invites.some((i) => i.role === 'viewer');
  if (hasViewer) {
    const trip = await getTrip(tripId);
    if (trip && !(trip as { hasPublicView?: boolean }).hasPublicView) {
      await updateDoc(fbDoc(firestore, `trips/${tripId}`), { hasPublicView: true, updatedAt: Date.now() });
    }
  }
  return invites;
}

/**
 * Accept an invite: add the signed-in user to the trip's members at the granted
 * role. Uses a server-side merge (arrayUnion + a dotted member field) so the
 * joiner does NOT need to read the trip first (they aren't a member yet, so the
 * read would be denied). The write carries joinToken so security rules can
 * verify the grant. Returns the tripId joined, or null if invalid/revoked.
 */
export async function acceptInvite(tok: string): Promise<string | null> {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');
  const invite = await getInvite(tok);
  if (!invite || invite.revoked) return null;

  // Never downgrade an existing member. If the caller is already on this trip
  // (e.g. the owner opening their own link), leave their role untouched. The
  // viewer flow no longer calls this at all, but guard anyway so a stray accept
  // can't overwrite an owner/editor with a lesser role.
  const trip = await getTrip(invite.tripId);
  const existingRole = (trip as { members?: Record<string, TripRole> } | null)?.members?.[u.uid];
  if (existingRole) return invite.tripId;

  await updateDoc(fbDoc(firestore, `trips/${invite.tripId}`), {
    [`members.${u.uid}`]: invite.role as TripRole,
    memberUids: arrayUnion(u.uid),
    joinToken: tok,
    updatedAt: Date.now(),
  });
  return invite.tripId;
}

/** Build a shareable join URL for a token. */
export function inviteUrl(tok: string): string {
  return `${window.location.origin}/#/join/${tok}`;
}

/* ── Email whitelist invites ─────────────────────────────────────────────── */

/** Add an email to the trip's editor whitelist. Owner only. */
export async function addEmailInvite(tripId: string, email: string): Promise<void> {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');
  const normalised = email.trim().toLowerCase();
  if (!normalised) throw new Error('Invalid email.');
  await updateDoc(fbDoc(firestore, `trips/${tripId}`), {
    [`emailInvites.${normalised}`]: 'editor',
    updatedAt: Date.now(),
  });
}

/** Remove an email from the trip's editor whitelist. Owner only. */
export async function removeEmailInvite(tripId: string, email: string): Promise<void> {
  const normalised = email.trim().toLowerCase();
  await updateDoc(fbDoc(firestore, `trips/${tripId}`), {
    [`emailInvites.${normalised}`]: deleteField(),
    updatedAt: Date.now(),
  });
}

/**
 * If the signed-in user's email appears in the trip's emailInvites whitelist,
 * add them as an editor and remove the entry. Returns true if joined.
 */
export async function acceptEmailInvite(tripId: string): Promise<boolean> {
  const u = currentUser();
  if (!u?.email) return false;
  const email = u.email.trim().toLowerCase();

  const trip = await getTrip(tripId);
  if (!trip) return false;
  const invites = (trip as { emailInvites?: Record<string, string> }).emailInvites ?? {};
  if (!(email in invites)) return false;

  await updateDoc(fbDoc(firestore, `trips/${tripId}`), {
    [`members.${u.uid}`]: 'editor',
    memberUids: arrayUnion(u.uid),
    [`emailInvites.${email}`]: deleteField(),
    updatedAt: Date.now(),
  });
  return true;
}
