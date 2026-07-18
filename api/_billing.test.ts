import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getClient() {
      return Promise.resolve({
        getAccessToken: () => Promise.resolve({ token: 'fake-token' }),
      });
    }
  },
}));

const FAKE_SA = JSON.stringify({
  project_id: 'test-project',
  client_email: 'test@example.com',
  private_key: 'fake-key',
});

type FetchCall = { url: string; init?: RequestInit };
const calls: FetchCall[] = [];

/** A minimal Firestore REST fetch double. `handlers` are checked in order;
 *  the first whose predicate matches the (method, url) pair handles the call. */
function mockFetch(handlers: Array<{
  match: (method: string, url: string) => boolean;
  respond: (url: string, init?: RequestInit) => { status: number; body?: unknown };
}>) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = init?.method ?? 'GET';
    const handler = handlers.find(h => h.match(method, url));
    if (!handler) throw new Error(`Unmocked fetch: ${method} ${url}`);
    const { status, body } = handler.respond(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }));
}

beforeEach(() => {
  vi.resetModules();
  process.env.FIREBASE_SERVICE_ACCOUNT = FAKE_SA;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('grantQuota', () => {
  it('is idempotent: a duplicate order id is skipped', async () => {
    mockFetch([
      {
        match: (m, u) => m === 'POST' && u.includes('/purchases?documentId='),
        respond: () => ({ status: 409 }), // already claimed
      },
    ]);
    const { grantQuota } = await import('./_billing');
    const applied = await grantQuota('uid1', 'trip_pass', 'order-1');
    expect(applied).toBe(false);
    // Only the claim call should have happened — no read/patch on a duplicate.
    expect(calls).toHaveLength(1);
  });

  it('trip_pass on a free user sets plan=trip_pass and tripQuota=FREE_QUOTA+1', async () => {
    let patchedFields: Record<string, unknown> | null = null;
    mockFetch([
      { match: (m, u) => m === 'POST' && u.includes('/purchases?documentId='), respond: () => ({ status: 200 }) },
      { match: (m, u) => m === 'GET' && u.endsWith('/users/uid1'), respond: () => ({ status: 404 }) }, // no doc yet → free defaults
      {
        match: (m, u) => m === 'PATCH' && u.includes('/users/uid1'),
        respond: (_u, init) => {
          patchedFields = JSON.parse(init!.body as string).fields;
          return { status: 200 };
        },
      },
    ]);
    const { grantQuota } = await import('./_billing');
    const applied = await grantQuota('uid1', 'trip_pass', 'order-1');
    expect(applied).toBe(true);
    expect(patchedFields).toMatchObject({
      plan: { stringValue: 'trip_pass' },
      tripQuota: { integerValue: '2' }, // FREE_QUOTA(1) + 1
    });
  });

  it('lifetime sets plan=lifetime and tripQuota=LIFETIME_QUOTA regardless of current quota', async () => {
    let patchedFields: Record<string, unknown> | null = null;
    mockFetch([
      { match: (m, u) => m === 'POST' && u.includes('/purchases?documentId='), respond: () => ({ status: 200 }) },
      {
        match: (m, u) => m === 'GET' && u.endsWith('/users/uid1'),
        respond: () => ({
          status: 200,
          body: { fields: { plan: { stringValue: 'trip_pass' }, tripQuota: { integerValue: '3' } } },
        }),
      },
      {
        match: (m, u) => m === 'PATCH' && u.includes('/users/uid1'),
        respond: (_u, init) => {
          patchedFields = JSON.parse(init!.body as string).fields;
          return { status: 200 };
        },
      },
    ]);
    const { grantQuota } = await import('./_billing');
    const applied = await grantQuota('uid1', 'lifetime', 'order-2');
    expect(applied).toBe(true);
    expect(patchedFields).toMatchObject({
      plan: { stringValue: 'lifetime' },
      tripQuota: { integerValue: '9999' },
    });
  });

  it('a trip_pass purchase never downgrades an existing lifetime holder', async () => {
    let patchedFields: Record<string, unknown> | null = null;
    mockFetch([
      { match: (m, u) => m === 'POST' && u.includes('/purchases?documentId='), respond: () => ({ status: 200 }) },
      {
        match: (m, u) => m === 'GET' && u.endsWith('/users/uid1'),
        respond: () => ({
          status: 200,
          body: { fields: { plan: { stringValue: 'lifetime' }, tripQuota: { integerValue: '9999' } } },
        }),
      },
      {
        match: (m, u) => m === 'PATCH' && u.includes('/users/uid1'),
        respond: (_u, init) => {
          patchedFields = JSON.parse(init!.body as string).fields;
          return { status: 200 };
        },
      },
    ]);
    const { grantQuota } = await import('./_billing');
    await grantQuota('uid1', 'trip_pass', 'order-3');
    expect(patchedFields).toMatchObject({
      plan: { stringValue: 'lifetime' },
      tripQuota: { integerValue: '9999' },
    });
  });

  it('ai_topup adds AI_TOPUP_CREDITS to the pool and leaves plan/quota untouched', async () => {
    let patchedFields: Record<string, unknown> | null = null;
    mockFetch([
      { match: (m, u) => m === 'POST' && u.includes('/purchases?documentId='), respond: () => ({ status: 200 }) },
      {
        match: (m, u) => m === 'GET' && u.endsWith('/users/uid1'),
        respond: () => ({
          status: 200,
          body: { fields: { plan: { stringValue: 'trip_pass' }, aiCreditsPool: { integerValue: '5' } } },
        }),
      },
      {
        match: (m, u) => m === 'PATCH' && u.includes('/users/uid1'),
        respond: (_u, init) => {
          patchedFields = JSON.parse(init!.body as string).fields;
          return { status: 200 };
        },
      },
    ]);
    const { grantQuota, AI_TOPUP_CREDITS } = await import('./_billing');
    await grantQuota('uid1', 'ai_topup', 'order-4');
    expect(patchedFields).toMatchObject({
      aiCreditsPool: { integerValue: String(5 + AI_TOPUP_CREDITS) },
    });
    // ai_topup must not touch plan/tripQuota.
    expect(patchedFields).not.toHaveProperty('plan');
    expect(patchedFields).not.toHaveProperty('tripQuota');
  });

  it('propagates a Firestore error on the claim step instead of silently succeeding', async () => {
    mockFetch([
      { match: (m, u) => m === 'POST' && u.includes('/purchases?documentId='), respond: () => ({ status: 500, body: 'boom' }) },
    ]);
    const { grantQuota } = await import('./_billing');
    await expect(grantQuota('uid1', 'trip_pass', 'order-5')).rejects.toThrow();
  });
});

describe('revokeGrant', () => {
  it('is idempotent: refunding an already-refunded order is a no-op', async () => {
    mockFetch([
      {
        match: (m, u) => m === 'GET' && u.includes('/purchases/order-1'),
        respond: () => ({
          status: 200,
          body: { fields: { plan: { stringValue: 'trip_pass' }, refunded: { booleanValue: true } } },
        }),
      },
    ]);
    const { revokeGrant } = await import('./_billing');
    const revoked = await revokeGrant('uid1', 'trip_pass', 'order-1');
    expect(revoked).toBe(false);
  });

  it('unknown order id is skipped (never reverses a purchase it never recorded)', async () => {
    mockFetch([
      { match: (m, u) => m === 'GET' && u.includes('/purchases/order-x'), respond: () => ({ status: 404 }) },
    ]);
    const { revokeGrant } = await import('./_billing');
    const revoked = await revokeGrant('uid1', 'trip_pass', 'order-x');
    expect(revoked).toBe(false);
  });

  it('trip_pass revoke never drops tripQuota below the user\'s owned-trip count', async () => {
    let patchedFields: Record<string, unknown> | null = null;
    mockFetch([
      {
        match: (m, u) => m === 'GET' && u.includes('/purchases/order-1'),
        respond: () => ({ status: 200, body: { fields: { plan: { stringValue: 'trip_pass' } } } }),
      },
      {
        match: (m, u) => m === 'GET' && u.endsWith('/users/uid1'),
        respond: () => ({
          status: 200,
          body: { fields: { plan: { stringValue: 'trip_pass' }, tripQuota: { integerValue: '2' } } },
        }),
      },
      {
        match: (m, u) => m === 'PATCH' && u.includes('/users/uid1') && !u.includes('/purchases/'),
        respond: (_u, init) => {
          patchedFields = JSON.parse(init!.body as string).fields;
          return { status: 200 };
        },
      },
      {
        match: (m, u) => m === 'PATCH' && u.includes('/purchases/order-1'),
        respond: () => ({ status: 200 }),
      },
    ]);
    const { revokeGrant } = await import('./_billing');
    // ownedTripCount=3 but current tripQuota is only 2 — floor must win.
    const revoked = await revokeGrant('uid1', 'trip_pass', 'order-1', 3);
    expect(revoked).toBe(true);
    expect(patchedFields).toMatchObject({ tripQuota: { integerValue: '3' } }); // floor(3), not 2-1=1
  });

  it('lifetime revoke downgrades to free with no entitlements', async () => {
    let patchedFields: Record<string, unknown> | null = null;
    mockFetch([
      {
        match: (m, u) => m === 'GET' && u.includes('/purchases/order-1'),
        respond: () => ({ status: 200, body: { fields: { plan: { stringValue: 'lifetime' } } } }),
      },
      {
        match: (m, u) => m === 'GET' && u.endsWith('/users/uid1'),
        respond: () => ({
          status: 200,
          body: { fields: { plan: { stringValue: 'lifetime' }, tripQuota: { integerValue: '9999' } } },
        }),
      },
      {
        match: (m, u) => m === 'PATCH' && u.includes('/users/uid1') && !u.includes('/purchases/'),
        respond: (_u, init) => {
          patchedFields = JSON.parse(init!.body as string).fields;
          return { status: 200 };
        },
      },
      {
        match: (m, u) => m === 'PATCH' && u.includes('/purchases/order-1'),
        respond: () => ({ status: 200 }),
      },
    ]);
    const { revokeGrant } = await import('./_billing');
    await revokeGrant('uid1', 'lifetime', 'order-1', 0);
    expect(patchedFields).toMatchObject({
      plan: { stringValue: 'free' },
      entitlements: { arrayValue: { values: [] } },
    });
  });

  it('ai_topup revoke floors the pool at 0', async () => {
    let patchedFields: Record<string, unknown> | null = null;
    mockFetch([
      {
        match: (m, u) => m === 'GET' && u.includes('/purchases/order-1'),
        respond: () => ({ status: 200, body: { fields: { plan: { stringValue: 'ai_topup' } } } }),
      },
      {
        match: (m, u) => m === 'GET' && u.endsWith('/users/uid1'),
        respond: () => ({ status: 200, body: { fields: { aiCreditsPool: { integerValue: '3' } } } }),
      },
      {
        match: (m, u) => m === 'PATCH' && u.includes('/users/uid1') && !u.includes('/purchases/'),
        respond: (_u, init) => {
          patchedFields = JSON.parse(init!.body as string).fields;
          return { status: 200 };
        },
      },
      {
        match: (m, u) => m === 'PATCH' && u.includes('/purchases/order-1'),
        respond: () => ({ status: 200 }),
      },
    ]);
    const { revokeGrant, AI_TOPUP_CREDITS } = await import('./_billing');
    // Pool (3) is less than AI_TOPUP_CREDITS — must floor at 0, not go negative.
    expect(AI_TOPUP_CREDITS).toBeGreaterThan(3);
    await revokeGrant('uid1', 'ai_topup', 'order-1', 0);
    expect(patchedFields).toMatchObject({ aiCreditsPool: { integerValue: '0' } });
  });
});
