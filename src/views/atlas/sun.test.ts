import { describe, expect, it } from 'vitest';
import { subsolarPoint, nightCentre } from './sun.ts';

const at = (iso: string) => new Date(iso);

describe('subsolarPoint', () => {
  it('is near longitude 0 at noon UTC (within the equation of time) and ~180° away at midnight UTC', () => {
    expect(Math.abs(subsolarPoint(at('2026-03-20T12:00:00Z')).longitude)).toBeLessThan(4.5);
    expect(Math.abs(subsolarPoint(at('2026-03-20T00:00:00Z')).longitude)).toBeGreaterThan(175);
  });
  it('moves west 15° per hour', () => {
    const a = subsolarPoint(at('2026-06-01T10:00:00Z')).longitude;
    const b = subsolarPoint(at('2026-06-01T11:00:00Z')).longitude;
    expect(a - b).toBeCloseTo(15, 0);
  });
  it('has the sun over the tropics at the solstices and the equator at the equinoxes', () => {
    expect(subsolarPoint(at('2026-06-21T12:00:00Z')).latitude).toBeGreaterThan(23);
    expect(subsolarPoint(at('2026-12-21T12:00:00Z')).latitude).toBeLessThan(-23);
    expect(Math.abs(subsolarPoint(at('2026-03-20T12:00:00Z')).latitude)).toBeLessThan(1);
    expect(Math.abs(subsolarPoint(at('2026-09-23T12:00:00Z')).latitude)).toBeLessThan(1);
  });
  it('keeps longitude in [-180, 180]', () => {
    for (let h = 0; h < 24; h += 3) {
      const l = subsolarPoint(new Date(Date.UTC(2026, 4, 5, h))).longitude;
      expect(l).toBeGreaterThanOrEqual(-180);
      expect(l).toBeLessThanOrEqual(180);
    }
  });
});

describe('nightCentre', () => {
  it('is exactly opposite the sun', () => {
    const d = at('2026-08-01T09:30:00Z');
    const s = subsolarPoint(d), n = nightCentre(d);
    expect(n.latitude).toBeCloseTo(-s.latitude, 6);
    expect(Math.abs(((n.longitude - s.longitude + 720) % 360) - 180)).toBeLessThan(1e-6);
  });
});
