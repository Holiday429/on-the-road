import { describe, expect, it } from 'vitest';
import { convertedHint, renderTape, tapeRows, TAPE_MAX, type TapeEntry } from './checkout.ts';

const entry = (i: number, base = 10): TapeEntry => ({ id: `e${i}`, icon: '🍜', name: `Item ${i}`, baseAmount: base });
const fmt = (n: number) => `¥${n}`;

describe('tapeRows', () => {
  it('shows the newest lines last and folds the older ones into a count', () => {
    const entries = Array.from({ length: TAPE_MAX + 3 }, (_, i) => entry(i + 1));
    const { rows, extra } = tapeRows({ entries, dateLabel: 'x', fmt });
    expect(rows).toHaveLength(TAPE_MAX);
    expect(extra).toBe(3);
    expect(rows[rows.length - 1].label).toBe(`Item ${TAPE_MAX + 3}`);
  });

  it('the subtotal counts every entry, including folded ones', () => {
    const entries = Array.from({ length: 8 }, (_, i) => entry(i, 5));
    expect(tapeRows({ entries, dateLabel: 'x', fmt }).subtotal).toBe(40);
  });

  it('only fresh ids print in', () => {
    const { rows } = tapeRows({ entries: [entry(1), entry(2)], dateLabel: 'x', fmt, fresh: new Set(['e2']) });
    expect(rows.map((r) => r.className)).toEqual([undefined, 'paper-printing']);
  });

  it('shows the original amount when it was paid in another currency', () => {
    const { rows } = tapeRows({ entries: [{ ...entry(1), original: '€12.00' }], dateLabel: 'x', fmt });
    expect(rows[0].sub).toBe('€12.00');
  });
});

describe('renderTape', () => {
  it('empty day: the date and a quiet line, no subtotal', () => {
    const html = renderTape({ entries: [], dateLabel: 'Mon 12 Oct', fmt });
    expect(html).toContain('Mon 12 Oct');
    expect(html).toContain('ck-tape-empty');
    expect(html).not.toContain('is-total');
  });

  it('a day with entries ends in a subtotal row', () => {
    const html = renderTape({ entries: [entry(1, 20), entry(2, 30)], dateLabel: 'x', fmt });
    expect(html).toContain('paper-row is-strong is-total');
    expect(html).toContain('¥50');
  });

  it('escapes names', () => {
    const html = renderTape({ entries: [{ ...entry(1), name: '<img onerror=x>' }], dateLabel: 'x', fmt });
    expect(html).not.toContain('<img');
  });
});

describe('convertedHint', () => {
  const toBase = (a: number, c: string) => (c === 'EUR' ? a * 8 : a);
  it('only appears for a foreign amount', () => {
    expect(convertedHint(10, 'EUR', 'CNY', toBase, fmt)).toBe('≈ ¥80');
    expect(convertedHint(10, 'CNY', 'CNY', toBase, fmt)).toBe('');
    expect(convertedHint(0, 'EUR', 'CNY', toBase, fmt)).toBe('');
    expect(convertedHint(NaN, 'EUR', 'CNY', toBase, fmt)).toBe('');
  });
});
