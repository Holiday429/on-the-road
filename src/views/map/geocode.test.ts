/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* geocode.ts reads localStorage once at import, so each test sets the storage
   first and then imports a fresh copy of the module. */
async function load(storage: Record<string, unknown> = {}) {
  vi.resetModules();
  localStorage.clear();
  for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, JSON.stringify(v));
  return import('./geocode.ts');
}

const bernCH = { lat: 46.95, lng: 7.45, iso: 'CH' };
const bernUS = { lat: 40.1, lng: -75.2, iso: 'US' };

beforeEach(() => { localStorage.clear(); });

describe('geocodeLocal cache keys', () => {
  it('finds bundled cities regardless of hint', async () => {
    const { geocodeLocal } = await load();
    expect(geocodeLocal('Paris')?.iso).toBe('FR');
    expect(geocodeLocal('Paris', 'France')?.iso).toBe('FR');
  });

  it('keeps same-named cities in different countries apart', async () => {
    const { geocodeLocal } = await load({
      'otr:geocode:v2': { 'springfield|CH': bernCH, 'springfield|US': bernUS },
    });
    expect(geocodeLocal('Springfield', 'Switzerland')).toEqual(bernCH);
    expect(geocodeLocal('Springfield', 'USA')).toEqual(bernUS);
    expect(geocodeLocal('Springfield')).toBeNull();           // no hint → bare key, not cached
    expect(geocodeLocal('Springfield', 'Narnia')).toBeNull();
  });

  it('seeds the v2 cache from v1: valid bare, and for a hint matching its own ISO', async () => {
    const { geocodeLocal } = await load({ 'otr:geocode:v1': { 'little place': bernCH } });
    expect(geocodeLocal('Little Place')).toEqual(bernCH);
    expect(geocodeLocal('Little Place', 'Switzerland')).toEqual(bernCH);
    expect(geocodeLocal('Little Place', 'United States')).toBeNull();   // different country → not reused
  });
});
