/**
 * @vitest-environment jsdom
 *
 * Albums — the after-the-fact grouping that replaced picking a category first.
 *
 * The behaviour worth pinning down is membership: it lives on the ALBUM
 * (entryIds), not on the entry, so every add/remove is a write to one album
 * document, and an album that references a deleted entry must not break the
 * view it appears in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const albumUpdate = vi.hoisted(() => vi.fn((_id: string, _patch: Record<string, unknown>) => Promise.resolve()));
const albumSave = vi.hoisted(() => vi.fn((_a: Record<string, unknown>) => Promise.resolve('new-album')));
const albumRemove = vi.hoisted(() => vi.fn((_id: string) => Promise.resolve()));

vi.mock('../../data/stores/journal-store.ts', () => ({
  journalStore: { save: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));
vi.mock('../../data/stores/journal-album-store.ts', () => ({
  journalAlbumStore: {
    save: albumSave,
    update: albumUpdate,
    remove: albumRemove,
    addEntries: (album: any, ids: string[]) => {
      const next = [...album.entryIds];
      for (const id of ids) if (!next.includes(id)) next.push(id);
      return albumUpdate(album.id, { entryIds: next });
    },
    removeEntry: (album: any, id: string) =>
      albumUpdate(album.id, { entryIds: album.entryIds.filter((x: string) => x !== id) }),
  },
}));
vi.mock('../../data/stores/city-store.ts', () => ({ cityStore: { peek: () => [] } }));
vi.mock('../map/geo.ts', () => ({ coordsFor: () => null, primaryCity: () => '' }));
vi.mock('./card/card-preview.ts', () => ({ openCardPreview: vi.fn() }));
vi.mock('leaflet', () => ({ default: {} }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

import { createCaptureController } from './capture/capture.ts';

const mkEntry = (id: string, over: Record<string, unknown> = {}): any => ({
  id, tripId: null, title: `T${id}`, body: `B${id}`, template: 'moment',
  destination: 'Kyoto', tags: [], happenedOn: '2026-07-08',
  favorite: false, visibility: 'private', slug: '', images: ['u'],
  coverImage: 'u', createdAt: 1, updatedAt: 1, ...over,
});

const mkAlbum = (id: string, entryIds: string[] = []): any => ({
  id, tripId: null, title: `Album ${id}`, emoji: '📁',
  coverEntryId: null, entryIds, visibility: 'private', slug: '',
  createdAt: 1, updatedAt: 1,
});

function mount(entries: any[], albums: any[]) {
  document.body.replaceChildren();
  const root = document.createElement('div');
  root.id = 'view-journal';
  const body = document.createElement('div');
  body.className = 'journal-body';
  root.appendChild(body);
  document.body.appendChild(root);

  const ctrl = createCaptureController({
    getEntries: () => entries,
    getLegs: () => [],
    getAlbums: () => albums,
    requestRender: () => {
      // eslint-disable-next-line no-restricted-syntax -- audited: fixture data, no user input
      body.innerHTML = ctrl.render();
      ctrl.bind(root);
    },
  });
  // eslint-disable-next-line no-restricted-syntax -- see above
  body.innerHTML = ctrl.render();
  ctrl.bind(root);
  return { root, body, ctrl };
}

/** Switch to a top-level view the way the journal shell's tabs do. */
function gotoView(body: HTMLElement, view: string) {
  const btn = document.createElement('button');
  btn.dataset.journalView = view;
  body.appendChild(btn);
  btn.click();
  return body;
}

beforeEach(() => {
  albumUpdate.mockClear();
  albumSave.mockClear();
  albumRemove.mockClear();
  (Element.prototype as any).scrollIntoView = () => {};
});

