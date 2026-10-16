import { describe, expect, it } from 'vitest';
import { orientationOf, ratioValue, snapRatio, type RatioClass } from './photo-ratio.ts';

const ALL: RatioClass[] = ['3:4', '4:3', '2:3', '3:2', '16:9', '9:16', '1:1'];

describe('snapRatio', () => {
  it('maps every standard shape to itself', () => {
    for (const c of ALL) expect(snapRatio(ratioValue(c))).toBe(c);
  });

  it('survives 5% of measurement drift either way', () => {
    for (const c of ALL) {
      expect(snapRatio(ratioValue(c) * 1.05), `${c} +5%`).toBe(c);
      expect(snapRatio(ratioValue(c) * 0.95), `${c} -5%`).toBe(c);
    }
  });

  it('keeps upright and wide apart: swapping width and height flips the class', () => {
    expect(snapRatio(1 / ratioValue('3:2'))).toBe('2:3');
    expect(snapRatio(1 / ratioValue('4:3'))).toBe('3:4');
    expect(snapRatio(1 / ratioValue('16:9'))).toBe('9:16');
  });

  it('reads real camera dimensions', () => {
    expect(snapRatio(4032 / 3024)).toBe('4:3');
    expect(snapRatio(3024 / 4032)).toBe('3:4');
    expect(snapRatio(6000 / 4000)).toBe('3:2');
    expect(snapRatio(1920 / 1080)).toBe('16:9');
  });

  it('treats a value that is not a ratio as square rather than guessing a side', () => {
    expect(snapRatio(0)).toBe('1:1');
    expect(snapRatio(NaN)).toBe('1:1');
    expect(snapRatio(-1.5)).toBe('1:1');
    expect(snapRatio(Infinity)).toBe('1:1');
  });
});

describe('orientationOf', () => {
  it('splits upright from wide', () => {
    expect(orientationOf(0.75)).toBe('portrait');
    expect(orientationOf(1.5)).toBe('landscape');
    expect(orientationOf(16 / 9)).toBe('landscape');
  });

  it('calls near-square photos square', () => {
    expect(orientationOf(1)).toBe('square');
    expect(orientationOf(1.05)).toBe('square');
    expect(orientationOf(0.95)).toBe('square');
    expect(orientationOf(1.1)).toBe('landscape');
    expect(orientationOf(0.9)).toBe('portrait');
  });

  it('calls garbage square', () => {
    expect(orientationOf(0)).toBe('square');
    expect(orientationOf(NaN)).toBe('square');
  });
});

describe('ratioValue', () => {
  it('is the exact number for the class', () => {
    expect(ratioValue('3:2')).toBe(1.5);
    expect(ratioValue('1:1')).toBe(1);
    expect(ratioValue('16:9')).toBeCloseTo(1.7778, 3);
  });
});
