import { describe, it, expect } from 'vitest';
import { fitRuns, wrapRuns, type Measure } from './layout.ts';

/** Every CJK glyph is 10 wide, a Latin letter 5, a space 3; emphasised text is 10% wider. */
const measure: Measure = (text, em) => {
  let w = 0;
  for (const ch of text) w += /[぀-鿿　-〿＀-￯…—]/.test(ch) ? 10 : ch === ' ' ? 3 : 5;
  return em ? w * 1.1 : w;
};
const plain = (text: string) => [{ text, em: false }];
const textOf = (lines: ReturnType<typeof wrapRuns>) => lines.map((l) => l.segments.map((s) => s.text).join(''));

describe('wrapRuns', () => {
  it('breaks CJK text between any two characters', () => {
    const lines = textOf(wrapRuns(plain('一二三四五六七八九十'), measure, 50));
    expect(lines).toEqual(['一二三四五', '六七八九十']);
  });

  it('keeps Latin words whole', () => {
    const lines = textOf(wrapRuns(plain('hello brave world'), measure, 50));
    expect(lines).toEqual(['hello', 'brave', 'world']);
  });

  it('never starts a line with a closing mark; it hangs on the line above instead', () => {
    // 一二三四五 fills 50; the comma would start line two, so it stays on line one.
    const lines = textOf(wrapRuns(plain('一二三四五，六七八九十'), measure, 50));
    expect(lines[0]).toBe('一二三四五，');
    expect(lines[1].startsWith('，')).toBe(false);
  });

  it('never leaves an opening bracket stranded at the end of a line', () => {
    const lines = textOf(wrapRuns(plain('一二三四（五六七八'), measure, 50));
    expect(lines.every((l) => !l.endsWith('（'))).toBe(true);
    expect(lines.join('')).toBe('一二三四（五六七八');
  });

  it('keeps the text intact, losing only the spaces it breaks at', () => {
    const lines = textOf(wrapRuns(plain('one two three four five six'), measure, 60));
    expect(lines.join(' ').replace(/\s+/g, ' ')).toBe('one two three four five six');
  });

  it('measures emphasised runs in their own face and keeps them separate segments', () => {
    const lines = wrapRuns([{ text: '前面', em: false }, { text: '重点', em: true }, { text: '后面', em: false }], measure, 500);
    expect(lines).toHaveLength(1);
    expect(lines[0].segments.map((s) => [s.text, s.em])).toEqual([['前面', false], ['重点', true], ['后面', false]]);
    expect(lines[0].width).toBeCloseTo(20 + 22 + 20, 5);
  });

  it('lets an emphasised sentence run across a line break', () => {
    const lines = wrapRuns([{ text: '一二', em: false }, { text: '三四五六七八', em: true }], measure, 60);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.flatMap((l) => l.segments).filter((s) => s.em).map((s) => s.text).join('')).toBe('三四五六七八');
  });

  it('puts a token wider than a whole line on its own line instead of splitting it', () => {
    const lines = textOf(wrapRuns(plain('a https://example.com/a-very-long-path b'), measure, 40));
    expect(lines.some((l) => l.includes('https://example.com/a-very-long-path'))).toBe(true);
  });

  it('drops leading spaces and never counts trailing ones', () => {
    const [line] = wrapRuns(plain('   hi   '), measure, 100);
    expect(line.segments[0].text).toBe('hi');
    expect(line.width).toBe(10);
  });

  it('does not leave a single CJK glyph alone on the last line', () => {
    // Eleven glyphs in a 5-glyph column would be 5 / 5 / 1; the last line takes one down.
    const lines = textOf(wrapRuns(plain('一二三四五六七八九十甲'), measure, 50));
    expect(lines).toEqual(['一二三四五', '六七八九', '十甲']);
  });

  it('leaves a last line that is already two glyphs or longer alone', () => {
    expect(textOf(wrapRuns(plain('一二三四五六七八九十甲乙'), measure, 50))).toEqual(['一二三四五', '六七八九十', '甲乙']);
  });

  it('does not move a closing mark down to start a line', () => {
    const lines = textOf(wrapRuns(plain('一二三四五六七八九，甲'), measure, 50));
    expect(lines.every((l) => !/^[，。]/.test(l))).toBe(true);
  });

  it('leaves Latin text alone', () => {
    expect(textOf(wrapRuns(plain('hellooooo a'), measure, 50))).toEqual(['hellooooo', 'a']);
  });

  it('returns one empty line for empty text', () => {
    expect(wrapRuns(plain(''), measure, 100)).toEqual([{ segments: [], width: 0 }]);
  });
});

describe('fitRuns', () => {
  const at = (size: number): Measure => (t, em) => measure(t, em) * (size / 10);
  const runs = plain('一二三四五六七八九十一二三四五六七八九十');

  it('picks the largest size that fits the height', () => {
    const fit = fitRuns(runs, at, 100, 1000, [40, 20, 10], 1.5);
    expect(fit.size).toBe(40);
  });

  it('steps down until the text fits', () => {
    // 20 glyphs in a 100-wide column: size 40 → 10 lines (600), size 20 → 4 lines (120),
    // size 10 → 2 lines (30). With 130 to spare the middle size is the largest that fits.
    const fit = fitRuns(runs, at, 100, 130, [40, 20, 10], 1.5);
    expect(fit.size).toBe(20);
    expect(fit.height).toBeLessThanOrEqual(130);
  });

  it('truncates with an ellipsis at the smallest size rather than overflow', () => {
    const fit = fitRuns(plain('字'.repeat(200)), at, 100, 40, [20, 10], 1.5);
    expect(fit.size).toBe(10);
    expect(fit.height).toBeLessThanOrEqual(40);
    const last = fit.lines[fit.lines.length - 1];
    expect(last.segments[last.segments.length - 1].text.endsWith('…')).toBe(true);
    expect(last.width).toBeLessThanOrEqual(100);
  });
});
