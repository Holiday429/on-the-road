import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REAL_KEY = 'super-secret-google-places-key';
const PHOTO_SECRET = 'super-secret-photo-hmac-key';

const verifyFirebaseToken = vi.fn();
vi.mock('./_guard', () => ({
  verifyFirebaseToken: (...args: unknown[]) => verifyFirebaseToken(...args),
}));

function makeReq(
  query: Record<string, string>,
  opts: { method?: string; token?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  return {
    method: opts.method ?? 'GET',
    query,
    headers,
  } as unknown as import('http').IncomingMessage & {
    query: Record<string, string>;
    method?: string;
    headers: Record<string, string>;
  };
}

function makeRes() {
  const res: {
    statusCode?: number; body?: unknown; redirectedTo?: string;
    status: (c: number) => typeof res; json: (d: unknown) => void;
    setHeader: (k: string, v: string) => void; redirect: (c: number, url: string) => void; end: () => void;
  } = {
    status(code: number) { res.statusCode = code; return res; },
    json(data: unknown) { res.body = data; },
    setHeader() {},
    redirect(code, url) { res.statusCode = code; res.redirectedTo = url; },
    end() {},
  };
  return res;
}

beforeEach(() => {
  vi.resetModules();
  process.env.GOOGLE_PLACES_KEY = REAL_KEY;
  process.env.PLACES_PHOTO_SECRET = PHOTO_SECRET;
  verifyFirebaseToken.mockReset();
  verifyFirebaseToken.mockResolvedValue('uid1');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected network call in test'); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_PLACES_KEY;
  delete process.env.PLACES_PHOTO_SECRET;
});

describe('/api/places', () => {
  it('rejects non-GET, non-OPTIONS methods', async () => {
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'autocomplete' }, { method: 'POST' }) as never, res as never);
    expect(res.statusCode).toBe(405);
  });

  it('answers OPTIONS with 204', async () => {
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({}, { method: 'OPTIONS' }) as never, res as never);
    expect(res.statusCode).toBe(204);
  });

  it('returns 503 (not a crash) when GOOGLE_PLACES_KEY is not configured', async () => {
    delete process.env.GOOGLE_PLACES_KEY;
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'autocomplete', q: 'Eiffel' }, { token: 'tok' }) as never, res as never);
    expect(res.statusCode).toBe(503);
  });

  it('rejects an unknown op', async () => {
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'deleteEverything' }, { token: 'tok' }) as never, res as never);
    expect(res.statusCode).toBe(400);
  });

  describe('auth', () => {
    it('autocomplete: 401s with no Authorization header', async () => {
      const { default: handler } = await import('./places');
      const res = makeRes();
      await handler(makeReq({ op: 'autocomplete', q: 'Eiffel' }) as never, res as never);
      expect(res.statusCode).toBe(401);
      expect(verifyFirebaseToken).not.toHaveBeenCalled();
    });

    it('details: 401s with no Authorization header', async () => {
      const { default: handler } = await import('./places');
      const res = makeRes();
      await handler(makeReq({ op: 'details', placeId: 'abc123' }) as never, res as never);
      expect(res.statusCode).toBe(401);
    });

    it('autocomplete: 401s when the token fails verification', async () => {
      verifyFirebaseToken.mockRejectedValue(new Error('bad token'));
      const { default: handler } = await import('./places');
      const res = makeRes();
      await handler(makeReq({ op: 'autocomplete', q: 'Eiffel' }, { token: 'bad' }) as never, res as never);
      expect(res.statusCode).toBe(401);
    });

    it('autocomplete: 200s with a valid token', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ predictions: [] }),
      })));
      const { default: handler } = await import('./places');
      const res = makeRes();
      await handler(makeReq({ op: 'autocomplete', q: 'Eiffel Tower' }, { token: 'good' }) as never, res as never);
      expect(res.statusCode).toBe(200);
      expect(verifyFirebaseToken).toHaveBeenCalledWith('good');
    });

    it('details: 200s with a valid token', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: { formatted_address: 'Paris' } }),
      })));
      const { default: handler } = await import('./places');
      const res = makeRes();
      await handler(makeReq({ op: 'details', placeId: 'abc123' }, { token: 'good' }) as never, res as never);
      expect(res.statusCode).toBe(200);
    });

    it('photo-sign: 401s with no Authorization header', async () => {
      const { default: handler } = await import('./places');
      const res = makeRes();
      await handler(makeReq({ op: 'photo-sign', ref: 'photo-ref-123' }) as never, res as never);
      expect(res.statusCode).toBe(401);
    });
  });

  it('autocomplete: short queries (<3 chars) short-circuit to an empty list without calling Google', async () => {
    const fetchMock = vi.fn(() => { throw new Error('should not be called'); });
    vi.stubGlobal('fetch', fetchMock);
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'autocomplete', q: 'ei' }, { token: 'tok' }) as never, res as never);
    expect(res.statusCode).toBe(200);
    expect((res.body as { predictions: unknown[] }).predictions).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The whole reason this proxy exists: the API key must never reach the
  // client, in the URL, headers, or response body.
  it('the response never leaks the API key, for autocomplete', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        predictions: [{ description: 'Eiffel Tower, Paris', place_id: 'abc123' }],
      }),
    })));
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'autocomplete', q: 'Eiffel Tower' }, { token: 'tok' }) as never, res as never);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(REAL_KEY);
  });

  it('the response never leaks the API key, for details', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        result: { formatted_address: '5 Ave Anatole France, Paris', geometry: { location: { lat: 48.8, lng: 2.29 } } },
      }),
    })));
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'details', placeId: 'abc123' }, { token: 'tok' }) as never, res as never);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(REAL_KEY);
    // mapsUrl falls back to a key-less URL when Google doesn't return one.
    expect((res.body as { result: { mapsUrl: string } }).result.mapsUrl).not.toContain(REAL_KEY);
  });

  it('details requires a placeId', async () => {
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'details' }, { token: 'tok' }) as never, res as never);
    expect(res.statusCode).toBe(400);
  });

  describe('photo signing', () => {
    it('photo-sign: requires a ref', async () => {
      const { default: handler } = await import('./places');
      const res = makeRes();
      await handler(makeReq({ op: 'photo-sign' }, { token: 'tok' }) as never, res as never);
      expect(res.statusCode).toBe(400);
    });

    it('photo-sign: returns a signed url + exp, and never leaks the API key or secret', async () => {
      const { default: handler } = await import('./places');
      const res = makeRes();
      await handler(makeReq({ op: 'photo-sign', ref: 'photo-ref-123' }, { token: 'tok' }) as never, res as never);
      expect(res.statusCode).toBe(200);
      const body = res.body as { url: string; exp: number };
      expect(body.url).toContain('op=photo');
      expect(body.url).toContain('ref=photo-ref-123');
      expect(body.url).toContain('sig=');
      expect(body.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(body.url).not.toContain(REAL_KEY);
      expect(body.url).not.toContain(PHOTO_SECRET);
    });

    it('photo: resolves the upstream redirect server-side with a valid signature', async () => {
      const { default: handler } = await import('./places');
      const signRes = makeRes();
      await handler(makeReq({ op: 'photo-sign', ref: 'photo-ref-123' }, { token: 'tok' }) as never, signRes as never);
      const { url } = signRes.body as { url: string };
      const params = new URLSearchParams(url.split('?')[1]);

      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        headers: { get: (h: string) => (h === 'location' ? 'https://lh3.googleusercontent.com/some-photo.jpg' : null) },
      })));
      const res = makeRes();
      await handler(makeReq({
        op: 'photo',
        ref: params.get('ref')!,
        sig: params.get('sig')!,
        exp: params.get('exp')!,
      }) as never, res as never);
      expect(res.statusCode).toBe(302);
      expect(res.redirectedTo).toBe('https://lh3.googleusercontent.com/some-photo.jpg');
      expect(res.redirectedTo).not.toContain(REAL_KEY);
    });

    it('photo: 403s on a forged signature', async () => {
      const { default: handler } = await import('./places');
      const res = makeRes();
      const exp = Math.floor(Date.now() / 1000) + 900;
      await handler(makeReq({
        op: 'photo', ref: 'photo-ref-123', sig: 'not-a-real-signature', exp: String(exp),
      }) as never, res as never);
      expect(res.statusCode).toBe(403);
    });

    it('photo: 403s on an expired signature', async () => {
      const { default: handler } = await import('./places');
      const signRes = makeRes();
      await handler(makeReq({ op: 'photo-sign', ref: 'photo-ref-123' }, { token: 'tok' }) as never, signRes as never);
      const { url } = signRes.body as { url: string };
      const params = new URLSearchParams(url.split('?')[1]);

      const res = makeRes();
      const expiredExp = Math.floor(Date.now() / 1000) - 10; // already in the past
      await handler(makeReq({
        op: 'photo',
        ref: params.get('ref')!,
        sig: params.get('sig')!,
        exp: String(expiredExp),
      }) as never, res as never);
      expect(res.statusCode).toBe(403);
    });

    it('photo: requires a ref', async () => {
      const { default: handler } = await import('./places');
      const res = makeRes();
      await handler(makeReq({ op: 'photo', sig: 'x', exp: '9999999999' }) as never, res as never);
      expect(res.statusCode).toBe(400);
    });

    it('photo: 503s (not a crash) when PLACES_PHOTO_SECRET is not configured', async () => {
      delete process.env.PLACES_PHOTO_SECRET;
      const { default: handler } = await import('./places');
      const res = makeRes();
      await handler(makeReq({ op: 'photo', ref: 'photo-ref-123', sig: 'x', exp: '9999999999' }) as never, res as never);
      expect(res.statusCode).toBe(503);
    });
  });

  it('returns 500 (not a raw stack trace) when the upstream call throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'autocomplete', q: 'Eiffel' }, { token: 'tok' }) as never, res as never);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(REAL_KEY);
  });
});
