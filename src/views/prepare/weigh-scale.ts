/* ==========================================================================
   On the Road · Pack · luggage scale
   --------------------------------------------------------------------------
   The weigh-in animation. Each bag drops onto a platform scale, the readout
   counts up to its weight, then a luggage tag swings out: PASS if it is within
   its limit, OVERWEIGHT (with the scale shaking) if not.

   Purely presentational — it is handed ready-made rows (views/pack/weigh-in.ts)
   and never reads or writes pack data.

   Two modes:
     · 'all'  a modal weighing every bag in turn; "Skip" jumps to the summary.
     · 'one'  a small non-blocking card in the corner for the bag you just
              edited; closes itself a moment after the verdict.
   With prefers-reduced-motion nothing moves: the final tags and numbers are
   shown straight away.
   ========================================================================== */

import '../../core/paper/paper.css';
import './styles/weigh-scale.css';
import { t } from '../../core/i18n.ts';
import { escHtml } from '../../core/utils.ts';
import { bagIcon, GLYPH } from '../../core/icons.ts';
import { weighSummary, type BagWeighIn, type Verdict } from '../pack/weigh-in.ts';

export interface WeighOptions {
  rows: BagWeighIn[];
  /** Formats grams in the user's chosen weight unit. */
  fmt: (grams: number) => string;
  mode: 'all' | 'one';
  returnFocus?: HTMLElement | null;
}

const TOAST_HOLD_MS = 2400;

let current: { close: () => void } | null = null;

