import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyAndMeter = vi.fn();
vi.mock('./_guard', () => ({ verifyAndMeter: (...a: unknown[]) => verifyAndMeter(...a) }));

function makeReq(body: unknown, opts: { method?: string } = {}) {
  return {
    method: opts.method ?? 'POST',
    headers: {},
    body,
  } as unknown as import('http').IncomingMessage & { body: Record<string, unknown>; headers: Record<string, string> };
}

function makeRes() {
  const res: {
    statusCode?: number; body?: unknown; headers: Record<string, string>; ended: boolean;
    status: (c: number) => typeof res; json: (d: unknown) => void;
    setHeader: (k: string, v: string) => void; write: (c: string) => boolean;
    flushHeaders: () => void; end: () => void;
  } = {
    headers: {},
    ended: false,
    status(code: number) { res.statusCode = code; return res; },
    json(data: unknown) { res.body = data; },
    setHeader(k, v) { res.headers[k] = v; },
    write() { return true; },
    flushHeaders() {},
    end() { res.ended = true; },
  };
  return res;
}

beforeEach(() => {
  vi.resetModules();
  verifyAndMeter.mockReset();
  // Never actually calls out — every test either short-circuits before this
  // or expects a specific fetch to fire, so an unmocked call is a bug.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected network call in test'); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/api/guide', () => {
  it('rejects non-POST, non-OPTIONS methods without touching the guard', async () => {
    const { default: handler } = await import('./guide');
    const res = makeRes();
    await handler(makeReq({}, { method: 'GET' }) as never, res as never);
    expect(res.statusCode).toBe(405);
    expect(verifyAndMeter).not.toHaveBeenCalled();
  });

  it('answers OPTIONS with 204 and never calls the guard (CORS preflight, no auth)', async () => {
    const { default: handler } = await import('./guide');
    const res = makeRes();
    await handler(makeReq(undefined, { method: 'OPTIONS' }) as never, res as never);
    expect(res.statusCode).toBe(204);
    expect(verifyAndMeter).not.toHaveBeenCalled();
  });

  it('rejects a request missing city/country before ever calling the guard (no credit burned on a bad request)', async () => {
    const { default: handler } = await import('./guide');
    const res = makeRes();
    await handler(makeReq({ city: 'Paris' }) as never, res as never); // no country
    expect(res.statusCode).toBe(400);
    expect(verifyAndMeter).not.toHaveBeenCalled();
  });

  it('when the guard rejects (quota/auth), the handler stops and never opens the SSE stream', async () => {
    verifyAndMeter.mockImplementation(async (_req: unknown, res: { status: (c: number) => { json: (d: unknown) => void } }) => {
      res.status(402).json({ error: 'quota_exceeded' });
      return null;
    });
    const { default: handler } = await import('./guide');
    const res = makeRes();
    await handler(makeReq({ city: 'Paris', country: 'France' }) as never, res as never);
    expect(res.statusCode).toBe(402);
    // The SSE content-type header is only set after the guard passes.
    expect(res.headers['Content-Type']).toBeUndefined();
  });

  it('charges the trip allowance (chargeable: true) — a full guide always debits a credit', async () => {
    verifyAndMeter.mockResolvedValue('uid1');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('DeepSeek down'))));
    const { default: handler } = await import('./guide');
    const res = makeRes();
    await handler(makeReq({ city: 'Paris', country: 'France', tripId: 'trip1' }) as never, res as never);
    expect(verifyAndMeter).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ tripId: 'trip1', chargeable: true }),
    );
  });

  it('opens the SSE stream once the guard passes, even if every downstream call fails', async () => {
    verifyAndMeter.mockResolvedValue('uid1');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('DeepSeek down'))));
    const { default: handler } = await import('./guide');
    const res = makeRes();
    await handler(makeReq({ city: 'Paris', country: 'France' }) as never, res as never);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.ended).toBe(true); // stream always closes, success or failure
  });
});
