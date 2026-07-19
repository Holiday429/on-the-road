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

describe('/api/story', () => {
  it('rejects non-POST, non-OPTIONS methods without touching the guard', async () => {
    const { default: handler } = await import('./story');
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
    const { default: handler } = await import('./story');
    const res = makeRes();
    await handler(makeReq({ prompt: 'Write a recap', tripId: 'trip1' }) as never, res as never);
    expect(res.statusCode).toBe(402);
    expect(verifyAndMeter).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ tripId: 'trip1', chargeable: true }),
    );
  });

  it('rejects an empty prompt after the guard has already passed', async () => {
    verifyAndMeter.mockResolvedValue('uid1');
    const { default: handler } = await import('./story');
    const res = makeRes();
    await handler(makeReq({ prompt: '   ' }) as never, res as never); // whitespace-only
    expect(res.statusCode).toBe(400);
  });

  it('never calls DeepSeek if the guard rejects', async () => {
    verifyAndMeter.mockImplementation(async (_req: unknown, res: { status: (c: number) => { json: (d: unknown) => void } }) => {
      res.status(401).json({ error: 'unauthenticated' });
      return null;
    });
    const fetchMock = vi.fn(() => { throw new Error('should not be called'); });
    vi.stubGlobal('fetch', fetchMock);
    const { default: handler } = await import('./story');
    const res = makeRes();
    await handler(makeReq({ prompt: 'Write a recap' }) as never, res as never);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
