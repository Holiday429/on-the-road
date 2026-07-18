import { readFileSync } from 'fs';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment, type RulesTestContext,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where,
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-otr-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** Seed a doc bypassing security rules (setup, not the thing under test). */
async function seed(fn: (ctx: RulesTestContext) => Promise<void>): Promise<void> {
  await testEnv.withSecurityRulesDisabled(fn);
}

// ── users/{userId} ──────────────────────────────────────────────────────────

describe('users/{userId}', () => {
  it('a signed-in user can read and write their own profile', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(setDoc(doc(alice.firestore(), 'users/alice'), { displayName: 'Alice' }));
    await assertSucceeds(getDoc(doc(alice.firestore(), 'users/alice')));
  });

  it('a user cannot read or write another user\'s profile', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/bob'), { displayName: 'Bob' });
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(getDoc(doc(alice.firestore(), 'users/bob')));
    await assertFails(setDoc(doc(alice.firestore(), 'users/bob'), { displayName: 'Hacked' }));
  });

  it('an unauthenticated user cannot read or write any profile', async () => {
    const anon = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(anon.firestore(), 'users/alice')));
    await assertFails(setDoc(doc(anon.firestore(), 'users/alice'), { displayName: 'X' }));
  });

  // billingFieldsUnchanged() — the core billing-security boundary. A client
  // must never be able to grant itself a plan, trip slots, or AI credits.
  describe('billing fields are server-authoritative', () => {
    it('cannot seed a protected field on create', async () => {
      const alice = testEnv.authenticatedContext('alice');
      await assertFails(setDoc(doc(alice.firestore(), 'users/alice'), { plan: 'lifetime' }));
      await assertFails(setDoc(doc(alice.firestore(), 'users/alice'), { tripQuota: 999 }));
      await assertFails(setDoc(doc(alice.firestore(), 'users/alice'), { aiCreditsPool: 100 }));
      await assertFails(setDoc(doc(alice.firestore(), 'users/alice'), { freeAiUsed: false }));
      await assertFails(setDoc(doc(alice.firestore(), 'users/alice'), { entitlements: ['ai.guide'] }));
    });

    it('can create a profile with only non-billing fields', async () => {
      const alice = testEnv.authenticatedContext('alice');
      await assertSucceeds(setDoc(doc(alice.firestore(), 'users/alice'), { displayName: 'Alice', locale: 'en' }));
    });

    it('cannot change a protected field on update, even alongside a legit field', async () => {
      await seed(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users/alice'), { displayName: 'Alice', plan: 'free', tripQuota: 1 });
      });
      const alice = testEnv.authenticatedContext('alice');
      await assertFails(updateDoc(doc(alice.firestore(), 'users/alice'), { plan: 'lifetime' }));
      await assertFails(updateDoc(doc(alice.firestore(), 'users/alice'), { displayName: 'Alice2', tripQuota: 999 }));
    });

    it('can update non-billing fields while billing fields stay untouched', async () => {
      await seed(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users/alice'), { displayName: 'Alice', plan: 'free', tripQuota: 1 });
      });
      const alice = testEnv.authenticatedContext('alice');
      await assertSucceeds(updateDoc(doc(alice.firestore(), 'users/alice'), { displayName: 'Alice V2', locale: 'zh' }));
    });
  });

  it('a user can read and write their own sub-collections (coreKit, etc.)', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(setDoc(doc(alice.firestore(), 'users/alice/coreKit/item1'), { name: 'passport' }));
    await assertFails(setDoc(doc(testEnv.authenticatedContext('bob').firestore(), 'users/alice/coreKit/item2'), { name: 'x' }));
  });
});

// ── trips/{tripId} ───────────────────────────────────────────────────────────

function baseTrip(ownerUid: string, extra: Record<string, unknown> = {}) {
  return {
    ownerUid,
    members: { [ownerUid]: 'owner' },
    memberUids: [ownerUid],
    name: 'Test Trip',
    ...extra,
  };
}

