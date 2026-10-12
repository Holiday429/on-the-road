import { describe, expect, it } from 'vitest';
import { createWorldState } from './world-state.ts';

describe('world state machine', () => {
  it('starts in the world, with nothing picked', () => {
    const s = createWorldState();
    expect(s.phase).toBe('world');
    expect(s.iso).toBeNull();
  });

  it('world → focusing → country', () => {
    const s = createWorldState();
    const t = s.begin('FR');
    expect([s.phase, s.iso]).toEqual(['focusing', 'FR']);
    expect(s.settle(t)).toBe(true);
    expect(s.phase).toBe('country');
  });

  it('a newer pick supersedes the one in flight: the old token can no longer settle', () => {
    const s = createWorldState();
    const first = s.begin('FR');
    const second = s.begin('DE');
    expect(s.isLive(first)).toBe(false);
    expect(s.settle(first)).toBe(false);
    expect(s.iso).toBe('DE');
    expect(s.settle(second)).toBe(true);
  });

  it('leaving cancels a transition in flight', () => {
    const s = createWorldState();
    const t = s.begin('FR');
    s.leave();
    expect(s.isLive(t)).toBe(false);
    expect(s.settle(t)).toBe(false);
    expect([s.phase, s.iso]).toEqual(['world', null]);
  });

  it('settling twice does nothing the second time', () => {
    const s = createWorldState();
    const t = s.begin('FR');
    expect(s.settle(t)).toBe(true);
    expect(s.settle(t)).toBe(false);
  });

  it('survives 20 rapid back-and-forth cycles ending in a clean world state', () => {
    const s = createWorldState();
    for (let i = 0; i < 20; i++) {
      const t = s.begin(i % 2 ? 'FR' : 'DE');
      if (i % 3 === 0) s.settle(t);
      s.leave();
    }
    expect([s.phase, s.iso]).toEqual(['world', null]);
  });
});
