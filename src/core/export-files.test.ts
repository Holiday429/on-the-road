import { describe, expect, it } from 'vitest';
import { fileStem } from './export-files.ts';

describe('fileStem', () => {
  it('replaces reserved characters and spaces', () => {
    expect(fileStem('Paris · Day 1 (2026-05-01)')).toBe('Paris-·-Day-1-(2026-05-01)');
    expect(fileStem('a/b\\c:d*e?f')).toBe('a-b-c-d-e-f');
  });

  it('keeps CJK names', () => {
    expect(fileStem('巴黎 行程')).toBe('巴黎-行程');
  });

  it('falls back when nothing usable remains', () => {
    expect(fileStem(' / ')).toBe('on-the-road');
    expect(fileStem('', 'x')).toBe('x');
  });
});
