/**
 * @vitest-environment jsdom
 *
 * The journal re-renders on every data change and reuses the deck's DOM node, so
 * the controller's `bind` runs again on the SAME node. If it added listeners each
 * time, one tap would turn a card over several times — an even count is no flip.
 */
/* eslint-disable no-restricted-syntax -- test harness: the markup under test is authored in this repo, never user input */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLocale } from '../../../core/i18n.ts';

const drawCardBack = vi.fn();
const deliverImage = vi.fn(async (..._a: unknown[]) => 'downloaded' as const);
vi.mock('./export/draw.ts', () => ({ drawCardBack: (...a: unknown[]) => drawCardBack(...a), CARD_W: 1080, CARD_H: 1440 }));
vi.mock('./export/save.ts', async (orig) => ({ ...(await orig<typeof import('./export/save.ts')>()), deliverImage: (...a: unknown[]) => deliverImage(...a) }));
vi.mock('../card/card-fonts.ts', () => ({ ensureCardFonts: async () => {} }));
vi.mock('../../../core/paywall.ts', () => ({ handleAiError: () => false }));
vi.mock('../../../data/stores/traveler-recap-store.ts', () => ({ travelerRecapStore: { save: vi.fn(), update: vi.fn() } }));
const generateRecap = vi.fn(async (..._a: unknown[]) => ({ draft: {}, privacyReport: {} }));
vi.mock('./generator.ts', async (orig) => ({ ...(await orig<typeof import('./generator.ts')>()), generateRecap: (...a: unknown[]) => generateRecap(...a) }));
const confirmModal = vi.fn(async (..._a: unknown[]) => true);
vi.mock('./export/ui.ts', () => ({ confirmModal: (...a: unknown[]) => confirmModal(...a), toast: vi.fn() }));

import { createRecapController } from './recap.ts';
import { europeZh, flagged } from './preview/fixture.ts';
import { LONG_PRESS_MS } from './export/save.ts';

function mount(recap: typeof europeZh) {
  const requestRender = vi.fn();
  const controller = createRecapController({ getEntries: () => [], getRecaps: () => [recap as never], requestRender });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const paint = () => { host.innerHTML = controller.render(); };
  paint();
  return { controller, host, paint, requestRender };
}

const card = (host: HTMLElement, i: number) => host.querySelector<HTMLElement>(`[data-recap-card="${i}"]`)!;
function press(el: Element, type: string, pointerType = 'touch') {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX: 0, clientY: 0, pointerType });
  el.dispatchEvent(e);
}

beforeEach(() => { setLocale('zh'); document.body.innerHTML = ''; drawCardBack.mockClear(); generateRecap.mockClear(); deliverImage.mockClear(); confirmModal.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('binding', () => {
  it('turns a card over exactly once, however many times the journal re-binds', () => {
    const { controller, host } = mount(europeZh);
    for (let i = 0; i < 4; i += 1) controller.bind(host); // four renders' worth of binds on one node
    card(host, 2).click();
    expect(card(host, 2).classList.contains('is-flipped')).toBe(true);
    card(host, 2).click();
    expect(card(host, 2).classList.contains('is-flipped')).toBe(false);
  });

  it('binds again for a genuinely new shell', () => {
    const { controller, host, paint } = mount(europeZh);
    controller.bind(host);
    host.innerHTML = '';           // the shell node is replaced…
    paint();
    controller.bind(host);         // …so the new one needs listeners of its own
    card(host, 3).click();
    expect(card(host, 3).classList.contains('is-flipped')).toBe(true);
  });

  it('asks for a re-render when switching between public and private', () => {
    const { controller, host, requestRender } = mount(europeZh);
    controller.bind(host);
    host.querySelector<HTMLElement>('[data-recap-view="public"]')!.click();
    expect(requestRender).toHaveBeenCalledTimes(1);
    host.querySelector<HTMLElement>('[data-recap-view="public"]')!.click();
    expect(requestRender).toHaveBeenCalledTimes(1); // already public: nothing to do
  });
});

describe('spending credit', () => {
  it('never calls the model for a click a script made, only for a real tap', async () => {
    const { controller, host } = mount(europeZh);
    controller.bind(host);
    const regen = host.querySelector<HTMLElement>('[data-recap-regenerate]')!;

    regen.click();                                   // programmatic: isTrusted is false
    regen.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(generateRecap).not.toHaveBeenCalled();
  });
});

describe('press and hold', () => {
  it('saves that card and does not also turn it over', async () => {
    vi.useFakeTimers();
    const { controller, host } = mount(europeZh);
    controller.bind(host);

    press(card(host, 4), 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    press(card(host, 4), 'pointerup');
    card(host, 4).click(); // the click the same gesture produces
    vi.useRealTimers();

    await vi.waitFor(() => expect(deliverImage).toHaveBeenCalled());
    expect(card(host, 4).classList.contains('is-flipped')).toBe(false);
    const call = drawCardBack.mock.calls[0] as unknown as [unknown, { page: number; total: number; key: string }];
    expect(call[1]).toMatchObject({ key: 'relations', page: 5, total: 9 });
    expect(String(deliverImage.mock.calls[0][1])).toBe('on-the-road-portrait-05.png');
  });

  it('still turns a card on an ordinary tap', () => {
    const { controller, host } = mount(europeZh);
    controller.bind(host);
    press(card(host, 2), 'pointerdown');
    press(card(host, 2), 'pointerup');
    card(host, 2).click();
    expect(card(host, 2).classList.contains('is-flipped')).toBe(true);
  });

  it('asks first when the card was flagged, and saves only if the owner agrees', async () => {
    vi.useFakeTimers();
    const { controller, host } = mount(flagged);
    controller.bind(host);
    confirmModal.mockResolvedValueOnce(false);

    press(card(host, 4), 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    vi.useRealTimers();
    await vi.waitFor(() => expect(confirmModal).toHaveBeenCalled());
    expect(String(confirmModal.mock.calls[0][0])).toContain('关系称谓');
    await Promise.resolve();
    expect(deliverImage).not.toHaveBeenCalled();
  });

  it('saves a flagged card when the owner confirms', async () => {
    vi.useFakeTimers();
    const { controller, host } = mount(flagged);
    controller.bind(host);
    confirmModal.mockResolvedValueOnce(true);
    press(card(host, 4), 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    vi.useRealTimers();
    await vi.waitFor(() => expect(deliverImage).toHaveBeenCalled());
  });

  it('does not save a card that has no public wording', async () => {
    vi.useFakeTimers();
    const bare = { ...europeZh, chapters: europeZh.chapters.map((c, i) => (i === 0 ? { ...c, bodyPublic: '', flags: ['empty'], shareable: false } : c)) };
    const { controller, host } = mount(bare);
    controller.bind(host);
    press(card(host, 2), 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    vi.useRealTimers();
    await Promise.resolve();
    expect(drawCardBack).not.toHaveBeenCalled();
    expect(confirmModal).not.toHaveBeenCalled();
  });

  it('saves the card with the page number it has in the deck', async () => {
    vi.useFakeTimers();
    const { controller, host } = mount(europeZh);
    controller.bind(host);
    press(card(host, 0), 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    vi.useRealTimers();
    await vi.waitFor(() => expect(drawCardBack).toHaveBeenCalled());
    expect((drawCardBack.mock.calls[0] as unknown as [unknown, { page: number }])[1].page).toBe(1);
  });
});
