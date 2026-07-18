import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifySignedJwtWithCertsAsync = vi.fn();

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getClient() {
      return Promise.resolve({
        getAccessToken: () => Promise.resolve({ token: 'fake-token' }),
      });
    }
  },
  OAuth2Client: class {
    verifySignedJwtWithCertsAsync(...args: unknown[]) {
      return verifySignedJwtWithCertsAsync(...args);
    }
  },
}));

const FAKE_SA = JSON.stringify({
  project_id: 'test-project',
  client_email: 'test@example.com',
  private_key: 'fake-key',
});

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

type Handler = {
  match: (method: string, url: string) => boolean;
  respond: (url: string, init?: RequestInit) => { status: number; body?: unknown };
};

function mockFetch(handlers: Handler[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const handler = handlers.find(h => h.match(method, url));
    if (!handler) throw new Error(`Unmocked fetch: ${method} ${url}`);
    const { status, body } = handler.respond(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }));
}

const certsHandler: Handler = {
  match: (m, u) => m === 'GET' && u === CERTS_URL,
  respond: () => ({ status: 200, body: {} }),
};

function makeReq(token: string | null) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as import('http').IncomingMessage & { body: Record<string, unknown>; headers: Record<string, string> };
}

function makeRes() {
  const res: { statusCode?: number; body?: unknown; status: (c: number) => typeof res; json: (d: unknown) => void } = {
    status(code: number) { res.statusCode = code; return res; },
    json(data: unknown) { res.body = data; },
  };
  return res;
}

