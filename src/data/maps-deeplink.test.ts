import { describe, expect, it } from 'vitest';
import { buildDeepLinks, placeUrl, MAX_STOPS_PER_LINK } from './maps-deeplink.ts';
import type { ExportPlace } from './places-export.ts';

const p = (name: string, over: Partial<ExportPlace> = {}): ExportPlace => ({ name, source: 'plan', ...over });
const many = (n: number) => Array.from({ length: n }, (_, i) => p(`Stop ${i}`, { city: 'Paris' }));
const params = (url: string) => new URL(url).searchParams;

describe('buildDeepLinks', () => {
  it('returns nothing for an empty list and reports unusable places', () => {
    expect(buildDeepLinks([])).toEqual({ segments: [], skipped: [] });
    const r = buildDeepLinks([p('  '), p('Louvre')]);
    expect(r.skipped).toHaveLength(1);
    expect(r.segments).toHaveLength(1);
  });

  it('uses a search link for a single place, with query_place_id when known', () => {
    const r = buildDeepLinks([p('Cafe', { placeId: 'ChIJ1', city: 'Lisbon' })]);
    expect(r.segments[0].url).toBe('https://www.google.com/maps/search/?api=1&query=Cafe%2C%20Lisbon&query_place_id=ChIJ1');
    expect(placeUrl({ kind: 'text', query: 'x y' })).toBe('https://www.google.com/maps/search/?api=1&query=x%20y');
  });

  it('builds origin / waypoints / destination for a short route', () => {
    const r = buildDeepLinks([p('A'), p('B'), p('C'), p('D')], { travelMode: 'walking' });
    expect(r.segments).toHaveLength(1);
    const q = params(r.segments[0].url);
    expect(q.get('origin')).toBe('A');
    expect(q.get('destination')).toBe('D');
    expect(q.get('waypoints')).toBe('B|C');
    expect(q.get('travelmode')).toBe('walking');
    expect(r.segments[0].url).toContain('waypoints=B%7CC');
  });

  it('sends waypoint_place_ids only when every middle stop has an id', () => {
    const all = buildDeepLinks([p('A', { placeId: 'a' }), p('B', { placeId: 'b' }), p('C', { placeId: 'c' })]);
    expect(params(all.segments[0].url).get('waypoint_place_ids')).toBe('b');
    expect(params(all.segments[0].url).get('origin_place_id')).toBe('a');
    const some = buildDeepLinks([p('A'), p('B'), p('C', { placeId: 'c' }), p('D')]);
    expect(params(some.segments[0].url).has('waypoint_place_ids')).toBe(false);
  });

  it('prefers coordinates over text when there is no place id', () => {
    const r = buildDeepLinks([p('A', { lat: 1, lng: 2 }), p('B', { lat: 3.5, lng: 4 })]);
    expect(params(r.segments[0].url).get('origin')).toBe('1.000000,2.000000');
  });

  it('splits long routes at the stop limit, chaining segments end→start', () => {
    const r = buildDeepLinks(many(25));
    expect(r.segments.every(s => s.count <= MAX_STOPS_PER_LINK)).toBe(true);
    for (let i = 1; i < r.segments.length; i++) {
      expect(r.segments[i].from).toBe(r.segments[i - 1].to);
    }
    expect(r.segments[0].from).toBe(0);
    expect(r.segments[r.segments.length - 1].to).toBe(24);
  });

  it('splits on URL length even under the stop limit', () => {
    const long = Array.from({ length: 8 }, (_, i) => p(`${'X'.repeat(90)}${i}`));
    const r = buildDeepLinks(long, { maxUrlLength: 600 });
    expect(r.segments.length).toBeGreaterThan(1);
    expect(r.segments.every(s => s.url.length <= 600)).toBe(true);
  });

  it('still emits a 2-stop segment when that pair alone exceeds the length cap', () => {
    const r = buildDeepLinks([p('A'.repeat(300)), p('B'.repeat(300)), p('C')], { maxUrlLength: 100 });
    expect(r.segments.length).toBe(2);
    expect(r.segments.every(s => s.count === 2)).toBe(true);
  });
});