describe('trips/{tripId}', () => {
  it('create: must set yourself as sole owner', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(setDoc(doc(alice.firestore(), 'trips/t1'), baseTrip('alice')));
  });

  it('create: cannot create a trip owned by someone else', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'trips/t1'), baseTrip('bob')));
  });

  it('create: cannot omit yourself from memberUids', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'trips/t1'), {
      ownerUid: 'alice', members: { alice: 'owner' }, memberUids: [],
    }));
  });

  it('get: a non-member cannot read a private trip', async () => {
    await seed(async (ctx) => { await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice')); });
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(getDoc(doc(bob.firestore(), 'trips/t1')));
  });

  it('get: reading a non-existent trip is allowed (probing is safe)', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(getDoc(doc(alice.firestore(), 'trips/does-not-exist')));
  });

  it('get: a trip with publicView.enabled is readable by anyone signed in', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', {
        publicView: { enabled: true, collections: [] },
      }));
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertSucceeds(getDoc(doc(bob.firestore(), 'trips/t1')));
  });

  it('list: the memberUids array-contains query works for a member, and cannot be widened', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice'));
      await setDoc(doc(ctx.firestore(), 'trips/t2'), baseTrip('bob'));
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(getDocs(query(collection(alice.firestore(), 'trips'), where('memberUids', 'array-contains', 'alice'))));
    // Querying for someone else's membership must fail — the rule requires uid() in memberUids.
    await assertFails(getDocs(query(collection(alice.firestore(), 'trips'), where('memberUids', 'array-contains', 'bob'))));
  });

  it('delete: only the owner can delete', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', { members: { alice: 'owner', bob: 'editor' }, memberUids: ['alice', 'bob'] }));
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(deleteDoc(doc(bob.firestore(), 'trips/t1')));
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(deleteDoc(doc(alice.firestore(), 'trips/t1')));
  });

  it('update: an editor cannot change members/memberUids/ownerUid', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', { members: { alice: 'owner', bob: 'editor' }, memberUids: ['alice', 'bob'] }));
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertSucceeds(updateDoc(doc(bob.firestore(), 'trips/t1'), { name: 'Renamed by editor' }));
    await assertFails(updateDoc(doc(bob.firestore(), 'trips/t1'), { members: { alice: 'owner', bob: 'owner' } }));
    await assertFails(updateDoc(doc(bob.firestore(), 'trips/t1'), { ownerUid: 'bob' }));
  });

  it('update: a viewer cannot write at all (not selfCanEdit)', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', { members: { alice: 'owner', carol: 'viewer' }, memberUids: ['alice', 'carol'] }));
    });
    const carol = testEnv.authenticatedContext('carol');
    await assertFails(updateDoc(doc(carol.firestore(), 'trips/t1'), { name: 'Nope' }));
  });

  // isSelfLeave — a member removing ONLY themselves.
  describe('self-leave', () => {
    it('a non-owner member can remove themselves', async () => {
      await seed(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', { members: { alice: 'owner', bob: 'editor' }, memberUids: ['alice', 'bob'] }));
      });
      const bob = testEnv.authenticatedContext('bob');
      await assertSucceeds(updateDoc(doc(bob.firestore(), 'trips/t1'), {
        members: { alice: 'owner' }, memberUids: ['alice'],
      }));
    });

    // isSelfLeave() itself guards `before.members[me] != 'owner'`, but that
    // guard only applies to the isSelfLeave() branch of the top-level update
    // rule. The owner ALSO matches selfIsOwner() (a separate, earlier OR
    // branch) which grants full member-management rights, including removing
    // themselves — so a self-leave-shaped write from the owner still
    // succeeds via that branch. This is the rules' intended behavior (an
    // owner has full control over `members`), not a gap in isSelfLeave().
    // Asserted as success (not failure) so a future change to selfIsOwner()
    // that accidentally starts blocking this doesn't look like an
    // unrelated, uncovered regression.
    it('the owner CAN remove themselves via the selfIsOwner() update path', async () => {
      await seed(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', { members: { alice: 'owner', bob: 'editor' }, memberUids: ['alice', 'bob'] }));
      });
      const alice = testEnv.authenticatedContext('alice');
      await assertSucceeds(updateDoc(doc(alice.firestore(), 'trips/t1'), {
        members: { bob: 'editor' }, memberUids: ['bob'],
      }));
    });

    it('a member cannot self-leave while also removing someone else', async () => {
      await seed(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', {
          members: { alice: 'owner', bob: 'editor', carol: 'editor' },
          memberUids: ['alice', 'bob', 'carol'],
        }));
      });
      const bob = testEnv.authenticatedContext('bob');
      // Bob leaves but also drops Carol — isSelfLeave requires memberUids.hasOnly([...before minus bob]).
      await assertFails(updateDoc(doc(bob.firestore(), 'trips/t1'), {
        members: { alice: 'owner' }, memberUids: ['alice'],
      }));
    });
  });

  // isEmailJoin — joining via an email whitelist entry on the trip doc.
  describe('email-invite self-join', () => {
    it('a whitelisted email can add themselves as editor', async () => {
      await seed(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', {
          emailInvites: { 'bob@example.com': 'editor' },
        }));
      });
      const bob = testEnv.authenticatedContext('bob', { email: 'bob@example.com' });
      await assertSucceeds(updateDoc(doc(bob.firestore(), 'trips/t1'), {
        members: { alice: 'owner', bob: 'editor' },
        memberUids: ['alice', 'bob'],
      }));
    });

    it('a non-whitelisted email cannot self-join', async () => {
      await seed(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', {
          emailInvites: { 'bob@example.com': 'editor' },
        }));
      });
      const eve = testEnv.authenticatedContext('eve', { email: 'eve@example.com' });
      await assertFails(updateDoc(doc(eve.firestore(), 'trips/t1'), {
        members: { alice: 'owner', eve: 'editor' },
        memberUids: ['alice', 'eve'],
      }));
    });

    it('a whitelisted email cannot grant themselves owner via the join path', async () => {
      await seed(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', {
          emailInvites: { 'bob@example.com': 'editor' },
        }));
      });
      const bob = testEnv.authenticatedContext('bob', { email: 'bob@example.com' });
      await assertFails(updateDoc(doc(bob.firestore(), 'trips/t1'), {
        members: { alice: 'owner', bob: 'owner' },
        memberUids: ['alice', 'bob'],
      }));
    });
  });

  // isSelfJoin — joining via a live tripInvites token.
  describe('token self-join', () => {
    it('a signed-in user can join with a live, matching invite token', async () => {
      await seed(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice'));
        await setDoc(doc(ctx.firestore(), 'tripInvites/tok1'), {
          tripId: 't1', role: 'editor', revoked: false, createdByUid: 'alice',
        });
      });
      const bob = testEnv.authenticatedContext('bob');
      await assertSucceeds(updateDoc(doc(bob.firestore(), 'trips/t1'), {
        members: { alice: 'owner', bob: 'editor' },
        memberUids: ['alice', 'bob'],
        joinToken: 'tok1',
      }));
    });

    it('a revoked invite token cannot be used to join', async () => {
      await seed(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice'));
        await setDoc(doc(ctx.firestore(), 'tripInvites/tok1'), {
          tripId: 't1', role: 'editor', revoked: true, createdByUid: 'alice',
        });
      });
      const bob = testEnv.authenticatedContext('bob');
      await assertFails(updateDoc(doc(bob.firestore(), 'trips/t1'), {
        members: { alice: 'owner', bob: 'editor' },
        memberUids: ['alice', 'bob'],
        joinToken: 'tok1',
      }));
    });

    it('cannot join granting yourself a role different from the invite\'s role', async () => {
      await seed(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice'));
        await setDoc(doc(ctx.firestore(), 'tripInvites/tok1'), {
          tripId: 't1', role: 'viewer', revoked: false, createdByUid: 'alice',
        });
      });
      const bob = testEnv.authenticatedContext('bob');
      await assertFails(updateDoc(doc(bob.firestore(), 'trips/t1'), {
        members: { alice: 'owner', bob: 'owner' }, // invite says viewer, not owner
        memberUids: ['alice', 'bob'],
        joinToken: 'tok1',
      }));
    });

    it('cannot join a different trip than the token was issued for', async () => {
      await seed(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice'));
        await setDoc(doc(ctx.firestore(), 'trips/t2'), baseTrip('carol'));
        await setDoc(doc(ctx.firestore(), 'tripInvites/tok1'), {
          tripId: 't1', role: 'editor', revoked: false, createdByUid: 'alice',
        });
      });
      const bob = testEnv.authenticatedContext('bob');
      await assertFails(updateDoc(doc(bob.firestore(), 'trips/t2'), {
        members: { carol: 'owner', bob: 'editor' },
        memberUids: ['carol', 'bob'],
        joinToken: 'tok1', // token is for t1, not t2
      }));
    });
  });
});

