/* ==========================================================================
   On the Road · Journal letter — the two bits of motion
   --------------------------------------------------------------------------
   Opening: the envelope's flap lifts, the letter is drawn up out of it, the
   postcards slide out after it. Played once, when an entry is opened from the
   Feed / Calendar / Places — never when turning with ‹ ›.

   Posting (saving): the letter folds in three, the postcards gather into a
   pile, both slide into the envelope, the flap closes, the postmark is struck,
   and the envelope sails off. The write to the database starts at the same
   moment and does not wait for any of this; if it fails the whole thing is
   cancelled and the page is exactly as it was.

   All timings live in LETTER_MOTION so the two stay in step and the schedule
   can be tested (openSchedule / postSchedule are pure). The playing itself is
   the Web Animations API on the live DOM; under "reduce motion", or where the
   API is missing (jsdom), nothing plays and the caller carries straight on.
   ========================================================================== */

export const LETTER_MOTION = {
  open: {
    envelope: { at: 0, ms: 240 },
    flap: { at: 0, ms: 260 },
    paper: { at: 160, ms: 420 },
    cardsAt: 300, cardStagger: 50, cardStaggerMax: 4, cardMs: 350,
  },
  post: {
    /** The paper is folded from its top this many px at most, however long the letter. */
    foldMaxHeight: 540,
    foldLower: { at: 0, ms: 300 },
    foldUpper: { at: 260, ms: 300 },
    gatherAt: 80, gatherStagger: 40, gatherStaggerMax: 5, gatherMs: 380,
    slide: { at: 540, ms: 420 },
    flap: { at: 960, ms: 300 },
    stamp: { at: 1260, ms: 260 },
    /** A beat between the postmark landing and the envelope leaving. */
    flyGap: 80, flyMs: 420, overlayFadeMs: 300,
  },
} as const;

export interface Phase { at: number; ms: number }

/** When each part of the opening plays, ms from the start (pure). */
export function openSchedule(cardCount: number, m = LETTER_MOTION.open) {
  const cards: Phase[] = Array.from({ length: cardCount }, (_, i) => ({
    at: m.cardsAt + Math.min(i, m.cardStaggerMax) * m.cardStagger, ms: m.cardMs,
  }));
  const end = Math.max(m.envelope.at + m.envelope.ms, m.flap.at + m.flap.ms, m.paper.at + m.paper.ms, ...cards.map((c) => c.at + c.ms));
  return { envelope: m.envelope, flap: m.flap, paper: m.paper, cards, end };
}

/** When each part of the posting plays, ms from the start (pure). `sealed` is when the postmark has landed. */
export function postSchedule(cardCount: number, m = LETTER_MOTION.post) {
  const gather: Phase[] = Array.from({ length: cardCount }, (_, i) => ({
    at: m.gatherAt + Math.min(i, m.gatherStaggerMax) * m.gatherStagger, ms: m.gatherMs,
  }));
  const sealed = m.stamp.at + m.stamp.ms;
  const flyAt = sealed + m.flyGap;
  return {
    foldLower: m.foldLower, foldUpper: m.foldUpper, gather, slide: m.slide, flap: m.flap, stamp: m.stamp,
    sealed, flyAt, end: flyAt + m.flyMs,
  };
}

/* ── Playing ─────────────────────────────────────────────────────────────── */

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const canAnimate = (el: Element | null): el is HTMLElement => !!el && typeof (el as HTMLElement).animate === 'function';

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.5, 0, 0.3, 1)';

/**
 * Open the envelope. The scene is already drawn in its final state; each part
 * starts from where it was "inside" and eases to where it already is, so there
 * is nothing to undo afterwards.
 */
export function playOpen(scene: HTMLElement | null): void {
  if (reduced() || !canAnimate(scene)) return;
  const m = LETTER_MOTION.open;
  const sched = openSchedule(scene.querySelectorAll('.ltr-pc').length);
  const play = (el: Element | null, frames: Keyframe[], at: number, ms: number) =>
    el && canAnimate(el) ? el.animate(frames, { duration: ms, delay: at, easing: EASE_OUT, fill: 'backwards' }) : null;

  play(scene.querySelector('.ltr-env'), [{ translate: '0 -14px', opacity: 0 }, { translate: '0 0', opacity: 1 }], m.envelope.at, m.envelope.ms);
  // Closed flap = the open one flipped down over the envelope's front.
  play(scene.querySelector('.ltr-env-flap'), [{ transform: 'scaleY(-1)' }, { transform: 'scaleY(1)' }], m.flap.at, m.flap.ms);
  play(scene.querySelector('.ltr-paper'), [{ translate: '0 -90px', opacity: 0 }, { translate: '0 0', opacity: 1 }], m.paper.at, m.paper.ms);
  scene.querySelectorAll('.ltr-pc').forEach((card, i) => {
    play(card, [{ translate: '-240px -70px', scale: '0.6', opacity: 0 }, { translate: '0 0', scale: '1', opacity: 1 }], sched.cards[i].at, sched.cards[i].ms);
  });
}

