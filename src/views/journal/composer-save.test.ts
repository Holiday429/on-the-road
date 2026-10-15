/**
 * @vitest-environment jsdom
 *
 * The single-entry composer's save contract.
 *
 * Three things changed when the category picker went away, and none of them
 * are visible to the type checker:
 *   1. a draft with neither text nor photos is the only empty one,
 *   2. a new entry's category is inferred from what was written,
 *   3. editing does NOT re-infer, so a hand-fixed category survives a re-save.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted above this file's other statements, so the spies it
// closes over have to be hoisted too.
const { save, update } = vi.hoisted(() => ({
  save: vi.fn((_payload: Record<string, unknown>) => Promise.resolve()),
  update: vi.fn((_id: string, _patch: Record<string, unknown>) => Promise.resolve()),
}));

vi.mock('../../data/stores/journal-store.ts', () => ({
  journalStore: { save, update, remove: vi.fn() },
}));
vi.mock('../../data/stores/journal-album-store.ts', () => ({
  journalAlbumStore: {
    subscribe: () => () => {}, peek: () => [],
    save: vi.fn(), update: vi.fn(), remove: vi.fn(),
    addEntries: vi.fn(), removeEntry: vi.fn(),
  },
}));
vi.mock('../../data/stores/city-store.ts', () => ({ cityStore: { peek: () => [] } }));
vi.mock('../map/geo.ts', () => ({ coordsFor: () => null, primaryCity: () => '', cityLocationsFor: () => [] }));
vi.mock('./card/card-preview.ts', () => ({ openCardPreview: vi.fn() }));
vi.mock('../../firebase/storage.ts', () => ({
  uploadJournalImage: vi.fn(() => Promise.resolve('https://example.test/photo.jpg')),
}));

import { createCaptureController } from './capture/capture.ts';

const entry: any = {
  id: 'e1', tripId: null, title: 'T', body: 'B', template: 'interesting',
  destination: 'Berlin', tags: [], happenedOn: '2026-07-08',
  favorite: false, visibility: 'private', slug: '', images: [],
  createdAt: 1, updatedAt: 1,
};

function mount(entries: any[] = []) {
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

/* The new-entry button lives in the journal's top bar (views/journal/index.ts),
   which this fixture does not mount — but the click handler for it belongs to
   the capture controller, so the bar's button is recreated here to exercise it. */
function newEntryButton(root: HTMLElement, body: HTMLElement): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'journal-new-btn';
  btn.dataset.journalNew = '';
  body.prepend(btn);
  void root;
  return btn;
}

/** Type into the open composer and hit Save. */
async function writeAndSave(body: HTMLElement, text: string) {
  const textarea = body.querySelector('#journal-body') as HTMLTextAreaElement;
  textarea.value = text;
  (body.querySelector('[data-journal-save]') as HTMLElement).click();
  // saveDraft is async (photo upload); let its promise chain settle.
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

beforeEach(() => {
  save.mockClear();
  update.mockClear();
  (Element.prototype as any).scrollIntoView = () => {};
});

describe('composer save', () => {
  it('opens straight from one button, with no category to pick first', () => {
    const { root, body } = mount();
    expect(body.querySelector('[data-stamp]'), 'no category stamps').toBeFalsy();

    newEntryButton(root, body).click();
    expect(body.querySelector('.jsp--write'), 'composer opened').toBeTruthy();
    expect(body.querySelector('#journal-body'), 'straight to the text field').toBeTruthy();
  });

  it('puts the day on the page and keeps the rest on a folded note', () => {
    const { root, body } = mount();
    newEntryButton(root, body).click();

    // The notebook's own furniture is always out: the date stamp, the place, the
    // mood stickers and somewhere to write. None of it hides behind a summary line.
    expect(body.querySelector('#journal-date'), 'date stamp is the date control').toBeTruthy();
    expect(body.querySelector('#journal-destination'), 'place is on the page').toBeTruthy();
    expect(body.querySelector('input[name="journal-mood"]'), 'mood stickers are on the page').toBeTruthy();
    expect(body.querySelector('#journal-body'), 'ruled page to write on').toBeTruthy();
    // Only the extras (tags, saved places) are folded away.
    const more = body.querySelector('[data-journal-more]') as HTMLDetailsElement;
    expect(more, 'sticky note rendered').toBeTruthy();
    expect(more.open, 'sticky note starts folded').toBe(false);
  });

  it('rejects a draft with neither text nor photos', async () => {
    const { root, body } = mount();
    newEntryButton(root, body).click();
    await writeAndSave(body, '   ');
    expect(save).not.toHaveBeenCalled();
  });

  it('infers note from a price', async () => {
    const { root, body } = mount();
    newEntryButton(root, body).click();
    await writeAndSave(body, '手冲 ¥800，老板很酷');

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ template: 'note' });
  });

  it('falls back to moment for ordinary prose', async () => {
    const { root, body } = mount();
    newEntryButton(root, body).click();
    await writeAndSave(body, '今天走了很久的路');

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ template: 'moment' });
  });

  it('does not re-infer when editing, so a corrected category sticks', async () => {
    const { body } = mount([entry]);
    (body.querySelector('[data-open-entry]') as HTMLElement).click();
    (body.querySelector('[data-open-reader-edit]') as HTMLElement).click();

    // Re-save with a body that WOULD infer as `note` on a new entry.
    await writeAndSave(body, '门票 ¥500');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toMatchObject({ template: 'interesting' });
  });
});
