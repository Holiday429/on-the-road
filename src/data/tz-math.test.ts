import { describe, expect, it } from 'vitest';
import { clockAngles, formatOffsetHours, isoDateIn, offsetHoursBetween, tzOffsetMinutes, wallTimeToInstant } from './tz-math.ts';

describe('tzOffsetMinutes', () => {
  it('knows fixed and DST offsets', () => {
    expect(tzOffsetMinutes('Asia/Shanghai', new Date('2026-01-15T00:00:00Z'))).toBe(480);
    expect(tzOffsetMinutes('Europe/Rome', new Date('2026-01-15T00:00:00Z'))).toBe(60);
    expect(tzOffsetMinutes('Europe/Rome', new Date('2026-07-15T00:00:00Z'))).toBe(120);
    expect(tzOffsetMinutes('Asia/Kolkata', new Date('2026-07-15T00:00:00Z'))).toBe(330);
  });
});

describe('wallTimeToInstant', () => {
  it('reads wall-clock time in the given zone', () => {
    expect(wallTimeToInstant('2026-08-12', '14:20', 'Europe/Rome')!.toISOString()).toBe('2026-08-12T12:20:00.000Z');
    expect(wallTimeToInstant('2026-01-12', '14:20', 'Asia/Shanghai')!.toISOString()).toBe('2026-01-12T06:20:00.000Z');
  });
  it('lands on the right side of a DST change', () => {
    // Europe/Rome springs forward 2026-03-29 02:00 → 03:00; 12:00 that day is CEST (+2).
    expect(wallTimeToInstant('2026-03-29', '12:00', 'Europe/Rome')!.toISOString()).toBe('2026-03-29T10:00:00.000Z');
    expect(wallTimeToInstant('2026-03-28', '12:00', 'Europe/Rome')!.toISOString()).toBe('2026-03-28T11:00:00.000Z');
  });
  it('rejects malformed input', () => {
    expect(wallTimeToInstant('2026-8-12', '14:20', 'Europe/Rome')).toBeNull();
    expect(wallTimeToInstant('2026-08-12', 'noon', 'Europe/Rome')).toBeNull();
  });
});

describe('offsets & labels', () => {
  const at = new Date('2026-08-12T12:00:00Z');
  it('computes the hour gap between zones', () => {
    expect(offsetHoursBetween('Europe/Rome', 'Asia/Shanghai', at)).toBe(-6);
    expect(offsetHoursBetween('Asia/Shanghai', 'Europe/Rome', at)).toBe(6);
    expect(offsetHoursBetween('Asia/Kolkata', 'Asia/Shanghai', at)).toBe(-2.5);
  });
  it('formats them', () => {
    expect(formatOffsetHours(6)).toBe('+6h');
    expect(formatOffsetHours(-1)).toBe('−1h');
    expect(formatOffsetHours(5.5)).toBe('+5.5h');
    expect(formatOffsetHours(0)).toBe('±0');
  });
});

describe('clockAngles / isoDateIn', () => {
  it('puts the hands where the wall clock reads', () => {
    // 15:30 in Shanghai = 07:30Z
    const a = clockAngles('Asia/Shanghai', new Date('2026-08-12T07:30:00Z'));
    expect(a.minute).toBe(180);
    expect(a.hour).toBeCloseTo(3 * 30 + 15, 5);
  });
  it('gives the date in the zone, not UTC', () => {
    const at = new Date('2026-08-12T22:00:00Z');
    expect(isoDateIn('Asia/Shanghai', at)).toBe('2026-08-13');
    expect(isoDateIn('America/Los_Angeles', at)).toBe('2026-08-12');
  });
});
