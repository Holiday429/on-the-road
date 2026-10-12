/* ==========================================================================
   On the Road · Wrap · keyboard paging (pure)
   --------------------------------------------------------------------------
   ↑ / ↓ move between chapters. A chapter taller than the window (a receipt on a
   phone) must still be readable, so while its far edge is off screen the key is
   left alone and the browser scrolls normally.
   ========================================================================== */

/** A chapter whose far edge is only this far below the window counts as fully in view (the page header pushes
 *  the first chapter a little past one screen). */
const SLACK_DOWN = 120;

export interface ChapterRect { top: number; bottom: number }

/** The chapter that fills the upper-middle of the window. */
export function currentChapter(rects: ChapterRect[], viewportH: number): number {
  const i = rects.findIndex((r) => r.bottom > viewportH * 0.35);
  return i === -1 ? Math.max(0, rects.length - 1) : i;
}

/** Index to scroll to for a key press, or null to let the browser handle it. */
export function chapterKeyTarget(key: string, rects: ChapterRect[], viewportH: number): number | null {
  if (!rects.length) return null;
  const cur = currentChapter(rects, viewportH);
  const r = rects[cur];
  if (key === 'ArrowDown') {
    if (r.bottom > viewportH + SLACK_DOWN) return null;
    return cur + 1 < rects.length ? cur + 1 : null;
  }
  if (key === 'ArrowUp') {
    if (r.top < -8) return null;
    return cur - 1 >= 0 ? cur - 1 : null;
  }
  return null;
}
