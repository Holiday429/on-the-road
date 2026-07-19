import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REAL_KEY = 'super-secret-google-places-key';

function makeReq(query: Record<string, string>, opts: { method?: string } = {}) {
  return {
    method: opts.method ?? 'GET',
    query,
  } as unknown as import('http').IncomingMessage & { query: Record<string, string>; method?: string };
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
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected network call in test'); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_PLACES_KEY;
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
    await handler(makeReq({ op: 'autocomplete', q: 'Eiffel' }) as never, res as never);
    expect(res.statusCode).toBe(503);
  });

  it('rejects an unknown op', async () => {
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'deleteEverything' }) as never, res as never);
    expect(res.statusCode).toBe(400);
  });

  it('autocomplete: short queries (<3 chars) short-circuit to an empty list without calling Google', async () => {
    const fetchMock = vi.fn(() => { throw new Error('should not be called'); });
    vi.stubGlobal('fetch', fetchMock);
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'autocomplete', q: 'ei' }) as never, res as never);
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
    await handler(makeReq({ op: 'autocomplete', q: 'Eiffel Tower' }) as never, res as never);
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
    await handler(makeReq({ op: 'details', placeId: 'abc123' }) as never, res as never);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(REAL_KEY);
    // mapsUrl falls back to a key-less URL when Google doesn't return one.
    expect((res.body as { result: { mapsUrl: string } }).result.mapsUrl).not.toContain(REAL_KEY);
  });

  it('details requires a placeId', async () => {
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'details' }) as never, res as never);
    expect(res.statusCode).toBe(400);
  });

  it('photo: resolves the upstream redirect server-side so the key is never in the client-facing URL', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      headers: { get: (h: string) => (h === 'location' ? 'https://lh3.googleusercontent.com/some-photo.jpg' : null) },
    })));
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'photo', ref: 'photo-ref-123' }) as never, res as never);
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe('https://lh3.googleusercontent.com/some-photo.jpg');
    expect(res.redirectedTo).not.toContain(REAL_KEY);
  });

  it('photo requires a ref', async () => {
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'photo' }) as never, res as never);
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 (not a raw stack trace) when the upstream call throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const { default: handler } = await import('./places');
    const res = makeRes();
    await handler(makeReq({ op: 'autocomplete', q: 'Eiffel' }) as never, res as never);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(REAL_KEY);
  });
});
