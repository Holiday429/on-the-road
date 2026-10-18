/**
 * @vitest-environment jsdom
 *
 * The reader's structure: what is on the paper, what is not, and which of the
 * four cases (letter + postcards, letter only, postcards only, long letter)
 * produces which scene.
 */
import { describe, expect, it } from 'vitest';
import { renderReadLetter, renderWriteLetter, type ReadLetterOpts, type WriteLetterOpts } from './letter.ts';

const entry = (over: Record<string, unknown> = {}): any => ({
  id: 'e1', tripId: null, title: 'Canal bikes', body: 'Rented a bike.', template: 'moment',
  destination: 'Amsterdam', tags: ['food'], mood: 'calm', happenedOn: '2026-07-10',
  favorite: false, visibility: 'private', slug: '', images: ['a.jpg', 'b.jpg'], createdAt: 1, updatedAt: 1, ...over,
});

const opts = (e: any, over: Partial<ReadLetterOpts> = {}): ReadLetterOpts => ({
  entry: e, albums: [], prevId: 'p', nextId: null, dir: '', ratios: e.images.map(() => 1.5),
  iso: 'NL', country: 'Netherlands', locale: 'en', author: 'Mei', focus: null, ...over,
});

const dom = (o: ReadLetterOpts) => {
  const host = document.createElement('div');
  // eslint-disable-next-line no-restricted-syntax -- audited: fixture markup under test
  host.innerHTML = renderReadLetter(o);
  return host;
};

describe('renderReadLetter', () => {
  it('a letter with photos: paper, a pile of postcards, one card per photo', () => {
    const d = dom(opts(entry()));
    expect(d.querySelector('.ltr-paper')).toBeTruthy();
    expect(d.querySelector('.ltr-cards')?.getAttribute('data-layout')).toBe('stack');
    expect(d.querySelectorAll('[data-postcard]')).toHaveLength(2);
    expect(d.querySelector('.ltr-scene')?.classList.contains('has-cards')).toBe(true);
  });

  it('only a letter: no postcards, nothing reserved for them', () => {
    const d = dom(opts(entry({ images: [] })));
    expect(d.querySelector('.ltr-paper')).toBeTruthy();
    expect(d.querySelector('.ltr-cards')).toBeNull();
    expect(d.querySelector('.ltr-scene')?.classList.contains('has-cards')).toBe(false);
  });

  it('only photos: no paper, the postcards lie loose under a bigger envelope', () => {
    const d = dom(opts(entry({ title: '', body: '' })));
    expect(d.querySelector('.ltr-paper')).toBeNull();
    expect(d.querySelector('.ltr-cards')?.getAttribute('data-layout')).toBe('loose');
    expect(d.querySelector('.ltr-env.is-big')).toBeTruthy();
  });

  it('keeps every word of a long letter on the one page', () => {
    const body = Array.from({ length: 40 }, (_, i) => `第${i}段，一些文字。`).join('\n\n');
    const d = dom(opts(entry({ body })));
    expect(d.querySelector('.ltr-text')?.textContent).toBe(body);
  });

  it('puts no control on the paper: every button is in the bar, the close, or a postcard', () => {
    const d = dom(opts(entry({ visibility: 'public' }), { albums: [{ id: 'a', title: 'T', emoji: '📁', entryIds: ['e1'] } as any] }));
    expect(d.querySelector('.ltr-paper')!.querySelectorAll('button, select, input, a, [role="button"]')).toHaveLength(0);
    expect(d.querySelector('.ltr-bar [data-open-reader-edit]')).toBeTruthy();
    expect(d.querySelector('.ltr-bar [data-card-entry]')).toBeTruthy();
    expect(d.querySelector('.ltr-bar [data-share-entry]')).toBeTruthy();
    expect(d.querySelector('.ltr-bar [data-favorite-entry]')).toBeTruthy();
    expect(d.querySelector('.ltr-bar [data-delete-entry]')).toBeTruthy();
    expect(d.querySelector('.ltr-bar [data-album-add-entry]')).toBeTruthy();
    expect(d.querySelector('.ltr-bar [data-album-remove-entry="a:e1"]')).toBeTruthy();
    expect(d.querySelector('[data-reader-close]')).toBeTruthy();
  });

  it('wires the page arrows to the neighbours, disabling the missing one', () => {
    const d = dom(opts(entry()));
    const prev = d.querySelector<HTMLButtonElement>('[data-spread-prev]')!;
    const next = d.querySelector<HTMLButtonElement>('[data-spread-next]')!;
    expect(prev.dataset.spreadPrev).toBe('p');
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(true);
  });

  it('only fades on a turn: the first open carries no fade class', () => {
    expect(dom(opts(entry())).querySelector('.ltr')?.className).not.toMatch(/is-fading/);
    expect(dom(opts(entry(), { dir: 'next' })).querySelector('.ltr')?.className).toMatch(/is-fading-a/);
    expect(dom(opts(entry(), { dir: 'prev' })).querySelector('.ltr')?.className).toMatch(/is-fading-b/);
  });

  it('gives a tall photo the tall card and anything else the wide one', () => {
    const d = dom(opts(entry(), { ratios: [0.75, undefined] }));
    const cards = [...d.querySelectorAll<HTMLElement>('[data-postcard]')];
    expect(cards[0].dataset.orient).toBe('portrait');
    expect(cards[0].getAttribute('style')).toContain('--w:240px');
    expect(cards[1].dataset.orient).toBe('landscape');
    expect(cards[1].getAttribute('style')).toContain('--w:340px');
  });

  it('brings the picked card to the front and turns over the flipped ones', () => {
    const d = dom(opts(entry(), { focus: { entryId: 'e1', picked: 1, flipped: [1] } }));
    const [a, b] = [...d.querySelectorAll<HTMLElement>('[data-postcard]')];
    expect(b.classList.contains('is-picked')).toBe(true);
    expect(b.classList.contains('is-flipped')).toBe(true);
    expect(a.classList.contains('is-picked')).toBe(false);
    // focus left over from another entry is ignored
    const stale = dom(opts(entry(), { focus: { entryId: 'other', picked: 1, flipped: [1] } }));
    expect(stale.querySelector('.is-flipped')).toBeNull();
  });

  it('escapes what the traveller typed', () => {
    const d = dom(opts(entry({ title: '<img src=x onerror=alert(1)>', body: '<b>hi</b>', destination: '<i>x</i>', tags: ['<u>'] })));
    expect(d.querySelector('.ltr-paper img')).toBeNull();
    expect(d.querySelector('.ltr-text b')).toBeNull();
    expect(d.querySelector('.ltr-paper u')).toBeNull();
    expect(d.querySelector('.ltr-env i')).toBeNull();
  });

  it('seals the letter in the mood\'s wax, and leaves it off for a mood it does not know', () => {
    expect(dom(opts(entry({ mood: 'wired' }))).querySelector('.ltr-seal')?.getAttribute('data-mood')).toBe('wired');
    expect(dom(opts(entry({ mood: '😊' }))).querySelector('.ltr-seal')).toBeNull();
  });
});

