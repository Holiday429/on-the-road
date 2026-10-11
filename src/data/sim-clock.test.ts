import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./trip-context.ts', () => ({ currentTrip: () => null }));
vi.mock('./stores/route-store.ts', () => ({ routeStore: { peek: () => [] } }));
const sim = await import('./sim-clock.ts');
const { todayIso } = await import('./trip-phase.ts');

beforeEach(() => { sim._resetSimClockForTests(); });
afterEach(() => { vi.useRealTimers(); sim._resetSimClockForTests(); });

describe('sim clock', () => {
  it('is off by default and follows the real clock', () => {
    expect(sim.isSimulating()).toBe(false);
    expect(Math.abs(sim.appNow().getTime() - Date.now())).toBeLessThan(50);
  });

  it('shifts "now" and todayIso to the chosen moment, and keeps ticking', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 9, 0, 0));        // real: 11 Oct 2026 09:00 local
    expect(sim.setSimulatedNow('2026-08-07T10:30')).toBe(true);
    expect(sim.isSimulating()).toBe(true);
    expect(todayIso()).toBe('2026-08-07');
    expect(sim.appNow().getHours()).toBe(10);
    expect(sim.appNow().getMinutes()).toBe(30);
    vi.advanceTimersByTime(90 * 60 * 1000);                    // 90 real minutes later
    expect(sim.appNow().getHours()).toBe(12);                  // simulated time moved with it
    expect(sim.nowLocalValue()).toBe('2026-08-07T12:00');
  });

  it('rolls todayIso over at simulated midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 9, 0, 0));
    sim.setSimulatedNow('2026-08-07T23:30');
    vi.advanceTimersByTime(45 * 60 * 1000);
    expect(todayIso()).toBe('2026-08-08');
  });

  it('returns to the real clock on reset', () => {
    sim.setSimulatedNow('2000-01-01T00:00');
    sim.setSimulatedNow(null);
    expect(sim.isSimulating()).toBe(false);
    expect(todayIso()).toBe(todayIso());
    expect(sim.appNow().getFullYear()).toBeGreaterThan(2020);
  });

  it('rejects malformed values and leaves the state alone', () => {
    expect(sim.setSimulatedNow('tomorrow')).toBe(false);
    expect(sim.setSimulatedNow('2026-13-45T99:99')).toBe(false);
    expect(sim.isSimulating()).toBe(false);
  });

  it('notifies subscribers on change, until unsubscribed', () => {
    const fn = vi.fn();
    const off = sim.onSimChange(fn);
    sim.setSimulatedNow('2026-08-07T10:00');
    sim.setSimulatedNow(null);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    sim.setSimulatedNow('2026-08-07T10:00');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('?sim / ?debug URL params', () => {
  it('?sim=DATE starts a simulation at 10:00; a full time is kept', () => {
    sim.initDebugFromUrl('?sim=2026-08-07');
    expect(sim.nowLocalValue().slice(0, 13)).toBe('2026-08-07T10');
    sim.initDebugFromUrl('?sim=2026-08-09T18:45');
    expect(sim.nowLocalValue().slice(0, 16)).toBe('2026-08-09T18:45');
  });
  it('is a no-op without params, and debugEnabled is false without storage', () => {
    sim.initDebugFromUrl('');
    expect(sim.isSimulating()).toBe(false);
    expect(sim.debugEnabled()).toBe(false);
  });
});
