import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyAndMeter = vi.fn();
vi.mock('./_guard', () => ({ verifyAndMeter: (...a: unknown[]) => verifyAndMeter(...a) }));

function makeReq(body: unknown, opts: { method?: string } = {}) {
  return {
    method: opts.method ?? 'POST',
    headers: {},
    body,
  } as unknown as import('http').IncomingMessage & { body: Record<string, unknown>; headers: Record<string, string>; method: string };
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
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected network call in test'); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/api/check', () => {
  it('rejects non-POST, non-OPTIONS methods without touching the guard', async () => {
    const { default: handler } = await import('./check');
    const res = makeRes();
    await handler(makeReq({}, { method: 'GET' }) as never, res as never);
    expect(res.statusCode).toBe(405);
    expect(verifyAndMeter).not.toHaveBeenCalled();
  });

  it('requires the guard to pass and charges a credit (chargeable: true)', async () => {
    verifyAndMeter.mockImplementation(async (_req: unknown, res: { status: (c: number) => { json: (d: unknown) => void } }) => {
      res.status(402).json({ error: 'quota_exceeded' });
      return null;
    });
    const { default: handler } = await import('./check');
    const res = makeRes();
    await handler(makeReq({ summary: 'Passport, Visa', tripId: 'trip1' }) as never, res as never);
    expect(res.statusCode).toBe(402);
    expect(verifyAndMeter).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ tripId: 'trip1', chargeable: true }),
    );
  });

  it('rejects an empty summary after the guard has already passed', async () => {
    verifyAndMeter.mockResolvedValue('uid1');
    const { default: handler } = await import('./check');
    const res = makeRes();
    await handler(makeReq({ summary: '' }) as never, res as never);
    expect(res.statusCode).toBe(400);
  });

  it('caps returned suggestions at 5 and drops non-string entries', async () => {
    verifyAndMeter.mockResolvedValue('uid1');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({
          suggestions: ['a', 'b', 'c', 'd', 'e', 'f', 123, null],
        }) } }],
      }),
    })));
    const { default: handler } = await import('./check');
    const res = makeRes();
    await handler(makeReq({ summary: 'Passport, Visa' }) as never, res as never);
    const suggestions = (res.body as { suggestions: string[] }).suggestions;
    expect(suggestions).toHaveLength(5);
    expect(suggestions.every(s => typeof s === 'string')).toBe(true);
  });
});
