import { describe, expect, it } from 'vitest';
import { resolveAlert, resolvePhase, ring, WEIGH_URGENT_DAYS } from './phase-strip.ts';

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

describe('resolveAlert', () => {
  it('says nothing when there is nothing to say', () => {
    expect(resolveAlert(null, 3)).toBeNull();
  });

  it('an overweight bag is always urgent and leads to the list', () => {
    const a = resolveAlert({ kind: 'over', listId: 'l1', count: 2 }, 90)!;
    expect(a).toMatchObject({ kind: 'over', listId: 'l1', urgent: true });
    expect(a.sub).toContain('2');
  });

  it('bags still to weigh are calm far from departure and urgent in the last two weeks', () => {
    const far = resolveAlert({ kind: 'weigh', listId: 'l1', count: 3 }, WEIGH_URGENT_DAYS + 1)!;
    const soon = resolveAlert({ kind: 'weigh', listId: 'l1', count: 3 }, WEIGH_URGENT_DAYS)!;
    expect(far.urgent).toBe(false);
    expect(soon.urgent).toBe(true);
    expect(soon.sub).toContain(String(WEIGH_URGENT_DAYS));
    expect(resolveAlert({ kind: 'weigh', listId: 'l1', count: 3 }, null)!.urgent).toBe(false);   // no dates
    expect(resolveAlert({ kind: 'weigh', listId: 'l1', count: 3 }, -2)!.urgent).toBe(false);     // already left
  });
});

describe('ring', () => {
  it('clamps the arc and escapes the label', () => {
    expect(ring(2, 'x')).toContain(`stroke-dasharray="${(2 * Math.PI * 18).toFixed(1)} `);
    expect(ring(-1, 'x')).toContain('stroke-dasharray="0.0 ');
    expect(ring(0.5, '<b>')).toContain('&lt;b&gt;');
  });
});
