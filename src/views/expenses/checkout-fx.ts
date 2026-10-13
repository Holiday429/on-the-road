/* ==========================================================================
   On the Road · Expenses · checkout motion
   --------------------------------------------------------------------------
   The till's moving parts, kept out of the markup module: the display typing
   its line, the odometer rolling the total, the scan window (label sliding
   past a laser), the optional beep. Everything here is a no-op or an instant
   jump under prefers-reduced-motion.
   ========================================================================== */

import { odoMarkup } from './checkout.ts';

const BEEP_KEY = 'otr:expenses:beep';

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ── Beep (off by default, remembered per device) ────────────────────────── */

export function beepEnabled(): boolean {
  try { return localStorage.getItem(BEEP_KEY) === '1'; } catch { return false; }
}
export function setBeepEnabled(on: boolean): void {
  try { localStorage.setItem(BEEP_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
}

let audio: AudioContext | null = null;
/** A 60 ms square-wave blip, synthesised — no audio file. */
export function beep(): void {
  if (!beepEnabled()) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audio ??= new AC();
    const o = audio.createOscillator();
    const g = audio.createGain();
    const now = audio.currentTime;
    o.type = 'square';
    o.frequency.value = 1800;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.08, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    o.stop(now + 0.07);
  } catch { /* no audio */ }
}

/* ── Display line ────────────────────────────────────────────────────────── */

let typer: number | undefined;

/** Long lines drift back and forth once typed, instead of being cut off. */
function fitMarquee(el: HTMLElement): void {
  const box = el.parentElement;
  if (!box) return;
  const over = el.scrollWidth - box.clientWidth + 28;
  el.classList.toggle('is-marquee', over > 0);
  if (over > 0) el.style.setProperty('--mq', `-${over}px`);
}

/** Show `text` on display line 1, typed out one dot-matrix step at a time. */
export function showLine(el: HTMLElement | null, text: string, animate = true): void {
  if (!el) return;
  window.clearInterval(typer);
  el.classList.remove('is-marquee');
  const chars = [...text];
  if (!animate || reducedMotion()) { el.textContent = text; fitMarquee(el); return; }
  let n = 0;
  el.textContent = '';
  typer = window.setInterval(() => {
    n = Math.min(chars.length, n + 2);
    el.textContent = chars.slice(0, n).join('');
    if (n >= chars.length) { window.clearInterval(typer); fitMarquee(el); }
  }, 34);
}

/* ── Odometer ────────────────────────────────────────────────────────────── */

/** Roll the total from `from` to `to`. Same digit count → each strip slides; otherwise it just redraws. */
export function rollOdometer(el: HTMLElement | null, from: number, to: number): void {
  if (!el) return;
  const fromDigits = odoMarkup(from).match(/odo-digit/g)?.length ?? 0;
  const toDigits = odoMarkup(to).match(/odo-digit/g)?.length ?? 0;
  el.dataset.total = String(Math.round(to));
  // eslint-disable-next-line no-restricted-syntax -- audited: odoMarkup only emits digits and escaped separators
  if (reducedMotion() || from === to || fromDigits !== toDigits) { el.innerHTML = odoMarkup(to); return; }
  // eslint-disable-next-line no-restricted-syntax -- audited: as above
  el.innerHTML = odoMarkup(from);
  void el.offsetWidth;
  const next = [...Math.round(to).toLocaleString('en-US')].filter((c) => c >= '0' && c <= '9');
  el.querySelectorAll<HTMLElement>('.odo-strip').forEach((strip, i) => { strip.style.transform = `translateY(-${next[i]}em)`; });
}

/* ── Scan window ─────────────────────────────────────────────────────────── */

export interface ScanItem { icon: string; label: string; amount: string }

/** Slide the product label across the scan window under a laser sweep. Resolves when it has left. */
export function playScan(win: HTMLElement | null, item: ScanItem, ms = 1100): Promise<void> {
  if (!win || reducedMotion()) return Promise.resolve();
  const tag = document.createElement('div');
  tag.className = 'ck-ptag';
  tag.style.animationDuration = `${ms}ms`;
  const parts: [string, string][] = [['ck-ptag-emoji', item.icon], ['ck-ptag-desc', item.label], ['ck-ptag-amt', item.amount]];
  for (const [cls, text] of parts) {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    tag.appendChild(span);
  }
  tag.appendChild(Object.assign(document.createElement('span'), { className: 'ck-ptag-code' }));
  const laser = Object.assign(document.createElement('div'), { className: 'ck-laser' });
  const flash = Object.assign(document.createElement('div'), { className: 'ck-flash' });
  win.append(tag, laser, flash);
  return new Promise((resolve) => {
    window.setTimeout(() => { tag.remove(); laser.remove(); flash.remove(); resolve(); }, ms);
  });
}

/** Re-trigger a one-shot CSS animation class on `el`. */
export function pulse(el: Element | null, cls: string): void {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/* ── Soft-key strip ──────────────────────────────────────────────────────── */

/** The category keys scroll sideways in one fixed-height row; ‹ › page it and go dim at the ends. */
export function bindKeyPager(root: HTMLElement): void {
  const strip = root.querySelector<HTMLElement>('#exp-cat-chips');
  const prev = root.querySelector<HTMLButtonElement>('#exp-keys-prev');
  const next = root.querySelector<HTMLButtonElement>('#exp-keys-next');
  if (!strip || !prev || !next) return;
  const sync = () => {
    prev.disabled = strip.scrollLeft <= 2;
    next.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
  };
  const page = (dir: number) => strip.scrollBy({ left: dir * strip.clientWidth * 0.85, behavior: reducedMotion() ? 'auto' : 'smooth' });
  prev.addEventListener('click', () => page(-1));
  next.addEventListener('click', () => page(1));
  strip.addEventListener('scroll', sync, { passive: true });
  // Bring the engaged key into view, then settle the arrows once layout is known.
  requestAnimationFrame(() => {
    const on = strip.querySelector<HTMLElement>('.ck-key.is-on');
    if (on) strip.scrollLeft = Math.max(0, on.offsetLeft - strip.clientWidth / 2 + on.offsetWidth / 2);
    sync();
  });
}
