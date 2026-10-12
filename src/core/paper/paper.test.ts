import { describe, expect, it } from 'vitest';
import { paperReceipt, paperRow, paperRows, paperStamp, paperTag } from './paper.ts';

describe('paper kit markup', () => {
  it('a row has label, leader and value; HTML in the text is escaped', () => {
    const html = paperRow({ label: '<b>Lunch</b>', value: '¥45', icon: '🍜' });
    expect(html).toContain('class="paper-row"');
    expect(html).toContain('&lt;b&gt;Lunch&lt;/b&gt;');
    expect(html).toContain('paper-row-lead');
    expect(html).not.toContain('<b>');
  });

  it('tone / strong / total become modifier classes', () => {
    const html = paperRow({ label: 'Over', value: '¥1', tone: 'bad', strong: true, total: true });
    expect(html).toMatch(/class="paper-row is-bad is-strong is-total"/);
  });

  it('a clickable row renders as a button carrying its action', () => {
    const html = paperRow({ label: 'Total', value: '¥9', act: 'open-records' });
    expect(html.startsWith('<button type="button"')).toBe(true);
    expect(html).toContain('data-act="open-records"');
  });

  it('a sub line is optional', () => {
    expect(paperRow({ label: 'a', value: 'b' })).not.toContain('paper-row-sub');
    expect(paperRow({ label: 'a', value: 'b', sub: '¥1 / ¥2' })).toContain('paper-row-sub');
  });

  it('stamp: red by default, other tones as modifiers', () => {
    expect(paperStamp({ text: 'Over' })).toBe('<span class="paper-stamp">Over</span>');
    expect(paperStamp({ text: 'Paid', tone: 'good', corner: true })).toContain('paper-stamp--good paper-stamp--corner');
  });

  it('tag carries tone and hides on request', () => {
    expect(paperTag({ verdict: 'PASS', tone: 'good', hidden: true })).toMatch(/paper-tag paper-tag--good" hidden/);
  });

  it('receipt: head, rows, total under a rule, optional stamp and barcode', () => {
    const html = paperReceipt({
      title: 'Europe 2026', meta: '25 JUN', rows: [{ label: 'Stay', value: '¥1' }],
      total: { label: 'TOTAL', value: '¥1' }, stamp: { text: 'Over', tone: 'bad' }, barcode: true, zigzag: true,
    });
    expect(html).toContain('paper--zigzag');
    expect(html).toContain('paper-row is-strong is-total');
    expect(html).toContain('paper-receipt-stamp');
    expect(html).toContain('<span class="paper-stamp">Over</span>');
    expect(html).toContain('paper-barcode');
    expect(paperRows([{ label: 'a', value: 'b' }])).toContain('paper-rows');
  });
});
