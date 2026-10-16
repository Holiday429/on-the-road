/**
 * @vitest-environment jsdom
 *
 * A cover picture the traveller uploads: previewed in the editor, put on Storage
 * only when the cover is saved, and stored on the album as `cover.photo`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { albumUpdate, upload } = vi.hoisted(() => ({
  albumUpdate: vi.fn((_id: string, _patch: Record<string, unknown>) => Promise.resolve()),
  upload: vi.fn((_f: File, _i?: number) => Promise.resolve({ url: 'https://storage.test/cover.jpg', name: 'cover.jpg' })),
}));

vi.mock('../../data/stores/journal-store.ts', () => ({ journalStore: { save: vi.fn(), update: vi.fn(), remove: vi.fn() } }));
vi.mock('../../data/stores/journal-album-store.ts', () => ({
  journalAlbumStore: { save: vi.fn(), update: albumUpdate, remove: vi.fn(), addEntries: vi.fn(), removeEntry: vi.fn() },
}));
vi.mock('../../data/stores/city-store.ts', () => ({ cityStore: { peek: () => [] } }));
vi.mock('../map/geo.ts', () => ({ coordsFor: () => null, primaryCity: () => '', cityLocationsFor: () => [] }));
vi.mock('./card/card-preview.ts', () => ({ openCardPreview: vi.fn() }));
vi.mock('../../firebase/storage.ts', () => ({ uploadJournalImage: upload }));

import { createCaptureController } from './capture/capture.ts';

const album: any = { id: 'a1', tripId: null, title: 'Lisbon', emoji: '📁', coverEntryId: null, entryIds: [], visibility: 'private', slug: '', createdAt: 1, updatedAt: 1 };

function mount() {
  document.body.replaceChildren();
  const root = document.createElement('div');
  root.id = 'view-journal';
  const body = document.createElement('div');
  body.className = 'journal-body';
  root.appendChild(body);
  document.body.appendChild(root);
  const ctrl = createCaptureController({
    getEntries: () => [],
    getLegs: () => [],
    getAlbums: () => [album],
    requestRender: () => {
      // eslint-disable-next-line no-restricted-syntax -- audited: fixture data
      body.innerHTML = ctrl.render();
      ctrl.bind(root);
    },
  });
  // eslint-disable-next-line no-restricted-syntax -- see above
  body.innerHTML = ctrl.render();
  ctrl.bind(root);
  const tab = document.createElement('button');
  tab.dataset.journalView = 'albums';
  body.appendChild(tab);
  tab.click();
  (body.querySelector('[data-open-album]') as HTMLElement).click();
  (body.querySelector('[data-album-cover]') as HTMLElement).click();
  return { body };
}

function choose(body: HTMLElement) {
  const input = body.querySelector('[data-cover-photo-input]') as HTMLInputElement;
  const file = new File(['x'], 'mine.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return file;
}

beforeEach(() => {
  albumUpdate.mockClear(); upload.mockClear();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

describe('designing a cover with your own photo', () => {
  it('previews the chosen picture in the proof without uploading it', () => {
    const { body } = mount();
    choose(body);
    expect(body.querySelector('.jce-proof-art img')!.getAttribute('src')).toBe('blob:preview');
    expect(body.querySelector('[data-cover-photo-clear]')).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads it when the cover is saved, and stores its URL on the album', async () => {
    const { body } = mount();
    const file = choose(body);
    (body.querySelector('[data-cover-save]') as HTMLElement).click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(upload).toHaveBeenCalledWith(file, 0);
    expect(albumUpdate).toHaveBeenCalledTimes(1);
    expect((albumUpdate.mock.calls[0][1] as any).cover.photo).toBe('https://storage.test/cover.jpg');
  });

  it('cancelling uploads nothing', () => {
    const { body } = mount();
    choose(body);
    (body.querySelector('[data-cover-cancel]') as HTMLElement).click();
    expect(upload).not.toHaveBeenCalled();
    expect(albumUpdate).not.toHaveBeenCalled();
  });

  it('"use an entry photo" drops the picture again', async () => {
    const { body } = mount();
    choose(body);
    (body.querySelector('[data-cover-photo-clear]') as HTMLElement).click();
    expect(body.querySelector('[data-cover-photo-clear]')).toBeNull();
    (body.querySelector('[data-cover-save]') as HTMLElement).click();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(upload).not.toHaveBeenCalled();
    expect((albumUpdate.mock.calls[0][1] as any).cover.photo).toBe('');
  });

  it('keeps the editor open and writes nothing to the album when the upload fails', async () => {
    upload.mockRejectedValueOnce(new Error('offline'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { body } = mount();
    choose(body);
    (body.querySelector('[data-cover-save]') as HTMLElement).click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(albumUpdate).not.toHaveBeenCalled();
    expect(body.querySelector('[data-cover-editor]')).toBeTruthy();
    err.mockRestore();
  });
});
