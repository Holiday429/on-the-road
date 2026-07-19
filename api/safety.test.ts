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
    statusCode?: number; body?: unknown;
    status: (c: number) => typeof res; json: (d: unknown) => void;
    setHeader: (k: string, v: string) => void; end: () => void;
  } = {
    status(code: number) { res.statusCode = code; return res; },
    json(data: unknown) { res.body = data; },
    setHeader() {},
    end() {},
  };
  return res;
}

beforeEach(() => {
  vi.resetModules();
  verifyAndMeter.mockReset();
  process.env.DEEPSEEK_API_KEY = 'test-key';
  delete process.env.TAVILY_API_KEY;
  delete process.env.GOOGLE_GEOCODING_KEY;
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected network call in test'); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/api/safety — geocode mode', () => {
  // geocode is a free lookup helper (not AI generation) and deliberately
  // bypasses the auth/credit guard entirely — verify that stays true, and
  // that it's still gated on having valid lat/lng.
  it('geocode mode never calls the guard', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ city: 'Paris', locality: '', countryName: 'France', countryCode: 'FR' }),
    })));
    const { default: handler } = await import('./safety');
    const res = makeRes();
    await handler(makeReq({ mode: 'geocode', lat: 48.85, lng: 2.35 }) as never, res as never);
    expect(verifyAndMeter).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('geocode mode rejects non-numeric lat/lng', async () => {
    const { default: handler } = await import('./safety');
    const res = makeRes();
    await handler(makeReq({ mode: 'geocode', lat: 'not-a-number', lng: 2.35 }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(verifyAndMeter).not.toHaveBeenCalled();
  });
});

describe('/api/safety — generate mode', () => {
  it('rejects non-POST, non-OPTIONS methods', async () => {
    const { default: handler } = await import('./safety');
    const res = makeRes();
    await handler(makeReq({}, { method: 'GET' }) as never, res as never);
    expect(res.statusCode).toBe(405);
  });

  it('requires the guard to pass before generating (chargeable: true)', async () => {
    verifyAndMeter.mockImplementation(async (_req: unknown, res: { status: (c: number) => { json: (d: unknown) => void } }) => {
      res.status(402).json({ error: 'quota_exceeded' });
      return null;
    });
    const { default: handler } = await import('./safety');
    const res = makeRes();
    await handler(makeReq({ mode: 'generate', city: 'Paris', country: 'France', tripId: 'trip1' }) as never, res as never);
    expect(res.statusCode).toBe(402);
    expect(verifyAndMeter).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ tripId: 'trip1', chargeable: true }),
    );
  });

  it('rejects a generate request with no city, after the guard already passed', async () => {
    verifyAndMeter.mockResolvedValue('uid1');
    const { default: handler } = await import('./safety');
    const res = makeRes();
    await handler(makeReq({ mode: 'generate', country: 'France' }) as never, res as never);
    expect(res.statusCode).toBe(400);
  });

  it('mode defaults to generate when omitted, and still requires the guard', async () => {
    verifyAndMeter.mockImplementation(async (_req: unknown, res: { status: (c: number) => { json: (d: unknown) => void } }) => {
      res.status(401).json({ error: 'unauthenticated' });
      return null;
    });
    const { default: handler } = await import('./safety');
    const res = makeRes();
    await handler(makeReq({ city: 'Paris', country: 'France' }) as never, res as never); // no mode field
    expect(verifyAndMeter).toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
