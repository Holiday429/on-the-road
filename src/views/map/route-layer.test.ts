import { describe, expect, it } from 'vitest';
import { routeCountries, splitRoute, type RouteStop } from './route-layer.ts';

const stop = (lat: number, lng: number, iso: string | null, dateFrom: string, dateTo: string): RouteStop =>
  ({ lat, lng, iso, dateFrom, dateTo });

/* The route a trip actually walks: Lisbon → Paris → Rome, with today inside the
   Paris leg, so one segment is behind the traveller and one is still ahead. */
const ROUTE = [
  stop(38.7, -9.1, 'PT', '2026-06-01', '2026-06-10'),
  stop(48.9, 2.4, 'FR', '2026-07-01', '2026-07-05'),
  stop(41.9, 12.5, 'IT', '2026-08-01', '2026-08-10'),
];

describe('splitRoute', () => {
  it('colours the line as far as the stop you are in, and leaves the rest ahead', () => {
    const { done, ahead } = splitRoute(ROUTE, '2026-07-03');
    expect(done).toHaveLength(1);   // Lisbon → Paris: arrived
    expect(ahead).toHaveLength(1);  // Paris → Rome: not yet
  });

  it('counts a leg as reached on its first day, not once it is over', () => {
    // Arrival day in Paris: the segment into it is already coloured.
    expect(splitRoute(ROUTE, '2026-07-01').done).toHaveLength(1);
    // The day before: nothing has been travelled yet.
    expect(splitRoute(ROUTE, '2026-06-30').done).toHaveLength(0);
  });

  it('has the whole line ahead before departure and all of it behind after the trip', () => {
    expect(splitRoute(ROUTE, '2026-01-01')).toMatchObject({ done: [], ahead: [expect.anything(), expect.anything()] });
    expect(splitRoute(ROUTE, '2026-12-31')).toMatchObject({ done: [expect.anything(), expect.anything()], ahead: [] });
  });

  it('draws nothing for a single stop — there is no segment to draw', () => {
    expect(splitRoute([ROUTE[0]], '2026-07-03')).toEqual({ done: [], ahead: [] });
    expect(splitRoute([], '2026-07-03')).toEqual({ done: [], ahead: [] });
  });

  it('gives each segment a curve, not just its two endpoints', () => {
    const [seg] = splitRoute(ROUTE, '2026-12-31').done;
    expect(seg.length).toBeGreaterThan(2);
    expect(seg[0]).toEqual([ROUTE[0].lng, ROUTE[0].lat]);
    expect(seg[seg.length - 1]).toEqual([ROUTE[1].lng, ROUTE[1].lat]);
  });
});

describe('splitRoute with a cursor', () => {
  it('splits the line at the figure, whatever the date says', () => {
    // The date is after the whole trip, but the figure stands in Paris: Lisbon → Paris behind, Paris → Rome ahead.
    const { done, ahead } = splitRoute(ROUTE, '2026-12-31', 1);
    expect(done).toHaveLength(1);
    expect(ahead).toHaveLength(1);
  });

  it('has nothing behind a figure at the first stop, and nothing ahead of one at the last', () => {
    expect(splitRoute(ROUTE, '2026-12-31', 0)).toMatchObject({ done: [], ahead: [expect.anything(), expect.anything()] });
    expect(splitRoute(ROUTE, '2026-01-01', 2)).toMatchObject({ done: [expect.anything(), expect.anything()], ahead: [] });
  });

  it('falls back to the date when there is no cursor', () => {
    expect(splitRoute(ROUTE, '2026-07-03', null)).toEqual(splitRoute(ROUTE, '2026-07-03'));
  });
});

describe('routeCountries', () => {
  it('lists the countries in order, once each, ignoring stops with none', () => {
    const repeated = [...ROUTE, stop(43.3, 5.4, 'FR', '2026-09-01', '2026-09-03'), stop(0, 0, null, '2026-09-04', '2026-09-05')];
    expect(routeCountries(repeated)).toEqual(['PT', 'FR', 'IT']);
  });
});
