/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { captureUiState, restoreUiState, swapHtml, createRenderScheduler, mapSignature } from './dashboard-render.ts';

function mount(html: string): HTMLElement {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root')!;
  root.innerHTML = html;
  return root;
}
const FORM = `<input class="td-quickadd-amt"><input class="td-quickadd-desc"><select class="td-quickadd-cat"><option value="">-</option><option value="food">f</option></select>`;

describe('UI state across a re-render', () => {
  it('keeps typed values and the focused field with its caret', () => {
    const root = mount(FORM);
    const amt = root.querySelector<HTMLInputElement>('.td-quickadd-amt')!;
    amt.value = '12.50'; amt.focus(); amt.setSelectionRange(2, 2);
    root.querySelector<HTMLInputElement>('.td-quickadd-desc')!.value = 'taxi';
    root.querySelector<HTMLSelectElement>('.td-quickadd-cat')!.value = 'food';

    const state = captureUiState(root);
    root.innerHTML = FORM;                      // the wholesale rebuild
    restoreUiState(root, state);

    expect(root.querySelector<HTMLInputElement>('.td-quickadd-amt')!.value).toBe('12.50');
    expect(root.querySelector<HTMLInputElement>('.td-quickadd-desc')!.value).toBe('taxi');
    expect(root.querySelector<HTMLSelectElement>('.td-quickadd-cat')!.value).toBe('food');
    const after = root.querySelector<HTMLInputElement>('.td-quickadd-amt')!;
    expect(document.activeElement).toBe(after);
    expect(after.selectionStart).toBe(2);
  });
  it('does not overwrite a value the new markup already provides', () => {
    const root = mount('<input data-rate-input>');
    root.querySelector<HTMLInputElement>('[data-rate-input]')!.value = 'old';
    const state = captureUiState(root);
    root.innerHTML = '<input data-rate-input value="fresh">';
    restoreUiState(root, state);
    expect(root.querySelector<HTMLInputElement>('[data-rate-input]')!.value).toBe('fresh');
  });
  it('does nothing when nothing was typed', () => {
    const root = mount(FORM);
    expect(captureUiState(root)).toEqual({ values: [], focus: null });
  });
});

describe('swapHtml', () => {
  it('moves the kept node into the new markup instead of recreating it', () => {
    const root = mount('<div class="a"></div><div id="map-canvas"><canvas></canvas></div>');
    const canvas = root.querySelector('#map-canvas')!;
    swapHtml(root, '<p>new</p><section><div id="map-canvas"></div></section>', '#map-canvas');
    expect(root.querySelector('#map-canvas')).toBe(canvas);       // same node
    expect(canvas.querySelector('canvas')).not.toBeNull();         // contents intact
    expect(root.querySelector('section #map-canvas')).toBe(canvas);
    expect(root.querySelector('.a')).toBeNull();                   // rest replaced
  });
  it('works on first render, when there is nothing to keep', () => {
    const root = mount('');
    swapHtml(root, '<div id="map-canvas"></div>', '#map-canvas');
    expect(root.querySelector('#map-canvas')).not.toBeNull();
  });
});

describe('createRenderScheduler', () => {
  it('coalesces a synchronous burst into one run', async () => {
    let n = 0;
    const schedule = createRenderScheduler(() => { n++; });
    schedule(); schedule(); schedule();
    expect(n).toBe(0);
    await Promise.resolve();
    expect(n).toBe(1);
    schedule(); await Promise.resolve();
    expect(n).toBe(2);
  });
});

describe('mapSignature', () => {
  const leg = (over: object = {}) => ({ id: 'a', city: 'Rome', country: 'Italy', dateFrom: '2026-08-12', dateTo: '2026-08-16', ...over });
  it('ignores order and unrelated fields, notices real changes', () => {
    expect(mapSignature([leg(), leg({ id: 'b', city: 'Paris' })])).toBe(mapSignature([leg({ id: 'b', city: 'Paris' }), leg({ plans: [1] } as any)]));
    expect(mapSignature([leg()])).not.toBe(mapSignature([leg({ dateTo: '2026-08-17' })]));
  });
});
