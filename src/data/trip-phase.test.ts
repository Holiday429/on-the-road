import { describe, expect, it, vi } from 'vitest';
import type { StoredLeg } from './stores/route-store.ts';

// currentTrip() is mutable module state with no test-facing setter, so each
// test mocks trip-context.ts directly rather than trying to seed it via the
// real store (same approach as compare-store.test.ts).
let mockTrip: { startDate: string; endDate: string } | null = null;
vi.mock('./trip-context.ts', () => ({ currentTrip: () => mockTrip }));
vi.mock('./stores/route-store.ts', () => ({ routeStore: { peek: () => [] } }));

const { tripPhase, currentLeg, daysBetween, daysToGo, todayIso } = await import('./trip-phase.ts');

function leg(dateFrom: string, dateTo: string): StoredLeg {
  return { dateFrom, dateTo } as StoredLeg;
}

const TODAY = todayIso();

describe('daysBetween', () => {
  it('counts whole days forward and backward', () => {
    expect(daysBetween('2026-08-01', '2026-08-05')).toBe(4);
    expect(daysBetween('2026-08-05', '2026-08-01')).toBe(-4);
    expect(daysBetween('2026-08-01', '2026-08-01')).toBe(0);
  });
});

describe('tripPhase', () => {
  it('uses the trip doc dates when a trip is loaded, ignoring legs entirely', () => {
    mockTrip = { startDate: '2000-01-01', endDate: '2000-01-02' }; // long over
    expect(tripPhase([leg('2099-01-01', '2099-01-02')])).toBe('after');
    mockTrip = null;
  });

  it('falls back to leg span when no trip is loaded', () => {
    mockTrip = null;
    const future = leg(addDays(TODAY, 10), addDays(TODAY, 15));
    expect(tripPhase([future])).toBe('before');
    const past = leg(addDays(TODAY, -15), addDays(TODAY, -10));
    expect(tripPhase([past])).toBe('after');
    const ongoing = leg(addDays(TODAY, -2), addDays(TODAY, 2));
    expect(tripPhase([ongoing])).toBe('during');
  });

  it('defaults to "before" with no trip and no legs', () => {
    mockTrip = null;
    expect(tripPhase([])).toBe('before');
  });
});

describe('currentLeg', () => {
  it('returns null with no legs', () => {
    expect(currentLeg([])).toBeNull();
  });

  it('picks the leg spanning today over a future or past one', () => {
    const past = leg(addDays(TODAY, -10), addDays(TODAY, -5));
    const ongoing = leg(addDays(TODAY, -1), addDays(TODAY, 1));
    const future = leg(addDays(TODAY, 5), addDays(TODAY, 10));
    expect(currentLeg([past, future, ongoing])).toBe(ongoing);
  });

  it('falls back to the next upcoming leg when none is ongoing', () => {
    const past = leg(addDays(TODAY, -10), addDays(TODAY, -5));
    const soon = leg(addDays(TODAY, 3), addDays(TODAY, 6));
    const later = leg(addDays(TODAY, 10), addDays(TODAY, 12));
    expect(currentLeg([past, later, soon])).toBe(soon);
  });

  it('falls back to the last leg when the trip is entirely over', () => {
    const first = leg(addDays(TODAY, -20), addDays(TODAY, -15));
    const last = leg(addDays(TODAY, -10), addDays(TODAY, -5));
    expect(currentLeg([first, last])).toBe(last);
  });
});

describe('daysToGo', () => {
  it('prefers the trip start date over legs', () => {
    mockTrip = { startDate: addDays(TODAY, 7), endDate: addDays(TODAY, 14) };
    expect(daysToGo([leg(addDays(TODAY, 1), addDays(TODAY, 2))])).toBe(7);
    mockTrip = null;
  });

  it('falls back to the earliest leg when no trip is loaded', () => {
    mockTrip = null;
    expect(daysToGo([leg(addDays(TODAY, 3), addDays(TODAY, 5))])).toBe(3);
  });

  it('returns null with no trip and no legs', () => {
    mockTrip = null;
    expect(daysToGo([])).toBeNull();
  });
});

// Stays in UTC date arithmetic throughout (matching todayIso()'s
// toISOString()) — parsing/re-emitting through local time here would drift
// by a day in timezones behind UTC.
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
