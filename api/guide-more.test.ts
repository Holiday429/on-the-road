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
    statusCode?: number; body?: unknown; headers: Record<string, string>;
    status: (c: number) => typeof res; json: (d: unknown) => void;
    setHeader: (k: string, v: string) => void; end: () => void;
  } = {
    headers: {},
    status(code: number) { res.statusCode = code; return res; },
    json(data: unknown) { res.body = data; },
    setHeader(k, v) { res.headers[k] = v; },
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

describe('/api/guide-more', () => {
  it('rejects non-POST, non-OPTIONS methods without touching the guard', async () => {
    const { default: handler } = await import('./guide-more');
    const res = makeRes();
    await handler(makeReq({}, { method: 'GET' }) as never, res as never);
    expect(res.statusCode).toBe(405);
    expect(verifyAndMeter).not.toHaveBeenCalled();
  });

  // The whole point of this endpoint: it's a follow-up to an already-paid
  // guide and must NEVER debit a second credit. If this regresses, users get
  // silently double-charged every time they tap "load more".
  it('verifies the session but does NOT charge a credit (chargeable: false)', async () => {
    verifyAndMeter.mockResolvedValue('uid1');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({}),
    })));
    const { default: handler } = await import('./guide-more');
    const res = makeRes();
    await handler(makeReq({ city: 'Paris', section: 'attractions', existingTitles: [] }) as never, res as never);
    expect(verifyAndMeter).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ chargeable: false }),
    );
  });

  it('when the guard rejects, the handler stops without calling DeepSeek', async () => {
    verifyAndMeter.mockImplementation(async (_req: unknown, res: { status: (c: number) => { json: (d: unknown) => void } }) => {
      res.status(401).json({ error: 'unauthenticated' });
      return null;
    });
    const { default: handler } = await import('./guide-more');
    const res = makeRes();
    await handler(makeReq({ city: 'Paris', section: 'attractions' }) as never, res as never);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a request with no city', async () => {
    verifyAndMeter.mockResolvedValue('uid1');
    const { default: handler } = await import('./guide-more');
    const res = makeRes();
    await handler(makeReq({ section: 'attractions' }) as never, res as never);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a section that is not in the known SECTIONS map', async () => {
    verifyAndMeter.mockResolvedValue('uid1');
    const { default: handler } = await import('./guide-more');
    const res = makeRes();
    await handler(makeReq({ city: 'Paris', section: 'notARealSection' }) as never, res as never);
    expect(res.statusCode).toBe(400);
  });

  it('deduplicates returned items against existingTitles (case-insensitive)', async () => {
    verifyAndMeter.mockResolvedValue('uid1');
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('deepseek.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            choices: [{ message: { content: JSON.stringify([
              { title: 'Eiffel Tower' }, // duplicate, different case
              { title: 'Louvre Museum' },
            ]) } }],
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch to ${url}`));
    }));
    const { default: handler } = await import('./guide-more');
    const res = makeRes();
    await handler(makeReq({
      city: 'Paris', section: 'attractions', existingTitles: ['eiffel tower'],
    }) as never, res as never);
    const items = (res.body as { items: { title: string }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Louvre Museum');
  });
});
