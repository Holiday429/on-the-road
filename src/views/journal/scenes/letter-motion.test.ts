import { describe, expect, it } from 'vitest';
import { LETTER_MOTION, openSchedule, postSchedule } from './letter-motion.ts';

describe('openSchedule', () => {
  it('opens the envelope, then the letter, then the postcards, in under a second', () => {
    const s = openSchedule(4);
    expect(s.flap.at).toBeLessThanOrEqual(s.paper.at);
    expect(s.paper.at).toBeLessThan(s.cards[0].at);
    expect(s.end).toBeGreaterThanOrEqual(700);
    expect(s.end).toBeLessThanOrEqual(900);
  });

  it('staggers the cards but caps the stagger, so nine cards take no longer than five', () => {
    const nine = openSchedule(9);
    expect(nine.cards[1].at).toBeGreaterThan(nine.cards[0].at);
    expect(nine.end).toBeLessThanOrEqual(900);
    expect(openSchedule(5).end).toBe(nine.end);
  });

  it('plays with no cards at all', () => {
    expect(openSchedule(0).cards).toEqual([]);
    expect(openSchedule(0).end).toBeGreaterThan(0);
  });
});

describe('postSchedule', () => {
  const s = postSchedule(5);

  it('folds, gathers, slides in, closes the flap, strikes the postmark, then flies — in that order', () => {
    expect(s.foldLower.at).toBeLessThan(s.foldUpper.at);
    expect(s.foldUpper.at + s.foldUpper.ms).toBeLessThanOrEqual(s.slide.at + s.slide.ms);
    expect(s.slide.at).toBeGreaterThanOrEqual(s.foldUpper.at);
    expect(s.slide.at + s.slide.ms).toBeLessThanOrEqual(s.flap.at);
    expect(s.flap.at + s.flap.ms).toBeLessThanOrEqual(s.stamp.at);
    expect(s.sealed).toBe(s.stamp.at + s.stamp.ms);
    expect(s.flyAt).toBeGreaterThan(s.sealed);
    expect(s.end).toBe(s.flyAt + LETTER_MOTION.post.flyMs);
  });

  it('has every postcard in the envelope before the flap closes', () => {
    for (const c of postSchedule(9).gather) expect(c.at + c.ms).toBeLessThanOrEqual(s.flap.at);
  });

  it('is the same length for any number of cards', () => {
    expect(postSchedule(0).end).toBe(postSchedule(9).end);
  });
});