describe('renderWriteLetter', () => {
  const draft = (over: Record<string, unknown> = {}): any => ({
    body: 'b', title: 't', template: 'moment', destination: 'Berlin', tagsText: 'x', mood: 'calm', happenedOn: '2026-07-08',
    images: ['a.jpg', 'b.jpg'], pendingFiles: [null, null], imageRatios: [0.75, 1.5], uploading: false, linkedPlaces: [], ...over,
  });
  const w = (d: any, over: Partial<WriteLetterOpts> = {}) => {
    const host = document.createElement('div');
    // eslint-disable-next-line no-restricted-syntax -- audited: fixture markup under test
    host.innerHTML = renderWriteLetter({
      state: { draft: d, editingId: null, moreOpen: false, letter: null } as any,
      cities: ['Berlin', 'Rome'], destinations: ['Berlin'], extras: '<i class="extra"></i>', iso: 'DE', country: 'Germany', locale: 'en', author: 'Mei', ...over,
    });
    return host;
  };

  it('keeps every hook the composer, the tests and the dashboard overlay rely on', () => {
    const d = w(draft());
    for (const sel of ['#journal-date', '#journal-destination-select', '#journal-destination', '#journal-title', '#journal-body',
      '#journal-tags', '#journal-image-input', '[data-journal-save]', '[data-journal-cancel]', '[data-journal-close]', '[data-journal-more]',
      'input[name="journal-mood"]', '.extra']) {
      expect(d.querySelector(sel), sel).toBeTruthy();
    }
    expect(d.querySelectorAll('input[name="journal-mood"]')).toHaveLength(4);
    expect(d.querySelector<HTMLInputElement>('input[name="journal-mood"]:checked')?.value).toBe('calm');
  });

  it('one card per photo with remove and reorder, first is the cover, and a blank card to add more', () => {
    const d = w(draft());
    expect(d.querySelectorAll('[data-postcard]')).toHaveLength(2);
    expect(d.querySelector('[data-remove-image="1"]')).toBeTruthy();
    expect(d.querySelector('[data-move-image="0"][data-move-dir="back"]')?.hasAttribute('disabled')).toBe(true);
    expect(d.querySelector('[data-move-image="1"][data-move-dir="forward"]')?.hasAttribute('disabled')).toBe(true);
    expect(d.querySelectorAll('.ltr-pc-cover')).toHaveLength(1);
    expect(d.querySelector('label.ltr-pc-slot[for="journal-image-input"]')).toBeTruthy();
  });

  it('offers no blank card once nine photos are in', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `p${i}.jpg`);
    const d = w(draft({ images: nine, pendingFiles: nine.map(() => null), imageRatios: nine.map(() => 1.5) }));
    expect(d.querySelectorAll('[data-postcard]')).toHaveLength(9);
    expect(d.querySelector('.ltr-pc-slot')).toBeNull();
  });

  it('a draft with no photos is the paper and a blank card', () => {
    const d = w(draft({ images: [], pendingFiles: [], imageRatios: [] }));
    expect(d.querySelectorAll('[data-postcard]')).toHaveLength(0);
    expect(d.querySelector('.ltr-pc-slot')).toBeTruthy();
  });

  it('writes the place and the date as a dateline, in the right language', () => {
    expect(w(draft()).querySelector('.ltr-date-text')?.textContent).toBe('8 July 2026');
    expect(w(draft(), { locale: 'zh' }).querySelector('.ltr-date-text')?.textContent).toBe('2026年7月8日');
  });

  it('escapes what was typed', () => {
    const d = w(draft({ title: '"><img src=x>', body: '</textarea><b>x</b>' }));
    expect(d.querySelector('.ltr-paper img')).toBeNull();
    expect(d.querySelector('.ltr-paper b')).toBeNull();
    expect((d.querySelector('#journal-body') as HTMLTextAreaElement).value).toBe('</textarea><b>x</b>');
  });
});