describe('albums view', () => {
  it('lists the user albums with their entry counts', () => {
    const { body } = mount([mkEntry('e1'), mkEntry('e2')], [mkAlbum('a1', ['e1', 'e2'])]);
    gotoView(body, 'albums');

    expect(body.querySelector('[data-open-album="a1"]'), 'album tile rendered').toBeTruthy();
    expect(body.textContent).toContain('Album a1');
    expect(body.textContent).toContain('2 entries');
  });

  it('ignores entry ids whose entry was deleted', () => {
    // a1 references e2, which no longer exists.
    const { body } = mount([mkEntry('e1')], [mkAlbum('a1', ['e1', 'e2'])]);
    gotoView(body, 'albums');
    expect(body.textContent).toContain('1 entries');
  });

  it('opens an album and can drop an entry from it', async () => {
    const album = mkAlbum('a1', ['e1', 'e2']);
    const { body } = mount([mkEntry('e1'), mkEntry('e2')], [album]);
    gotoView(body, 'albums');

    (body.querySelector('[data-open-album="a1"]') as HTMLElement).click();
    expect(body.querySelector('[data-album-back]'), 'album detail opened').toBeTruthy();

    (body.querySelector('[data-album-remove-entry="a1:e1"]') as HTMLElement).click();
    await Promise.resolve();

    expect(albumUpdate).toHaveBeenCalledWith('a1', { entryIds: ['e2'] });
  });

  it('keeps the auto groups, but below the user albums', () => {
    const { body } = mount([mkEntry('e1')], []);
    gotoView(body, 'albums');
    const shell = body.querySelector('.journal-album-shell')!;
    const auto = shell.querySelector('.journal-auto-groups');
    expect(auto, 'auto groups still present').toBeTruthy();
    // Collapsed: it's reference material, not the main event.
    expect((auto as HTMLDetailsElement).open).toBe(false);
  });
});

describe('gallery multi-select', () => {
  it('toggles into select mode and picks tiles without opening the reader', () => {
    const { body } = mount([mkEntry('e1'), mkEntry('e2')], [mkAlbum('a1')]);
    gotoView(body, 'gallery');

    // Not in select mode: tiles open the reader.
    expect(body.querySelector('[data-open-entry="e1"]')).toBeTruthy();

    (body.querySelector('[data-gallery-select]') as HTMLElement).click();
    expect(body.querySelector('[data-open-entry="e1"]'), 'tiles no longer open the reader').toBeFalsy();

    (body.querySelector('[data-gallery-pick="e1"]') as HTMLElement).click();
    expect(body.querySelector('.journal-gallery-tile.is-picked'), 'tile marked picked').toBeTruthy();
    expect(body.textContent).toContain('选中 1 条');
  });

  it('adds the whole selection to an album in one write, then exits select mode', async () => {
    const album = mkAlbum('a1', []);
    const { body } = mount([mkEntry('e1'), mkEntry('e2')], [album]);
    gotoView(body, 'gallery');

    (body.querySelector('[data-gallery-select]') as HTMLElement).click();
    (body.querySelector('[data-gallery-pick="e1"]') as HTMLElement).click();
    (body.querySelector('[data-gallery-pick="e2"]') as HTMLElement).click();

    const select = body.querySelector('[data-album-target]') as HTMLSelectElement;
    select.value = 'a1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 4; i++) await Promise.resolve();

    expect(albumUpdate).toHaveBeenCalledTimes(1);
    expect(albumUpdate).toHaveBeenCalledWith('a1', { entryIds: ['e1', 'e2'] });
    expect(body.querySelector('[data-gallery-pick]'), 'select mode exited').toBeFalsy();
  });
});

describe('reader album membership', () => {
  it('shows which albums an entry is in, and can remove it from one', async () => {
    const { body } = mount([mkEntry('e1')], [mkAlbum('a1', ['e1']), mkAlbum('a2', [])]);

    (body.querySelector('[data-open-entry="e1"]') as HTMLElement).click();
    expect(body.querySelector('.journal-reader-albums'), 'album row in reader').toBeTruthy();
    expect(body.textContent).toContain('Album a1');

    (body.querySelector('[data-album-remove-entry="a1:e1"]') as HTMLElement).click();
    await Promise.resolve();
    expect(albumUpdate).toHaveBeenCalledWith('a1', { entryIds: [] });
  });

  it('only offers albums the entry is not already in', () => {
    const { body } = mount([mkEntry('e1')], [mkAlbum('a1', ['e1']), mkAlbum('a2', [])]);
    (body.querySelector('[data-open-entry="e1"]') as HTMLElement).click();

    const options = [...body.querySelectorAll('[data-album-add-entry] option')].map((o) => o.getAttribute('value'));
    expect(options).toContain('a2');
    expect(options).not.toContain('a1');
  });
});

/**
 * Create / rename / delete used to be window.prompt()/confirm() — blocking
 * native dialogs that don't match the rest of the app. They're openModal()
 * now: async, dismissible by ✕/backdrop/Esc, and (for create) the caller
 * awaits a promise that has to resolve on every one of those exits, or a
 * cancelled "add to album from a new album" flow would hang forever.
 */
