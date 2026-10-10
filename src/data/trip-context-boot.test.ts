import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ==========================================================================
   Cache-first boot: resolveActiveTripFromCache() / reconcileActiveTripWithServer()
   and the pure pickActiveTrip() they share with the server boot path.

   Firestore is mocked with two separate worlds — the local cache and the
   server — so each test can say exactly what is stale where.
   ========================================================================== */

type Doc = Record<string, unknown>;
const world = vi.hoisted(() => ({
  cacheTrips: [] as Doc[],
  cacheUser: null as Doc | null,
  serverTrips: [] as Doc[],
  serverUser: null as Doc | null,
  serverDown: false,
  cacheMiss: false,
  serverReads: 0,
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => path,
  collection: (_db: unknown, path: string) => path,
  query: () => 'q',
  where: () => 'w',
  getDocsFromCache: async () => {
    if (world.cacheMiss) throw new Error('unavailable');
    return { docs: world.cacheTrips.map((t) => ({ data: () => t })) };
  },
  getDocFromCache: async () => {
    if (!world.cacheUser) throw new Error('not in cache');
    return { exists: () => true, data: () => world.cacheUser };
  },
  getDocs: async () => {
    world.serverReads++;
    if (world.serverDown) throw new Error('offline');
    return { docs: world.serverTrips.map((t) => ({ data: () => t })) };
  },
  getDoc: async () => {
    world.serverReads++;
    if (world.serverDown) throw new Error('offline');
    return { exists: () => !!world.serverUser, data: () => world.serverUser };
  },
  setDoc: async () => {}, deleteDoc: async () => {}, writeBatch: () => ({}),
}));
vi.mock('../firebase/config.ts', () => ({ db: {} }));
vi.mock('../firebase/auth.ts', () => ({ currentUser: () => ({ uid: 'u1', email: 'a@b.c' }) }));
vi.mock('../firebase/db.ts', () => ({ setMyTripIdsResolver: () => {} }));
vi.mock('../core/analytics.ts', () => ({ track: () => {} }));

const tc = await import('./trip-context.ts');

const trip = (id: string, extra: Doc = {}): Doc => ({
  id, name: id, startDate: '2026-06-25', endDate: '2026-09-06', baseCurrency: 'EUR',
  ownerUid: 'u1', members: { u1: 'owner' }, memberUids: ['u1'], userCreated: true, ...extra,
});

beforeEach(() => {
  Object.assign(world, { cacheTrips: [], cacheUser: null, serverTrips: [], serverUser: null, serverDown: false, cacheMiss: false, serverReads: 0 });
});

describe('pickActiveTrip', () => {
  const a = trip('a') as never, b = trip('b') as never;
  const shared = trip('s', { userCreated: false, ownerUid: 'other' }) as never;

  it('honours the saved default when the user still belongs to it', () => {
    expect(tc.pickActiveTrip([a, b], 'b')?.id).toBe('b');
  });
  it('ignores a saved default the user no longer belongs to', () => {
    expect(tc.pickActiveTrip([a, b], 'gone')?.id).toBe('a');
  });
  it('prefers a trip the user created over one shared with them', () => {
    expect(tc.pickActiveTrip([shared, a], null)?.id).toBe('a');
  });
  it('falls back to a shared trip so collaborators are not pushed into onboarding', () => {
    expect(tc.pickActiveTrip([shared], null)?.id).toBe('s');
  });
  it('returns null when the user has no trips', () => {
    expect(tc.pickActiveTrip([], 'a')).toBeNull();
  });
});

