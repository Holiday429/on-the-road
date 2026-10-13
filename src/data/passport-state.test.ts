import { describe, expect, it } from 'vitest';
import { docWarnings, passportState, snapOf, stampFromSnap } from './passport-state.ts';
import { passportFor, type PassportStamp } from './passport.ts';
import type { PlacementRec } from './schema/passport.ts';

const LEGS = [
  { id: 'a', city: 'Copenhagen', country: 'Denmark', dateFrom: '2026-06-25', dateTo: '2026-07-05', tripId: 't1' },
  { id: 'b', city: 'Berlin', country: 'Germany', dateFrom: '2026-07-05', dateTo: '2026-07-09', tripId: 't1' },
  { id: 'c', city: 'Paris', country: 'France', dateFrom: '2026-09-01', dateTo: '2026-09-05', tripId: 't1' },
];
const derived = passportFor(LEGS, '2026-12-01', new Map([['t1', 'Euro']])).stamps;
const rec = (s: PassportStamp, over: Partial<PlacementRec> = {}): PlacementRec =>
  ({ page: 't1#0', x: 30, y: 30, rot: 0, pressure: 1, at: 1, snap: snapOf(s), ...over });

describe('passportState', () => {
  it('stamps with a placement are pressed, the others wait in the tray, oldest first', () => {
    const st = passportState(derived, { [derived[1].id]: rec(derived[1]) });
    expect(st.pressed.map((s) => s.iso)).toEqual(['DE']);
    expect(st.pending.map((s) => s.iso)).toEqual(['DK', 'FR']);
  });

  it('a pressed stamp whose stop was deleted stays, from its saved copy, marked as an orphan', () => {
    const gone = derived[2];
    const st = passportState(derived.slice(0, 2), { [gone.id]: rec(gone) });
    const o = st.pressed.find((s) => s.iso === 'FR')!;
    expect(o).toMatchObject({ orphan: true, country: 'France', tripName: 'Euro', date: '2026-09-01' });
    expect(st.pending.map((s) => s.iso)).toEqual(['DK', 'DE']);
  });

  it('a placement with no saved copy and no stamp is ignored', () => {
    const st = passportState([], { 'country:XX:t9': { ...rec(derived[0]), snap: undefined } });
    expect(st.pressed).toEqual([]);
  });

  it('stampFromSnap rebuilds what the stamp said', () => {
    const s = derived[0];
    expect(stampFromSnap(s.id, rec(s, { rot: 7 }))).toMatchObject({ id: s.id, country: 'Denmark', nights: s.nights, rotation: 7, shape: s.shape, ink: s.ink });
  });
});

describe('docWarnings', () => {
  const trips = [
    { name: 'Past', startDate: '2025-01-01', endDate: '2025-02-01' },
    { name: 'Spring', startDate: '2027-03-01', endDate: '2027-03-20' },
  ];
  it('nothing without a valid expiry date', () => {
    expect(docWarnings('', trips, '2026-10-13')).toEqual([]);
    expect(docWarnings('soon', trips, '2026-10-13')).toEqual([]);
  });
  it('expires before the trip ends', () => {
    expect(docWarnings('2027-03-10', trips, '2026-10-13')).toMatchObject([{ tripName: 'Spring', kind: 'expired' }]);
  });
  it('valid for less than 6 months after you come back', () => {
    expect(docWarnings('2027-08-01', trips, '2026-10-13')).toMatchObject([{ tripName: 'Spring', kind: 'short' }]);
  });
  it('fine when valid for 6+ months after; past trips never count', () => {
    expect(docWarnings('2027-09-21', trips, '2026-10-13')).toEqual([]);
    expect(docWarnings('2025-01-10', [trips[0]], '2026-10-13')).toEqual([]);
  });
});
