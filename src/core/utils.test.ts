import { describe, expect, it } from 'vitest';
import { escHtml } from './utils.ts';

describe('escHtml', () => {
  it('returns an empty string for null/undefined/empty input', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
    expect(escHtml('')).toBe('');
  });

  it('escapes all five HTML-significant characters', () => {
    expect(escHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('neutralizes a script-tag injection attempt', () => {
    const out = escHtml('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('neutralizes an attribute-breakout injection (onerror=)', () => {
    const out = escHtml('"><img src=x onerror=alert(1)>');
    expect(out).not.toContain('"><img');
    expect(out).toBe('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('neutralizes a single-quoted attribute breakout', () => {
    const out = escHtml("' onmouseover='alert(1)");
    expect(out).not.toContain("' onmouseover='");
    expect(out).toBe('&#39; onmouseover=&#39;alert(1)');
  });

  it('leaves plain text with no special characters unchanged', () => {
    expect(escHtml('Paris, France — Day 3')).toBe('Paris, France — Day 3');
  });

  it('escapes & exactly once even when the input already looks encoded (no double-unescape bugs)', () => {
    expect(escHtml('&amp;')).toBe('&amp;amp;');
  });
});
