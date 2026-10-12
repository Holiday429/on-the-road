/* ==========================================================================
   On the Road · Map — timeline scrubber
   --------------------------------------------------------------------------
   The date slider under the "all footprints" map: drag, arrow keys or play to
   sweep a cursor through time. It owns only the control itself (DOM, pointer
   wiring, the play ticker); what the cursor *means* for the map is the
   caller's `reveal(cursorMs)`. Everything it listens to is torn down by
   `destroy()`.
   ========================================================================== */

import { t, getLocale } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { prefersReducedMotion } from './amcharts-boot.ts';
import { type TimeRange, fmtScrubDate, fractionToMs } from './map-timeline.ts';

export interface ScrubberHooks {
  /** The cursor moved to this epoch-ms; update the map to match. */
  reveal: (cursorMs: number) => void;
  /** The user took over (drag / play) — stop any other animation. */
  onTakeover: () => void;
}

export interface Scrubber {
  /** Stop playing without moving the cursor. */
  stop: () => void;
  /** Remove the control and every listener/timer it owns. */
  destroy: () => void;
}

/** Mount the scrubber into `slot`, starting fully revealed. */
export function mountScrubber(slot: HTMLElement, range: TimeRange, hooks: ScrubberHooks): Scrubber {
  const el = document.createElement('div');
  el.className = 'map-timeline';
  el.id = 'mapTimeline';
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  el.innerHTML = `
    <button class="map-timeline-play" title="${esc(t('map.timeline.play'))}">▶</button>
    <div class="map-timeline-track">
      <div class="map-timeline-fill"></div>
      <div class="map-timeline-handle" role="slider" aria-label="${esc(t('map.timeline.label'))}" tabindex="0"></div>
    </div>
    <span class="map-timeline-date"></span>`;
  slot.appendChild(el);

  const track = el.querySelector<HTMLElement>('.map-timeline-track')!;
  const fillEl = el.querySelector<HTMLElement>('.map-timeline-fill')!;
  const handle = el.querySelector<HTMLElement>('.map-timeline-handle')!;
  const dateEl = el.querySelector<HTMLElement>('.map-timeline-date')!;
  const playBtn = el.querySelector<HTMLButtonElement>('.map-timeline-play')!;

  let fraction = 1;
  let timer: number | null = null;
  let drag: AbortController | null = null;

  const set = (f: number) => {
    fraction = Math.min(1, Math.max(0, f));
    const pct = `${(fraction * 100).toFixed(2)}%`;
    fillEl.style.width = pct;
    handle.style.left = pct;
    const ms = fractionToMs(fraction, range);
    dateEl.textContent = fmtScrubDate(ms, getLocale());
    hooks.reveal(ms);
  };

  const stop = () => {
    if (timer) { clearInterval(timer); timer = null; }
    playBtn.textContent = '▶';
  };

  const play = () => {
    if (prefersReducedMotion()) { set(1); return; }   // no animated sweep
    hooks.onTakeover();
    stop();
    set(0);
    playBtn.textContent = '⏸';
    const STEP = 0.018, INTERVAL = 80;
    let f = 0;
    timer = window.setInterval(() => {
      f += STEP;
      if (f >= 1) { set(1); stop(); return; }
      set(f);
    }, INTERVAL);
  };

  const fractionAt = (clientX: number) => {
    const rect = track.getBoundingClientRect();
    return (clientX - rect.left) / rect.width;
  };

  const endDrag = () => { drag?.abort(); drag = null; };
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stop();
    endDrag();
    drag = new AbortController();
    set(fractionAt(e.clientX));
    window.addEventListener('pointermove', (m) => set(fractionAt(m.clientX)), { signal: drag.signal });
    window.addEventListener('pointerup', endDrag, { signal: drag.signal });
  });
  handle.addEventListener('keydown', (e) => {
    const step = 1 / 40;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); set(fraction - step); }
    if (e.key === 'ArrowRight') { e.preventDefault(); set(fraction + step); }
  });
  playBtn.addEventListener('click', () => { if (timer) stop(); else play(); });

  set(1);   // start fully revealed, matching the default lit state

  return {
    stop,
    destroy() { stop(); endDrag(); el.remove(); },
  };
}
