import { describe, expect, it, vi } from 'vitest';
import type { StoredLeg } from './stores/route-store.ts';

vi.mock('./trip-context.ts', () => ({ currentTrip: () => null }));
vi.mock('./stores/route-store.ts', () => ({ routeStore: { peek: () => [] } }));

const { currentStop, tonightStay, legStays, stayNights, tripTransports, nextTransport, arrivalFor, countdownTo, tripDial, tripSpan } =
  await import('./trip-now.ts');

function leg(id: string, city: string, country: string, dateFrom: string, dateTo: string, extra: Partial<StoredLeg> = {}): StoredLeg {
  return { id, city, country, flag: '', dateFrom, dateTo, ...extra } as StoredLeg;
}

const LISBON = leg('a', 'Lisbon', 'Portugal', '2026-08-01', '2026-08-05', {
  arrivalTransport: { type: 'flight', from: 'Harbin', to: 'Lisbon', date: '2026-08-01', time: '09:00', confirmed: false },
});
const ROME = leg('b', 'Rome', 'Italy', '2026-08-05', '2026-08-12', {
  arrivalTransport: { type: 'flight', from: 'Lisbon', to: 'Rome', date: '2026-08-05', time: '14:20', confirmed: false },
  accommodations: [
    { id: 's2', name: 'Late flat', checkIn: '2026-08-09', checkOut: '2026-08-12', confirmed: false },
    { id: 's1', name: 'Early room', checkIn: '2026-08-05', checkOut: '2026-08-09', confirmed: false },
  ],
});
const ZURICH = leg('c', 'Zurich', 'Switzerland', '2026-08-12', '2026-08-15', {
  arrivalTransport: { type: 'train', from: 'Rome', to: 'Zurich', date: '2026-08-12', confirmed: false },
});
const LEGS = [ZURICH, LISBON, ROME]; // deliberately unsorted

describe('currentStop', () => {
  it('picks first / last outside the trip', () => {
    expect(currentStop(LEGS, '2026-07-01', 'before')).toMatchObject({ index: 1, count: 3 });
    expect(currentStop(LEGS, '2026-09-01', 'after')!.leg.id).toBe('c');
  });
  it('prefers the leg that starts today on a change-of-city day', () => {
    expect(currentStop(LEGS, '2026-08-05', 'during')!.leg.id).toBe('b');
    expect(currentStop(LEGS, '2026-08-12', 'during')!.leg.id).toBe('c');
  });
  it('covers mid-leg days and gaps', () => {
    expect(currentStop(LEGS, '2026-08-03', 'during')!.leg.id).toBe('a');
    const gap = [leg('x', 'A', 'Italy', '2026-08-01', '2026-08-02'), leg('y', 'B', 'Italy', '2026-08-05', '2026-08-06')];
    expect(currentStop(gap, '2026-08-03', 'during')!.leg.id).toBe('x');
  });
  it('is null with no legs', () => { expect(currentStop([], '2026-08-03', 'during')).toBeNull(); });
});

describe('stays', () => {
  it('orders stays by check-in and computes nights', () => {
    expect(legStays(ROME).map((s) => s.id)).toEqual(['s1', 's2']);
    expect(stayNights(legStays(ROME)[0])).toBe(4);
    expect(stayNights({ name: 'x', confirmed: false } as never)).toBeNull();
  });
  it("headlines tonight's stay, flipping on check-out day", () => {
    expect(tonightStay(ROME, '2026-08-07')!.id).toBe('s1');
    expect(tonightStay(ROME, '2026-08-09')!.id).toBe('s2'); // check-out of s1 = check-in of s2
    expect(tonightStay(ROME, '2026-08-01')!.id).toBe('s1'); // before: the next to begin
    expect(tonightStay(ROME, '2026-09-01')!.id).toBe('s2'); // after: the last
  });
  it('is null when a stop has no stays', () => { expect(tonightStay(LISBON, '2026-08-02')).toBeNull(); });
});

