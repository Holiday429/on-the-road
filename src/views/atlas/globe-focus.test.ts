import { describe, expect, it } from 'vitest';
import { clampTilt, focusFor, shortestRotation, wrapLng, MAX_TILT } from './globe-focus.ts';

describe('clampTilt / wrapLng', () => {
  it('limits the tilt to ±60°', () => {
    expect(MAX_TILT).toBe(60);
    expect(clampTilt(75)).toBe(60);
    expect(clampTilt(-90)).toBe(-60);
    expect(clampTilt(12)).toBe(12);
  });
  it('wraps longitudes into [-180, 180]', () => {
    expect(wrapLng(190)).toBe(-170);
    expect(wrapLng(-190)).toBe(170);
    expect(wrapLng(0)).toBe(0);
    expect(wrapLng(540)).toBe(-180);
  });
});

describe('shortestRotation', () => {
  it('takes the short way round', () => {
    expect(shortestRotation(170, -170)).toBe(190);       // 20° east, not 340° west
    expect(shortestRotation(-170, 170)).toBe(-190);
    expect(shortestRotation(10, 40)).toBe(40);
  });
  it('never turns more than half a lap', () => {
    for (const [a, b] of [[0, 359], [-300, 200], [720, 10], [45, -135]]) {
      expect(Math.abs(shortestRotation(a, b) - a)).toBeLessThanOrEqual(180);
    }
  });
});

describe('focusFor', () => {
  const germany = { left: 5.9, right: 15.0, top: 55.1, bottom: 47.3 };
  it('puts the country at the centre of the disc', () => {
    const c = focusFor(germany);
    expect(c.rotationX).toBeCloseTo(-10.45, 1);
    expect(c.rotationY).toBeCloseTo(-51.2, 1);
  });
  it('zooms in tight on a small country, out for a big one', () => {
    const tiny = focusFor({ left: 4.7, right: 5.1, top: 50.8, bottom: 50.6 });
    const russia = focusFor({ left: 19.6, right: 180, top: 81.9, bottom: 41.2 });
    expect(tiny.zoom).toBe(6);
    expect(russia.zoom).toBe(1.6);
    expect(focusFor(germany).zoom).toBeGreaterThan(russia.zoom);
    expect(focusFor(germany).zoom).toBeLessThanOrEqual(6);
  });
  it('centres a country that crosses the date line on the right side of the world', () => {
    const fiji = focusFor({ left: 177.1, right: -178.2, top: -16.2, bottom: -18.3 });   // right < left: wraps
    expect(Math.abs(fiji.rotationX)).toBeGreaterThan(170);                              // near the date line, not near 0
    expect(fiji.rotationX).toBeCloseTo(-(179.45), 0);
  });
  it('never tips the globe past the allowed tilt', () => {
    expect(focusFor({ left: -25, right: -13, top: 66.5, bottom: 63.3 }).rotationY).toBe(-60);   // Iceland
    expect(focusFor({ left: 166, right: 175, top: -34, bottom: -47 }).rotationY).toBeGreaterThanOrEqual(-60);
  });
});
