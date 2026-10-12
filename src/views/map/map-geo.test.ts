import { describe, expect, it } from 'vitest';
import { fmtRange, nights } from './map-geo.ts';

describe('fmtRange', () => {
  it('shows the calendar dates as written, not shifted by the time zone', () => {
    // Built from local-time parts: a bare 'YYYY-MM-DD' parses as UTC midnight,
    // which rendered as the previous day west of Greenwich.
    const fmt = (y: number, m: number, d: number) =>
      new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    expect(fmtRange('2026-10-12', '2026-10-14')).toBe(`${fmt(2026, 10, 12)} – ${fmt(2026, 10, 14)}`);
    expect(fmtRange('2026-01-01', '2026-01-02')).toBe('Jan 1 – Jan 2');
  });

  it('formats in the requested locale', () => {
    expect(fmtRange('2026-10-12', '2026-10-14', 'zh')).toMatch(/10月12日/);
  });
});

describe('nights', () => {
  it('counts the nights between two dates', () => {
    expect(nights('2026-10-12', '2026-10-15')).toBe(3);
    expect(nights('2026-10-12', '2026-10-12')).toBe(0);
  });
  it('never goes negative', () => {
    expect(nights('2026-10-15', '2026-10-12')).toBe(0);
  });
  it('is not thrown off by a daylight-saving change in between', () => {
    expect(nights('2026-03-27', '2026-03-30')).toBe(3);
    expect(nights('2026-10-24', '2026-10-27')).toBe(3);
  });
});
