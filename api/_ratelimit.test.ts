import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const UPSTASH_URL = 'https://fake-upstash.example.com';
const UPSTASH_TOKEN = 'fake-upstash-token';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe('checkRateLimit', () => {
  it('fails open (allows the request) when Upstash env vars are unset', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('should not call Upstash without env vars'); }));
    const { checkRateLimit } = await import('./_ratelimit');
    const result = await checkRateLimit('test-key', 5, 60);
    expect(result.ok).toBe(true);
  });

  it('allows the request when under the limit', async () => {
    process.env.UPSTASH_REDIS_REST_URL = UPSTASH_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = UPSTASH_TOKEN;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      expect(url).toBe(`${UPSTASH_URL}/pipeline`);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ result: 3 }, { result: 1 }]),
      });
    }));
    const { checkRateLimit } = await import('./_ratelimit');
    const result = await checkRateLimit('test-key', 5, 60);
    expect(result.ok).toBe(true);
  });

  it('rejects the request once the count exceeds the limit, with a Retry-After from TTL', async () => {
    process.env.UPSTASH_REDIS_REST_URL = UPSTASH_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = UPSTASH_TOKEN;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === `${UPSTASH_URL}/pipeline`) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ result: 6 }, { result: 0 }]) });
      }
      if (url.startsWith(`${UPSTASH_URL}/ttl/`)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: 42 }) });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const { checkRateLimit } = await import('./_ratelimit');
    const result = await checkRateLimit('test-key', 5, 60);
    expect(result.ok).toBe(false);
    expect(result.retryAfter).toBe(42);
  });

  it('fails open when the Upstash pipeline call itself errors', async () => {
    process.env.UPSTASH_REDIS_REST_URL = UPSTASH_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = UPSTASH_TOKEN;
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const { checkRateLimit } = await import('./_ratelimit');
    const result = await checkRateLimit('test-key', 5, 60);
    expect(result.ok).toBe(true);
  });

  it('fails open when Upstash responds with a non-ok status', async () => {
    process.env.UPSTASH_REDIS_REST_URL = UPSTASH_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = UPSTASH_TOKEN;
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500 })));
    const { checkRateLimit } = await import('./_ratelimit');
    const result = await checkRateLimit('test-key', 5, 60);
    expect(result.ok).toBe(true);
  });

  it('falls back to the window size for Retry-After if the TTL lookup fails', async () => {
    process.env.UPSTASH_REDIS_REST_URL = UPSTASH_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = UPSTASH_TOKEN;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === `${UPSTASH_URL}/pipeline`) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ result: 6 }, { result: 0 }]) });
      }
      return Promise.resolve({ ok: false, status: 500 });
    }));
    const { checkRateLimit } = await import('./_ratelimit');
    const result = await checkRateLimit('test-key', 5, 60);
    expect(result.ok).toBe(false);
    expect(result.retryAfter).toBe(60);
  });
});

describe('respondRateLimited', () => {
  it('sets Retry-After and responds 429 with a JSON body', async () => {
    const { respondRateLimited } = await import('./_ratelimit');
    const headers: Record<string, string> = {};
    let statusCode: number | undefined;
    let body: unknown;
    const res = {
      setHeader: (k: string, v: string) => { headers[k] = v; },
      status: (c: number) => { statusCode = c; return { json: (d: unknown) => { body = d; } }; },
    };
    respondRateLimited(res, 42);
    expect(headers['Retry-After']).toBe('42');
    expect(statusCode).toBe(429);
    expect((body as { retryAfter: number }).retryAfter).toBe(42);
  });
});
