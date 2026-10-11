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
