import { describe, it, expect } from 'vitest';
import { normalizeEmphasis, stripEmphasis } from './emphasis';

describe('stripEmphasis', () => {
  it('removes every marker', () => {
    expect(stripEmphasis('a **b** c **d**')).toBe('a b c d');
  });
});

describe('normalizeEmphasis', () => {
  it('keeps a single well-formed pair untouched', () => {
    expect(normalizeEmphasis('前面。**关键的一句。**后面。')).toBe('前面。**关键的一句。**后面。');
  });

  it('keeps only the first pair when there are several', () => {
    expect(normalizeEmphasis('**一**，**二**，**三**')).toBe('**一**，二，三');
  });

  it('drops an unbalanced marker rather than leave a stray asterisk', () => {
    expect(normalizeEmphasis('前面 **没有收尾')).toBe('前面 没有收尾');
    expect(normalizeEmphasis('没有开头** 后面')).toBe('没有开头 后面');
  });

  it('never leaves more than one closed pair, whatever the input', () => {
    for (const input of ['**一 **二** 三**', '****', '** **', 'a ** b ** c ** d', '***x***']) {
      const out = normalizeEmphasis(input);
      const markers = (out.match(/\*\*/g) ?? []).length;
      expect([0, 2]).toContain(markers);
      expect(out.replace(/\*\*/g, '')).not.toContain('*');
    }
  });

  it('returns marker-free text unchanged', () => {
    expect(normalizeEmphasis('没有任何标记。')).toBe('没有任何标记。');
  });

  it('is idempotent', () => {
    const once = normalizeEmphasis('a **b** c **d**');
    expect(normalizeEmphasis(once)).toBe(once);
  });
});
