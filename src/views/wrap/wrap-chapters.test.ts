// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { tripWrap, type WrapInput } from '../../data/trip-wrap.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import type { PackList } from '../../data/schema.ts';
import { coverChapter, endChapter, journalChapter, packChapter, passportChapter, presentChapters, routeChapter, spendChapter, staysChapter, wrapChapters, type WrapCtx } from './wrap-chapters.ts';

const leg = (id: string, city: string, country: string, from: string, to: string, extra: Record<string, unknown> = {}) =>
  ({ id, city, country, flag: '🏳️', dateFrom: from, dateTo: to, order: 0, ...extra }) as unknown as StoredLeg;
const LEGS = [
  leg('a', 'Copenhagen', 'Denmark', '2026-06-25', '2026-07-05', { lat: 55.7, lng: 12.6, arrivalTransport: { type: 'flight', from: 'Harbin', to: 'Copenhagen' }, accommodations: [{ name: 'Home', platform: 'Friend' }] }),
  leg('b', 'Berlin <i>', 'Germany', '2026-07-05', '2026-07-09', { lat: 52.5, lng: 13.4, arrivalTransport: { type: 'train', from: 'Copenhagen', to: 'Berlin' } }),
];
const PACK = { name: 'x', containers: [{ id: 'c', label: 'Bag', kind: 'backpack', limitG: 0, selfWeightG: 1000 }],
  items: [{ id: '1', name: 'Jacket', qty: 1, unitWeightG: 800, acquiredLegId: null, droppedLegId: null }, { id: '2', name: 'Mug', qty: 1, unitWeightG: 300, acquiredLegId: 'b', droppedLegId: null }] } as unknown as PackList;

function ctx(over: Partial<WrapInput> = {}, c: Partial<WrapCtx> = {}): WrapCtx {
  const m = tripWrap({
    trip: { name: 'Europe <2026>', startDate: '2026-06-25', endDate: '2026-07-09', totalBudget: 1000 },
    legs: LEGS, expenses: [{ date: '2026-06-26', category: 'food', country: 'Denmark' }, { date: '2026-07-06', category: 'mystery', country: 'Germany' }, { date: '2026-07-07', category: '', country: 'Germany' }],
    toBase: () => 100, pack: PACK, journal: [], portraitMin: 8, coordOf: () => null, today: '2026-07-20', ...over,
  });
  return {
    m, locale: 'en-US', ongoing: false,
    money: (n) => `¥${Math.round(n)}`, weight: (g) => `${g}g`, km: (n) => String(Math.round(n)),
    cat: (id) => ({ label: id === 'food' ? 'Food' : id, icon: id === 'food' ? '🍜' : '🗂️' }), ...c,
  };
}

describe('chapters', () => {
  it('cover shows the trip name escaped, the stamp count and no "ongoing" note once over', () => {
    const html = coverChapter(ctx());
    expect(html).toContain('Europe &lt;2026&gt;');
    expect(html).not.toContain('<2026>');
    expect(html).toContain('4 stamps');
    expect(html).not.toContain('wrap-note');
    expect(coverChapter(ctx({}, { ongoing: true }))).toContain('wrap-note');
  });

  it('route: stops, a replay button, and no map when fewer than two stops can be placed', () => {
    const html = routeChapter(ctx());
    expect(html).toContain('data-wrap-replay');
    expect(html).toContain('<svg');
    expect(html).toContain('Berlin &lt;i&gt;');
    const lone = routeChapter(ctx({ legs: [LEGS[0]] }));
    expect(lone).not.toContain('<svg');
    expect(lone).toContain('wrap-note');
  });

  it('passport: every earned stamp, and a button to the book', () => {
    const html = passportChapter(ctx());
    expect((html.match(/class="wrap-stamp"/g) ?? []).length).toBe(4);
    expect(html).toContain('data-wrap-passport');
    expect(passportChapter(ctx({ legs: [] }))).not.toContain('data-wrap-passport');
  });

  it('stays: a bar per city, the longest flagged', () => {
    const html = staysChapter(ctx());
    expect((html.match(/<li class="wrap-bar/g) ?? []).length).toBe(2);
    expect(html).toContain('is-top');
    expect(html).toContain('Longest stay: Copenhagen · 10 nights');
  });

  it('spend: a receipt with a total, an under-budget stamp, unknown categories kept, unsorted labelled', () => {
    const html = spendChapter(ctx());
    expect(html).toContain('¥300');
    expect(html).toContain('UNDER BUDGET');
    expect(html).toContain('mystery');
    expect(html).toContain('Unsorted');
    expect(spendChapter(ctx({ trip: { name: 'x', startDate: '2026-06-25', endDate: '2026-07-09', totalBudget: 200 } }))).toContain('OVER BUDGET');
    expect(spendChapter(ctx({ expenses: [] }))).toContain('No expenses');
  });

  it('pack: departure vs return on LED glass, what was picked up; skipped without a list', () => {
    const html = packChapter(ctx())!;
    expect(html).toContain('paper-led');
    expect(html).toContain('1800g');   // left home: jacket 800 + empty bag 1000
    expect(html).toContain('2100g');   // back: + the mug picked up in Berlin
    expect(html).toContain('300g heavier');
    expect(html).toContain('Mug');
    expect(packChapter(ctx({ pack: null }))).toBeNull();
  });

  it('journal: Portrait is disabled with a reason until there are enough entries', () => {
    const few = journalChapter(ctx({ journal: [{ id: '1', happenedOn: '2026-06-26', destination: 'Copenhagen', favorite: false, images: ['https://x.test/a.jpg'] }] }));
    expect(few).toMatch(/data-wrap-journal="recap" disabled/);
    expect(few).toContain('wrap-portrait-why');
    expect(few).toContain('https://x.test/a.jpg');
    const many = Array.from({ length: 8 }, (_, i) => ({ id: String(i), happenedOn: '2026-06-26', destination: 'Copenhagen', favorite: false, images: [] as string[] }));
    expect(journalChapter(ctx({ journal: many }))).not.toMatch(/data-wrap-journal="recap" disabled/);
    expect(journalChapter(ctx())).toContain('No journal entries');
  });

  it('journal photo URLs cannot smuggle script', () => {
    const html = journalChapter(ctx({ journal: [{ id: '1', happenedOn: '2026-06-26', destination: '', favorite: false, images: ['javascript:alert(1)'] }] }));
    expect(html).not.toContain('javascript:');
  });

  it('end: a closing line and the way home', () => {
    const html = endChapter(ctx());
    expect(html).toContain('15 days, 2 countries');
    expect(html).toContain('data-wrap-home');
  });

  it('the page is eight chapters, seven without a pack list', () => {
    expect(wrapChapters(ctx()).length).toBe(8);
    expect(wrapChapters(ctx({ pack: null })).length).toBe(7);
    expect(presentChapters(ctx({ pack: null }))).not.toContain('pack');
  });
});
