// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ==========================================================================
   The page title as the way back.

   A view with a detail screen over its own landing registers a "go home"
   callback; while one is registered the top bar draws that view's title
   ("Prepare", "Itinerary") as the control that returns to its landing, so no
   view ships its own back button. The registry lives in core/sidebar.ts and the
   top bar repaints on its event — this covers that contract from both ends.
   ========================================================================== */

import { getViewHome, setViewHome } from './sidebar.ts';

const home = (id: 'prep' | 'route') => getViewHome(id);

beforeEach(() => {
  setViewHome('prep', null);
  setViewHome('route', null);
});

describe('the view-home registry', () => {
  it('holds nothing until a view registers, and hands back what it registered', () => {
    expect(home('prep')).toBeNull();

    const back = vi.fn();
    setViewHome('prep', back);
    expect(home('prep')).toBe(back);

    home('prep')!();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('clears on null, so a landing shows a plain heading again', () => {
    setViewHome('prep', vi.fn());
    setViewHome('prep', null);
    expect(home('prep')).toBeNull();
  });

  it('keeps each view separate', () => {
    const prep = vi.fn();
    const route = vi.fn();
    setViewHome('prep', prep);
    setViewHome('route', route);

    expect(home('prep')).toBe(prep);
    expect(home('route')).toBe(route);

    setViewHome('prep', null);
    expect(home('prep')).toBeNull();
    expect(home('route')).toBe(route);
  });

  it('a second registration replaces the first rather than stacking', () => {
    const first = vi.fn();
    const second = vi.fn();
    setViewHome('prep', first);
    setViewHome('prep', second);

    home('prep')!();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('announces every change so the top bar can repaint its title', () => {
    const seen: string[] = [];
    const onHome = (e: Event) => seen.push((e as CustomEvent<{ id: string }>).detail.id);
    window.addEventListener('otr:view-home', onHome);

    setViewHome('prep', vi.fn());
    setViewHome('route', vi.fn());
    setViewHome('prep', null);

    window.removeEventListener('otr:view-home', onHome);
    expect(seen).toEqual(['prep', 'route', 'prep']);
  });
});
