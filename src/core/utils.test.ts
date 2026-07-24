import { describe, expect, it } from 'vitest';
import { escHtml, safeUrl } from './utils.ts';

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

describe('safeUrl', () => {
  it('passes through a plain http(s) URL (HTML-escaped)', () => {
    expect(safeUrl('https://images.unsplash.com/photo-123')).toBe('https://images.unsplash.com/photo-123');
    expect(safeUrl('http://example.com/a?b=1&c=2')).toBe('http://example.com/a?b=1&amp;c=2');
  });

  it('blocks javascript: and data: schemes (scheme injection escHtml would let through)', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl("javascript:alert('xss')")).toBe('');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeUrl('vbscript:msgbox(1)')).toBe('');
  });

  it('blocks a CSS url() breakout attempt', () => {
    // Would break out of style="background-image:url('...')" if not blocked.
    expect(safeUrl("');background:url('evil")).toBe('');
  });

  it('returns empty for null/undefined/empty', () => {
    expect(safeUrl(null)).toBe('');
    expect(safeUrl(undefined)).toBe('');
    expect(safeUrl('')).toBe('');
    expect(safeUrl('   ')).toBe('');
  });
});