describe('album create / rename / delete modals', () => {
  it('opens a modal, not window.prompt, to create an album', () => {
    const { body } = mount([], []);
    gotoView(body, 'albums');

    (body.querySelector('[data-album-create]') as HTMLElement).click();

    const modal = document.querySelector('.otr-modal');
    expect(modal, 'modal opened').toBeTruthy();
    expect(document.querySelector('#ja-title'), 'title input present').toBeTruthy();
  });

  it('creates the album on submit and closes the modal', async () => {
    const { body } = mount([], []);
    gotoView(body, 'albums');
    (body.querySelector('[data-album-create]') as HTMLElement).click();

    const input = document.querySelector('#ja-title') as HTMLInputElement;
    input.value = 'Kyoto week';
    (document.querySelector('#ja-create') as HTMLElement).click();
    for (let i = 0; i < 4; i++) await Promise.resolve();

    expect(albumSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Kyoto week' }),
    );
    expect(document.querySelector('.otr-modal'), 'modal closed after create').toBeFalsy();
  });

  it('refuses a blank title without closing, so the user can just try again', async () => {
    const { body } = mount([], []);
    gotoView(body, 'albums');
    (body.querySelector('[data-album-create]') as HTMLElement).click();

    (document.querySelector('#ja-create') as HTMLElement).click();
    await Promise.resolve();

    expect(albumSave).not.toHaveBeenCalled();
    expect(document.querySelector('.otr-modal'), 'modal stays open on a blank title').toBeTruthy();
  });

  it('cancelling create resolves without ever calling save', async () => {
    const { body } = mount([], []);
    gotoView(body, 'albums');
    (body.querySelector('[data-album-create]') as HTMLElement).click();

    // [data-otr-close] is the Cancel button AND the ✕ — either tears the
    // modal down via the same path.
    (document.querySelector('[data-otr-close]') as HTMLElement).click();
    await Promise.resolve();

    expect(document.querySelector('.otr-modal')).toBeFalsy();
    expect(albumSave).not.toHaveBeenCalled();
  });

  it('renames via a modal pre-filled with the current title', async () => {
    const { body } = mount([], [mkAlbum('a1')]);
    gotoView(body, 'albums');
    (body.querySelector('[data-open-album="a1"]') as HTMLElement).click();
    (body.querySelector('[data-album-rename="a1"]') as HTMLElement).click();

    const input = document.querySelector('#ja-title') as HTMLInputElement;
    expect(input.value, 'pre-filled with the existing title').toBe('Album a1');

    input.value = 'Renamed';
    (document.querySelector('#ja-save') as HTMLElement).click();
    await Promise.resolve();

    expect(albumUpdate).toHaveBeenCalledWith('a1', { title: 'Renamed' });
  });

  it('deletes only after an explicit confirm click, and the copy says entries are kept', async () => {
    const { body } = mount([], [mkAlbum('a1')]);
    gotoView(body, 'albums');
    (body.querySelector('[data-open-album="a1"]') as HTMLElement).click();
    (body.querySelector('[data-album-delete="a1"]') as HTMLElement).click();

    const modal = document.querySelector('.otr-modal');
    expect(modal?.textContent, 'reassures that entries are kept').toContain('kept');
    expect(albumRemove, 'not deleted just from opening the confirm').not.toHaveBeenCalled();

    (document.querySelector('#ja-delete') as HTMLElement).click();
    await Promise.resolve();

    expect(albumRemove).toHaveBeenCalledWith('a1');
  });

  it('gallery selection -> "new album…" opens the same create modal, seeded with the picks', async () => {
    const { body } = mount([mkEntry('e1'), mkEntry('e2')], []);
    gotoView(body, 'gallery');

    (body.querySelector('[data-gallery-select]') as HTMLElement).click();
    (body.querySelector('[data-gallery-pick="e1"]') as HTMLElement).click();
    (body.querySelector('[data-gallery-pick="e2"]') as HTMLElement).click();

    const select = body.querySelector('[data-album-target]') as HTMLSelectElement;
    select.value = '__new__';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    const input = document.querySelector('#ja-title') as HTMLInputElement;
    expect(input, 'create modal opened from the gallery select').toBeTruthy();

    input.value = 'From gallery';
    (document.querySelector('#ja-create') as HTMLElement).click();
    for (let i = 0; i < 4; i++) await Promise.resolve();

    expect(albumSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'From gallery', entryIds: ['e1', 'e2'] }),
    );
  });
});
