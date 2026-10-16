/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { beginFlip, dragDirection, sheetAngle, sheetShade, shouldCommit, turnProgress } from './magazine-flip.ts';

describe('sheetAngle', () => {
  it('swings the right page from 0 to -180 going forward, and the left page from 0 to 180 going back', () => {
    expect(sheetAngle(0, 1, 'spread')).toBeCloseTo(0);
    expect(sheetAngle(0.5, 1, 'spread')).toBeCloseTo(-90);
    expect(sheetAngle(1, 1, 'spread')).toBe(-180);
    expect(sheetAngle(0.5, -1, 'spread')).toBe(90);
    expect(sheetAngle(1, -1, 'spread')).toBe(180);
  });
  it('lifts a lone page away going forward and lays it back down going back, never past the screen', () => {
    expect(sheetAngle(1, 1, 'single')).toBe(-100);
    expect(sheetAngle(0, -1, 'single')).toBe(-100);
    expect(sheetAngle(1, -1, 'single')).toBeCloseTo(0);
  });
  it('is clamped', () => {
    expect(sheetAngle(-3, 1, 'spread')).toBeCloseTo(0);
    expect(sheetAngle(9, 1, 'spread')).toBe(-180);
  });
});

describe('sheetShade', () => {
  it('is none when flat and darkest on edge', () => {
    expect(sheetShade(0)).toBe(0);
    expect(sheetShade(1)).toBe(0);
    expect(sheetShade(0.5)).toBeGreaterThan(sheetShade(0.2));
    expect(sheetShade(0.5)).toBeLessThanOrEqual(0.4);
  });
});

describe('dragDirection', () => {
  const spine = 600;
  it('turns forward by pulling the right page left, back by pulling the left page right', () => {
    expect(dragDirection(900, 800, spine, 'spread')).toBe(1);
    expect(dragDirection(300, 420, spine, 'spread')).toBe(-1);
  });
  it('ignores the wrong way on a side (pulling the right page right is not a turn)', () => {
    expect(dragDirection(900, 1000, spine, 'spread')).toBe(0);
    expect(dragDirection(300, 200, spine, 'spread')).toBe(0);
  });
  it('waits for a real drag, and a lone page turns either way', () => {
    expect(dragDirection(900, 895, spine, 'spread')).toBe(0);
    expect(dragDirection(200, 100, spine, 'single')).toBe(1);
    expect(dragDirection(200, 300, spine, 'single')).toBe(-1);
  });
});

describe('the drag thresholds are the passport book’s', () => {
  it('a short slow drag springs back, a long one or a flick lands', () => {
    expect(shouldCommit(turnProgress(60, 600), 0.1)).toBe(false);
    expect(shouldCommit(turnProgress(300, 600), 0.1)).toBe(true);
    expect(shouldCommit(turnProgress(40, 600), 0.9)).toBe(true);
  });
});

describe('beginFlip', () => {
  const page = (cls: string, text: string) => {
    const el = document.createElement('section');
    el.className = `mag-page ${cls}`;
    el.textContent = text;
    return el;
  };
  function spread(n = 2) {
    const host = document.createElement('div');
    host.className = 'mag-spread';
    const pages = n === 2 ? [page('is-verso', 'A-left'), page('is-recto', 'A-right')] : [page('is-recto', 'A-only')];
    host.append(...pages);
    const slot = document.createElement('div');
    slot.className = 'mag-flip-slot';
    host.append(slot);
    return { host, pages, slot };
  }

  it('does nothing without the Web Animations API (the caller then just turns)', () => {
    const { host } = spread();
    expect(beginFlip(host, 'spread', 1, [page('', 'B-left'), page('', 'B-right')])).toBeNull();
  });

  it('forward: the old right page is the front of the sheet, the new left page its back, the new right page waits under it', () => {
    const { host, pages, slot } = spread();
    host.animate = vi.fn() as never;
    const flip = beginFlip(host, 'spread', 1, [page('', 'B-left'), page('', 'B-right')])!;
    expect(flip).toBeTruthy();
    expect(slot.querySelector('.is-front')!.textContent).toBe('A-right');
    expect(slot.querySelector('.is-back')!.textContent).toBe('B-left');
    expect(slot.querySelector('.mag-flip-under')!.textContent).toBe('B-right');
    expect(pages[1].style.visibility).toBe('hidden');
    expect(pages[0].style.visibility).toBe('');
    flip.destroy();
    expect(slot.children).toHaveLength(0);
    expect(pages[1].style.visibility).toBe('');
  });

  it('backward: the old left page is the front, the earlier spread’s right page the back', () => {
    const { host, pages, slot } = spread();
    host.animate = vi.fn() as never;
    const flip = beginFlip(host, 'spread', -1, [page('', 'B-left'), page('', 'B-right')])!;
    expect(slot.querySelector('.is-front')!.textContent).toBe('A-left');
    expect(slot.querySelector('.is-back')!.textContent).toBe('B-right');
    expect(slot.querySelector('.mag-flip-under')!.textContent).toBe('B-left');
    expect(pages[0].style.visibility).toBe('hidden');
    flip.destroy();
  });

  it('follows the hand, and a cancelled drag leaves nothing behind', async () => {
    const { host, slot } = spread();
    host.animate = vi.fn() as never;
    const flip = beginFlip(host, 'spread', 1, [page('', 'B-left'), page('', 'B-right')])!;
    flip.set(0.5);
    expect((slot.querySelector('.mag-sheet') as HTMLElement).style.transform).toBe('rotateY(-90deg)');
    await flip.settle(0);
    expect((slot.querySelector('.mag-sheet') as HTMLElement).style.transform).toBe('rotateY(0deg)');
    flip.destroy();
    expect(host.querySelectorAll('.mag-page')).toHaveLength(2);
  });

  it('puts a void page under the sheet when the next spread has no page on that side', () => {
    const { host, slot } = spread();
    host.animate = vi.fn() as never;
    const flip = beginFlip(host, 'spread', 1, [page('', 'back'), page('is-void', '')])!;
    expect(slot.querySelector('.mag-flip-under .mag-page')!.classList.contains('is-void')).toBe(true);
    flip.destroy();
  });

  it('on a phone the old page lifts away over the next, or the earlier page is laid down over this one', () => {
    const fwd = spread(1);
    fwd.host.animate = vi.fn() as never;
    const f = beginFlip(fwd.host, 'single', 1, [page('', 'B')])!;
    expect(fwd.slot.querySelector('.is-front')!.textContent).toBe('A-only');
    expect(fwd.slot.querySelector('.mag-flip-under')!.textContent).toBe('B');
    f.destroy();
    const back = spread(1);
    back.host.animate = vi.fn() as never;
    const b = beginFlip(back.host, 'single', -1, [page('', 'Z')])!;
    expect(back.slot.querySelector('.is-front')!.textContent).toBe('Z');
    expect(back.pages[0].style.visibility).toBe('');
    b.destroy();
  });

  it('refuses a spread it does not understand', () => {
    const { host } = spread();
    host.animate = vi.fn() as never;
    expect(beginFlip(host, 'spread', 1, [page('', 'only one')])).toBeNull();
  });
});
