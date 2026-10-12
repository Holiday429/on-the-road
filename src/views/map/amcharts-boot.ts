/* ==========================================================================
   On the Road · amCharts boot helpers
   --------------------------------------------------------------------------
   The bits every amCharts map in the app repeats: wait for the container to
   have a size, create a Root with the logo removed, and decide whether motion
   is allowed. The Map page and the Dashboard thumbnail both start here; the
   library itself still comes from the CDN via amcharts-loader.ts.
   ========================================================================== */

import type { Am5Obj } from './map-amcharts.ts';

/** True when the user asked the OS for less motion. Read at use time, not cached. */
export function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

/** A duration that collapses to 0 under reduced motion. */
export function motionMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

/** Resolve once `el` has a non-zero width (it may be laid out after we run). */
export function waitForSize(el: HTMLElement): Promise<void> {
  if (el.clientWidth > 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) { ro.disconnect(); resolve(); }
    });
    ro.observe(el);
  });
}

/**
 * Create an amCharts Root on `container` (an element or its id). The Animated
 * theme is added only when `animated` is set and motion is allowed — under
 * reduced motion amCharts' default state transitions are left out entirely.
 */
export function createMapRoot(
  container: string | HTMLElement,
  { animated = true }: { animated?: boolean } = {},
): Am5Obj {
  const root = am5.Root.new(container);
  if (animated && !prefersReducedMotion()) root.setThemes([am5themes_Animated.new(root)]);
  if (root._logo) root._logo.dispose();
  return root;
}

/** Dispose a Root, swallowing the error amCharts throws if it is already gone. */
export function disposeRoot(root: Am5Obj | null): void {
  if (!root) return;
  try { root.dispose(); } catch { /* already disposed */ }
}
