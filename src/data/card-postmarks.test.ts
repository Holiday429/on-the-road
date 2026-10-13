import { describe, expect, it } from 'vitest';
import { postmarksFor } from './card-postmarks.ts';
import type { StampLeg } from './stamps.ts';

const leg = (id: string, city: string, country: string, from: string, to: string, extra: Partial<StampLeg> = {}): StampLeg =>
  ({ id, city, country, dateFrom: from, dateTo: to, ...extra });

const ROUTE: StampLeg[] = [
  leg('a', 'Copenhagen', 'Denmark', '2026-06-25', '2026-07-05', { arrivalTransport: { type: 'flight' } }),
  leg('b', 'Berlin', 'Germany', '2026-07-05', '2026-07-09', { arrivalTransport: { type: 'train' } }),
  leg('c', 'Hamburg', 'Germany', '2026-07-09', '2026-07-11', { arrivalTransport: { type: 'bus' } }),
];

describe('postmarksFor', () => {
  it('nothing before the trip starts', () => {
    expect(postmarksFor(ROUTE, '2026-06-01').size).toBe(0);
  });

  it('arrival mark appears on the arrival date, departure mark only once you have left', () => {
    const m = postmarksFor(ROUTE, '2026-06-25');
    expect(m.get('a')?.arrive).toMatchObject({ phase: 'arrive', date: '2026-06-25', mode: 'flight' });
    expect(m.get('a')?.depart).toBeUndefined();
    expect(m.has('b')).toBe(false);
  });

  it('a departure is dated dateTo and names the transport to the next stop', () => {
    const m = postmarksFor(ROUTE, '2026-07-05');
    expect(m.get('a')?.depart).toMatchObject({ phase: 'depart', date: '2026-07-05', mode: 'train' });
    expect(m.get('b')?.arrive).toMatchObject({ date: '2026-07-05', mode: 'train' });
  });

  it('the last stop has no onward transport to name', () => {
    const m = postmarksFor(ROUTE, '2026-12-01');
    expect(m.get('c')?.depart?.mode).toBeUndefined();
  });

  it('is deterministic and gives the pair different shapes', () => {
    const a = postmarksFor(ROUTE, '2026-12-01');
    expect(postmarksFor(ROUTE, '2026-12-01')).toEqual(a);
    const pair = a.get('a')!;
    expect(pair.arrive!.shape).not.toBe(pair.depart!.shape);
  });
});
