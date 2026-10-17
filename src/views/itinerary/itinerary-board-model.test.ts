import { describe, expect, it } from 'vitest';
import type { Leg } from './itinerary-shared.ts';
import { boardState, boardSummary, gapBetween, gateFor, tileText } from './itinerary-board-model.ts';

const leg = (id: string, from: string, to: string, extra: Partial<Leg> = {}): Leg =>
  ({ id, city: id, country: 'X', flag: '', dateFrom: from, dateTo: to, ...extra }) as Leg;
const booked = { arrivalTransport: { type: 'train', from: 'A', to: 'B', confirmed: true }, accommodations: [{ name: 'H', confirmed: true }] } as Partial<Leg>;

describe('boardState', () => {
  const l = leg('a', '2026-07-05', '2026-07-09', booked);
  it('is done after the departure day', () => expect(boardState(l, '2026-07-10')).toBe('done'));
  it('is now from arrival through the departure day', () => {
    expect(boardState(l, '2026-07-05')).toBe('now');
    expect(boardState(l, '2026-07-09')).toBe('now');
  });
  it('is booked only when transport and every stay are confirmed', () => {
    expect(boardState(l, '2026-07-01')).toBe('booked');
    expect(boardState(leg('b', '2026-07-05', '2026-07-09'), '2026-07-01')).toBe('tobook');
    expect(boardState(leg('c', '2026-07-05', '2026-07-09', { arrivalTransport: booked.arrivalTransport }), '2026-07-01')).toBe('tobook');
  });
});

describe('gapBetween', () => {
  it('is positive for a gap and negative for an overlap', () => {
    expect(gapBetween(leg('a', '2026-07-01', '2026-07-05'), leg('b', '2026-07-07', '2026-07-09'))).toBe(2);
    expect(gapBetween(leg('a', '2026-07-01', '2026-07-05'), leg('b', '2026-07-04', '2026-07-09'))).toBe(-1);
    expect(gapBetween(leg('a', '2026-07-01', '2026-07-05'), leg('b', '2026-07-05', '2026-07-09'))).toBe(0);
  });
});

describe('gateFor', () => {
  const legs = [leg('a', '2026-07-01', '2026-07-05'), leg('b', '2026-07-05', '2026-07-09'), leg('c', '2026-07-09', '2026-07-12')];
  it('is none for an empty route', () => expect(gateFor([], '2026-07-01').kind).toBe('none'));
  it('counts the day inside the current stop and names the next one', () => {
    const g = gateFor(legs, '2026-07-07');
    expect(g).toMatchObject({ kind: 'now', dayNo: 3, dayTotal: 4 });
    expect(g.kind === 'now' && g.leg.id).toBe('b');
    expect(g.kind === 'now' && g.next?.id).toBe('c');
  });
  it('on a shared boundary day, picks the stop being reached', () => {
    const g = gateFor(legs, '2026-07-05');
    expect(g.kind === 'now' && g.leg.id).toBe('b');
  });
  it('before the trip: next departure with a countdown', () => {
    expect(gateFor(legs, '2026-06-20')).toMatchObject({ kind: 'next', daysUntil: 11 });
  });
  it('after the trip: over, with totals', () => {
    expect(gateFor(legs, '2026-08-01')).toEqual({ kind: 'over', nights: 11, stops: 3 });
  });
});

describe('boardSummary / tileText', () => {
  it('sums nights and counts distinct countries and unbooked stops', () => {
    const legs = [leg('a', '2026-07-01', '2026-07-05'), leg('b', '2026-07-05', '2026-07-09', { country: 'Y' })];
    expect(boardSummary(legs, '2026-06-01')).toEqual({ stops: 2, countries: 2, nights: 8, toBook: 2 });
  });
  it('tolerates a stop saved without a city', () => {
    expect(tileText(undefined, 10)).toBe('');
    expect(tileText(null, 10)).toBe('');
  });
  it('caps long names with an ellipsis', () => {
    expect(tileText('Copenhagen', 12)).toBe('Copenhagen');
    expect(tileText('Llanfairpwllgwyngyll', 10)).toBe('Llanfairp…');
  });
});