// ── trips/{tripId}/{sub}/{docId} ─────────────────────────────────────────────

describe('trips/{tripId}/{sub}/{docId}', () => {
  it('a member can read a sub-collection doc', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice'));
      await setDoc(doc(ctx.firestore(), 'trips/t1/expenses/e1'), { amount: 10 });
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(getDoc(doc(alice.firestore(), 'trips/t1/expenses/e1')));
  });

  it('a non-member cannot read a private trip\'s sub-collection', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice'));
      await setDoc(doc(ctx.firestore(), 'trips/t1/expenses/e1'), { amount: 10 });
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(getDoc(doc(bob.firestore(), 'trips/t1/expenses/e1')));
  });

  it('a published publicView collection is readable by a non-member', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', {
        publicView: { enabled: true, collections: ['itinerary'] },
      }));
      await setDoc(doc(ctx.firestore(), 'trips/t1/itinerary/leg1'), { city: 'Paris' });
      await setDoc(doc(ctx.firestore(), 'trips/t1/expenses/e1'), { amount: 10 });
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertSucceeds(getDoc(doc(bob.firestore(), 'trips/t1/itinerary/leg1')));
    // expenses is NOT in the published collections allow-list.
    await assertFails(getDoc(doc(bob.firestore(), 'trips/t1/expenses/e1')));
  });

  // The most important rule in the file: clients can never write the
  // server-authoritative AI-usage counter, regardless of their role.
  it('the usage sub-collection can never be written by a client, even by the owner', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice'));
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'trips/t1/usage/ai'), { count: 0 }));
    await assertFails(updateDoc(doc(alice.firestore(), 'trips/t1/usage/ai'), { count: 999 }));
  });

  it('an editor can write a normal sub-collection with no page restrictions', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', { members: { alice: 'owner', bob: 'editor' }, memberUids: ['alice', 'bob'] }));
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertSucceeds(setDoc(doc(bob.firestore(), 'trips/t1/expenses/e1'), { amount: 5 }));
  });

  it('a page-restricted editor can only write sub-collections in their allow-list', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', {
        members: { alice: 'owner', bob: 'editor' },
        memberUids: ['alice', 'bob'],
        memberCollections: { bob: ['expenses'] },
      }));
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertSucceeds(setDoc(doc(bob.firestore(), 'trips/t1/expenses/e1'), { amount: 5 }));
    await assertFails(setDoc(doc(bob.firestore(), 'trips/t1/itinerary/leg1'), { city: 'Rome' }));
  });

  it('the owner writes any sub-collection even when memberCollections restricts other editors', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', {
        members: { alice: 'owner', bob: 'editor' },
        memberUids: ['alice', 'bob'],
        memberCollections: { bob: ['expenses'] },
      }));
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(setDoc(doc(alice.firestore(), 'trips/t1/itinerary/leg1'), { city: 'Rome' }));
  });

  it('a viewer cannot write any sub-collection', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', { members: { alice: 'owner', carol: 'viewer' }, memberUids: ['alice', 'carol'] }));
    });
    const carol = testEnv.authenticatedContext('carol');
    await assertFails(setDoc(doc(carol.firestore(), 'trips/t1/expenses/e1'), { amount: 5 }));
  });
});

