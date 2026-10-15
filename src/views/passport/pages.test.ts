import { describe, expect, it } from 'vitest';
import { pageHtml, type PageCtx } from './pages.ts';
import { bookPages, stampPages, type BookPage } from './book.ts';
import { passportFor } from '../../data/passport.ts';
import { NO_DOC } from './bio.ts';

const LEGS = [
  { id: 'a', city: 'Copenhagen', country: 'Denmark', dateFrom: '2026-06-25', dateTo: '2026-07-05', tripId: 't1' },
  { id: 'b', city: 'Berlin', country: 'Germany', dateFrom: '2026-07-05', dateTo: '2026-07-09', tripId: 't1' },
];
const data = passportFor(LEGS, '2026-08-01', new Map([['t1', 'Euro <Trip>']]));
const placements = Object.fromEntries(data.stamps.map((s, i) => [s.id, { page: 't1#0', x: 30 + 30 * i, y: 40, rot: 0, pressure: 1, at: 1 }]));
const pages: BookPage[] = bookPages(stampPages(data.stamps, placements), 0);
const ctx: PageCtx = {
  data, nickname: 'Holi<day>', nationality: 'CN', occupation: 'Pil<ot>', signature: 'M0 0L10 10', photoUrl: '', uid: 'u1', issued: '2026-06-25', fresh: new Set(['country:DK:t1']),
  locale: 'en', visas: [], visaNotes: new Map(), schengen: null, pageNo: (p) => pages.indexOf(p) + 1,
  cover: { color: '#34465e', material: 'cloth', foil: 'gold', emblem: 'globe', title: '' }, pressed: 2, doc: NO_DOC,
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

  it('a passport with no stamps shows the blank map and an invitation, not a ring of 0/0', () => {
    const empty = pageHtml({ kind: 'inside' }, { ...ctx, data: { ...data, stamps: [], countries: 0, cities: 0, nights: 0, trips: 0 }, pressed: 0 });
    expect(empty).toContain('pp-record-empty');
    expect(empty).toContain('pp-dotmap');
    expect(empty).not.toContain('pp-ring');
    expect(empty).not.toContain('is-lit"><circle');
    expect(pageHtml({ kind: 'inside' }, ctx)).not.toContain('pp-record-empty');
  });

  it('the data page carries the made-up number and two machine lines', () => {
    const bio = pageHtml({ kind: 'bio' }, ctx);
    expect(bio).toMatch(/N° \d{7}/);
    expect(bio.match(/P&lt;OTR/g)).toHaveLength(1);
  });

  it('the data page shows the traveller\'s occupation and signature, escaped; an unsafe signature is not painted', () => {
    const bio = pageHtml({ kind: 'bio' }, ctx);
    expect(bio).toContain('Pil&lt;ot&gt;');
    expect(bio).toContain('d="M0 0L10 10"');
    expect(pageHtml({ kind: 'bio' }, { ...ctx, signature: 'M0 0"><script>' })).not.toContain('<script>');
  });

  it('visa pages: stickers with a masked number, notes escaped, the Schengen count, and an add button on the last page', () => {
    const v = { id: 'v1', region: 'SCHENGEN', type: 'Tou<rist>', number: 'AB123456', validFrom: '2026-06-01', validTo: '2026-09-30', entries: 'multiple', stayDays: 90, notes: '', photoURL: '', createdAt: 0, updatedAt: 0, schemaVersion: 1 } as const;
    const c2: PageCtx = { ...ctx, visas: [v], visaNotes: new Map([['v1', { uses: 'Used for <Euro>', warns: ['too <long>'] }]]), schengen: { used: 41, remaining: 49, peak: 41, overstayOn: '' } };
    const html = pageHtml({ kind: 'visas', index: 0 }, c2);
    expect(html).toContain('data-pp-visa="v1"');
    expect(html).toContain('Tou&lt;rist&gt;');
    expect(html).toContain('Used for &lt;Euro&gt;');
    expect(html).toContain('too &lt;long&gt;');
    expect(html).not.toContain('AB123456');
    expect(html).toContain('3456');
    expect(html).toContain('data-pp-visa-add');
    const many = Array.from({ length: 3 }, (_, i) => ({ ...v, id: `v${i}` }));
    expect(pageHtml({ kind: 'visas', index: 0 }, { ...c2, visas: many })).not.toContain('data-pp-visa-add');
    expect(pageHtml({ kind: 'visas', index: 1 }, { ...c2, visas: many })).toContain('data-pp-visa-add');
  });

  it('the visa page carries the visas, not a running Schengen count — but a real overstay is still flagged', () => {
    const base: PageCtx = { ...ctx, schengen: { used: 41, remaining: 49, peak: 41, overstayOn: '' } };
    expect(pageHtml({ kind: 'visas', index: 0 }, base)).not.toContain('41');
    expect(pageHtml({ kind: 'visas', index: 0 }, base)).not.toContain('90');
    const over = pageHtml({ kind: 'visas', index: 0 }, { ...base, schengen: { used: 95, remaining: 0, peak: 95, overstayOn: '2026-09-02' } });
    expect(over).toContain('2026-09-02');
    expect(over).toContain('pp-visa-warn');
  });

  it('a stamp page names its page key; a page of deleted-trip stamps says so', () => {
    const stamps = pages.find((p) => p.kind === 'stamps')!;
    expect(pageHtml(stamps, ctx)).toContain('data-page-key="t1#0"');
    const orphan = { ...stamps, items: stamps.kind === 'stamps' ? stamps.items.map((i) => ({ ...i, stamp: { ...i.stamp, orphan: true } })) : [] };
    expect(pageHtml(orphan as BookPage, ctx)).toContain(' · ');
  });

  it('a stamp on the page carries no "first entry" label, even for a country\'s first-ever stamp', () => {
    const stamps = data.stamps.map((x) => ({ ...x, firstEver: true }));
    const html = pageHtml(stampPages(stamps, placements)[0], ctx);
    expect(html).not.toContain('pp-first');
    expect(html).not.toMatch(/first entry/i);
  });

  it('a stamp just pressed is marked to land later; an older one is not', () => {
    const stamps = pages.find((p) => p.kind === 'stamps')!;
    const html = pageHtml(stamps, ctx);
    expect(html).toMatch(/data-stamp="country:DK:t1" data-fresh/);
    expect(html).not.toMatch(/data-stamp="country:DE:t1" data-fresh/);
  });

  it('the cover is just the emblem, title and name — no stamp count, no "tap to open"', () => {
    const cover = pageHtml({ kind: 'cover' }, ctx);
    expect(cover).not.toContain('pp-cover-count');
    expect(cover).not.toContain('pp-cover-hint');
    expect(cover).not.toMatch(/stamps/i);
  });

  it('the first spread opens on the data page, with the record on its right and no "belongs to" line or name on it', () => {
    expect(pages[0].kind).toBe('bio');
    expect(pages[1].kind).toBe('inside');
    const rec = pageHtml({ kind: 'inside' }, ctx);
    expect(rec).not.toContain('pp-inside-title');
    expect(rec).not.toMatch(/belongs/i);
    expect(rec).not.toContain('Holi&lt;day&gt;');
  });

  it('the record page\'s map carries the magnifier hook with the visited countries', () => {
    const rec = pageHtml({ kind: 'inside' }, ctx);
    expect(rec).toMatch(/data-pp-lens="[A-Z ]*DK[A-Z ]*"/);
    expect(rec).toContain('data-no-turn');
    expect(pageHtml({ kind: 'inside' }, { ...ctx, data: { ...data, stamps: [], countries: 0, cities: 0, nights: 0, trips: 0 }, pressed: 0 })).not.toContain('data-pp-lens');
  });

  describe('the data page\'s details', () => {
    const doc = { fullName: 'Holi Day <X>', number: 'E12345678', birthDate: '1992-04-17', gender: 'F' as const, issued: '2026-06-25', expires: '2036-06-24', showNumber: true, showFullName: false, showBirth: false };
    const bio = (d: Partial<typeof doc>) => pageHtml({ kind: 'bio' }, { ...ctx, doc: { ...doc, ...d } });

    it('shows what the traveller chose to show, as dots what they did not, and always sex, issue and expiry', () => {
      const html = bio({});
      expect(html).toContain('N° E12345678');             // number: shown
      expect(html).not.toContain('Holi Day');             // name: hidden
      expect(html).not.toContain('17 APR');               // birth: hidden
      expect(html).toContain('is-hidden');
      expect(html).toContain('•');
      expect(html).toContain('25 JUN 2026');
      expect(html).toContain('24 JUN 2036');
      expect(html).toMatch(/>F</);
    });

    it('shows name and birth date when chosen, escaped', () => {
      const html = bio({ showFullName: true, showBirth: true });
      expect(html).toContain('Holi Day &lt;X&gt;');
      expect(html).toContain('17 APR 1992');
    });

    it('a hidden number never reaches the page or the machine-readable lines', () => {
      const html = bio({ showNumber: false });
      expect(html).not.toContain('E12345678');
      expect(html).not.toContain('5678');
    });

    it('with nothing entered: the made-up number, a dash for the personal items, the booklet\'s own ten years', () => {
      const html = pageHtml({ kind: 'bio' }, ctx);
      expect(html).toMatch(/N° \d{7}/);
      expect(html).toContain('25 JUN 2026');
      expect(html).toContain('24 JUN 2036');
      expect(html).not.toContain('is-hidden');
    });
  });

  it('the signature shares its row with the SIGNATURE label (and the edit button), instead of sitting under it', () => {
    const bio = pageHtml({ kind: 'bio' }, ctx);
    const row = bio.slice(bio.indexOf('class="pp-sign"'), bio.indexOf('class="pp-mrz"'));
    expect(row.indexOf('pp-sign-l')).toBeGreaterThan(-1);
    expect(row.indexOf('pp-sign-l')).toBeLessThan(row.indexOf('pp-sign-line'));
    expect(row.indexOf('pp-sign-line')).toBeLessThan(row.indexOf('data-pp-edit'));
    expect(row).not.toContain('pp-sign-top');
  });
});
