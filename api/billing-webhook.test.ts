import * as crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const grantQuota = vi.fn();
const revokeGrant = vi.fn();
vi.mock('./_billing', () => ({ grantQuota: (...a: unknown[]) => grantQuota(...a), revokeGrant: (...a: unknown[]) => revokeGrant(...a) }));

const trackServerEvent = vi.fn();
vi.mock('./_analytics', () => ({ trackServerEvent: (...a: unknown[]) => trackServerEvent(...a) }));

const SECRET = 'test-webhook-secret';

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function makeReq(payload: unknown, opts: { signature?: string; method?: string } = {}) {
  const body = JSON.stringify(payload);
  const signature = opts.signature ?? sign(body);
  return {
    method: opts.method ?? 'POST',
    headers: { 'x-signature': signature },
    body,
  } as unknown as import('http').IncomingMessage & { body: Buffer | string; headers: Record<string, string>; method?: string };
}

function makeRes() {
  const res: { statusCode?: number; body?: unknown; status: (c: number) => typeof res; json: (d: unknown) => void } = {
    status(code: number) { res.statusCode = code; return res; },
    json(data: unknown) { res.body = data; },
  };
  return res;
}

function orderCreatedPayload(overrides: Partial<{ uid: string; plan: string; identifier: string; total: number }> = {}) {
  return {
    meta: { event_name: 'order_created', custom_data: { uid: overrides.uid ?? 'uid1', plan: overrides.plan ?? 'trip_pass' } },
    data: {
      id: overrides.identifier ?? 'ls-order-1',
      attributes: { total: overrides.total ?? 880 },
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = SECRET;
  grantQuota.mockReset();
  revokeGrant.mockReset();
  trackServerEvent.mockReset();
});

afterEach(() => {
  delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
});

describe('billing-webhook', () => {
  it('rejects a request with an invalid signature and never calls grantQuota', async () => {
    const { default: handler } = await import('./billing-webhook');
    const req = makeReq(orderCreatedPayload(), { signature: 'deadbeef'.repeat(8) });
    const res = makeRes();
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(401);
    expect(grantQuota).not.toHaveBeenCalled();
  });

  it('rejects non-POST methods', async () => {
    const { default: handler } = await import('./billing-webhook');
    const req = makeReq(orderCreatedPayload(), { method: 'GET' });
    const res = makeRes();
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(405);
    expect(grantQuota).not.toHaveBeenCalled();
  });

  it('order_created calls grantQuota with uid/plan/orderId parsed from custom_data', async () => {
    grantQuota.mockResolvedValue(true);
    const { default: handler } = await import('./billing-webhook');
    const req = makeReq(orderCreatedPayload({ uid: 'uid-abc', plan: 'lifetime', identifier: 'ord-9' }));
    const res = makeRes();
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(grantQuota).toHaveBeenCalledWith('uid-abc', 'lifetime', 'ord-9', 880);
  });

  it('order_created fires a purchase analytics event only when grantQuota applied a fresh grant', async () => {
    grantQuota.mockResolvedValue(true);
    const { default: handler } = await import('./billing-webhook');
    await handler(makeReq(orderCreatedPayload()) as never, makeRes() as never);
    expect(trackServerEvent).toHaveBeenCalledWith('purchase', expect.objectContaining({ plan: 'trip_pass' }));
  });

  it('does not fire a purchase event when grantQuota reports a duplicate (applied=false)', async () => {
    grantQuota.mockResolvedValue(false);
    const { default: handler } = await import('./billing-webhook');
    await handler(makeReq(orderCreatedPayload()) as never, makeRes() as never);
    expect(trackServerEvent).not.toHaveBeenCalled();
  });

  it('order_refunded calls revokeGrant, not grantQuota', async () => {
    revokeGrant.mockResolvedValue(true);
    const { default: handler } = await import('./billing-webhook');
    const payload = orderCreatedPayload();
    (payload.meta as { event_name: string }).event_name = 'order_refunded';
    const req = makeReq(payload);
    const res = makeRes();
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(revokeGrant).toHaveBeenCalledWith('uid1', 'trip_pass', 'ls-order-1');
    expect(grantQuota).not.toHaveBeenCalled();
  });

  it('acks and skips unknown event names without touching billing', async () => {
    const { default: handler } = await import('./billing-webhook');
    const payload = orderCreatedPayload();
    (payload.meta as { event_name: string }).event_name = 'subscription_created';
    const req = makeReq(payload);
    const res = makeRes();
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect((res.body as { skipped?: boolean }).skipped).toBe(true);
    expect(grantQuota).not.toHaveBeenCalled();
    expect(revokeGrant).not.toHaveBeenCalled();
  });

  it('acks and skips when custom_data has no uid (never crashes on malformed payloads)', async () => {
    const { default: handler } = await import('./billing-webhook');
    const payload = orderCreatedPayload();
    (payload.meta as { custom_data?: { uid?: string; plan?: string } }).custom_data = { plan: 'trip_pass' };
    const req = makeReq(payload);
    const res = makeRes();
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(grantQuota).not.toHaveBeenCalled();
  });

  it('acks and skips an unrecognized plan value', async () => {
    const { default: handler } = await import('./billing-webhook');
    const req = makeReq(orderCreatedPayload({ plan: 'some_new_sku' }));
    const res = makeRes();
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(grantQuota).not.toHaveBeenCalled();
  });

  it('returns 500 and does not throw when grantQuota itself fails', async () => {
    grantQuota.mockRejectedValue(new Error('Firestore down'));
    const { default: handler } = await import('./billing-webhook');
    const req = makeReq(orderCreatedPayload());
    const res = makeRes();
    await expect(handler(req as never, res as never)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(500);
  });
});
