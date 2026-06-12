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
import { collectionsForPages } from './page-collections.ts';

function token(): string {
  // URL-safe, unguessable enough for an invite code.
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

/** Create a share invite for a trip. Returns the token (the URL code).
 * `pages` lists the ViewIds the link grants — for a viewer link it scopes the
 * public read; for an editor link it scopes what the approved editor can edit.
 * Empty = all pages. */
export async function createInvite(
  tripId: string,
  role: Exclude<TripRole, 'owner'> = 'editor',
  pages: string[] = [],
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
    pages,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
  });
  await setDoc(fbDoc(firestore, `tripInvites/${t}`), invite as object);
  // Viewer invites drive page-level public read — recompute the union.
  if (role === 'viewer') await recomputePublicView(tripId);
  return t;
}

/**
 * Recompute and write the trip's publicView config from all LIVE viewer
 * invites. `collections` is the union of the page-derived sub-collection
 * names across every live viewer link, so security rules can gate
 * unauthenticated sub-collection reads by name. Always writes the whole
 * publicView object (never a dotted merge) so collections from a revoked
 * link drop out cleanly. Owner-only (rules require owner to write the trip).
 */
export async function recomputePublicView(tripId: string): Promise<void> {
  const snap = await getDocs(
    query(collection(firestore, 'tripInvites'),
      where('tripId', '==', tripId),
      where('role', '==', 'viewer'),
      where('revoked', '==', false),
    ),
  );
  const liveViewers = snap.docs.map((d) => d.data() as TripInvite);
  const pages = [...new Set(liveViewers.flatMap((i) => i.pages ?? []))];
  const collections = collectionsForPages(pages);
  await updateDoc(fbDoc(firestore, `trips/${tripId}`), {
    publicView: { enabled: liveViewers.length > 0, collections },
    // Clear the deprecated coarse flag as part of converting this trip.
    hasPublicView: deleteField(),
    updatedAt: Date.now(),
  });
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
  // Viewer invite revoked → recompute the public-read union (shrinks or
  // disables publicView depending on what live viewer links remain).
  if (existing.role === 'viewer') await recomputePublicView(existing.tripId);
}

/** All live invites for a trip (owner's share panel). */
export async function listInvites(tripId: string): Promise<TripInvite[]> {
  const snap = await getDocs(
    query(collection(firestore, 'tripInvites'), where('tripId', '==', tripId)),
  );
  return snap.docs.map((d) => d.data() as TripInvite).filter((i) => !i.revoked);
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

/** Add an email to the trip's editor whitelist with optional page restriction.
 *  Empty `pages` = full access. Owner only. */
export async function addEmailInvite(tripId: string, email: string, pages: string[] = []): Promise<void> {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');
  const normalised = email.trim().toLowerCase();
  if (!normalised) throw new Error('Invalid email.');
  await updateDoc(fbDoc(firestore, `trips/${tripId}`), {
    [`emailInvites.${normalised}`]: 'editor',
    [`emailInvitePages.${normalised}`]: pages,
    updatedAt: Date.now(),
  });
}

/** Remove an email from the trip's editor whitelist. Owner only. */
export async function removeEmailInvite(tripId: string, email: string): Promise<void> {
  const normalised = email.trim().toLowerCase();
  await updateDoc(fbDoc(firestore, `trips/${tripId}`), {
    [`emailInvites.${normalised}`]: deleteField(),
    [`emailInvitePages.${normalised}`]: deleteField(),
    updatedAt: Date.now(),
  });
}

/**
 * If the signed-in user's email appears in the trip's emailInvites whitelist,
 * add them as an editor (carrying any page restriction into memberPages) and
 * remove the email entry. Returns true if joined.
 */
export async function acceptEmailInvite(tripId: string): Promise<boolean> {
  const u = currentUser();
  if (!u?.email) return false;
  const email = u.email.trim().toLowerCase();

  const trip = await getTrip(tripId);
  if (!trip) return false;
  const invites = (trip as { emailInvites?: Record<string, string> }).emailInvites ?? {};
  if (!(email in invites)) return false;

  const pageMap = (trip as { emailInvitePages?: Record<string, string[]> }).emailInvitePages ?? {};
  const pages = pageMap[email] ?? [];

  const patch: Record<string, unknown> = {
    [`members.${u.uid}`]: 'editor',
    memberUids: arrayUnion(u.uid),
    [`emailInvites.${email}`]: deleteField(),
    [`emailInvitePages.${email}`]: deleteField(),
    updatedAt: Date.now(),
  };
  // Only set a restriction when pages were specified; full access = no entry.
  if (pages.length) {
    patch[`memberPages.${u.uid}`] = pages;
    patch[`memberCollections.${u.uid}`] = collectionsForPages(pages);
  }
  await updateDoc(fbDoc(firestore, `trips/${tripId}`), patch);
  return true;
}
