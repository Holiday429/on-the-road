/**
 * @vitest-environment jsdom
 *
 * Reader -> editor handoff, part 3: the real subscription wiring.
 *
 * The other two tests drive the capture controller directly. This one goes
 * through initJournal(), so the store subscriptions, handleDataChange() and
 * renderJournal() are wired exactly as they are in the app — the fake stores
 * reproduce the emission sequence of src/firebase/db.ts `subscribe()`, which
 * always calls cb() once synchronously (cb([]) when signed out, else the cached
 * rows) before the onSnapshot rows arrive.
 *
 * This is what the Firestore emulator would exercise end-to-end; the emission
 * order is the only part of the store that this bug depends on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';



const entry: any = {
  id: 'e1', tripId: null, title: 'T', body: 'B', template: 'moment',
  destination: 'Berlin', tags: ['x'], happenedOn: '2026-07-08',
  favorite: false, visibility: 'private', slug: '', images: [],
  coverImage: '', imageRatio: 0.75, createdAt: 1, updatedAt: 1,
};

// Captured subscriber callbacks, so the test can emit snapshots on demand.
// vi.hoisted, because vi.mock factories are hoisted above normal consts.
const { subs, register } = vi.hoisted(() => {
  const subs: Record<string, ((rows: any[]) => void)[]> =
    { entries: [], legs: [], stories: [], albums: [], recaps: [] };
  const register = (bucket: string) => (cb: (rows: any[]) => void) => {
    subs[bucket].push(cb);
    return () => {};
  };
  return { subs, register };
});

vi.mock('../../data/stores/journal-store.ts', () => ({
  journalStore: {
    subscribe: register('entries'),
    subscribeAll: register('entries'),
    peek: () => [],
    update: vi.fn(), remove: vi.fn(), save: vi.fn(),
  },
}));
vi.mock('../../data/stores/route-store.ts', () => ({
  routeStore: { subscribe: register('legs'), peek: () => [] },
}));
vi.mock('../../data/stores/journal-story-store.ts', () => ({
  journalStoryStore: { subscribe: register('stories'), peek: () => [] },
}));
vi.mock('../../data/stores/journal-album-store.ts', () => ({
  journalAlbumStore: { subscribe: register('albums'), peek: () => [] },
}));
vi.mock('../../data/stores/traveler-recap-store.ts', () => ({
  travelerRecapStore: { subscribe: register('recaps'), peek: () => [] },
}));
vi.mock('../../data/stores/city-store.ts', () => ({ cityStore: { peek: () => [] } }));
// The journal stores are all faked above, so nothing here should reach Firebase.
// Stubbed to keep the db.ts <-> trip-context.ts import cycle out of the test.
vi.mock('../../firebase/db.ts', () => ({
  createTaggedCollectionStore: () => ({ peek: () => [], subscribe: () => () => {} }),
  createCollectionStore: () => ({ peek: () => [], subscribe: () => () => {} }),
  setMyTripIdsResolver: () => {},
}));
vi.mock('../../data/trip-context.ts', async (importOriginal) => ({
  ...(await importOriginal() as object),
  currentTripId: () => 't1',
  onTripChange: () => () => {},
}));
vi.mock('../map/geo.ts', () => ({ coordsFor: () => null, primaryCity: () => '' }));
vi.mock('./card/card-preview.ts', () => ({ openCardPreview: vi.fn() }));
vi.mock('leaflet', () => ({ default: {} }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

import { initJournal } from './index.ts';

const emit = (bucket: string, rows: any[]) => subs[bucket].forEach((cb) => cb(rows));

describe('reader -> edit through the real subscription wiring', () => {
  beforeEach(() => {
    for (const key of Object.keys(subs)) subs[key] = [];
    // eslint-disable-next-line no-restricted-syntax -- audited: static test scaffold, no interpolation
    document.body.innerHTML = '<div id="view-journal"><div class="journal-body"></div></div>';
  });

  it('keeps the editor open when a sibling store refreshes', () => {
    initJournal();

    // Mirror db.ts subscribe(): a synchronous first emission, then real rows.
    emit('entries', []);
    emit('legs', []);
    emit('stories', []);
    emit('albums', []);
    emit('entries', [entry]);

    const body = document.querySelector('.journal-body') as HTMLElement;

    // Open the reader, then the editor.
    (body.querySelector('[data-open-entry]') as HTMLElement).click();
    (body.querySelector('[data-open-reader-edit]') as HTMLElement).click();
    expect(body.querySelector('.journal-composer'), 'composer open').toBeTruthy();

    // A sibling store re-emits its cold-cache empty snapshot while the editor
    // is open — this is what slammed the composer shut and bounced the user
    // back to the feed.
    emit('legs', []);
    emit('albums', []);
    expect(body.querySelector('.journal-composer'), 'composer survives sibling refresh').toBeTruthy();

    // The entries stream itself re-subscribing (trip switch / signed-out blip).
    emit('entries', []);
    expect(body.querySelector('.journal-composer'), 'composer survives empty entries snapshot').toBeTruthy();
  });

  it('closes the editor when the entry is deleted out of band', () => {
    initJournal();
    const other: any = { ...entry, id: 'e2' };
    emit('entries', [entry, other]);

    const body = document.querySelector('.journal-body') as HTMLElement;
    (body.querySelector('[data-open-entry="e1"]') as HTMLElement).click();
    (body.querySelector('[data-open-reader-edit]') as HTMLElement).click();
    expect(body.querySelector('.journal-composer'), 'composer open').toBeTruthy();

    // e1 removed on another device; the collection is still populated.
    emit('entries', [other]);
    expect(body.querySelector('.journal-composer'), 'composer should close').toBeFalsy();
  });
});
