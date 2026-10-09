/**
 * @vitest-environment jsdom
 *
 * The two ways out: press-and-hold on a phone, and handing an image to the share
 * sheet (or a download). The long-press rules are the fiddly part — a swipe, a
 * tap, a mouse and a button must all NOT fire it.
 */
/* eslint-disable no-restricted-syntax -- test harness: the markup under test is authored in this repo, never user input */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const downloadCard = vi.fn();
vi.mock('../../card/card-export.ts', () => ({ downloadCard: (...a: unknown[]) => downloadCard(...a) }));

import { LONG_PRESS_MS, LONG_PRESS_SLOP, bindLongPress, deliverImage } from './save.ts';

function press(el: Element, type: string, init: { x?: number; y?: number; pointerType?: string } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX: init.x ?? 0, clientY: init.y ?? 0, pointerType: init.pointerType ?? 'touch' });
  el.dispatchEvent(e);
  return e;
}

function setup() {
  document.body.innerHTML = `
    <div id="root">
      <div data-recap-card="3" id="card"><span id="inner">text</span><button id="chip">e03</button></div>
      <div id="outside">not a card</div>
    </div>`;
  const root = document.getElementById('root')!;
  const onPress = vi.fn();
  const handle = bindLongPress(root, onPress);
  return { root, onPress, handle, card: document.getElementById('card')!, inner: document.getElementById('inner')!, chip: document.getElementById('chip')!, outside: document.getElementById('outside')! };
}

beforeEach(() => { vi.useFakeTimers(); downloadCard.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('long press', () => {
  it('fires once the press has been held long enough, with the card pressed', () => {
    const { onPress, card, inner } = setup();
    press(inner, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(card);
  });

  it('does not fire on a tap', () => {
    const { onPress, inner } = setup();
    press(inner, 'pointerdown');
    vi.advanceTimersByTime(120);
    press(inner, 'pointerup');
    vi.advanceTimersByTime(1000);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not fire when the finger moves — that is a swipe through the deck', () => {
    const { onPress, inner } = setup();
    press(inner, 'pointerdown', { x: 100, y: 100 });
    vi.advanceTimersByTime(200);
    press(inner, 'pointermove', { x: 100 + LONG_PRESS_SLOP + 5, y: 100 });
    vi.advanceTimersByTime(1000);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('forgives a small tremor', () => {
    const { onPress, inner } = setup();
    press(inner, 'pointerdown', { x: 100, y: 100 });
    press(inner, 'pointermove', { x: 103, y: 102 });
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the gesture is cancelled by the system', () => {
    const { onPress, inner } = setup();
    press(inner, 'pointerdown');
    vi.advanceTimersByTime(100);
    press(inner, 'pointercancel');
    vi.advanceTimersByTime(1000);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ignores the mouse — on a pointer device Export is the way out', () => {
    const { onPress, inner } = setup();
    press(inner, 'pointerdown', { pointerType: 'mouse' });
    vi.advanceTimersByTime(1000);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ignores a press that starts on a button inside the card', () => {
    const { onPress, chip } = setup();
    press(chip, 'pointerdown');
    vi.advanceTimersByTime(1000);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ignores a press outside any card', () => {
    const { onPress, outside } = setup();
    press(outside, 'pointerdown');
    vi.advanceTimersByTime(1000);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('restarts the clock when a second press begins', () => {
    const { onPress, inner } = setup();
    press(inner, 'pointerdown');
    vi.advanceTimersByTime(300);
    press(inner, 'pointerdown');
    vi.advanceTimersByTime(300);
    expect(onPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('swallows the click the same gesture produces, once', () => {
    const { handle, inner } = setup();
    press(inner, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(handle.consumeClick()).toBe(true);
    expect(handle.consumeClick()).toBe(false);
  });

  it('does not swallow an ordinary click', () => {
    const { handle } = setup();
    expect(handle.consumeClick()).toBe(false);
  });

  it('stops a stale long press from swallowing a click much later', () => {
    const { handle, inner } = setup();
    press(inner, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    vi.advanceTimersByTime(5000);
    expect(handle.consumeClick()).toBe(false);
  });

  it('suppresses the system context menu while a press is in progress or just fired', () => {
    const { inner } = setup();
    press(inner, 'pointerdown');
    expect(press(inner, 'contextmenu').defaultPrevented).toBe(true);
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(press(inner, 'contextmenu').defaultPrevented).toBe(true);
  });

  it('leaves the context menu alone otherwise', () => {
    const { outside } = setup();
    expect(press(outside, 'contextmenu').defaultPrevented).toBe(false);
  });
});

describe('deliverImage', () => {
  const canvas = { toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' })) } as unknown as HTMLCanvasElement;

  function stubNav(share?: () => Promise<void>, canShare = true) {
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: share ? () => canShare : undefined, configurable: true });
  }

  it('uses the system share sheet when the browser can share files', async () => {
    const share = vi.fn(async () => {});
    stubNav(share);
    expect(await deliverImage(canvas, 'a.png', 'Title')).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    const arg = (share.mock.calls[0] as unknown as [ShareData])[0];
    expect(arg.files?.[0].name).toBe('a.png');
    expect(downloadCard).not.toHaveBeenCalled();
  });

  it('treats dismissing the share sheet as a cancel, not an error or a download', async () => {
    stubNav(vi.fn(async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); }));
    expect(await deliverImage(canvas, 'a.png', 'T')).toBe('cancelled');
    expect(downloadCard).not.toHaveBeenCalled();
  });

  it('falls back to a download when sharing fails for another reason', async () => {
    stubNav(vi.fn(async () => { throw new Error('boom'); }));
    expect(await deliverImage(canvas, 'a.png', 'T')).toBe('downloaded');
    expect(downloadCard).toHaveBeenCalledTimes(1);
  });

  it('downloads when the browser cannot share files', async () => {
    stubNav(vi.fn(async () => {}), false);
    expect(await deliverImage(canvas, 'a.png', 'T')).toBe('downloaded');
    expect(downloadCard).toHaveBeenCalledWith(canvas, 'a');
  });

  it('downloads when there is no share API at all', async () => {
    stubNav(undefined);
    expect(await deliverImage(canvas, 'a.png', 'T')).toBe('downloaded');
  });

  it('rejects when the canvas cannot be turned into an image', async () => {
    stubNav(undefined);
    const broken = { toBlob: (cb: (b: Blob | null) => void) => cb(null) } as unknown as HTMLCanvasElement;
    await expect(deliverImage(broken, 'a.png', 'T')).rejects.toThrow('Canvas export failed');
  });
});
