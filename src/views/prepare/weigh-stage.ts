/* ==========================================================================
   On the Road · Pack · scale stage
   --------------------------------------------------------------------------
   The weigh-in, now a physical object that stands in the pack screen instead of
   a modal: a platform scale on a bench. A bag drops onto it (the deck gives and
   springs back), the glass counts up to the weight, then a luggage tag snaps
   on — PASS with a flash, or OVERWEIGHT with the scale shaking and a concrete
   suggestion of what to take out.

   Purely presentational: it is handed ready-made rows (views/pack/weigh-in.ts)
   and never reads or writes pack data. The element is built once and re-inserted
   by the caller after each re-render, so an animation survives a store push.
   Every timing lives in MOTION; reduced-motion shows the final state at once.
   ========================================================================== */

import '../../core/paper/paper.css';
import '../../core/paper/luggage.css';
import './styles/weigh-stage.css';
import { t } from '../../core/i18n.ts';
import { escHtml } from '../../core/utils.ts';
import { renderBag, renderScale, bagWidth } from '../../core/paper/luggage.ts';
import type { BagWeighIn, Verdict } from '../pack/weigh-in.ts';

/** Timings (ms) and easings — shared with the iOS port. */
export const MOTION = {
  drop: 640,
  deck: 720,
  count: 980,
  tag: 420,
  hold: 820,
  slide: 260,
  ease: 'cubic-bezier(.2,.8,.3,1)',
  spring: 'cubic-bezier(.34,1.56,.64,1)',
} as const;

export interface StageOptions {
  /** Current rows, one per bag (read fresh at the start of each bag). */
  rows: () => BagWeighIn[];
  /** Formats grams in the user's chosen unit. */
  fmt: (grams: number) => string;
  /** Short sentence about what to take out of an overweight bag, or null. */
  suggest: (bagId: string) => string | null;
  /** Whether the click/thunk sounds are on. */
  sound: () => boolean;
  /** Fires after each bag settles (the caller records the result). */
  onBag?: (row: BagWeighIn) => void;
}

export interface WeighStage {
  el: HTMLElement;
  /** Weighs these bags in order; resolves with the rows it showed. */
  run(ids: string[]): Promise<BagWeighIn[]>;
  skip(): void;
  busy(): boolean;
  /** Highlights the stage while a bag is being dragged over it. */
  setDropActive(on: boolean): void;
  setSoundLabel(): void;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function verdictLabel(v: Verdict): string {
  return v === 'pass' ? t('pack.weigh.pass') : v === 'over' ? t('pack.weigh.over') : t('pack.weigh.nolimit');
}

export function stageMarkup(): string {
  return `
    <div class="wst-head">
      <span class="wst-eyebrow">${escHtml(t('pack.scale.eyebrow'))}</span>
      <button type="button" class="wst-sound" data-wst-sound></button>
    </div>
    <div class="wst-hint" data-wst-hint>↓ ${escHtml(t('pack.scale.hint'))}</div>
    <div class="wst-floor">
      <div class="wst-bag" data-wst-bag aria-hidden="true"></div>
      <div class="wst-tag paper-tag" data-wst-tag hidden>
        <div class="paper-tag-verdict" data-wst-verdict></div>
        <div class="paper-tag-sub" data-wst-sub></div>
      </div>
      <div class="wst-flash" data-wst-flash aria-hidden="true"></div>
      <div class="wst-scale" data-wst-scale>${renderScale({ reading: '0' })}</div>
    </div>
    <div class="wst-name" data-wst-name></div>
    <div class="wst-advice" data-wst-advice aria-live="polite"></div>
    <button type="button" class="btn btn-ghost wst-skip" data-wst-skip hidden>${escHtml(t('pack.weigh.skip'))}</button>`;
}

export function createWeighStage(opts: StageOptions): WeighStage {
  const el = document.createElement('section');
  el.className = 'wst';
  el.dataset.state = 'idle';
  el.setAttribute('aria-label', t('pack.scale.eyebrow'));
  el.dataset.drop = 'scale';
  // eslint-disable-next-line no-restricted-syntax -- audited: stageMarkup() escapes its translations
  el.innerHTML = stageMarkup();

  const $ = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const bagEl = $('[data-wst-bag]');
  const tagEl = $('[data-wst-tag]');
  const verdictEl = $('[data-wst-verdict]');
  const subEl = $('[data-wst-sub]');
  const flashEl = $('[data-wst-flash]');
  const scaleEl = $('[data-wst-scale]');
  const nameEl = $('[data-wst-name]');
  const adviceEl = $('[data-wst-advice]');
  const skipBtn = $<HTMLButtonElement>('[data-wst-skip]');
  const soundBtn = $<HTMLButtonElement>('[data-wst-sound]');

  let running = false;
  let skipping = false;
  let ctx: AudioContext | null = null;

  const setSoundLabel = () => {
    soundBtn.textContent = opts.sound() ? `🔊 ${t('pack.scale.soundOn')}` : `🔇 ${t('pack.scale.soundOff')}`;
  };
  setSoundLabel();

  /** A short synthesised click — no audio files. Silent unless the user turned sound on. */
  function beep(freq: number, ms: number): void {
    if (!opts.sound()) return;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = ctx ?? new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.value = 0.07;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
      osc.stop(ctx.currentTime + ms / 1000 + 0.02);
    } catch { /* no audio: fine */ }
  }

