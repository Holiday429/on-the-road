import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ==========================================================================
   updateTrip · legacy email-invite repair.

   `updateDoc(ref, { 'emailInvites.a@b.com': 'editor' })` looks like it sets one
   key, but Firestore reads a dotted STRING path as nesting — so the flat
   `email -> 'editor'` map was stored as `a@b -> { com: 'editor' }`. Because
   updateTrip re-parses the WHOLE trip doc through TripSchema before writing,
   that one malformed map made every later write to the trip throw a ZodError:

     path ["emailInvites", "holiday"]     expected "editor"
     path ["emailInvitePages", "holiday"] expected array

   which is what stopped budget caps from saving. updateTrip must heal the shape
   instead of refusing to write.
   ========================================================================== */

const store = new Map<string, Record<string, unknown>>();

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => path,
  collection: (_db: unknown, path: string) => path,
  getDoc: async (path: string) => {
    const data = store.get(path);
    return { exists: () => !!data, data: () => data };
  },
  setDoc: async (path: string, data: Record<string, unknown>) => { store.set(path, data); },
  getDocs: async () => ({ docs: [] }),
  deleteDoc: async () => {},
  query: () => 'q',
  where: () => 'w',
  writeBatch: () => ({ set() {}, delete() {}, commit: async () => {} }),
}));

vi.mock('../firebase/config.ts', () => ({ db: {} }));
vi.mock('../firebase/auth.ts', () => ({ currentUser: () => ({ uid: 'u1', email: 'a@b.c' }) }));
vi.mock('../firebase/db.ts', () => ({ setMyTripIdsResolver: () => {} }));
vi.mock('../core/analytics.ts', () => ({ track: () => {} }));

const { updateTrip } = await import('./trip-context.ts');

const TRIP = 'trips/t1';
const baseDoc = () => ({
  id: 't1', name: 'Euro Trip', startDate: '2026-09-01', endDate: '2026-10-01',
  baseCurrency: 'CNY', coverColor: '#f9b830', status: 'planning',
  ownerUid: 'u1', members: { u1: 'owner' }, memberUids: ['u1'],
  userCreated: true, totalBudget: 85000,
  createdAt: 1, updatedAt: 1, schemaVersion: 1,
});

beforeEach(() => { store.clear(); });

describe('updateTrip with dot-corrupted email invites', () => {
  it('writes a budget cap despite the corrupted invite maps', async () => {
    store.set(TRIP, {
      ...baseDoc(),
      // Exactly the production shape: holiday@x.com split on every dot.
      emailInvites: { 'holiday@x': { com: 'editor' } },
      emailInvitePages: { 'holiday@x': { com: [] } },
    });

    await updateTrip('t1', { countryBudgets: { Switzerland: 15000, France: 10000 } });

    expect(store.get(TRIP)!.countryBudgets).toEqual({ Switzerland: 15000, France: 10000 });
  });

  it('flattens the nesting back to the original email key', async () => {
    store.set(TRIP, {
      ...baseDoc(),
      emailInvites: { 'holiday@x': { com: 'editor' } },
      emailInvitePages: { 'holiday@x': { com: ['expenses', 'itinerary'] } },
    });

    await updateTrip('t1', { name: 'Renamed' });

    expect(store.get(TRIP)!.emailInvites).toEqual({ 'holiday@x.com': 'editor' });
    expect(store.get(TRIP)!.emailInvitePages).toEqual({
      'holiday@x.com': ['expenses', 'itinerary'],
    });
  });

  it('handles a multi-dot address', async () => {
    store.set(TRIP, {
      ...baseDoc(),
      emailInvites: { 'a@b': { co: { uk: 'editor' } } },
    });

    await updateTrip('t1', { name: 'Renamed' });

    expect(store.get(TRIP)!.emailInvites).toEqual({ 'a@b.co.uk': 'editor' });
  });

  it('leaves an already-correct invite map untouched', async () => {
    store.set(TRIP, {
      ...baseDoc(),
      emailInvites: { 'holiday@x.com': 'editor' },
      emailInvitePages: { 'holiday@x.com': ['expenses'] },
    });

    await updateTrip('t1', { name: 'Renamed' });

    expect(store.get(TRIP)!.emailInvites).toEqual({ 'holiday@x.com': 'editor' });
    expect(store.get(TRIP)!.emailInvitePages).toEqual({ 'holiday@x.com': ['expenses'] });
  });

  it('drops entries that cannot be salvaged rather than failing the write', async () => {
    store.set(TRIP, {
      ...baseDoc(),
      emailInvites: { 'bad@x': { com: 'viewer' } },   // not 'editor'
      emailInvitePages: { 'bad@x': { com: 'nope' } }, // not an array
    });

    await updateTrip('t1', { countryBudgets: { France: 10000 } });

    expect(store.get(TRIP)!.countryBudgets).toEqual({ France: 10000 });
    expect(store.get(TRIP)!.emailInvites).toBeUndefined();
    expect(store.get(TRIP)!.emailInvitePages).toBeUndefined();
  });

  it('keeps the good entries when only some are corrupt', async () => {
    store.set(TRIP, {
      ...baseDoc(),
      emailInvites: {
        'good@x': { com: 'editor' },
        'bad@y': { com: 'viewer' },
      },
    });

    await updateTrip('t1', { name: 'Renamed' });

    expect(store.get(TRIP)!.emailInvites).toEqual({ 'good@x.com': 'editor' });
  });

  it('still writes when the invite field is not an object at all', async () => {
    store.set(TRIP, { ...baseDoc(), emailInvites: 'garbage' });

    await updateTrip('t1', { countryBudgets: { France: 10000 } });

    expect(store.get(TRIP)!.countryBudgets).toEqual({ France: 10000 });
    expect(store.get(TRIP)!.emailInvites).toBeUndefined();
  });
});
