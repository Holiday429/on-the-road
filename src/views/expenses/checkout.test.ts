import { describe, expect, it } from 'vitest';
import {
  FOLD_AT, altLine, barcodeBars, breakdownRows, convertedHint, dayFigures, odoMarkup, receiptLines, renderReceipt, renderVfd,
  type MartLine,
} from './checkout.ts';

const line = (i: number, base = 10, over: Partial<MartLine> = {}): MartLine => ({
  id: `e${i}`, icon: '🍜', name: `Item ${i}`, category: 'food', baseAmount: base, amount: base, currency: 'CNY', ...over,
});
const fmt = (n: number) => `¥${n}`;
const receipt = (lines: MartLine[], extra: Partial<Parameters<typeof renderReceipt>[0]> = {}) =>
  renderReceipt({ lines, expanded: false, store: 'LISBON · PORTUGAL', stamp: '2026-10-12  18:42', fmt, breakdown: [], paid: false, seed: '20261012050429', ...extra });

describe('dayFigures', () => {
  it('totals the base amounts and counts the lines', () => {
    const f = dayFigures([line(1, 10), line(2, 25)], 'CNY');
    expect(f).toMatchObject({ count: 2, total: 35, foreign: [] });
  });

  it('sums spend per foreign currency in that currency, ignoring the base', () => {
    const f = dayFigures([
      line(1, 100, { currency: 'EUR', amount: 12 }), line(2, 50, { currency: 'EUR', amount: 6 }),
      line(3, 60, { currency: 'JPY', amount: 1200 }), line(4, 7),
    ], 'CNY');
    expect(f.foreign).toEqual([{ currency: 'EUR', amount: 18 }, { currency: 'JPY', amount: 1200 }]);
  });
});

describe('altLine', () => {
  it('is empty when everything was paid in the base currency', () => {
    expect(altLine([], (a, c) => `${c}${a}`)).toBe('');
  });
  it('joins the foreign amounts', () => {
    expect(altLine([{ currency: 'EUR', amount: 18 }, { currency: 'JPY', amount: 1200 }], (a, c) => `${c}${a}`)).toBe('≈ EUR18  ·  JPY1200');
  });
});

describe('breakdownRows', () => {
  const meta = (id: string) => (id === 'food' ? { icon: '🍜', label: 'Food', color: 'red' } : id === 'stay' ? { icon: '🏨', label: 'Stay', color: 'blue' } : undefined);
  it('groups by category, biggest first, with a share of the day', () => {
    const rows = breakdownRows([line(1, 30), line(2, 10), line(3, 60, { category: 'stay' })], meta);
    expect(rows.map((r) => [r.label, r.amount, r.share])).toEqual([['Stay', 60, 60], ['Food', 40, 40]]);
  });
  it('an unknown category falls back to a generic row', () => {
    expect(breakdownRows([line(1, 5, { category: '' })], meta)[0].icon).toBe('🗂️');
  });
});

describe('receiptLines', () => {
  const many = Array.from({ length: FOLD_AT + 3 }, (_, i) => line(i + 1));
  it('folds the earlier lines, keeping the newest and their original numbers', () => {
    const { shown, hidden } = receiptLines(many, false);
    expect(hidden).toBe(3);
    expect(shown).toHaveLength(FOLD_AT);
    expect(shown[0].no).toBe(4);
    expect(shown[shown.length - 1].line.id).toBe(`e${FOLD_AT + 3}`);
  });
  it('shows everything when expanded or short', () => {
    expect(receiptLines(many, true).shown).toHaveLength(many.length);
    expect(receiptLines(many.slice(0, 3), false).hidden).toBe(0);
  });
});

describe('renderReceipt', () => {
  it('prints the store, the lines and a total that counts folded lines too', () => {
    const html = receipt(Array.from({ length: 8 }, (_, i) => line(i, 5)));
    expect(html).toContain('LISBON · PORTUGAL');
    expect(html).toContain('ON THE ROAD MART');
    expect(html).toContain('¥40');
    expect(html).toContain('data-act="fold"');
  });
  it('an empty day: a quiet line, no stamp', () => {
    const html = receipt([], { paid: true });
    expect(html).toContain('rc-empty');
    expect(html).not.toContain('rc-stamp');
  });
  it('a past day with spend is stamped PAID', () => {
    expect(receipt([line(1)], { paid: true })).toContain('rc-stamp');
    expect(receipt([line(1)], { paid: false })).not.toContain('rc-stamp');
  });
  it('only fresh lines print in', () => {
    const html = receipt([line(1), line(2)], { fresh: new Set(['e2']) });
    expect(html.match(/rc-line--print/g)).toHaveLength(1);
  });
  it('shows the original amount for foreign lines, and escapes names', () => {
    const html = receipt([line(1, 10, { original: '€12.00 @ 7.820', name: '<b>x</b>' })]);
    expect(html).toContain('€12.00 @ 7.820');
    expect(html).not.toContain('<b>x</b>');
  });
  it('readonly (full-receipt modal) drops void and zoom controls', () => {
    const html = receipt([line(1)], { readonly: true });
    expect(html).not.toContain('data-void');
    expect(html).not.toContain('data-act="zoom"');
  });
});

describe('barcodeBars', () => {
  it('is deterministic per seed and varies between seeds', () => {
    expect(barcodeBars('a')).toEqual(barcodeBars('a'));
    expect(barcodeBars('a')).not.toEqual(barcodeBars('b'));
  });
});

describe('odoMarkup / renderVfd', () => {
  it('draws one strip per digit and keeps separators as text', () => {
    const html = odoMarkup(1284);
    expect(html.match(/odo-digit/g)).toHaveLength(4);
    expect(html).toContain('odo-sep');
    expect(html).toContain('translateY(-1em)');
  });
  it('the display carries the line, the day and the count', () => {
    const html = renderVfd({ line1: '☕ COFFEE', dayLabel: 'TODAY · 12 OCT', count: 5, total: 1284, baseSymbol: '¥', alt: '' });
    expect(html).toContain('☕ COFFEE');
    expect(html).toContain('TODAY · 12 OCT');
    expect(html).toContain('>05<');
  });
});

describe('convertedHint', () => {
  const toBase = (a: number) => a * 8;
  it('is empty for the base currency or no amount', () => {
    expect(convertedHint(10, 'CNY', 'CNY', toBase, fmt)).toBe('');
    expect(convertedHint(0, 'EUR', 'CNY', toBase, fmt)).toBe('');
  });
  it('shows the home-currency value otherwise', () => {
    expect(convertedHint(10, 'EUR', 'CNY', toBase, fmt)).toBe('≈ ¥80');
  });
});
