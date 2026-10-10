/* ==========================================================================
   On the Road · Dashboard — render helpers
   --------------------------------------------------------------------------
   The dashboard rebuilds its markup wholesale (innerHTML) whenever any store
   ticks. Done naively that (a) wipes whatever the user is half-way through
   typing in the quick-add boxes, (b) drops focus, and (c) destroys and
   re-creates the map every time. These helpers make a rebuild invisible:

   · captureUiState / restoreUiState — carry typed values, <select> choices and
     the focused field (with caret) across the swap;
   · swapHtml — swaps the markup but moves a chosen long-lived node (the map
     canvas) from the old DOM into the new one instead of recreating it;
   · createRenderScheduler — coalesces a burst of store callbacks (eight
     listeners all fire once at start-up) into a single render.
   ========================================================================== */

/** Fields whose content the user types or picks and a re-render must not lose. */
const PRESERVED = [
  '.td-quickadd-amt', '.td-quickadd-desc', '.td-quickadd-cat',
  '.td-todo-add-input', '[data-rate-input]',
] as const;

export interface UiState {
  values: Array<{ selector: string; value: string }>;
  focus: { selector: string; start: number | null; end: number | null } | null;
}

export function captureUiState(root: HTMLElement): UiState {
  const values: UiState['values'] = [];
  for (const selector of PRESERVED) {
    const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (el && el.value !== '') values.push({ selector, value: el.value });
  }
  let focus: UiState['focus'] = null;
  const active = document.activeElement as HTMLInputElement | null;
  if (active && root.contains(active)) {
    const selector = PRESERVED.find((s) => active.matches(s));
    if (selector) {
      focus = {
        selector,
        start: typeof active.selectionStart === 'number' ? active.selectionStart : null,
        end: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
      };
    }
  }
  return { values, focus };
}

export function restoreUiState(root: HTMLElement, state: UiState): void {
  for (const { selector, value } of state.values) {
    const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    // Don't clobber a value the fresh markup already carries (e.g. the
    // converter input is re-rendered from module state).
    if (el && el.value === '') el.value = value;
  }
  if (state.focus) {
    const el = root.querySelector<HTMLInputElement>(state.focus.selector);
    if (el) {
      el.focus({ preventScroll: true });
      const { start, end } = state.focus;
      if (start !== null && end !== null) { try { el.setSelectionRange(start, end); } catch { /* not a text input */ } }
    }
  }
}

/** Replace `root`'s children with `html`, but carry the node matching
 *  `keepSelector` over from the old DOM (replacing its placeholder in the new
 *  markup) so something expensive to build — a map — survives the swap. */
export function swapHtml(root: HTMLElement, html: string, keepSelector: string): void {
  const kept = root.querySelector<HTMLElement>(keepSelector);
  kept?.remove();
  // eslint-disable-next-line no-restricted-syntax -- caller passes audited, escaped markup (see dashboard.ts N10)
  root.innerHTML = html;
  if (kept) {
    const placeholder = root.querySelector<HTMLElement>(keepSelector);
    if (placeholder) placeholder.replaceWith(kept);
  }
}

/** Returns `schedule()`: run `fn` once on the next microtask no matter how many
 *  times it is called before then. User-driven actions should still call `fn`
 *  directly so the UI responds synchronously. */
export function createRenderScheduler(fn: () => void): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; fn(); });
  };
}

/** Stable signature of what the map actually draws, so unrelated route edits
 *  (ticking a plan item, renaming a note) don't tear the map down. */
export function mapSignature(legs: Array<{ id: string; city: string; country: string; dateFrom: string; dateTo: string }>): string {
  return legs
    .map((l) => `${l.id}|${l.city}|${l.country}|${l.dateFrom}|${l.dateTo}`)
    .sort()
    .join(';');
}
