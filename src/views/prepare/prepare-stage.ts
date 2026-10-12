/* ==========================================================================
   On the Road · Prepare — rail stages
   --------------------------------------------------------------------------
   Two small illustrated stages above the rails: sticky notes getting ticked
   off, and a case getting packed. Pure markup + a replay hook; the motion is
   CSS (styles/stage.css). They play once per visit and again on hover/focus —
   never on a loop — and reduced-motion shows the finished frame.
   ========================================================================== */

import { escHtml } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';

/** How many of the three rows are ticked, from overall checklist progress. */
export function ticksFor(done: number, total: number): number {
  if (total <= 0 || done <= 0) return 0;
  if (done >= total) return 3;
  return Math.max(1, Math.min(2, Math.round((done / total) * 3)));
}

const ROW_Y = [46, 68, 90];

export function renderNotesStage(done: number, total: number): string {
  const ticks = ticksFor(done, total);
  const complete = total > 0 && done >= total;
  const rows = ROW_Y.map((y, i) => {
    const on = i < ticks;
    const w = [118, 96, 108][i];
    return `
      <rect x="38" y="${y - 9}" width="15" height="15" rx="4" class="st-box"/>
      <rect x="62" y="${y - 4}" width="${w}" height="5" rx="2.5" class="st-line${on ? ' is-done' : ''}"/>
      ${on ? `<path d="M40.5 ${y - 1.5} l4.2 4.6 l8.2 -10" class="st-tick" style="--d:${0.45 + i * 0.6}s" pathLength="24"/>` : ''}`;
  }).join('');
  return `
    <div class="prep-stage prep-stage--notes" data-stage="notes" aria-hidden="true">
      <svg viewBox="0 0 240 120" role="presentation">
        <g class="st-note st-note--back"><rect x="58" y="16" width="148" height="92" rx="4"/></g>
        <g class="st-note st-note--front">
          <rect x="22" y="22" width="168" height="90" rx="4" class="st-paper"/>
          <rect x="88" y="14" width="40" height="14" rx="2" class="st-tape"/>
          ${rows}
        </g>
      </svg>
      ${complete ? `<span class="paper-stamp paper-stamp--good prep-stage-stamp">${escHtml(t('prep.stageReady'))}</span>` : ''}
    </div>`;
}

export function renderPackStage(items: number): string {
  const loaded = items > 0;
  return `
    <div class="prep-stage prep-stage--pack${loaded ? '' : ' is-empty'}" data-stage="pack" aria-hidden="true">
      <svg viewBox="0 0 240 120" role="presentation">
        <ellipse cx="120" cy="108" rx="82" ry="6" class="st-shadow"/>
        <g class="st-case">
          <rect x="52" y="48" width="136" height="56" rx="8" class="st-case-back"/>
          <g class="st-drops">
            <text x="86" y="60" class="st-drop" style="--i:0">👕</text>
            <text x="116" y="60" class="st-drop" style="--i:1">🧴</text>
            <text x="146" y="60" class="st-drop" style="--i:2">📷</text>
          </g>
          <path d="M52 66 H188 V96 a8 8 0 0 1 -8 8 H60 a8 8 0 0 1 -8 -8 Z" class="st-case-front"/>
          <line x1="52" y1="66" x2="188" y2="66" class="st-seam"/>
          <rect x="74" y="74" width="4" height="22" rx="2" class="st-strap"/>
          <rect x="162" y="74" width="4" height="22" rx="2" class="st-strap"/>
          <g class="st-lid">
            <rect x="52" y="40" width="136" height="12" rx="6" class="st-case-lid"/>
            <path d="M104 40 v-8 a6 6 0 0 1 6 -6 h20 a6 6 0 0 1 6 6 v8" class="st-handle"/>
          </g>
          <rect x="114" y="62" width="12" height="9" rx="2" class="st-clasp"/>
        </g>
      </svg>
    </div>`;
}

/** Replay a stage's motion (hover / focus / tap). */
export function bindStages(host: HTMLElement): void {
  host.querySelectorAll<HTMLElement>('[data-stage]').forEach((el) => {
    const replay = () => {
      el.classList.remove('is-playing', 'is-still');
      void el.offsetWidth;                 // restart the CSS animations
      el.classList.add('is-playing');
    };
    el.addEventListener('mouseenter', replay);
    el.addEventListener('click', replay);
  });
}

const played = new Set<string>();

/** Forget what has played (a fresh visit to the page plays them again). */
export function resetStages(): void { played.clear(); }

/** Play each stage the first time it scrolls into view; the notes stage also plays when
 *  tick progress moved. Every other repaint leaves them at the finished frame. */
export function playStages(host: HTMLElement, notesChanged: boolean): void {
  host.querySelectorAll<HTMLElement>('[data-stage]').forEach((el) => {
    const kind = el.dataset.stage!;
    el.classList.add('is-still');
    if (played.has(kind) && !(kind === 'notes' && notesChanged)) return;
    const go = () => { played.add(kind); el.classList.remove('is-still'); el.classList.add('is-playing'); };
    if (typeof IntersectionObserver === 'undefined') { go(); return; }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); }
    }, { threshold: 0.6 });
    io.observe(el);
  });
}
