import { describe, expect, it } from 'vitest';
import { pickFastener, renderBlock } from './feed.ts';
import type { FeedBlock } from './feed-plan.ts';

const block = (id: string, variant: FeedBlock['variant']): FeedBlock => ({
  entry: { id } as FeedBlock['entry'], kind: 'square', variant, tilt: 0, hasPhoto: true, cols: 3, rows: 3,
});

describe('pickFastener', () => {
  it('is stable for a card', () => {
    expect(pickFastener(block('e1', 'polaroid'), null)).toBe(pickFastener(block('e1', 'polaroid'), null));
  });

  it('never gives a card the same hardware as the card before it', () => {
    const variants: FeedBlock['variant'][] = ['cover', 'polaroid', 'postcard', 'ticket', 'quote'];
    let previous = null as ReturnType<typeof pickFastener> | null;
    for (let i = 0; i < 60; i++) {
      const kind = pickFastener(block(`e${i}`, variants[i % variants.length]), previous);
      expect(kind, `card ${i}`).not.toBe(previous);
      previous = kind;
    }
  });

  it('tapes corners on both sides somewhere in a long feed', () => {
    const kinds = new Set(Array.from({ length: 40 }, (_, i) => pickFastener(block(`p${i}`, 'polaroid'), null)));
    expect(kinds.has('corner')).toBe(true);
    expect(kinds.has('cornerR')).toBe(true);
    expect(kinds.has('safety')).toBe(true);
  });
});

describe('the postcard card', () => {
  const entry = { id: 'e1', title: 'Cabo da Roca', body: 'Wind.', destination: 'Sintra', happenedOn: '2026-07-30', images: ['a.jpg'], favorite: false, tags: [] } as unknown as FeedBlock['entry'];

  it('carries no postmark stamped in its corner', () => {
    const html = renderBlock({ ...block('e1', 'postcard'), entry }, null);
    expect(html).not.toContain('jf-postmark');
    // what it does carry: the photo and the title strip
    expect(html).toContain('jf-photo');
    expect(html).toContain('Cabo da Roca');
  });
});
