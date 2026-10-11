/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDrawer, isDrawerOpen, openDrawer } from './drawer.ts';

afterEach(() => { closeDrawer(); document.body.replaceChildren(); });

const mount = (html: string) => {
  document.body.replaceChildren();
  document.body.insertAdjacentHTML('beforeend', html); // static test markup
};

const q = (sel: string) => document.querySelector<HTMLElement>(sel);

describe('openDrawer', () => {
  it('renders an escaped title and the body, and marks the body as open', () => {
    openDrawer({ title: '<b>Rome</b>', subtitle: 'a & b', body: '<p id="x">hi</p>' });
    expect(q('.otr-drawer-title')!.textContent).toBe('<b>Rome</b>');
    expect(q('.otr-drawer-title b')).toBeNull();
    expect(q('.otr-drawer-sub')!.textContent).toBe('a & b');
    expect(q('#x')).not.toBeNull();
    expect(document.body.classList.contains('otr-drawer-open')).toBe(true);
    expect(isDrawerOpen()).toBe(true);
  });

  it('closes on ✕, scrim click and Escape; panel clicks do not close', () => {
    let h = openDrawer({ title: 't', body: '' });
    q('.otr-drawer')!.click();
    expect(isDrawerOpen()).toBe(true);
    q('[data-otr-close]')!.click();
    expect(isDrawerOpen()).toBe(false);

    h = openDrawer({ title: 't', body: '' });
    q('.otr-drawer-scrim')!.click();
    expect(isDrawerOpen()).toBe(false);

    h = openDrawer({ title: 't', body: '' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isDrawerOpen()).toBe(false);
    expect(document.body.classList.contains('otr-drawer-open')).toBe(false);
    h.close(); // idempotent
  });

  it('keeps only one drawer open and fires onClose for the replaced one', () => {
    const onClose = vi.fn();
    openDrawer({ title: 'first', body: '', onClose });
    openDrawer({ title: 'second', body: '' });
    expect(document.querySelectorAll('.otr-drawer')).toHaveLength(1);
    expect(q('.otr-drawer-title')!.textContent).toBe('second');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('otr-drawer-open')).toBe(true);
  });

  it('returns focus to the trigger on close, but not when replaced', () => {
    mount('<button id="a">a</button><button id="b">b</button>');
    const a = document.getElementById('a')!, b = document.getElementById('b')!;
    a.focus();
    openDrawer({ title: 't', body: '<button id="in">x</button>' });
    expect(document.activeElement).toBe(q('.otr-drawer'));
    closeDrawer();
    expect(document.activeElement).toBe(a);

    a.focus();
    openDrawer({ title: '1', body: '' });
    b.focus();
    openDrawer({ title: '2', body: '', returnFocus: b });
    expect(document.activeElement).not.toBe(a);
    closeDrawer();
    expect(document.activeElement).toBe(b);
  });

  it('traps Tab inside the drawer', () => {
    mount('<button id="out">out</button>');
    openDrawer({ title: 't', body: '<input id="i1"><input id="i2">' });
    const i1 = document.getElementById('i1')!, i2 = document.getElementById('i2')!;
    const close = q('[data-otr-close]')!;
    close.focus();
    i2.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    // From the last focusable, Tab wraps to the first (✕ button).
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    i1.focus();
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    close.focus();
    document.dispatchEvent(back);
    expect(document.activeElement).toBe(i2);
  });

  it('setBody repaints in place', () => {
    const h = openDrawer({ title: 't', body: '<p>old</p>' });
    h.setBody('<p>new</p>');
    expect(q('.otr-drawer-body')!.textContent).toBe('new');
  });
});