export function closeWeighIn(): void {
  current?.close();
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function verdictLabel(v: Verdict): string {
  return v === 'pass' ? t('pack.weigh.pass') : v === 'over' ? t('pack.weigh.over') : t('pack.weigh.nolimit');
}

function verdictSub(row: BagWeighIn, fmt: (g: number) => string): string {
  if (row.verdict === 'pass') return t('pack.weigh.spare', { w: fmt(row.diffG) });
  if (row.verdict === 'over') return t('pack.weigh.overBy', { w: fmt(-row.diffG) });
  return '';
}

export function openWeighIn(opts: WeighOptions): void {
  const { rows, fmt, mode } = opts;
  if (!rows.length) return;
  closeWeighIn();

  const reduced = prefersReducedMotion();
  const root = document.createElement('div');
  root.className = `ws-overlay ws-overlay--${mode === 'all' ? 'modal' : 'toast'}`;
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml
  root.innerHTML = `
    <div class="ws-card" data-verdict="none" role="${mode === 'all' ? 'dialog' : 'status'}" ${mode === 'all' ? 'aria-modal="true"' : ''} aria-label="${escHtml(t('pack.weigh.title'))}">
      <button type="button" class="ws-close" aria-label="${escHtml(t('pack.weigh.close'))}">${GLYPH.close}</button>
      <div class="ws-title">⚖️ ${escHtml(t('pack.weigh.title'))}</div>
      <div class="ws-stage">
        <div class="ws-bag" aria-hidden="true"></div>
        <div class="ws-scale">
          <div class="ws-plate"></div>
          <div class="ws-base">
            <div class="ws-readout paper-led">
              <div class="ws-num paper-led-num">${escHtml(fmt(0))}</div>
              <div class="ws-limit paper-led-aux"></div>
            </div>
          </div>
        </div>
        <div class="ws-tag paper-tag" hidden>
          <div class="ws-tag-verdict paper-tag-verdict"></div>
          <div class="ws-tag-sub paper-tag-sub"></div>
        </div>
      </div>
      <div class="ws-name"></div>
      ${mode === 'all' ? '<div class="ws-shelf"></div>' : ''}
      <div class="ws-summary"></div>
      <div class="ws-live" aria-live="polite"></div>
      ${mode === 'all' ? `<div class="ws-actions"><button type="button" class="btn btn-ghost ws-skip">${escHtml(t('pack.weigh.skip'))}</button></div>` : ''}
    </div>`;
  document.body.appendChild(root);

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const card = $('.ws-card');
  const bag = $('.ws-bag');
  const plate = $('.ws-plate');
  const readout = $('.ws-readout');
  const num = $('.ws-num');
  const limit = $('.ws-limit');
  const tag = $('.ws-tag');
  const tagVerdict = $('.ws-tag-verdict');
  const tagSub = $('.ws-tag-sub');
  const nameEl = $('.ws-name');
  const summary = $('.ws-summary');
  const live = $('.ws-live');
  const shelf = root.querySelector<HTMLElement>('.ws-shelf');
  const skipBtn = root.querySelector<HTMLButtonElement>('.ws-skip');

  let alive = true;
  let skipping = false;
  let autoCloseTimer = 0;

  const close = () => {
    if (!alive) return;
    alive = false;
    clearTimeout(autoCloseTimer);
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    if (current?.close === close) current = null;
    opts.returnFocus?.focus?.();
  };
  current = { close };

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }
  document.addEventListener('keydown', onKey, true);
  $('.ws-close').addEventListener('click', close);
  if (mode === 'all') root.addEventListener('click', (e) => { if (e.target === root) close(); });
  if (mode === 'one') card.addEventListener('click', close);

  /* ── helpers ─────────────────────────────────────────────────────────── */

  const wait = (ms: number) => (skipping || !alive ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms)));

  function play(el: HTMLElement, frames: Keyframe[], ms: number, easing = 'ease-out'): Promise<unknown> {
    if (skipping || !alive || typeof el.animate !== 'function') return Promise.resolve();
    return el.animate(frames, { duration: ms, easing, fill: 'none' }).finished.catch(() => undefined);
  }

  function countTo(toG: number, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        if (!alive || skipping) { num.textContent = fmt(toG); resolve(); return; }
        const p = Math.max(0, Math.min(1, (now - t0) / ms)); // rAF's timestamp can precede t0
        num.textContent = fmt(toG * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  function showBag(row: BagWeighIn): void {
    bag.textContent = bagIcon(row.kind);
    nameEl.textContent = row.label;
    limit.textContent = row.limitG ? t('pack.weigh.limit', { w: fmt(row.limitG) }) : t('pack.weigh.noLimitShort');
  }

  /** Colours the tag and the LED for a verdict (kit tones: good / bad / neutral). */
  function setTone(v: Verdict | 'none'): void {
    card.dataset.verdict = v;
    tag.classList.toggle('paper-tag--good', v === 'pass');
    tag.classList.toggle('paper-tag--bad', v === 'over');
    readout.classList.toggle('is-good', v === 'pass');
    readout.classList.toggle('is-bad', v === 'over');
  }

  function showVerdict(row: BagWeighIn): void {
    setTone(row.verdict);
    num.textContent = fmt(row.weightG);
    tagVerdict.textContent = verdictLabel(row.verdict);
    tagSub.textContent = verdictSub(row, fmt);
    tag.hidden = false;
    live.textContent = `${row.label}: ${verdictLabel(row.verdict)} ${verdictSub(row, fmt)}`.trim();
  }

  function addChip(row: BagWeighIn): void {
    if (!shelf) return;
    const mark = row.verdict === 'pass' ? GLYPH.check : row.verdict === 'over' ? '▲' : '·';
    const chip = document.createElement('span');
    chip.className = 'ws-chip';
    chip.dataset.verdict = row.verdict;
    chip.textContent = `${bagIcon(row.kind)} ${row.label} ${fmt(row.weightG)} ${mark}`;
    shelf.appendChild(chip);
  }

  function showSummary(): void {
    if (mode !== 'all') return;
    const s = weighSummary(rows);
    summary.textContent = t('pack.weigh.summary', { n: s.total, ok: s.pass, bad: s.over });
    if (skipBtn) {
      skipBtn.textContent = t('pack.weigh.done');
      skipBtn.classList.remove('btn-ghost');
      skipBtn.classList.add('btn-primary');
      skipBtn.focus();
    }
  }

  /* ── one bag ─────────────────────────────────────────────────────────── */

  async function weighOne(row: BagWeighIn): Promise<void> {
    showBag(row);
    setTone('none');
    tag.hidden = true;
    num.textContent = fmt(0);

    // drop onto the platform
    bag.style.opacity = '1';
    await play(bag, [
      { transform: 'translateY(-112px)', opacity: 0 },
      { transform: 'translateY(0)', opacity: 1, offset: 0.7 },
      { transform: 'translateY(-9px)', offset: 0.85 },
      { transform: 'translateY(0)' },
    ], 560, 'cubic-bezier(.4,0,.8,.6)');
    // platform gives under the weight
    void play(plate, [{ transform: 'translateY(0)' }, { transform: 'translateY(5px)' }, { transform: 'translateY(2px)' }], 380);
    await countTo(row.weightG, 760);
    if (!alive) return;

    showVerdict(row);
    if (row.verdict === 'over') {
      void play(readout, [{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }], 520, 'steps(1, end)');
      void play(plate, [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], 460);
    } else {
      void play(readout, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], 360);
    }
    await play(tag, [
      { transform: 'rotate(-26deg)', opacity: 0 },
      { transform: 'rotate(9deg)', opacity: 1, offset: 0.55 },
      { transform: 'rotate(-4deg)', offset: 0.8 },
      { transform: 'rotate(0)' },
    ], 640, 'ease-out');
  }

  /* ── sequence ────────────────────────────────────────────────────────── */

  async function run(): Promise<void> {
    if (reduced) {
      // No motion: show every bag's result at once.
      if (mode === 'all') {
        rows.forEach(addChip);
        const last = rows[rows.length - 1];
        showBag(last);
        showVerdict(last);
        showSummary();
      } else {
        showBag(rows[0]);
        showVerdict(rows[0]);
        autoCloseTimer = window.setTimeout(close, TOAST_HOLD_MS + 1500);
      }
      return;
    }

    if (skipBtn) skipBtn.addEventListener('click', () => {
      if (!skipping && alive && skipBtn.classList.contains('btn-ghost')) { skipping = true; return; }
      close();
    });

    for (let i = 0; i < rows.length && alive; i++) {
      const row = rows[i];
      if (skipping) { showBag(row); showVerdict(row); addChip(row); continue; }
      await weighOne(row);
      if (!alive) return;
      await wait(mode === 'all' ? 750 : TOAST_HOLD_MS);
      if (!alive) return;
      addChip(row);
      if (i < rows.length - 1 && !skipping) {
        await play(bag, [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(46px)', opacity: 0 }], 240, 'ease-in');
        bag.style.opacity = '0';
        tag.hidden = true;
        await wait(120);
      }
    }
    if (!alive) return;
    skipping = false;
    if (mode === 'all') showSummary();
    else autoCloseTimer = window.setTimeout(close, 200);
  }

  void run();
}
