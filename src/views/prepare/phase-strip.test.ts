import { describe, expect, it } from 'vitest';
import { resolvePhase } from './phase-strip.ts';

describe('resolvePhase', () => {
  it('returns "none" when there is no trip/leg data at all', () => {
    expect(resolvePhase(null, 'before')).toBe('none');
  });

  it('returns "far" when more than 14 days out', () => {
    expect(resolvePhase(15, 'before')).toBe('far');
    expect(resolvePhase(100, 'before')).toBe('far');
  });

  it('returns "packing" between 4 and 14 days out, inclusive of 14', () => {
    expect(resolvePhase(14, 'before')).toBe('packing');
    expect(resolvePhase(4, 'before')).toBe('packing');
  });

  it('returns "imminent" at 3 days or fewer, before departure', () => {
    expect(resolvePhase(3, 'before')).toBe('imminent');
    expect(resolvePhase(0, 'before')).toBe('imminent');
    expect(resolvePhase(-1, 'before')).toBe('imminent');
  });

  it('returns "traveling" whenever the trip phase is "during", regardless of daysToGo', () => {
    expect(resolvePhase(0, 'during')).toBe('traveling');
    expect(resolvePhase(null, 'during')).toBe('traveling');
    expect(resolvePhase(-5, 'during')).toBe('traveling');
  });

  it('returns "none" once the trip phase is "after", regardless of daysToGo', () => {
    expect(resolvePhase(-30, 'after')).toBe('none');
    expect(resolvePhase(null, 'after')).toBe('none');
  });
});
