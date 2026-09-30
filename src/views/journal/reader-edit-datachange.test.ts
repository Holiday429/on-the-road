/**
 * @vitest-environment jsdom
 *
 * Reader -> editor handoff, part 2: surviving a data refresh.
 *
 * reader-edit.test.ts covers the click path in isolation. This covers what
 * happens *after* the composer is open, when one of the journal view's live
 * store subscriptions fires. initJournal() subscribes four stores (entries,
 * legs, stories, templates) and every one of their callbacks calls
 * capture.handleDataChange() + renderJournal(). handleDataChange() closes the
 * composer when the entry being edited is absent from getEntries() — so any
 * refresh that momentarily reports zero entries (a cold cache read, a signed-out
 * snapshot, a trip re-subscribe) slams the open editor shut and drops the user
 * back on the feed.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../data/stores/journal-store.ts', () => ({ journalStore: { update: vi.fn(), remove: vi.fn(), save: vi.fn() } }));
vi.mock('../../data/stores/city-store.ts', () => ({ cityStore: { peek: () => [] } }));
vi.mock('../../data/stores/journal-album-store.ts', () => ({ journalAlbumStore: { subscribe: () => () => {}, peek: () => [], save: vi.fn(), update: vi.fn(), remove: vi.fn(), addEntries: vi.fn(), removeEntry: vi.fn() } }));
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

function openEditor(getEntries: () => any[]) {
  const root = document.createElement('div');
  root.id = 'view-journal';
  const body = document.createElement('div');
  body.className = 'journal-body';
  root.appendChild(body);
  document.body.appendChild(root);

  const ctrl = createCaptureController({
    getEntries,
    getLegs: () => [],
    requestRender: () => {
      // eslint-disable-next-line no-restricted-syntax -- audited: fixture data, no user input
      body.innerHTML = ctrl.render();
      ctrl.bind(root);
    },
  });

  // eslint-disable-next-line no-restricted-syntax -- see above
  body.innerHTML = ctrl.render();
  ctrl.bind(root);

  (body.querySelector('[data-open-entry]') as HTMLElement).click();
  (body.querySelector('[data-open-reader-edit]') as HTMLElement).click();
  expect(body.querySelector('.journal-composer'), 'composer open').toBeTruthy();

  return { ctrl, body };
}

describe('open editor survives store refreshes', () => {
  it('stays open when a subscription momentarily reports zero entries', () => {
    // The live store emits cb([]) for a signed-out/cold-cache snapshot before
    // the real rows land. That must not close an open editor.
    let rows = [entry];
    const { ctrl, body } = openEditor(() => rows);

    rows = [];
    ctrl.handleDataChange();
    ctrl.render();

    // eslint-disable-next-line no-restricted-syntax -- fixture data
    body.innerHTML = ctrl.render();
    expect(body.querySelector('.journal-composer'), 'composer must stay open').toBeTruthy();
  });

  it('still closes the editor when the entry is genuinely deleted', () => {
    // The guard must not be so broad that a real deletion leaves a zombie
    // editor bound to a row that no longer exists.
    const other: any = { ...entry, id: 'e2' };
    let rows = [entry, other];
    const { ctrl, body } = openEditor(() => rows);

    // e1 deleted, but the collection is still populated -> a real deletion.
    rows = [other];
    ctrl.handleDataChange();

    // eslint-disable-next-line no-restricted-syntax -- fixture data
    body.innerHTML = ctrl.render();
    expect(body.querySelector('.journal-composer'), 'composer should close').toBeFalsy();
  });
});
