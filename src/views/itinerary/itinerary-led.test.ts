import { describe, expect, it } from 'vitest';
import { ledText } from './itinerary-led.ts';

describe('ledText', () => {
  it('draws digits as segments and words as small caps beside them', () => {
    const html = ledText('06 JUL 2026');
    expect(html.match(/<svg/g)).toHaveLength(2);        // "06" and "2026"
    expect(html).toContain('<span class="rb-led-word">JUL</span>');
  });

  it('keeps the plain text for screen readers and escapes it', () => {
    expect(ledText('05 JUL')).toContain('aria-label="05 JUL"');
    expect(ledText('1 <b>', 'x & y')).toContain('aria-label="x &amp; y"');
    expect(ledText('1 <b>')).not.toContain('<b>');
  });

  it('lights more segments for 8 than for 1, and none for an unknown character', () => {
    const lit = (s: string) => (ledText(s).match(/M[\d.]+ [\d.]+L/g) ?? []).length;
    expect(lit('8')).toBe(7);
    expect(lit('1')).toBe(2);
    expect(lit('?')).toBe(0);
  });
});
