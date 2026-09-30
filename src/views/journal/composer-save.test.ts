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
vi.mock('../../data/stores/city-store.ts', () => ({ cityStore: { peek: () => [] } }));
vi.mock('../map/geo.ts', () => ({ coordsFor: () => null, primaryCity: () => '' }));
vi.mock('./card/card-preview.ts', () => ({ openCardPreview: vi.fn() }));
vi.mock('leaflet', () => ({ default: {} }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
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
    const { body } = mount();
    const newBtn = body.querySelector('[data-journal-new]') as HTMLElement;
    expect(newBtn, 'single compose button rendered').toBeTruthy();
    expect(body.querySelector('[data-stamp]'), 'no category stamps').toBeFalsy();

    newBtn.click();
    expect(body.querySelector('.journal-composer'), 'composer opened').toBeTruthy();
    expect(body.querySelector('#journal-body'), 'straight to the text field').toBeTruthy();
  });

  it('keeps the optional fields collapsed until asked for', () => {
    const { body } = mount();
    (body.querySelector('[data-journal-new]') as HTMLElement).click();

    // L2 is a summary line, not a set of controls.
    expect(body.querySelector('[data-meta-edit]'), 'place+date collapsed').toBeTruthy();
    expect(body.querySelector('#journal-destination'), 'no destination input yet').toBeFalsy();
    // L3 is present but closed.
    const more = body.querySelector('[data-journal-more]') as HTMLDetailsElement;
    expect(more, 'more section rendered').toBeTruthy();
    expect(more.open, 'more section starts closed').toBe(false);
  });

  it('rejects a draft with neither text nor photos', async () => {
    const { body } = mount();
    (body.querySelector('[data-journal-new]') as HTMLElement).click();
    await writeAndSave(body, '   ');
    expect(save).not.toHaveBeenCalled();
  });

  it('infers note from a price', async () => {
    const { body } = mount();
    (body.querySelector('[data-journal-new]') as HTMLElement).click();
    await writeAndSave(body, '手冲 ¥800，老板很酷');

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ template: 'note' });
  });

  it('falls back to moment for ordinary prose', async () => {
    const { body } = mount();
    (body.querySelector('[data-journal-new]') as HTMLElement).click();
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