  const wait = (ms: number) => (skipping ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms)));

  function play(target: Element, frames: Keyframe[], ms: number, easing: string): Promise<unknown> {
    if (skipping || typeof (target as HTMLElement).animate !== 'function') return Promise.resolve();
    return (target as HTMLElement).animate(frames, { duration: ms, easing, fill: 'none' }).finished.catch(() => undefined);
  }

  const led = () => scaleEl.querySelector<SVGElement>('.lg-scale');
  const ledNum = () => scaleEl.querySelector<SVGTextElement>('[data-lg="num"]');
  const ledCap = () => scaleEl.querySelector<SVGTextElement>('[data-lg="cap"]');

  function setScale(v: 'pass' | 'over' | null): void {
    const s = led();
    s?.classList.toggle('is-pass', v === 'pass');
    s?.classList.toggle('is-over', v === 'over');
  }

  function setReading(text: string): void { const n = ledNum(); if (n) n.textContent = text; }

  function showBag(row: BagWeighIn): void {
    const pct = row.limitG > 0 ? Math.min(100, (row.weightG / row.limitG) * 100) : 55;
    const w = Math.round(bagWidth(row.kind, true, row.size) * 0.9);
    bagEl.style.width = `${w}px`;
    // eslint-disable-next-line no-restricted-syntax -- audited: renderBag escapes its uid
    bagEl.innerHTML = renderBag(row.kind, { loadPct: pct, over: row.verdict === 'over', uid: `st-${row.id}`, tone: row.tone });
    bagEl.style.opacity = '1';
    nameEl.textContent = row.label;
    const cap = ledCap();
    if (cap) cap.textContent = row.limitG ? t('pack.weigh.limit', { w: opts.fmt(row.limitG) }) : t('pack.weigh.noLimitShort');
  }

  function showVerdict(row: BagWeighIn): void {
    setScale(row.verdict === 'pass' ? 'pass' : row.verdict === 'over' ? 'over' : null);
    setReading(opts.fmt(row.weightG));
    tagEl.className = `wst-tag paper-tag ${row.verdict === 'pass' ? 'paper-tag--good' : row.verdict === 'over' ? 'paper-tag--bad' : ''}`;
    verdictEl.textContent = verdictLabel(row.verdict);
    subEl.textContent = row.verdict === 'pass' ? t('pack.weigh.spare', { w: opts.fmt(row.diffG) })
      : row.verdict === 'over' ? t('pack.weigh.overBy', { w: opts.fmt(-row.diffG) }) : '';
    tagEl.hidden = false;
    const tip = row.verdict === 'over' ? opts.suggest(row.id) : null;
    adviceEl.textContent = tip ?? '';
    adviceEl.hidden = !tip;
  }

  function countTo(toG: number, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        if (skipping) { setReading(opts.fmt(toG)); resolve(); return; }
        const p = Math.max(0, Math.min(1, (now - t0) / ms));
        const eased = 1 - Math.pow(1 - p, 3);
        // the last stretch wobbles like a settling needle
        const wob = p > 0.86 ? Math.sin((p - 0.86) * 60) * toG * 0.012 * (1 - p) * 6 : 0;
        setReading(opts.fmt(Math.max(0, toG * eased + wob)));
        if (p < 1) requestAnimationFrame(step); else { setReading(opts.fmt(toG)); resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  function reset(): void {
    setScale(null);
    setReading(opts.fmt(0));
    tagEl.hidden = true;
    adviceEl.textContent = '';
    adviceEl.hidden = true;
  }

  async function weighOne(row: BagWeighIn): Promise<void> {
    reset();
    showBag(row);
    el.dataset.state = 'weighing';
    beep(220, 0.08);

    // the bag drops, bounces twice, settles; the deck gives under it
    await play(bagEl, [
      { transform: 'translateY(-200px) rotate(-5deg)', opacity: 0 },
      { transform: 'translateY(0) rotate(0)', opacity: 1, offset: 0.55 },
      { transform: 'translateY(-16px) rotate(.6deg)', offset: 0.7 },
      { transform: 'translateY(0)', offset: 0.85 },
      { transform: 'translateY(-5px)', offset: 0.93 },
      { transform: 'translateY(0)' },
    ], MOTION.drop, MOTION.ease);
    void play(scaleEl, [
      { transform: 'translateY(0) scaleY(1)' },
      { transform: 'translateY(6px) scaleY(.94)', offset: 0.22 },
      { transform: 'translateY(-3px) scaleY(1.03)', offset: 0.48 },
      { transform: 'translateY(2px) scaleY(.99)', offset: 0.7 },
      { transform: 'translateY(0) scaleY(1)' },
    ], MOTION.deck, MOTION.ease);
    await countTo(row.weightG, MOTION.count);

    showVerdict(row);
    beep(row.verdict === 'over' ? 140 : 660, 0.14);
    if (row.verdict === 'over') {
      void play(scaleEl, [
        { transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' },
        { transform: 'translateX(-4px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' },
      ], 480, 'ease-out');
      void play($('.lg-led-num'), [{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }], 520, 'steps(1, end)');
    } else if (row.verdict === 'pass') {
      void play(flashEl, [{ opacity: 0.85, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(1.5)' }], 520, 'ease-out');
    }
    // the tag snaps onto the pan, overshooting like a swung tag
    await play(tagEl, [
      { opacity: 0, transform: 'translate(16px,-26px) rotate(22deg) scale(.7)' },
      { opacity: 1, transform: 'translate(0,2px) rotate(-5deg) scale(1.04)', offset: 0.65 },
      { opacity: 1, transform: 'translate(0,0) rotate(-2.5deg) scale(1)' },
    ], MOTION.tag, MOTION.spring);
    opts.onBag?.(row);
  }

  async function run(ids: string[]): Promise<BagWeighIn[]> {
    if (running) return [];
    running = true;
    skipping = false;
    el.dataset.state = 'weighing';
    skipBtn.hidden = ids.length < 2;
    const shown: BagWeighIn[] = [];
    const reduced = prefersReducedMotion();
    try {
      for (let i = 0; i < ids.length; i++) {
        const row = opts.rows().find((r) => r.id === ids[i]);
        if (!row) continue;
        if (reduced || skipping) {
          reset(); showBag(row); showVerdict(row); opts.onBag?.(row);
        } else {
          await weighOne(row);
          if (i < ids.length - 1) {
            await wait(MOTION.hold);
            await play(bagEl, [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(46px)', opacity: 0 }], MOTION.slide, 'ease-in');
            bagEl.style.opacity = '0';
          }
        }
        shown.push(row);
      }
    } finally {
      running = false;
      skipping = false;
      skipBtn.hidden = true;
      el.dataset.state = shown.length ? 'done' : 'idle';
    }
    return shown;
  }

  skipBtn.addEventListener('click', () => { skipping = true; });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && running) { e.stopPropagation(); skipping = true; } });

  return {
    el,
    run,
    skip: () => { skipping = true; },
    busy: () => running,
    setDropActive: (on) => el.classList.toggle('is-drop-active', on),
    setSoundLabel,
  };
}