// ── tripInvites/{token} ───────────────────────────────────────────────────────

describe('tripInvites/{token}', () => {
  it('a viewer invite token is readable without auth', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tripInvites/tok1'), {
        tripId: 't1', role: 'viewer', revoked: false, createdByUid: 'alice',
      });
    });
    const anon = testEnv.unauthenticatedContext();
    await assertSucceeds(getDoc(doc(anon.firestore(), 'tripInvites/tok1')));
  });

  it('a revoked or editor invite is NOT readable without auth', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tripInvites/tok-revoked'), {
        tripId: 't1', role: 'viewer', revoked: true, createdByUid: 'alice',
      });
      await setDoc(doc(ctx.firestore(), 'tripInvites/tok-editor'), {
        tripId: 't1', role: 'editor', revoked: false, createdByUid: 'alice',
      });
    });
    const anon = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(anon.firestore(), 'tripInvites/tok-revoked')));
    await assertFails(getDoc(doc(anon.firestore(), 'tripInvites/tok-editor')));
  });

  it('only the trip owner can create an invite for their trip', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', { members: { alice: 'owner', bob: 'editor' }, memberUids: ['alice', 'bob'] }));
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(setDoc(doc(alice.firestore(), 'tripInvites/tok1'), {
      tripId: 't1', role: 'editor', revoked: false, createdByUid: 'alice',
    }));
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(setDoc(doc(bob.firestore(), 'tripInvites/tok2'), {
      tripId: 't1', role: 'editor', revoked: false, createdByUid: 'bob',
    }));
  });

  it('only the trip owner can revoke (update/delete) an invite', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice', { members: { alice: 'owner', bob: 'editor' }, memberUids: ['alice', 'bob'] }));
      await setDoc(doc(ctx.firestore(), 'tripInvites/tok1'), {
        tripId: 't1', role: 'editor', revoked: false, createdByUid: 'alice',
      });
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(updateDoc(doc(bob.firestore(), 'tripInvites/tok1'), { revoked: true }));
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(updateDoc(doc(alice.firestore(), 'tripInvites/tok1'), { revoked: true }));
  });
});

