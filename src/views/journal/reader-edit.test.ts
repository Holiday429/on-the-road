/**
 * @vitest-environment jsdom
 *
 * Reader -> editor handoff.
 *
 * Covers the two ways this flow has broken: the Edit button's click being
 * swallowed by a broader handler higher up in the delegated listener, and
 * focusComposer calling scrollIntoView on the composer — which lives in a
 * `position: fixed` overlay, so scrolling "to" it actually scrolls the page
 * behind it and reads as the journal snapping back to the list.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../data/stores/journal-store.ts', () => ({ journalStore: { update: vi.fn(), remove: vi.fn(), save: vi.fn() } }));
vi.mock('../../data/stores/city-store.ts', () => ({ cityStore: { peek: () => [] } }));
vi.mock('../../data/stores/journal-template-store.ts', () => ({ journalTemplateStore: { peek: () => [] } }));
vi.mock('../map/geo.ts', () => ({ coordsFor: () => null, primaryCity: () => '' }));
vi.mock('./card/card-preview.ts', () => ({ openCardPreview: vi.fn() }));
vi.mock('leaflet', () => ({ default: {} }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

import { createCaptureController } from './capture/capture.ts';

const entry: any = {
  id: 'e1', tripId: null, title: 'T', body: 'B', template: 'moment',
  destination: 'Berlin', tags: ['x'], happenedOn: '2026-07-08',
  favorite: false, visibility: 'private', slug: '', images: ['u1'],
  coverImage: 'u1', imageRatio: 0.75, createdAt: 1, updatedAt: 1,
};

describe('reader -> edit flow', () => {
  it('clicking Edit opens the composer without scrolling the page', async () => {
    const scrolled: string[] = [];
    // jsdom has no scrollIntoView; stub it so we can see whether the composer
    // (a fixed overlay) wrongly asks the page to scroll.
    (Element.prototype as any).scrollIntoView = function () { scrolled.push(this.className); };
    const root = document.createElement('div');
    root.id = 'view-journal';
    const body = document.createElement('div');
    body.className = 'journal-body';
    root.appendChild(body);
    document.body.appendChild(root);

    const ctrl = createCaptureController({
      getEntries: () => [entry],
      getLegs: () => [],
      // Test harness: mirrors what renderJournal() does, with fixture data
      // that contains no markup.
      requestRender: () => {
        // eslint-disable-next-line no-restricted-syntax -- audited: fixture data, no user input
        body.innerHTML = ctrl.render();
        ctrl.bind(root);
      },
    });

    // initial paint
    // eslint-disable-next-line no-restricted-syntax -- see above
    body.innerHTML = ctrl.render();
    ctrl.bind(root);

    // 1. click the feed card -> should open reader
    const card = body.querySelector('[data-open-entry]') as HTMLElement;
    expect(card, 'feed card rendered').toBeTruthy();
    card.click();
    expect(body.querySelector('[data-open-reader-edit]'), 'reader opened').toBeTruthy();

    // 2. click Edit -> should open composer
    const editBtn = body.querySelector('[data-open-reader-edit]') as HTMLElement;
    editBtn.click();

    const composer = body.querySelector('.journal-composer');
    const readerStill = body.querySelector('.journal-reader');
    expect(readerStill, 'reader should be closed').toBeFalsy();
    expect(composer, 'composer should be open').toBeTruthy();

    // let the queueMicrotask in focusComposer run
    await Promise.resolve();
    await Promise.resolve();
    expect(scrolled, 'must not scrollIntoView a fixed-overlay composer').toEqual([]);
  });
});
