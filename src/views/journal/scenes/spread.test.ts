import { describe, expect, it } from 'vitest';
import { photoLean, stampParts } from './spread.ts';

describe('stampParts', () => {
  it('splits an ISO date the way a rubber stamp prints it', () => {
    expect(stampParts('2026-07-30')).toEqual({ day: '30', month: 'JUL', year: '2026' });
    expect(stampParts('2026-01-01')).toEqual({ day: '01', month: 'JAN', year: '2026' });
    expect(stampParts('2026-12-25')).toEqual({ day: '25', month: 'DEC', year: '2026' });
  });

  it('keeps a nonsense month rather than printing the wrong one', () => {
    expect(stampParts('2026-13-01').month).toBe('13');
    expect(stampParts('').day).toBe('');
  });
});

describe('photoLean', () => {
  it('is stable: the same photo leans the same way on every render', () => {
    expect(photoLean('entry-4', 2)).toBe(photoLean('entry-4', 2));
  });

  it('alternates direction so a stack of photos fans out', () => {
    expect(photoLean('e', 0)).toBeLessThan(0);
    expect(photoLean('e', 1)).toBeGreaterThan(0);
    expect(photoLean('e', 2)).toBeLessThan(0);
  });

  it('stays a small tilt — a taped photo, not a windmill', () => {
    for (let i = 0; i < 40; i++) {
      const lean = Math.abs(photoLean(`entry-${i}`, i));
      expect(lean).toBeGreaterThanOrEqual(1.2);
      expect(lean).toBeLessThanOrEqual(3);
    }
  });

  it('gives different photos of one entry different angles', () => {
    const angles = new Set([0, 1, 2, 3].map((i) => photoLean('same-entry', i)));
    expect(angles.size).toBeGreaterThan(1);
  });
});