export interface Post {
  /** Resolves when the postmark has landed (the envelope is sealed). */
  sealed: Promise<void>;
  /** Sails the envelope off and fades the desk; resolves when it has gone. */
  fly(): Promise<void>;
  /** Undo everything: the page is as it was before posting began. */
  cancel(): void;
}

function div(cls: string, css = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.className = cls;
  if (css) el.style.cssText = css;
  return el;
}

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/**
 * Start posting the letter being written. `scene` is the `.ltr--write` article.
 * Returns null when nothing should play (reduce motion, no Web Animations, or
 * the scene is not as expected) — the caller then simply saves and closes.
 */
export function startPost(scene: HTMLElement | null): Post | null {
  return gatherIntoEnvelope(scene);
}

/**
 * Put the letter away: fold the paper, gather the postcards, slide both into
 * the envelope and close its flap.
 *
 * Shared by posting a letter being written (`startPost`) and closing one being
 * read (`playClose`) — the same desk, the same motion; only what happens after
 * the flap shuts differs, which is the caller's business.
 */
function gatherIntoEnvelope(scene: HTMLElement | null, strike = true): Post | null {
  if (reduced() || !canAnimate(scene)) return null;
  const stage = scene.querySelector<HTMLElement>('.ltr-scene');
  const paper = stage?.querySelector<HTMLElement>(':scope > .ltr-paper');
  const env = stage?.querySelector<HTMLElement>('.ltr-env');
  const envBody = env?.querySelector<HTMLElement>('.ltr-env-body');
  const flap = env?.querySelector<HTMLElement>('.ltr-env-flap');
  const slot = stage?.querySelector<HTMLElement>('.ltr-fold-slot');
  const scroller = scene.querySelector<HTMLElement>('.ltr-scroll');
  if (!stage || !paper || !env || !envBody || !flap || !slot || !scroller) return null;

  // Fold the top of the letter, where the eye already is.
  scroller.scrollTop = 0;
  const m = LETTER_MOTION.post;
  const sched = postSchedule(stage.querySelectorAll('.ltr-pc:not(.ltr-pc-slot)').length);
  const S = stage.getBoundingClientRect();
  const P = paper.getBoundingClientRect();
  const E = envBody.getBoundingClientRect();
  const W = Math.round(P.width);
  const H = Math.round(Math.min(P.height, m.foldMaxHeight));
  const h1 = Math.round(H / 3);
  const h2 = Math.round(H / 3);
  const h3 = H - h1 - h2;

  // The paper as it is now, duplicated: the real one is hidden while the copy folds.
  const copy = paper.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  copy.querySelectorAll('[name]').forEach((n) => n.removeAttribute('name'));
  const live = paper.querySelector<HTMLTextAreaElement>('textarea');
  const dup = copy.querySelector<HTMLTextAreaElement>('textarea');
  if (live && dup) { dup.value = live.value; dup.style.height = `${live.offsetHeight}px`; }
  copy.querySelectorAll<HTMLElement>('input, textarea, select, button, summary').forEach((n) => { n.tabIndex = -1; });
  copy.setAttribute('aria-hidden', 'true');

  const face = (offset: number, h: number, back: boolean) => {
    const f = div(`ltr-fold-face${back ? ' is-back' : ''}`, `width:${W}px;height:${h}px`);
    if (!back) {
      const c = copy.cloneNode(true) as HTMLElement;
      c.style.cssText = `position:absolute;left:0;top:${-offset}px;width:${W}px;height:${Math.round(P.height)}px;margin:0;translate:none;opacity:1;visibility:visible`;
      f.append(c);
    }
    return f;
  };
  const wrap = (top: number, h: number, offset: number) => {
    const w = div('ltr-fold-part', `top:${top}px;width:${W}px;height:${h}px`);
    w.append(face(offset, h, false), face(offset, h, true));
    return w;
  };

  const root = div('ltr-fold', `left:${Math.round(P.left - S.left)}px;top:${Math.round(P.top - S.top)}px;width:${W}px;height:${h1}px;transform-origin:50% ${h1 / 2}px`);
  const top = wrap(0, h1, 0);
  const mid = wrap(h1, h2, h1);
  const low = wrap(h2, h3, h1 + h2);
  mid.append(low);
  root.append(top, mid);
  slot.replaceChildren(root);

  scene.classList.add('is-posting');
  stage.classList.add('is-posting');

  const anims: Animation[] = [];
  const dones: Promise<void>[] = [];
  // A cancelled animation rejects `finished`; nobody is waiting on it then, so it resolves quietly.
  const run = (el: Element | null, frames: Keyframe[], at: number, ms: number, easing = EASE_IN_OUT, fill: FillMode = 'forwards') => {
    if (!el || !canAnimate(el)) return Promise.resolve();
    const a = el.animate(frames, { duration: ms, delay: at, easing, fill });
    anims.push(a);
    const done = a.finished.then(() => undefined, () => undefined);
    dones.push(done);
    return done;
  };

  // 1. Fold in three: the lower part folds up over the middle, then both fold up over the top.
  run(low, [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(180deg) translateZ(-1px)' }], sched.foldLower.at, sched.foldLower.ms);
  run(mid, [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(180deg) translateZ(-1px)' }], sched.foldUpper.at, sched.foldUpper.ms);

  // 2. The postcards gather into a pile and go to the envelope; the blank card just fades.
  const target = center(E);
  stage.querySelectorAll<HTMLElement>('.ltr-pc').forEach((card, i) => {
    if (card.classList.contains('ltr-pc-slot')) { run(card, [{ opacity: 1 }, { opacity: 0 }], 0, 160); return; }
    const k = sched.gather[Math.min(i, sched.gather.length - 1)];
    // In a pile they travel; in a swipeable row (clipped by its own scroller) they only shrink away.
    if (getComputedStyle(card).position === 'absolute') {
      const c = center(card.getBoundingClientRect());
      // Out of sight once inside, so nothing is left lying where the envelope was when it sails off.
      run(card, [
        { translate: '0 0', scale: '1', opacity: 1 },
        { translate: `${target.x - c.x}px ${target.y - c.y}px`, scale: '0.3', opacity: 1, offset: 0.85 },
        { translate: `${target.x - c.x}px ${target.y - c.y}px`, scale: '0.3', opacity: 0 },
      ], k.at, k.ms);
    } else {
      run(card, [{ scale: '1', opacity: 1 }, { scale: '0.4', opacity: 0 }], k.at, k.ms);
    }
  });

  // 3. The folded letter slides into the envelope (the envelope is in front of it).
  const packet = { x: P.left - S.left + W / 2, y: P.top - S.top + h1 / 2 };
  const into = { x: target.x - S.left, y: target.y - S.top };
  const scale = Math.min(1, (E.width * 0.7) / W);
  const inside = `translate(${into.x - packet.x}px, ${into.y - packet.y}px) scale(${scale})`;
  run(root, [
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: inside, opacity: 1, offset: 0.9 },
    { transform: inside, opacity: 0 },
  ], sched.slide.at, sched.slide.ms);

  // 4. The flap closes over it.
  run(flap, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(-1)' }], sched.flap.at, sched.flap.ms);

  // 5. The postmark is struck: it was not there until now. Only when the letter
  //    is being posted — a letter put away was franked long ago.
  const postmark = env.querySelector('.ltr-env-stamp .ltr-postmark');
  const struck = strike
    ? run(postmark, [
      { opacity: 0, scale: '2.4' },
      { opacity: 0.9, scale: '0.92', offset: 0.6 },
      { opacity: 1, scale: '1' },
    ], sched.stamp.at, sched.stamp.ms, 'cubic-bezier(0.3, 1.4, 0.5, 1)', 'both')
    : Promise.resolve();
  if (strike) run(env, [{ translate: '0 0' }, { translate: '0 3px', offset: 0.4 }, { translate: '0 0' }], sched.stamp.at + 60, 200, EASE_OUT, 'none');
  // Closing instead gives the envelope the small settle of being set down.
  if (!strike) run(env, [{ translate: '0 0', scale: '1' }, { translate: '0 2px', scale: '0.995', offset: 0.5 }, { translate: '0 0', scale: '1' }], sched.flap.at + sched.flap.ms - 60, 260, EASE_OUT, 'none');

  const sealed = Promise.all([struck, ...dones]).then(() => undefined);

  return {
    sealed,
    fly() {
      const away = env.getBoundingClientRect();
      const dx = Math.max(220, window.innerWidth * 0.4);
      const flown = run(env, [
        { translate: '0 0', scale: '1', opacity: 1 },
        { translate: `${dx}px ${-Math.max(120, away.top)}px`, scale: '0.55', opacity: 0 },
      ], 0, m.flyMs, 'cubic-bezier(0.55, 0, 0.9, 0.5)');
      // The desk goes with it.
      const overlay = scene.closest('.journal-composer-overlay');
      const faded = run(overlay, [{ opacity: 1 }, { opacity: 0 }], m.flyMs - m.overlayFadeMs + 100, m.overlayFadeMs, 'linear');
      return Promise.all([flown, faded]).then(() => undefined);
    },
    cancel() {
      for (const a of anims) a.cancel();
      slot.replaceChildren();
      scene.classList.remove('is-posting');
      stage.classList.remove('is-posting');
    },
  };
}

/* ── Closing ─────────────────────────────────────────────────────────────── */

/**
 * Put the letter away when it is closed: the paper folds, the postcards gather,
 * both go into the envelope and the flap shuts over them — the posting motion,
 * played for a letter being read.
 *
 * Resolves when it has finished, so the caller can shut the reader on the last
 * frame rather than pulling the desk away mid-fold. Resolves at once (and
 * nothing plays) under reduce motion, where the Web Animations API is missing,
 * or for an entry with no paper to fold: there the reader simply closes, as it
 * always did.
 */
export function playClose(scene: HTMLElement | null): Promise<void> {
  const post = gatherIntoEnvelope(scene, false);
  if (!post) return Promise.resolve();
  // The flap shuts and the envelope settles; it does not sail off — the letter
  // is being put back on the desk, not sent.
  return post.sealed.then(() => undefined, () => undefined);
}
