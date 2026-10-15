import { describe, expect, it } from 'vitest';
import { drawerHtml } from './stamp-card.ts';
import { countryMemory } from '../../data/country-memory.ts';
import { passportFor } from '../../data/passport.ts';
import type { FootprintLeg } from '../../data/footprint.ts';

const LEGS: FootprintLeg[] = [
  { id: 'a', city: 'Rome', country: 'Italy', dateFrom: '2020-08-08', dateTo: '2020-08-20', tripId: 't1' },
  { id: 'b', city: 'Rome', country: 'Italy', dateFrom: '2026-03-01', dateTo: '2026-03-05', tripId: 't2' },
];
const { stamps } = passportFor(LEGS, '2026-12-01', new Map([['t1', 'Old trip'], ['t2', 'Spring']]));
const data = {
  journal: [{ destination: 'Rome', happenedOn: '2026-03-02', tripId: 't2', images: ['https://x.test/a.jpg', 'https://x.test/b.jpg?alt=media&token=1'] }],
  expenses: [
    { country: 'Italy', baseAmount: 300, baseCurrency: 'CNY', tripId: 't2', category: 'accommodation' },
    { country: 'Italy', baseAmount: 80, baseCurrency: 'CNY', tripId: 't2', category: 'food' },
    { country: 'Italy', baseAmount: 20, baseCurrency: 'CNY', tripId: 't2', category: 'food' },
  ],
  nomad: [], intel: [],
};
const html = (stamp: (typeof stamps)[number]) => drawerHtml(countryMemory(stamp, stamps, LEGS, data), 'en', { i: 0, n: 2 });
const first = stamps.find((s) => s.tripId === 't1')!;
const second = stamps.find((s) => s.tripId === 't2')!;

describe('the memory card', () => {
  it('has the country and its dates in the head — no "Country memory" line, no step buttons, no trip name, no Photos label', () => {
    const h = html(second);
    expect(h).toContain('pp-drawer-title');
    expect(h).toContain('Italy');
    expect(h).not.toMatch(/Country memory/i);
    expect(h).not.toContain('data-pp-card-step');
    expect(h).not.toContain('Spring');
    expect(h).not.toMatch(/>\s*Photos\s*</);
    expect(h).toContain('data-pp-card-close');
  });

  it('says "first time" only on a country\'s first stamp over the whole journey, and never names a year', () => {
    expect(first.firstEver).toBe(true);
    expect(second.firstEver).toBe(false);
    const a = html(first);
    expect(a).toContain('Your first time in Italy');
    const chip = a.slice(a.indexOf('pp-drawer-first'), a.indexOf('pp-drawer-first') + 120);
    expect(chip).not.toMatch(/\d{4}/);
    expect(html(second)).not.toContain('Your first time');
  });

  it('the spend is the Expenses page\'s own till slip: numbered lines per category, biggest first, then the total', () => {
    const h = html(second);
    expect(h).toContain('class="rc rc--zoom');
    expect(h).toContain('ON THE ROAD MART');
    expect(h.indexOf('STAY')).toBeLessThan(h.indexOf('FOOD'));
    expect(h).toContain('¥300');
    expect(h).toContain('¥100');                 // food: 80 + 20
    expect(h).toContain('¥400');                 // the total
  });

  it('the slip has no store, cities, nights or subtotal rows — only the date (and the all-trips line for a repeat country)', () => {
    const h = html(second);
    for (const gone of ['STORE', 'CITIES', 'NIGHTS', 'SUBTOTAL', 'CASHIER', '#0429</span>']) expect(h).not.toContain(gone);
    expect(h).toContain('DATE');
    expect(h).toContain('ALL TRIPS');            // Italy has two trips here
    expect(html(first)).toContain('ALL TRIPS');
  });

  it('a stay that is over is stamped PAID', () => {
    expect(html(second)).toContain('rc-stamp');
  });

  it('the stamp stands to the left of the slip, in the card\'s body — not in the picture', () => {
    const h = html(second);
    const head = h.slice(0, h.indexOf('</header>'));
    expect(head).not.toContain('pp-card-stamp');
    const body = h.slice(h.indexOf('pp-drawer-top'));
    expect(body.indexOf('pp-card-stamp')).toBeGreaterThan(-1);
    expect(body.indexOf('pp-card-stamp')).toBeLessThan(body.indexOf('rc rc--zoom'));
  });

  it('photos are taped in without a heading, and their addresses are not double-escaped', () => {
    const h = html(second);
    expect(h).toContain('pp-polaroid');
    expect(h).toContain('alt=media&amp;token=1');
    expect(h).not.toContain('&amp;amp;');
  });
});
