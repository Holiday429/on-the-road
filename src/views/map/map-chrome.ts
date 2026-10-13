/* ==========================================================================
   On the Road · Route page — chrome wiring
   --------------------------------------------------------------------------
   The two small controls around the route map that are not part of the chart:
   the corner globe (a doorway into the Atlas) and the switch that puts the
   floating stop list away (remembered between visits). Listeners are tied to the
   chart's `signal`, so a rebuild never stacks them.
   ========================================================================== */

import { mapColors as C } from './map-theme.ts';
import type { Am5Obj } from './map-amcharts.ts';

const KEY = 'otr:map:panelHidden';

/**
 * A stop's pin, drawn as a postmark: a perforated outer ring round a solid disc
 * numbered in white — or round a hollow, dashed one while the stop is still ahead.
 */
export function postmarkPin(bRoot: Am5Obj, n: number, planned: boolean): Am5Obj {
  const route = am5.color(C().route);
  const c = am5.Container.new(bRoot, { opacity: planned ? 0.8 : 1 });
  c.children.push(am5.Circle.new(bRoot, { radius: 13, strokeWidth: 1.3, strokeDasharray: [2, 2], stroke: route }));
  c.children.push(am5.Circle.new(bRoot, planned
    ? { radius: 9, fill: am5.color(C().land), stroke: route, strokeWidth: 1.6, strokeDasharray: [3, 2] }
    : { radius: 9, fill: route }));
  c.children.push(am5.Label.new(bRoot, {
    text: String(n), centerX: am5.p50, centerY: am5.p50, fontSize: 10, fontWeight: '700',
    fill: planned ? route : am5.color('#fff'), populateText: false,
  }));
  return c;
}

/** Recolour a pin built by postmarkPin after a theme change. */
export function repaintPostmarkPin(sprite: Am5Obj, planned: boolean): void {
  const route = am5.color(C().route);
  sprite?.children.getIndex(0)?.set('stroke', route);
  const disc = sprite?.children.getIndex(1);
  if (planned) { disc?.set('fill', am5.color(C().land)); disc?.set('stroke', route); } else disc?.set('fill', route);
  if (planned) sprite?.children.getIndex(2)?.set('fill', route);
}

export function wireRouteChrome(host: HTMLElement | null, signal: AbortSignal): void {
  if (!host) return;
  host.querySelector('#mapPortal')?.addEventListener('click', () => {
    void import('../../core/app.ts').then(({ navigateTo }) => navigateTo('atlas'));
  }, { signal });

  const layout = host.querySelector<HTMLElement>('.map-layout');
  const toggle = host.querySelector<HTMLElement>('#mapPanelToggle');
  if (!layout || !toggle) return;
  try { if (localStorage.getItem(KEY) === '1') layout.classList.add('panel-collapsed'); } catch { /* default: shown */ }
  toggle.setAttribute('aria-pressed', String(!layout.classList.contains('panel-collapsed')));
  toggle.addEventListener('click', () => {
    const hidden = layout.classList.toggle('panel-collapsed');
    toggle.setAttribute('aria-pressed', String(!hidden));
    try { localStorage.setItem(KEY, hidden ? '1' : '0'); } catch { /* not remembered */ }
  }, { signal });
}