// ── tripAccessRequests/{reqId} ────────────────────────────────────────────────

describe('tripAccessRequests/{reqId}', () => {
  it('a signed-in user can create their own pending request', async () => {
    await seed(async (ctx) => { await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice')); });
    const bob = testEnv.authenticatedContext('bob');
    await assertSucceeds(setDoc(doc(bob.firestore(), 'tripAccessRequests/r1'), {
      requesterUid: 'bob', status: 'pending', tripId: 't1',
    }));
  });

  it('cannot create a request impersonating another requester', async () => {
    await seed(async (ctx) => { await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice')); });
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(setDoc(doc(bob.firestore(), 'tripAccessRequests/r1'), {
      requesterUid: 'carol', status: 'pending', tripId: 't1',
    }));
  });

  it('the requester and the trip owner can read the request; a stranger cannot', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice'));
      await setDoc(doc(ctx.firestore(), 'tripAccessRequests/r1'), { requesterUid: 'bob', status: 'pending', tripId: 't1' });
    });
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('bob').firestore(), 'tripAccessRequests/r1')));
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('alice').firestore(), 'tripAccessRequests/r1')));
    await assertFails(getDoc(doc(testEnv.authenticatedContext('eve').firestore(), 'tripAccessRequests/r1')));
  });

  it('only the trip owner can approve/deny (update status), and only status+updatedAt', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice'));
      await setDoc(doc(ctx.firestore(), 'tripAccessRequests/r1'), { requesterUid: 'bob', status: 'pending', tripId: 't1' });
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(updateDoc(doc(bob.firestore(), 'tripAccessRequests/r1'), { status: 'approved' }));
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(updateDoc(doc(alice.firestore(), 'tripAccessRequests/r1'), { status: 'approved', updatedAt: Date.now() }));
  });

  it('the owner cannot smuggle other field changes into a status update', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice'));
      await setDoc(doc(ctx.firestore(), 'tripAccessRequests/r1'), { requesterUid: 'bob', status: 'pending', tripId: 't1' });
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(updateDoc(doc(alice.firestore(), 'tripAccessRequests/r1'), { status: 'approved', requesterUid: 'eve' }));
  });

  it('only the trip owner can delete a request', async () => {
    await seed(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1'), baseTrip('alice'));
      await setDoc(doc(ctx.firestore(), 'tripAccessRequests/r1'), { requesterUid: 'bob', status: 'pending', tripId: 't1' });
    });
    await assertFails(deleteDoc(doc(testEnv.authenticatedContext('bob').firestore(), 'tripAccessRequests/r1')));
    await assertSucceeds(deleteDoc(doc(testEnv.authenticatedContext('alice').firestore(), 'tripAccessRequests/r1')));
  });
});

// ── Default deny ──────────────────────────────────────────────────────────────

describe('default deny', () => {
  it('an undeclared top-level collection is fully denied', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(setDoc(doc(alice.firestore(), 'somethingElse/doc1'), { x: 1 }));
    await assertFails(getDoc(doc(alice.firestore(), 'somethingElse/doc1')));
  });
});
