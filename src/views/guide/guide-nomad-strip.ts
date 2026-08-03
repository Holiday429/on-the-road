/* ==========================================================================
   On the Road · Guide — "my check-ins" strip for the Cafés tab
   --------------------------------------------------------------------------
   Nomad no longer has its own nav entry (folded into Guide, see
   product-restructure P3); its data (nomadStore) and view code
   (views/nomad/*) still exist. This strip surfaces the user's own saved
   café/co-working spots for the *current* city at the top of the Cafés tab,
   so existing check-ins aren't lost when the standalone Nomad page vanished.
   Kept in its own module so guide.ts (at its max-lines ratchet cap) only
   needs one render call + one wire call.
   ========================================================================== */

import { nomadStore, type StoredNomadSpot } from '../../data/stores/nomad-store.ts';
import { composite, scoreClass } from '../nomad/nomad-types.ts';
import { openDetailModal } from '../nomad/nomad-modal.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { currentUser } from '../../firebase/auth.ts';

/** Current uid for a new spot's ownerId, or '' if signed out (matches the
 *  fallback nomad.ts itself uses). */
export function nomadOwnerId(): string {
  return currentUser()?.uid ?? '';
}

/** Spots for `city` across all the user's trips (a café worth revisiting
 *  doesn't stop mattering just because the current trip changed). */
function spotsForCity(city: string): StoredNomadSpot[] {
  return nomadStore.peek().filter((s) => s.city === city);
}

export function renderNomadStrip(city: string): string {
  const spots = spotsForCity(city);
  if (!spots.length) return '';

  const chips = spots.map((s) => {
    // A freshly-saved spot has every rating at 0 (see guide.ts's nomadStore.add
    // bridge) — that's "not yet rated", not a genuine 0.0/5 score, so hide the
    // badge rather than showing a red "poor" chip for something unreviewed.
    const rated = Object.values(s.ratings).some((v) => v > 0);
    const score = composite(s.ratings);
    return `
      <button class="guide-nomad-chip" data-spot-id="${esc(s.id)}">
        <span class="guide-nomad-chip-icon">☕</span>
        <span class="guide-nomad-chip-name">${esc(s.name)}</span>
        ${rated ? `<span class="guide-nomad-chip-score ${scoreClass(score)}">${score.toFixed(1)}</span>` : ''}
      </button>`;
  }).join('');

  return `
    <div class="guide-nomad-strip">
      <div class="guide-nomad-strip-label">${t('guide.myCheckins')}</div>
      <div class="guide-nomad-strip-chips">${chips}</div>
    </div>`;
}

export function wireNomadStrip(root: HTMLElement, city: string): void {
  root.querySelectorAll<HTMLElement>('.guide-nomad-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const spot = spotsForCity(city).find((s) => s.id === chip.dataset.spotId);
      if (spot) openDetailModal(spot, () => {});
    });
  });
}
