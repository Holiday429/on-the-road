import { beforeEach, describe, expect, it, vi } from 'vitest';

const geocode = vi.fn();
const geocodeLocal = vi.fn();
vi.mock('./geocode.ts', () => ({
  geocode: (...a: unknown[]) => geocode(...a),
  geocodeLocal: (...a: unknown[]) => geocodeLocal(...a),
}));

import { resolveCityLocations } from './geo.ts';

beforeEach(() => { geocode.mockReset(); geocodeLocal.mockReset(); });

describe('resolveCityLocations', () => {
  it('locates every token and takes the ISO from the country hint', async () => {
    geocode.mockImplementation(async (name: string) => ({ lat: name === 'Kyoto' ? 35 : 34, lng: 135, iso: 'JP' }));
    const r = await resolveCityLocations('Kyoto + Osaka', 'Japan');
    expect(r.stops.map((s) => s.name)).toEqual(['Kyoto', 'Osaka']);
    expect(r.iso).toBe('JP');
    expect(r.missing).toEqual([]);
  });

  it('reports tokens it could not place instead of dropping them silently', async () => {
    geocode.mockImplementation(async (name: string) => (name === 'Nowhere' ? null : { lat: 1, lng: 2, iso: 'DK' }));
    const r = await resolveCityLocations('Aarhus / Nowhere', 'Denmark');
    expect(r.stops.map((s) => s.name)).toEqual(['Aarhus']);
    expect(r.missing).toEqual(['Nowhere']);
  });

  it('anchors the first stop on saved coordinates without a lookup', async () => {
    geocodeLocal.mockReturnValue(null);
    const r = await resolveCityLocations('Tiny Village', 'Norway', { lat: 61.5, lng: 8.1 });
    expect(r.stops[0]).toMatchObject({ lat: 61.5, lng: 8.1, name: 'Tiny Village' });
    expect(geocode).not.toHaveBeenCalled();
    expect(r.iso).toBe('NO');
  });

  it('ignores saved coordinates that are clearly stale for the city name', async () => {
    geocodeLocal.mockReturnValue({ lat: 48.85, lng: 2.35, iso: 'FR' });   // Paris
    const r = await resolveCityLocations('Paris', 'France', { lat: 41.9, lng: 12.5 });   // saved: Rome
    expect(r.stops[0]).toMatchObject({ lat: 48.85, lng: 2.35 });
  });

  it('only anchors the first token on saved coordinates', async () => {
    geocodeLocal.mockReturnValue(null);
    geocode.mockResolvedValue({ lat: 3, lng: 4, iso: 'NO' });
    const r = await resolveCityLocations('Alpha, Beta', 'Norway', { lat: 1, lng: 2 });
    expect(r.stops.map((s) => [s.name, s.lat])).toEqual([['Alpha', 1], ['Beta', 3]]);
  });
});
