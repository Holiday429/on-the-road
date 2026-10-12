import { describe, expect, it, vi } from 'vitest';
import { completeCoords, completeGroupCoords } from './places-coords.ts';
import type { ExportPlace } from './places-export.ts';

const p = (name: string, over: Partial<ExportPlace> = {}): ExportPlace => ({ name, source: 'plan', city: 'Paris', ...over });

describe('completeCoords', () => {
  it('skips places that already have coordinates and fills the rest', async () => {
    const geocoder = vi.fn(async () => ({ lat: 1, lng: 2 }));
    const res = await completeCoords([p('A', { lat: 9, lng: 9 }), p('B')], { geocoder });
    expect(geocoder).toHaveBeenCalledTimes(1);
    expect(res.places.map(x => [x.lat, x.lng])).toEqual([[9, 9], [1, 2]]);
    expect(res.unresolved).toEqual([]);
  });

  it('does not mutate its input', async () => {
    const input = p('B');
    await completeCoords([input], { geocoder: async () => ({ lat: 1, lng: 2 }) });
    expect(input.lat).toBeUndefined();
  });

  it('geocodes an identical query only once', async () => {
    const geocoder = vi.fn(async () => ({ lat: 1, lng: 2 }));
    await completeCoords([p('Louvre'), p('Louvre')], { geocoder });
    expect(geocoder).toHaveBeenCalledTimes(1);
  });

  it('reports unresolved places, including geocoder failures', async () => {
    const geocoder = async (q: string) => {
      if (q.startsWith('Boom')) throw new Error('network');
      return q.startsWith('Nowhere') ? null : { lat: 1, lng: 2 };
    };
    const res = await completeCoords([p('Nowhere'), p('Boom'), p('Ok')], { geocoder });
    expect(res.unresolved.map(x => x.name)).toEqual(['Nowhere', 'Boom']);
  });

  it('reports progress over only the places that need lookup', async () => {
    const seen: Array<[number, number]> = [];
    await completeCoords([p('A', { lat: 1, lng: 1 }), p('B'), p('C')], {
      geocoder: async () => ({ lat: 1, lng: 2 }),
      onProgress: ({ done, total }) => seen.push([done, total]),
    });
    expect(seen).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  it('stops when aborted and says so', async () => {
    const ctl = new AbortController();
    const geocoder = vi.fn(async () => { ctl.abort(); return { lat: 1, lng: 2 }; });
    const res = await completeCoords([p('A'), p('B'), p('C')], { geocoder, signal: ctl.signal });
    expect(geocoder).toHaveBeenCalledTimes(1);
    expect(res.aborted).toBe(true);
    expect(res.unresolved.map(x => x.name)).toEqual(['B', 'C']);
  });
});

describe('completeGroupCoords', () => {
  it('writes resolved places back into their own groups', async () => {
    const groups = [
      { id: 'g1', places: [p('A'), p('B', { lat: 5, lng: 5 })] },
      { id: 'g2', places: [p('C')] },
    ];
    const res = await completeGroupCoords(groups, { geocoder: async () => ({ lat: 1, lng: 2 }) });
    expect(res.groups.map(g => g.places.map(x => x.lat))).toEqual([[1, 5], [1]]);
    expect(res.groups[0].id).toBe('g1');
  });
});
