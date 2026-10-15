import { describe, expect, it } from 'vitest';
import {
  altLine, barcodeBars, convertedHint, dayFigures, odoMarkup, renderReceipt, renderScreenTop,
  type MartLine,
} from './checkout.ts';

const line = (i: number, base = 10, over: Partial<MartLine> = {}): MartLine => ({
  id: `e${i}`, icon: '🍜', name: `Item ${i}`, category: 'food', baseAmount: base, amount: base, currency: 'CNY', ...over,
});
const fmt = (n: number) => `¥${n}`;
const receipt = (lines: MartLine[], extra: Partial<Parameters<typeof renderReceipt>[0]> = {}) =>
  renderReceipt({ lines, store: 'LISBON · PORTUGAL', stamp: '2026-10-12  18:42', fmt, paid: false, seed: '20261012050429', ...extra });

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

describe('renderReceipt', () => {
  it('prints the store, every line numbered, and the total', () => {
    const html = receipt(Array.from({ length: 8 }, (_, i) => line(i, 5)));
    expect(html).toContain('LISBON · PORTUGAL');
    expect(html).toContain('ON THE ROAD MART');
    expect(html).toContain('¥40');
    expect(html.match(/class="rc-line[ "]/g)).toHaveLength(8);
    expect(html).toContain('>08<');
  });
  it('keeps the lines in a scrolling middle and the total in the foot', () => {
    const html = receipt([line(1)]);
    expect(html.indexOf('rc-scroll')).toBeLessThan(html.indexOf('rc-foot'));
    expect(html.indexOf('rc-line')).toBeLessThan(html.indexOf('rc-foot'));
    expect(html.indexOf('rc-total')).toBeGreaterThan(html.indexOf('rc-foot'));
  });
  it('lists what was bought once — no second per-category block with bars', () => {
    const html = receipt([line(1), line(2, 5, { category: 'stay' })]);
    expect(html).not.toContain('rc-bk');
    expect(html).not.toContain('rc-break');
  });
  it('the receipt book adds a trip-so-far line and prints every line in with a stagger', () => {
    const html = receipt([line(1), line(2)], { running: 'TRIP SO FAR ¥99', stagger: true });
    expect(html).toContain('TRIP SO FAR ¥99');
    expect(html.match(/rc-line--print/g)).toHaveLength(2);
    expect(html).toContain('animation-delay');
    expect(html).toContain('data-total="20"');
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

describe('odoMarkup / renderScreenTop', () => {
  it('draws one strip per digit and keeps separators as text', () => {
    const html = odoMarkup(1284);
    expect(html.match(/odo-digit/g)).toHaveLength(4);
    expect(html).toContain('odo-sep');
    expect(html).toContain('translateY(-1em)');
  });
  it('the screen top carries the line, the day and the count', () => {
    const html = renderScreenTop({ line1: '☕ COFFEE', dayLabel: 'TODAY · 12 OCT', count: 5, total: 1284, baseSymbol: '¥', alt: '' });
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

describe('renderReceipt meta rows', () => {
  it('a caller can replace the store / cashier / date rows with its own, escaped', () => {
    const html = receipt([], { meta: [['CITIES', 'Rome · <Florence>'], ['NIGHTS', '12']] });
    expect(html).toContain('CITIES');
    expect(html).toContain('Rome · &lt;Florence&gt;');
    expect(html).toContain('NIGHTS');
    expect(html).not.toContain('#0429</span>');
  });

  it('the subtotal line can be left out; by default the till keeps it', () => {
    const lines = [{ id: 'a', icon: '🍜', name: 'Ramen', category: 'food', baseAmount: 45, amount: 45, currency: 'CNY' }];
    expect(receipt(lines)).toContain('rc-row--sub');
    expect(receipt(lines, { subtotal: false })).not.toContain('rc-row--sub');
    expect(receipt(lines, { subtotal: false })).toContain('rc-total');
  });

  it('without meta it keeps the till\'s own three rows', () => {
    const html = receipt([]);
    expect(html).toContain('LISBON · PORTUGAL');
    expect(html).toContain('#0429');
    expect(html).toContain('2026-10-12  18:42');
  });
});
