/* ==========================================================================
   On the Road · Recap export — saving, sharing, long-press
   --------------------------------------------------------------------------
   Two ways out of the app, for two situations:
     · on a phone, press and hold a card to save just that card — each saved
       card goes straight into a nine-grid post;
     · the Export button makes the whole thing as one long image.

   Delivery prefers the system share sheet (on a phone that is where "Save
   Image", Photos, and every social app live) and falls back to a download.
   ========================================================================== */

import { downloadCard } from '../../card/card-export.ts';

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), 'image/png');
  });
}

export type Delivery = 'shared' | 'downloaded' | 'cancelled';

/**
 * Hand an image to the user: the system share sheet if the browser can share
 * files, otherwise a plain download. Dismissing the share sheet is not an error.
 */
export async function deliverImage(canvas: HTMLCanvasElement, filename: string, title: string): Promise<Delivery> {
  const blob = await canvasToBlob(canvas);
  const file = new File([blob], filename, { type: 'image/png' });

  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return 'cancelled';
      // Any other failure: fall through to the download below.
    }
  }
  // downloadCard's name is slugged; the canvas it is given is what matters.
  await downloadCard(canvas, filename.replace(/\.png$/i, ''));
  return 'downloaded';
}

/* ── Long-press ───────────────────────────────────────────────────────────── */

/** Held this long (ms) counts as a deliberate press, not a tap that lingered. */
export const LONG_PRESS_MS = 450;
/** Moving further than this (px) means the user is swiping the deck, not pressing. */
export const LONG_PRESS_SLOP = 10;

export interface LongPressHandle {
  /**
   * True once after a long-press has fired, so the click the same gesture would
   * otherwise produce does not also turn the card over.
   */
  consumeClick(): boolean;
}

/**
 * Detect a press-and-hold on a card. Mouse is ignored — on a pointer device the
 * Export button is the way out — and a press that moves, lifts early, or starts
 * on a button (an evidence chip) never fires.
 */
export function bindLongPress(
  root: HTMLElement,
  onPress: (card: HTMLElement) => void,
): LongPressHandle {
  let timer: number | null = null;
  let start: { x: number; y: number } | null = null;
  let firedAt = 0;

  const cancel = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    start = null;
  };

  root.addEventListener('pointerdown', (event) => {
    const e = event as PointerEvent;
    if (e.pointerType === 'mouse') return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    const card = target.closest<HTMLElement>('[data-recap-card]');
    if (!card) return;

    cancel();
    start = { x: e.clientX, y: e.clientY };
    timer = window.setTimeout(() => {
      timer = null;
      firedAt = Date.now();
      try { navigator.vibrate?.(10); } catch { /* not every device has it */ }
      onPress(card);
    }, LONG_PRESS_MS);
  });

  root.addEventListener('pointermove', (event) => {
    if (!start) return;
    const e = event as PointerEvent;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP) cancel();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) root.addEventListener(type, cancel);

  // A long press on a touch screen raises the system context menu; once we have
  // taken the gesture, that menu would sit on top of our own sheet.
  root.addEventListener('contextmenu', (event) => {
    if (timer !== null || Date.now() - firedAt < 1000) event.preventDefault();
  });

  return {
    consumeClick() {
      if (firedAt && Date.now() - firedAt < 800) { firedAt = 0; return true; }
      return false;
    },
  };
}
