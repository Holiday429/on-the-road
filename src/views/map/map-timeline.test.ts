import { describe, expect, it } from 'vitest';
import {
  legStartMs, legEndMs, fmtScrubDate, timelineRange,
  clampFraction, msToFraction, fractionToMs, type TimeRange,
} from './map-timeline.ts';

describe('legStartMs / legEndMs', () => {
  it('parse the leg dates to local-midnight epoch ms', () => {
    expect(legStartMs({ dateFrom: '2026-01-01' })).toBe(+new Date('2026-01-01T00:00:00'));
    expect(legEndMs({ dateTo: '2026-01-05' })).toBe(+new Date('2026-01-05T00:00:00'));
  });
});

describe('fmtScrubDate', () => {
  it('formats a cursor as "Mon YYYY"', () => {
    // Use a mid-month UTC time to avoid a tz-boundary month flip.
    expect(fmtScrubDate(+new Date('2026-03-15T12:00:00'))).toBe('Mar 2026');
  });
});

describe('timelineRange', () => {
  it('returns null for fewer than 2 legs', () => {
    expect(timelineRange([])).toBeNull();
    expect(timelineRange([{ dateFrom: '2026-01-01', dateTo: '2026-01-03' }])).toBeNull();
  });

  it('spans the earliest start to the latest end across legs', () => {
    const r = timelineRange([
      { dateFrom: '2026-01-10', dateTo: '2026-01-12' },
      { dateFrom: '2026-01-01', dateTo: '2026-01-04' }, // earliest start
      { dateFrom: '2026-01-20', dateTo: '2026-01-25' }, // latest end
    ])!;
    expect(r.minMs).toBe(+new Date('2026-01-01T00:00:00'));
    expect(r.maxMs).toBe(+new Date('2026-01-25T00:00:00'));
  });

  it('returns null when the bounds collapse (max <= min)', () => {
    // Two legs, but all on the same day → maxMs === minMs.
    expect(timelineRange([
      { dateFrom: '2026-01-01', dateTo: '2026-01-01' },
      { dateFrom: '2026-01-01', dateTo: '2026-01-01' },
    ])).toBeNull();
  });

  it('returns null when a date is unparseable (non-finite)', () => {
    expect(timelineRange([
      { dateFrom: 'not-a-date', dateTo: '2026-01-03' },
      { dateFrom: '2026-01-01', dateTo: '2026-01-05' },
    ])).toBeNull();
  });
});

describe('clampFraction', () => {
  it('clamps to [0,1]', () => {
    expect(clampFraction(-0.5)).toBe(0);
    expect(clampFraction(1.5)).toBe(1);
    expect(clampFraction(0.42)).toBe(0.42);
  });
});

describe('msToFraction / fractionToMs', () => {
  const range: TimeRange = { minMs: 1000, maxMs: 3000 };

  it('map ms to a [0,1] fraction across the range', () => {
    expect(msToFraction(1000, range)).toBe(0);
    expect(msToFraction(2000, range)).toBe(0.5);
    expect(msToFraction(3000, range)).toBe(1);
  });

  it('clamp out-of-range ms to the endpoints', () => {
    expect(msToFraction(0, range)).toBe(0);
    expect(msToFraction(9999, range)).toBe(1);
  });

  it('fractionToMs is the inverse within the range', () => {
    expect(fractionToMs(0, range)).toBe(1000);
    expect(fractionToMs(0.5, range)).toBe(2000);
    expect(fractionToMs(1, range)).toBe(3000);
  });

  it('round-trips ms → fraction → ms', () => {
    const ms = 2350;
    expect(fractionToMs(msToFraction(ms, range), range)).toBe(ms);
  });

  it('degrade safely with a null range (no scrubber armed)', () => {
    expect(msToFraction(1234, null)).toBe(1);  // "fully revealed" default
    expect(fractionToMs(0.5, null)).toBe(0);
  });
});
