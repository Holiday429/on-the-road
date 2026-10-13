/* ==========================================================================
   On the Road · Expenses · cap inputs
   --------------------------------------------------------------------------
   One binding for every budget input (total, per-category, per-country).
   Kept separate from the page so the commit rules — and the reason for them —
   are in one place.
   ========================================================================== */

/**
 * Bind a cap <input> to its store write.
 *
 * `change` alone is not enough. It only fires when the field loses focus in a
 * way the browser counts as a commit, so a value could be typed and then lost
 * outright by: pressing Enter (no handler on these fields), hitting Escape
 * (the panel closes and the DOM is thrown away), or leaving the page/tab while
 * the field still has focus. Each of those is an ordinary thing to do after
 * typing a number, and each silently discarded the edit.
 *
 * So commit on three signals, all funnelled through one idempotent save:
 *   - `input`, debounced — the value is safe ~400ms after typing stops, with
 *     no blur required at all.
 *   - `change` — immediate save on a normal blur, no debounce wait.
 *   - Enter — commits and drops focus, which is what users expect it to do.
 *
 * `last` makes repeat saves cheap: re-committing an unchanged value is skipped,
 * so the debounce and the blur firing back-to-back cost one write, not two. A
 * failed write resets it, so the next attempt retries instead of being skipped.
 *
 * A rejected write is SHOWN, never swallowed. The root cause of the original
 * "caps don't save" report was a Firestore rules denial on legacy trip docs
 * (see firestore.rules selfIsMember), and it stayed invisible for two rounds of
 * UI fixes precisely because this path had no error handling.
 */
export function bindCapInput(
  input: HTMLInputElement,
  save: (amount: number | null) => Promise<void>,
): { commit: () => Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = input.value.trim();

  const commit = async () => {
    clearTimeout(timer);
    const raw = input.value.trim();
    if (raw === last) return; // nothing new to persist
    const prev = last;
    last = raw;
    const val = parseFloat(raw);
    try {
      await save(Number.isFinite(val) && val > 0 ? val : null);
      input.classList.remove('ba-cap-error');
      input.title = '';
    } catch (e) {
      // Roll back so the next commit retries this value rather than skipping
      // it as unchanged, and make the failure visible — a silently dropped
      // write here is what made the original bug so hard to pin down.
      last = prev;
      input.classList.add('ba-cap-error');
      input.title = `Not saved: ${e instanceof Error ? e.message : String(e)}`;
      console.error('Budget cap failed to save:', e);
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { void commit(); }, 400);
  });
  input.addEventListener('change', () => { void commit(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Commit explicitly rather than leaning on blur to raise `change` —
      // whether it does is browser-dependent for a programmatic blur.
      void commit().then(() => input.blur());
      return;
    }
    // Escape tears the panel down (see onKey in budget-analysis.ts), so flush before that runs.
    if (e.key === 'Escape') void commit();
  });

  return { commit };
}

