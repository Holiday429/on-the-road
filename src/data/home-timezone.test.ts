import { describe, expect, it } from 'vitest';
import type { StoredLeg } from './stores/route-store.ts';
import { resolveHomeTimezone } from './home-timezone.ts';

const legs = [{ dateFrom: '2026-08-01', arrivalTransport: { from: 'Harbin' } }] as unknown as StoredLeg[];

describe('resolveHomeTimezone', () => {
  it('prefers a valid profile setting', () => {
    expect(resolveHomeTimezone('Europe/London', 'Harbin', legs)).toBe('Europe/London');
  });
  it('ignores an invalid setting and falls through', () => {
    expect(resolveHomeTimezone('Mars/Base', 'Tokyo', legs)).toBe('Asia/Tokyo');
  });
  it('infers from the home city, then the first departure', () => {
    expect(resolveHomeTimezone('', '哈尔滨', [])).toBe('Asia/Shanghai');
    expect(resolveHomeTimezone('', '', legs)).toBe('Asia/Shanghai');
  });
  it('is null when nothing resolves', () => {
    expect(resolveHomeTimezone('', '', [])).toBeNull();
    expect(resolveHomeTimezone(undefined, 'Xyzzy', [])).toBeNull();
  });
});

describe('here-clock override', async () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  const { resolveHereTimezone, setHereTimezoneOverride, hereTimezoneOverride } = await import('./home-timezone.ts');
  const rome = { id: 'b', city: 'Rome', country: 'Italy' };
  const guess = { id: 'g', city: 'Nowhere', country: 'Narnia' };

  it('falls back to the guess from city/country', () => {
    expect(resolveHereTimezone(rome)).toBe('Europe/Rome');
    expect(resolveHereTimezone(guess)).toBeNull();
  });
  it('a correction wins, is remembered per stop, and can be cleared', () => {
    setHereTimezoneOverride('g', 'Asia/Tokyo');
    expect(resolveHereTimezone(guess)).toBe('Asia/Tokyo');
    expect(resolveHereTimezone(rome)).toBe('Europe/Rome');           // other stops untouched
    setHereTimezoneOverride('g', null);
    expect(hereTimezoneOverride('g')).toBeNull();
  });
  it('ignores an invalid stored zone', () => {
    store.set('otr:hereTz:b', 'Mars/Base');
    expect(resolveHereTimezone(rome)).toBe('Europe/Rome');
    setHereTimezoneOverride('b', 'not a zone');
    expect(store.get('otr:hereTz:b')).toBeUndefined();
  });
});