describe('transports', () => {
  const list = tripTransports(LEGS, 'Asia/Shanghai');
  it('resolves departure zones: home for the first, previous stop after', () => {
    expect(list.map((t) => t.leg.id)).toEqual(['a', 'b', 'c']);
    expect(list[0].depTz).toBe('Asia/Shanghai');
    expect(list[0].depAt!.toISOString()).toBe('2026-08-01T01:00:00.000Z'); // 09:00 CST
    expect(list[1].depTz).toBe('Europe/Lisbon');
    expect(list[1].depAt!.toISOString()).toBe('2026-08-05T13:20:00.000Z'); // 14:20 WEST
    expect(list[2].depAt).toBeNull(); // no time given
  });
  it('uses a custom zone resolver for the departure stop (a corrected zone)', () => {
    const fixed = tripTransports(LEGS, 'Asia/Shanghai', (l) => (l.id === 'a' ? 'Atlantic/Azores' : null));
    expect(fixed[1].depTz).toBe('Atlantic/Azores');
    expect(fixed[1].depAt!.toISOString()).toBe('2026-08-05T14:20:00.000Z');   // Azores are UTC+0 in August (Lisbon would be 13:20Z)
    expect(fixed[2].depAt).toBeNull();                                         // resolver gave no zone
  });
  it('without a home zone the first flight has no instant', () => {
    expect(tripTransports(LEGS, null)[0].depAt).toBeNull();
  });
  it('finds the next one still to be taken', () => {
    const now = new Date('2026-08-05T10:00:00Z');
    expect(nextTransport(list, now, '2026-08-05')!.leg.id).toBe('b');
    expect(nextTransport(list, new Date('2026-08-05T14:00:00Z'), '2026-08-05')!.leg.id).toBe('c');
    expect(nextTransport(list, new Date('2026-08-13T00:00:00Z'), '2026-08-13')).toBeNull();
  });
  it('untimed transport counts as upcoming all of its day', () => {
    expect(nextTransport(list, new Date('2026-08-12T20:00:00Z'), '2026-08-12')!.leg.id).toBe('c');
  });
  it('finds how you arrived', () => {
    expect(arrivalFor(list, ROME)!.transport.from).toBe('Lisbon');
    expect(arrivalFor(list, leg('z', 'x', 'y', '', ''))).toBeNull();
  });
});

describe('countdownTo', () => {
  it('splits into days / hours / minutes and never goes negative', () => {
    const now = new Date('2026-08-10T08:00:00Z');
    expect(countdownTo(new Date('2026-08-12T12:30:00Z'), now)).toMatchObject({ days: 2, hours: 4, minutes: 30 });
    expect(countdownTo(new Date('2026-08-01T00:00:00Z'), now).ms).toBe(0);
  });
});

describe('tripDial', () => {
  const span = { start: '2026-08-01', end: '2026-08-10' };
  it('counts down before, up during, completes after', () => {
    expect(tripDial('before', span, '2026-07-20')).toEqual({ kind: 'before', daysToGo: 12, fraction: 0 });
    expect(tripDial('during', span, '2026-08-04')).toEqual({ kind: 'during', day: 4, total: 10, fraction: 0.4 });
    expect(tripDial('after', span, '2026-09-01')).toEqual({ kind: 'after', total: 10, fraction: 1 });
  });
  it('clamps and survives no span', () => {
    expect(tripDial('during', span, '2026-08-10')).toMatchObject({ day: 10, fraction: 1 });
    expect(tripDial('before', null, '2026-08-10')).toMatchObject({ daysToGo: 0 });
  });
  it('derives the span from legs when there is no trip', () => {
    expect(tripSpan(null, LEGS)).toEqual({ start: '2026-08-01', end: '2026-08-15' });
    expect(tripSpan({ startDate: '2026-07-30', endDate: '2026-08-20' }, LEGS)).toEqual({ start: '2026-07-30', end: '2026-08-20' });
    expect(tripSpan(null, [])).toBeNull();
  });
});
