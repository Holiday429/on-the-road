/* ==========================================================================
   On the Road · Trip access requests
   --------------------------------------------------------------------------
   Edit-access approval flow. A signed-in non-member who opens an editor link
   submits a request (createAccessRequest). The trip owner sees pending
   requests in-app (listAccessRequests / subscribeAccessRequests) and approves
   them (approveAccessRequest), which adds the requester to the trip's members
   as an editor. Until approved, the requester sees nothing about the trip.

   Docs live at tripAccessRequests/{id} (top-level). Security rules
   (firestore.rules) gate create to the requester, read/list to the requester
   (own) or the trip owner, and update/delete to the trip owner.
   ========================================================================== */

import {
  doc as fbDoc, setDoc, updateDoc, getDocs, collection, query, where, arrayUnion, onSnapshot,
} from 'firebase/firestore';
import { db as firestore } from '../firebase/config.ts';
import { currentUser } from '../firebase/auth.ts';
import { genId } from '../firebase/db.ts';
import { SCHEMA_VERSION, TripAccessRequestSchema, type TripAccessRequest, type TripRole } from './schema.ts';
import { getTrip } from './trip-context.ts';
import { collectionsForPages } from './page-collections.ts';

/**
 * Submit an edit-access request for a trip. `pages` is the editor link's page
 * restriction (empty = full access), carried so approval can apply it. No-ops
 * (returns null) if the user is already a member. Returns the request id.
 */
export async function createAccessRequest(tripId: string, pages: string[] = []): Promise<string | null> {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');

  const trip = await getTrip(tripId);
  // If already a member, nothing to request.
  const members = (trip as { members?: Record<string, TripRole> } | null)?.members;
  if (members && members[u.uid]) return null;

  // Avoid duplicate pending requests from the same user.
  const existing = await myPendingRequest(tripId);
  if (existing) return existing.id;

  const id = genId();
  const req = TripAccessRequestSchema.parse({
    id,
    tripId,
    tripName: trip?.name ?? '',
    requesterUid: u.uid,
    requesterEmail: u.email ?? '',
    requesterName: u.displayName ?? '',
    status: 'pending',
    pages,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
  });
  await setDoc(fbDoc(firestore, `tripAccessRequests/${id}`), req as object);
  return id;
}

/** The signed-in user's own request for a trip, if any (any status). */
export async function myPendingRequest(tripId: string): Promise<TripAccessRequest | null> {
  const u = currentUser();
  if (!u) return null;
  const snap = await getDocs(
    query(collection(firestore, 'tripAccessRequests'),
      where('tripId', '==', tripId),
      where('requesterUid', '==', u.uid),
    ),
  );
  if (snap.empty) return null;
  return snap.docs[0].data() as TripAccessRequest;
}

/** All requests for a trip (owner-side). Query is tripId-scoped so rules pass. */
export async function listAccessRequests(tripId: string): Promise<TripAccessRequest[]> {
  const snap = await getDocs(
    query(collection(firestore, 'tripAccessRequests'),
      where('tripId', '==', tripId),
      where('status', '==', 'pending'),
    ),
  );
  return snap.docs.map((d) => d.data() as TripAccessRequest);
}

/** Live subscription to pending requests for a trip (owner badge). Returns unsub. */
export function subscribeAccessRequests(
  tripId: string,
  cb: (requests: TripAccessRequest[]) => void,
): () => void {
  const q = query(collection(firestore, 'tripAccessRequests'),
    where('tripId', '==', tripId),
    where('status', '==', 'pending'),
  );
  return onSnapshot(q,
    (snap) => cb(snap.docs.map((d) => d.data() as TripAccessRequest)),
    () => cb([]), // non-owner reads are denied — treat as none
  );
}

/** Approve a request: add the requester as an editor (with any page
 *  restriction from the link), then mark approved. */
export async function approveAccessRequest(req: TripAccessRequest): Promise<void> {
  // Owner has full member-management rights; add the requester directly.
  const patch: Record<string, unknown> = {
    [`members.${req.requesterUid}`]: 'editor' as TripRole,
    memberUids: arrayUnion(req.requesterUid),
    updatedAt: Date.now(),
  };
  if (req.pages?.length) {
    patch[`memberPages.${req.requesterUid}`] = req.pages;
    patch[`memberCollections.${req.requesterUid}`] = collectionsForPages(req.pages);
  }
  await updateDoc(fbDoc(firestore, `trips/${req.tripId}`), patch);
  await updateDoc(fbDoc(firestore, `tripAccessRequests/${req.id}`), {
    status: 'approved',
    updatedAt: Date.now(),
  });
}

/** Deny a request (owner-side). */
export async function denyAccessRequest(req: TripAccessRequest): Promise<void> {
  await updateDoc(fbDoc(firestore, `tripAccessRequests/${req.id}`), {
    status: 'denied',
    updatedAt: Date.now(),
  });
}
