import { describe, expect, it } from 'vitest';
import { candidatesFor, isPictureLed, planLayouts } from './album-layout.ts';
import type { Leaf } from './album-pages.ts';

const leaf = (photos: number, chars: number, over: Partial<Leaf> = {}): Leaf => ({
  layout: 'feature',
  photos: Array.from({ length: photos }, (_, i) => `p${i}.jpg`),
  text: 'x'.repeat(chars),
  continues: false,
  continued: false,
  slots: 4,
  ...over,
});

describe('candidatesFor', () => {
  it('gives a page with no pictures the reading column, and nothing else', () => {
    expect(candidatesFor(leaf(0, 600), false)).toEqual(['column']);
  });

  it('runs a lone picture large when there is little to read, and insets it when there is a lot', () => {
    expect(candidatesFor(leaf(1, 50), false)[0]).toBe('plate');
    expect(candidatesFor(leaf(1, 900), false)[0]).toBe('inset');
  });

  it('offers the full-bleed opener only on an opening page', () => {
    expect(candidatesFor(leaf(1, 50), true)).toContain('openerL');
    expect(candidatesFor(leaf(1, 50), false)).not.toContain('openerL');
  });

  it('spreads several pictures into a mosaic', () => {
    expect(candidatesFor(leaf(4, 100), false)[0]).toBe('mosaic');
  });
});

describe('planLayouts', () => {
  const pages = Array.from({ length: 12 }, (_, i) => leaf(i % 4, 120 + i * 40));

  it('never repeats a layout on the page straight after it', () => {
    const plan = planLayouts(pages, 'album-1').filter(Boolean);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i], `page ${i} repeats ${plan[i - 1]}`).not.toBe(plan[i - 1]);
    }
  });

  it('alternates picture-led and text-led pages where the content allows', () => {
    // Pages that could go either way: one picture and enough text for both.
    const mixed = Array.from({ length: 8 }, () => leaf(1, 300));
    const plan = planLayouts(mixed, 'album-2').filter(Boolean) as string[];
    let switches = 0;
    for (let i = 1; i < plan.length; i++) {
      if (isPictureLed(plan[i] as never) !== isPictureLed(plan[i - 1] as never)) switches++;
    }
    expect(switches).toBeGreaterThan(plan.length / 2);
  });

  it('leaves the title page and blank sides alone', () => {
    const plan = planLayouts([leaf(0, 0, { layout: 'title' }), null, leaf(2, 100)], 'a');
    expect(plan[0]).toBeNull();
    expect(plan[1]).toBeNull();
    expect(plan[2]).not.toBeNull();
  });

  it('is stable: an album is laid out the same way every time it is opened', () => {
    expect(planLayouts(pages, 'album-1')).toEqual(planLayouts(pages, 'album-1'));
  });

  it('varies between albums wherever the page has a real choice to make', () => {
    // Four pictures and plenty of text: every candidate is available, so the
    // album id is free to pick a different starting point. (Where a page has
    // only one or two candidates the adjacency rules settle it, and both albums
    // land on the same layout — that is the rules working, not a bug.)
    const roomy = Array.from({ length: 10 }, () => leaf(4, 400));
    const a = planLayouts(roomy, 'album-1');
    const b = planLayouts(roomy, 'album-9');
    expect(a).not.toEqual(b);
  });

  it('still lays out pages that have only one possible arrangement', () => {
    const textOnly = Array.from({ length: 4 }, () => leaf(0, 500));
    expect(planLayouts(textOnly, 'a')).toEqual(['column', 'column', 'column', 'column']);
  });
});