beforeEach(() => {
  vi.resetModules();
  process.env.FIREBASE_SERVICE_ACCOUNT = FAKE_SA;
  verifySignedJwtWithCertsAsync.mockReset();
  verifySignedJwtWithCertsAsync.mockResolvedValue({ getPayload: () => ({ sub: 'uid1' }) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyAndMeter', () => {
  it('returns null and 401 with no Authorization header', async () => {
    const { verifyAndMeter } = await import('./_guard');
    const res = makeRes();
    const uid = await verifyAndMeter(makeReq(null) as never, res as never);
    expect(uid).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it('returns null and 401 when token verification fails', async () => {
    verifySignedJwtWithCertsAsync.mockRejectedValue(new Error('bad token'));
    mockFetch([certsHandler]);
    const { verifyAndMeter } = await import('./_guard');
    const res = makeRes();
    const uid = await verifyAndMeter(makeReq('bad-token') as never, res as never);
    expect(uid).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it('chargeable:false consumes no credit and skips straight to returning uid', async () => {
    mockFetch([
      certsHandler,
      { match: (m, u) => m === 'GET' && u.includes('/users/uid1'), respond: () => ({ status: 404 }) },
    ]);
    const { verifyAndMeter } = await import('./_guard');
    const res = makeRes();
    const uid = await verifyAndMeter(makeReq('tok') as never, res as never, { chargeable: false });
    expect(uid).toBe('uid1');
    expect(res.statusCode).toBeUndefined(); // never responded — caller proceeds
  });

  it('a paid plan spends the trip\'s bundled allowance first, before touching the pool', async () => {
    let tripBumped = false;
    let poolPatched = false;
    mockFetch([
      certsHandler,
      {
        match: (m, u) => m === 'GET' && u.includes('/users/uid1'),
        respond: () => ({
          status: 200,
          body: { fields: { plan: { stringValue: 'trip_pass' }, aiCreditsPool: { integerValue: '5' } } },
        }),
      },
      {
        match: (m, u) => m === 'GET' && u.includes('/trips/trip1/usage/ai'),
        respond: () => ({ status: 200, body: { fields: { count: { integerValue: '2' } } } }), // under the 10-credit allowance
      },
      {
        match: (m, u) => m.includes('POST') === false ? false : u.endsWith(':commit'),
        respond: () => { tripBumped = true; return { status: 200 }; },
      },
      {
        match: (m, u) => m === 'PATCH' && u.includes('/users/uid1'),
        respond: () => { poolPatched = true; return { status: 200 }; },
      },
    ]);
    const { verifyAndMeter } = await import('./_guard');
    const res = makeRes();
    const uid = await verifyAndMeter(makeReq('tok') as never, res as never, { tripId: 'trip1' });
    expect(uid).toBe('uid1');
    expect(tripBumped).toBe(true);
    expect(poolPatched).toBe(false); // pool must stay untouched — trip allowance covered it
  });

  it('falls back to the account pool once the trip allowance is exhausted', async () => {
    let poolPatchedWith: string | null = null;
    mockFetch([
      certsHandler,
      {
        match: (m, u) => m === 'GET' && u.includes('/users/uid1'),
        respond: () => ({
          status: 200,
          body: { fields: { plan: { stringValue: 'trip_pass' }, aiCreditsPool: { integerValue: '4' } } },
        }),
      },
      {
        match: (m, u) => m === 'GET' && u.includes('/trips/trip1/usage/ai'),
        respond: () => ({ status: 200, body: { fields: { count: { integerValue: '10' } } } }), // allowance fully used
      },
      {
        match: (m, u) => m === 'PATCH' && u.includes('/users/uid1'),
        respond: (_u, init) => {
          poolPatchedWith = JSON.parse(init!.body as string).fields.aiCreditsPool.integerValue;
          return { status: 200 };
        },
      },
    ]);
    const { verifyAndMeter } = await import('./_guard');
    const res = makeRes();
    const uid = await verifyAndMeter(makeReq('tok') as never, res as never, { tripId: 'trip1' });
    expect(uid).toBe('uid1');
    expect(poolPatchedWith).toBe('3'); // 4 - 1
  });

  it('a free user with no pool and no free trial used gets the one-time free call', async () => {
    let freeMarked = false;
    mockFetch([
      certsHandler,
      {
        match: (m, u) => m === 'GET' && u.includes('/users/uid1'),
        respond: () => ({ status: 200, body: { fields: { plan: { stringValue: 'free' } } } }),
      },
      {
        match: (m, u) => m === 'PATCH' && u.includes('/users/uid1'),
        respond: (_u, init) => {
          const fields = JSON.parse(init!.body as string).fields;
          if (fields.freeAiUsed) freeMarked = true;
          return { status: 200 };
        },
      },
    ]);
    const { verifyAndMeter } = await import('./_guard');
    const res = makeRes();
    const uid = await verifyAndMeter(makeReq('tok') as never, res as never, { tripId: '' });
    expect(uid).toBe('uid1');
    expect(freeMarked).toBe(true);
  });

  it('a free user who already used the trial and has no pool gets 402', async () => {
    mockFetch([
      certsHandler,
      {
        match: (m, u) => m === 'GET' && u.includes('/users/uid1'),
        respond: () => ({
          status: 200,
          body: { fields: { plan: { stringValue: 'free' }, freeAiUsed: { booleanValue: true } } },
        }),
      },
    ]);
    const { verifyAndMeter } = await import('./_guard');
    const res = makeRes();
    const uid = await verifyAndMeter(makeReq('tok') as never, res as never, { tripId: '' });
    expect(uid).toBeNull();
    expect(res.statusCode).toBe(402);
    expect((res.body as { needTopup?: boolean }).needTopup).toBe(true);
  });

  it('a paid user out of trip allowance and pool, with trial already used, gets 402 (not the free-trial path)', async () => {
    mockFetch([
      certsHandler,
      {
        match: (m, u) => m === 'GET' && u.includes('/users/uid1'),
        respond: () => ({
          status: 200,
          body: {
            fields: {
              plan: { stringValue: 'trip_pass' },
              aiCreditsPool: { integerValue: '0' },
              freeAiUsed: { booleanValue: true },
            },
          },
        }),
      },
      {
        match: (m, u) => m === 'GET' && u.includes('/trips/trip1/usage/ai'),
        respond: () => ({ status: 200, body: { fields: { count: { integerValue: '10' } } } }),
      },
    ]);
    const { verifyAndMeter } = await import('./_guard');
    const res = makeRes();
    const uid = await verifyAndMeter(makeReq('tok') as never, res as never, { tripId: 'trip1' });
    expect(uid).toBeNull();
    expect(res.statusCode).toBe(402);
  });

  it('returns 503 (not a crash) when the Firestore user read fails', async () => {
    mockFetch([
      certsHandler,
      { match: (m, u) => m === 'GET' && u.includes('/users/uid1'), respond: () => ({ status: 500, body: 'boom' }) },
    ]);
    const { verifyAndMeter } = await import('./_guard');
    const res = makeRes();
    const uid = await verifyAndMeter(makeReq('tok') as never, res as never, { tripId: 'trip1' });
    expect(uid).toBeNull();
    expect(res.statusCode).toBe(503);
  });
});
