import { describe, expect, it } from 'vitest';
import { pageHtml, type PageCtx } from './pages.ts';
import { bookPages, stampPages, type BookPage } from './book.ts';
import { passportFor } from '../../data/passport.ts';

const LEGS = [
  { id: 'a', city: 'Copenhagen', country: 'Denmark', dateFrom: '2026-06-25', dateTo: '2026-07-05', tripId: 't1' },
  { id: 'b', city: 'Berlin', country: 'Germany', dateFrom: '2026-07-05', dateTo: '2026-07-09', tripId: 't1' },
];
const data = passportFor(LEGS, '2026-08-01', new Map([['t1', 'Euro <Trip>']]));
const pages: BookPage[] = bookPages(stampPages(data.stamps));
const ctx: PageCtx = {
  data, nickname: 'Holi<day>', nationality: 'CN', photoUrl: '', uid: 'u1', issued: '2026-06-25', fresh: new Set(['country:DK:t1']),
  locale: 'en', pageNo: (p) => pages.indexOf(p) + 1,
};

describe('pageHtml', () => {
  it('draws every kind of page, and a missing back as blank paper', () => {
    for (const p of [{ kind: 'cover' } as BookPage, ...pages]) expect(pageHtml(p, ctx)).toContain('class="pp-');
    expect(pageHtml(null, ctx)).toContain('pp-blank');
  });

  it('escapes the traveller\'s words everywhere', () => {
    const all = [{ kind: 'cover' } as BookPage, ...pages].map((p) => pageHtml(p, ctx)).join('');
    expect(all).not.toContain('Holi<day>');
    expect(all).not.toContain('Euro <Trip>');
    expect(all).toContain('Holi&lt;day&gt;');
  });

  it('the data page carries the made-up number and two machine lines', () => {
    const bio = pageHtml({ kind: 'bio' }, ctx);
    expect(bio).toMatch(/N° \d{7}/);
    expect(bio.match(/P&lt;OTR/g)).toHaveLength(1);
  });

  it('a stamp not seen yet is marked to land later; a seen one is not', () => {
    const stamps = pages.find((p) => p.kind === 'stamps')!;
    const html = pageHtml(stamps, ctx);
    expect(html).toMatch(/data-stamp="country:DK:t1" data-fresh/);
    expect(html).not.toMatch(/data-stamp="country:DE:t1" data-fresh/);
  });
});