describe('resolveActiveTripFromCache', () => {
  it('opens the saved trip from cache without touching the server', async () => {
    world.cacheTrips = [trip('a'), trip('b')];
    world.cacheUser = { defaultTripId: 'b', accountMigrationsVersion: 1 };
    const r = await tc.resolveActiveTripFromCache();
    expect(r?.trip.id).toBe('b');
    expect(r?.accountMigrationsVersion).toBe(1);
    expect(tc.currentTripId()).toBe('b');
    expect(world.serverReads).toBe(0);
  });

  it('still works when the profile doc is not cached (falls back to the default pick)', async () => {
    world.cacheTrips = [trip('a')];
    const r = await tc.resolveActiveTripFromCache();
    expect(r?.trip.id).toBe('a');
    expect(r?.accountMigrationsVersion).toBe(0);
  });

  it('returns null when nothing is cached, so boot falls back to the server', async () => {
    expect(await tc.resolveActiveTripFromCache()).toBeNull();
  });

  it('returns null when the cache read itself fails', async () => {
    world.cacheMiss = true;
    expect(await tc.resolveActiveTripFromCache()).toBeNull();
  });
});

describe('reconcileActiveTripWithServer', () => {
  async function bootFromCache(trips: Doc[], saved: string | null) {
    world.cacheTrips = trips;
    world.cacheUser = { defaultTripId: saved };
    await tc.resolveActiveTripFromCache();
  }

  it('is silent when the server agrees with the cache (key order is irrelevant)', async () => {
    await bootFromCache([trip('a')], 'a');
    const listener = vi.fn();
    tc.onTripChange(listener);
    world.serverTrips = [Object.fromEntries(Object.entries(trip('a')).reverse())];
    world.serverUser = { defaultTripId: 'a' };
    expect(await tc.reconcileActiveTripWithServer()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('switches trip when the saved default moved on another device', async () => {
    await bootFromCache([trip('a'), trip('b')], 'a');
    const listener = vi.fn();
    tc.onTripChange(listener);
    world.serverTrips = [trip('a'), trip('b')];
    world.serverUser = { defaultTripId: 'b' };
    expect(await tc.reconcileActiveTripWithServer()).toBe(true);
    expect(tc.currentTripId()).toBe('b');
    expect(listener).toHaveBeenCalledWith('b');
  });

  it('refreshes and broadcasts when the active trip was edited elsewhere', async () => {
    await bootFromCache([trip('a', { name: 'Old name' })], 'a');
    const listener = vi.fn();
    tc.onTripChange(listener);
    world.serverTrips = [trip('a', { name: 'New name' })];
    world.serverUser = { defaultTripId: 'a' };
    expect(await tc.reconcileActiveTripWithServer()).toBe(true);
    expect(tc.currentTrip()?.name).toBe('New name');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('moves off a trip the user lost access to', async () => {
    await bootFromCache([trip('a'), trip('b')], 'a');
    world.serverTrips = [trip('b')];
    world.serverUser = { defaultTripId: 'a' };
    expect(await tc.reconcileActiveTripWithServer()).toBe(true);
    expect(tc.currentTripId()).toBe('b');
  });

  it('keeps the cached state, and does not broadcast, when the server is unreachable', async () => {
    await bootFromCache([trip('a'), trip('b')], 'b');
    const listener = vi.fn();
    tc.onTripChange(listener);
    world.serverDown = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await tc.reconcileActiveTripWithServer()).toBe(false);
    expect(tc.currentTripId()).toBe('b');
    expect(listener).not.toHaveBeenCalled();
  });

  it('a failed profile read is not mistaken for "no saved trip"', async () => {
    // Trips load but the profile doc is unreadable: must keep 'b', not fall back to 'a'.
    await bootFromCache([trip('a'), trip('b')], 'b');
    world.serverTrips = [trip('a'), trip('b')];
    world.serverUser = null;
    // getDoc → "doesn't exist" is a legitimate answer (no saved trip → default pick)…
    expect(await tc.reconcileActiveTripWithServer()).toBe(true);
    expect(tc.currentTripId()).toBe('a');
    // …whereas a thrown read leaves everything alone.
    world.serverDown = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await tc.reconcileActiveTripWithServer()).toBe(false);
    expect(tc.currentTripId()).toBe('a');
  });
});
