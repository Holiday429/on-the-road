import { createPrivateKey, createSign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ==========================================================================
   Fixture cert chain — root → intermediate → leaf, all self-signed P-256/EC,
   generated once with openssl and pasted here (this file needs no crypto
   tooling at test-run time beyond Node's built-in `crypto`).

   This chain can NEVER pass verify-apple-receipt.ts's real check — its root
   is pinned to Apple's actual Root CA G3 fingerprint by design, and this is
   not that key. That's intentional: these tests prove the verification
   logic correctly REJECTS a well-formed-but-untrusted chain (the same shape
   of bug class as an attacker forging a JWS), plus every earlier malformed-
   input branch. The one thing this file cannot test is the true happy path,
   since that needs a JWS actually signed by Apple.

   To regenerate (openssl, P-256/prime256v1, SHA-256):
     openssl ecparam -name prime256v1 -genkey -noout -out root.key
     openssl req -x509 -new -sha256 -key root.key -days 3650 -out root.pem \
       -subj "/CN=Test Root CA/O=Test/C=US" \
       -extensions v3_ca -config <(cat /etc/ssl/openssl.cnf; printf '[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n')
     openssl ecparam -name prime256v1 -genkey -noout -out intermediate.key
     openssl req -new -key intermediate.key -out i.csr -subj "/CN=Test Intermediate/O=Test/C=US" -sha256
     openssl x509 -req -in i.csr -CA root.pem -CAkey root.key -CAcreateserial -days 3650 -out intermediate.pem -sha256 -extfile <(printf 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n')
     openssl ecparam -name prime256v1 -genkey -noout -out leaf.key
     openssl req -new -key leaf.key -out l.csr -subj "/CN=Test Leaf/O=Test/C=US" -sha256
     openssl x509 -req -in l.csr -CA intermediate.pem -CAkey intermediate.key -CAcreateserial -days 3650 -out leaf.pem -sha256 -extfile <(printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n')
     # then base64 -w0 each `openssl x509 -in X.pem -outform DER` for the x5c
     # array below, and `openssl pkcs8 -topk8 -nocrypt -in leaf.key` for the
     # signing key.
   ========================================================================== */

const LEAF_DER_B64 = 'MIIByTCCAXCgAwIBAgIUD37xzlgDOd1tU+cLalGBvMq/v8owCgYIKoZIzj0EAwIwODEaMBgGA1UEAwwRVGVzdCBJbnRlcm1lZGlhdGUxDTALBgNVBAoMBFRlc3QxCzAJBgNVBAYTAlVTMB4XDTI2MDcxOTA4MDIxNloXDTM2MDcxNjA4MDIxNlowMDESMBAGA1UEAwwJVGVzdCBMZWFmMQ0wCwYDVQQKDARUZXN0MQswCQYDVQQGEwJVUzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABH4/+SMfPiG5EVuKSveq9z9h8W75aKp8BJtZx6DKcrY0ctrxXSVcJ6bLSdBd0M1oyZLUX+4+psA8qcjrerozcHGjYDBeMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMB0GA1UdDgQWBBRZ67Rq5/JSBlcURMUxoWJrGuWG8zAfBgNVHSMEGDAWgBRZ0LM6DBNEq/Xrdc09b6Ge66gH1DAKBggqhkjOPQQDAgNHADBEAiBFVWSANbt95dKEBEEhZewPgwUq3RFrJZS/G1GEiABqQQIgNSVey/W1OOEXHef+cM+/gMUuATAsVv7rDMWbPJDxoIo=';
const INTERMEDIATE_DER_B64 = 'MIIB0DCCAXagAwIBAgIUcXsDFsVpdabEjBGHR7XWeCNCNX0wCgYIKoZIzj0EAwIwMzEVMBMGA1UEAwwMVGVzdCBSb290IENBMQ0wCwYDVQQKDARUZXN0MQswCQYDVQQGEwJVUzAeFw0yNjA3MTkwODAyMTZaFw0zNjA3MTYwODAyMTZaMDgxGjAYBgNVBAMMEVRlc3QgSW50ZXJtZWRpYXRlMQ0wCwYDVQQKDARUZXN0MQswCQYDVQQGEwJVUzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABPOTez5PaWh9bG6aslSvl2HDJOUo3liBgnPMaI7Saoz4l8x7Z/9nM64SqZsbac2qzWryHOymfmKA9yPilA1hv4GjYzBhMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBRZ0LM6DBNEq/Xrdc09b6Ge66gH1DAfBgNVHSMEGDAWgBTv3aNUKk5cPJYbNZHghXRQH9xRVTAKBggqhkjOPQQDAgNIADBFAiB2UPAfIInLULJJB10vR68KPab6lnxUAaAThaltpTkJjgIhALowcFCk/sFNG2tYeUipfzyVmdXlzQAGYm983FWqrPlk';
const ROOT_DER_B64 = 'MIIBqjCCAVCgAwIBAgIUe6d4BHb7ZytDG8ijeTFht9U6Il0wCgYIKoZIzj0EAwIwMzEVMBMGA1UEAwwMVGVzdCBSb290IENBMQ0wCwYDVQQKDARUZXN0MQswCQYDVQQGEwJVUzAeFw0yNjA3MTkwODAxMzRaFw0zNjA3MTYwODAxMzRaMDMxFTATBgNVBAMMDFRlc3QgUm9vdCBDQTENMAsGA1UECgwEVGVzdDELMAkGA1UEBhMCVVMwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQj9RsYhvhgmyajJedVxQ2XeSpYkXNlKHlG64ReZBYSEqY8xfTOzyE8VjZelNO2rBTaQD2YtGYTMU1j612Ytmydo0IwQDAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAdBgNVHQ4EFgQU792jVCpOXDyWGzWR4IV0UB/cUVUwCgYIKoZIzj0EAwIDSAAwRQIgEz9fjK5i3FuTXgiHIS2Ks3mry4zt+kZYlMdMDjiQ/JoCIQDs0K76VJ/56rbZP6dsqJAOERa0Ub10Fb9oUKW6xFoLoA==';

// PKCS8 form of leaf.key — Node's createPrivateKey needs PKCS8, not SEC1/EC.
const LEAF_PRIVATE_KEY_PKCS8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg+HQoHVC9DjrUUPZ4
HBv7c2KWqF/GgaGdEbWoOzZSajihRANCAAR+P/kjHz4huRFbikr3qvc/YfFu+Wiq
fASbWcegynK2NHLa8V0lXCemy0nQXdDNaMmS1F/uPqbAPKnI63q6M3Bx
-----END PRIVATE KEY-----`;

// An unrelated key, used to build a JWS whose signature doesn't match the
// leaf cert's public key — proves signature verification is actually
// checked, not just chain trust.
const OTHER_PRIVATE_KEY_PKCS8 = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgWmPxX69xuUvPtfvR
lo4F9JCmgXYRnOYKo26/TO9OIqmhRANCAARSuie4SS+Lc7aUhjuBFlc/b9ExYkXu
XOjyF5gimGotemnxvl8PaQ1GL9CwSQC9OOGRt4rEigsFQst9Cbg92h/j
-----END PRIVATE KEY-----`;

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface JwsOptions {
  x5c?: string[];
  alg?: string;
  signingKeyPem?: string;
  payload?: Record<string, unknown>;
  tamperSignature?: boolean;
}

/** Build a real ES256 JWS (header.payload.signature, raw R||S) against the fixture chain. */
function buildJws(opts: JwsOptions = {}): string {
  const header = { alg: opts.alg ?? 'ES256', x5c: opts.x5c ?? [LEAF_DER_B64, INTERMEDIATE_DER_B64, ROOT_DER_B64] };
  const payload = opts.payload ?? {
    bundleId: 'com.holiday.On-the-Road',
    productId: 'com.holiday.On-the-Road.trip_pass',
    originalTransactionId: 'orig-tx-1',
    transactionId: 'tx-1',
    purchaseDate: Date.now(),
  };
  const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  if (opts.tamperSignature) {
    return `${signingInput}.${b64url(Buffer.from('not-a-real-signature'))}`;
  }

  const key = createPrivateKey(opts.signingKeyPem ?? LEAF_PRIVATE_KEY_PKCS8);
  const signer = createSign('sha256');
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign({ key, dsaEncoding: 'ieee-p1363' }); // raw R||S, matching JWS ES256
  return `${signingInput}.${b64url(sig)}`;
}

// ── Handler mocks ────────────────────────────────────────────────────────────

const verifyFirebaseToken = vi.fn();
const grantQuota = vi.fn();
vi.mock('./_guard.ts', () => ({ verifyFirebaseToken: (...a: unknown[]) => verifyFirebaseToken(...a) }));
vi.mock('./_billing.ts', () => ({ grantQuota: (...a: unknown[]) => grantQuota(...a) }));

function makeReq(body: unknown, opts: { method?: string; token?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? 'valid-firebase-token'}`;
  return {
    method: opts.method ?? 'POST',
    headers,
    body,
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
  verifyFirebaseToken.mockReset();
  grantQuota.mockReset();
  process.env.APPLE_BUNDLE_ID = 'com.holiday.On-the-Road';
});

afterEach(() => {
  delete process.env.APPLE_BUNDLE_ID;
});

describe('/api/verify-apple-receipt — request shape', () => {
  it('rejects non-POST methods', async () => {
    const { default: handler } = await import('./verify-apple-receipt.ts');
    const res = makeRes();
    await handler(makeReq({}, { method: 'GET' }) as never, res as never);
    expect(res.statusCode).toBe(405);
  });

  it('rejects a request with no Authorization header', async () => {
    const { default: handler } = await import('./verify-apple-receipt.ts');
    const res = makeRes();
    await handler(makeReq({ transactionJws: 'x', productId: 'x' }, { token: null }) as never, res as never);
    expect(res.statusCode).toBe(401);
    expect(verifyFirebaseToken).not.toHaveBeenCalled();
  });

  it('rejects when the Firebase token fails verification', async () => {
    verifyFirebaseToken.mockRejectedValue(new Error('bad token'));
    const { default: handler } = await import('./verify-apple-receipt.ts');
    const res = makeRes();
    await handler(makeReq({ transactionJws: 'x', productId: 'x' }) as never, res as never);
    expect(res.statusCode).toBe(401);
    expect(grantQuota).not.toHaveBeenCalled();
  });

  it('rejects a request missing transactionJws or productId', async () => {
    verifyFirebaseToken.mockResolvedValue('uid1');
    const { default: handler } = await import('./verify-apple-receipt.ts');
    const res = makeRes();
    await handler(makeReq({ productId: 'com.holiday.On-the-Road.trip_pass' }) as never, res as never); // no transactionJws
    expect(res.statusCode).toBe(400);
    expect(grantQuota).not.toHaveBeenCalled();
  });

  it('rejects an unknown productId before ever touching the JWS', async () => {
    verifyFirebaseToken.mockResolvedValue('uid1');
    const { default: handler } = await import('./verify-apple-receipt.ts');
    const res = makeRes();
    await handler(makeReq({ transactionJws: 'whatever', productId: 'com.evil.fake.sku' }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(grantQuota).not.toHaveBeenCalled();
  });
});

describe('/api/verify-apple-receipt — JWS verification rejects malformed/untrusted transactions', () => {
  const validProductId = 'com.holiday.On-the-Road.trip_pass';

  beforeEach(() => {
    verifyFirebaseToken.mockResolvedValue('uid1');
  });

  it('rejects a JWS with the wrong number of dot-separated parts', async () => {
    const { default: handler } = await import('./verify-apple-receipt.ts');
    const res = makeRes();
    await handler(makeReq({ transactionJws: 'not.a.valid.jws.token', productId: validProductId }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(grantQuota).not.toHaveBeenCalled();
  });

  it('rejects a JWS with an algorithm other than ES256', async () => {
    const jws = buildJws({ alg: 'RS256' });
    const { default: handler } = await import('./verify-apple-receipt.ts');
    const res = makeRes();
    await handler(makeReq({ transactionJws: jws, productId: validProductId }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(grantQuota).not.toHaveBeenCalled();
  });

  it('rejects a JWS with no x5c chain in the header', async () => {
    const jws = buildJws({ x5c: [] });
    const { default: handler } = await import('./verify-apple-receipt.ts');
    const res = makeRes();
    await handler(makeReq({ transactionJws: jws, productId: validProductId }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(grantQuota).not.toHaveBeenCalled();
  });

  // The core security property: a well-formed, correctly-signed chain whose
  // root is NOT Apple's real root must still be rejected. This is the exact
  // shape of an attacker with their own cert infrastructure trying to forge
  // a purchase. Verified negative-control: with the explicit fingerprint pin
  // (fingerprintMatches) disabled, this test STILL passes — the chain-of-
  // trust loop independently checks the top cert against the hardcoded
  // APPLE_ROOT constant (cert.checkIssued(APPLE_ROOT)), so there are two
  // redundant guards here, not one. Good defense in depth; just don't assume
  // this one test proves the fingerprint check specifically works — see
  // fingerprintMatches's own logic if that guard is ever refactored.
  it('rejects a well-formed, correctly-signed JWS whose root is not the pinned Apple Root CA G3', async () => {
    const jws = buildJws(); // valid chain, valid signature — just the wrong root
    const { default: handler } = await import('./verify-apple-receipt.ts');
    const res = makeRes();
    await handler(makeReq({ transactionJws: jws, productId: validProductId }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/invalid|untrusted/i);
    expect(grantQuota).not.toHaveBeenCalled();
  });

  it('rejects a JWS whose signature does not match the leaf certificate (tampered payload)', async () => {
    const jws = buildJws({ signingKeyPem: OTHER_PRIVATE_KEY_PKCS8 }); // signed by a DIFFERENT key than the leaf cert
    const { default: handler } = await import('./verify-apple-receipt.ts');
    const res = makeRes();
    await handler(makeReq({ transactionJws: jws, productId: validProductId }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(grantQuota).not.toHaveBeenCalled();
  });

  it('rejects a JWS with a garbage (non-cryptographic) signature', async () => {
    const jws = buildJws({ tamperSignature: true });
    const { default: handler } = await import('./verify-apple-receipt.ts');
    const res = makeRes();
    await handler(makeReq({ transactionJws: jws, productId: validProductId }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(grantQuota).not.toHaveBeenCalled();
  });

  it('never leaks JWS verification internals (stack traces) in the error response', async () => {
    const jws = buildJws();
    const { default: handler } = await import('./verify-apple-receipt.ts');
    const res = makeRes();
    await handler(makeReq({ transactionJws: jws, productId: validProductId }) as never, res as never);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('.ts:'); // no file/line stack trace leakage
    expect(serialized).not.toContain('at ');
  });
});

// The bundle-ID and idempotency checks run AFTER JWS verification, so they
// can't be exercised with this fixture chain (every JWS it can produce is
// rejected at the trust-anchor step first, by design — see the file header).
// They're already covered at the unit level: _billing.test.ts asserts
// grantQuota's idempotency directly, and the bundle-mismatch branch is a
// simple field comparison with no crypto dependency — read it at
// api/verify-apple-receipt.ts:203-209 alongside this suite when reviewing.
