/* ==========================================================================
   On the Road · Recap controller
   --------------------------------------------------------------------------
   Owns the deck's interaction state and the generate / export lifecycle.
   Mirrors createStoryController's shape (render / bind / handleDataChange) so
   journal/index.ts can host both modes the same way.
   ========================================================================== */

import { travelerRecapStore, type StoredTravelerRecap } from '../../../data/stores/traveler-recap-store.ts';
import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { handleAiError } from '../../../core/paywall.ts';
import { t } from '../../../core/i18n.ts';
import { generateRecap, isRecapStale, MIN_ENTRIES_FOR_PORTRAIT } from './generator.ts';
import { flipAll, toggleCard } from './interact.ts';
import { renderRecap } from './render.ts';
import { initialRecapUi, type RecapUiState } from './types.ts';
import { ensureCardFonts } from '../card/card-fonts.ts';
import { drawCardBack, CARD_H, CARD_W } from './export/draw.ts';
import { bindLongPress, deliverImage } from './export/save.ts';
import { exportCandidates } from './export/select.ts';
import { openExportSheet } from './export/sheet.ts';
import { confirmModal, toast } from './export/ui.ts';
import { flagLabel } from './render.ts';

interface RecapControllerDeps {
  getEntries: () => StoredJournalEntry[];
  getRecaps: () => StoredTravelerRecap[];
  requestRender: () => void;
  /** Open one journal entry in the reader, for the evidence chips. */
  openEntry?: (entryId: string) => void;
}

export function createRecapController(deps: RecapControllerDeps) {
  const ui: RecapUiState = initialRecapUi();
  // The journal re-renders on every data change, and morphInto REUSES the shell
  // node. Without this, each render would add another set of listeners to the
  // same node and one tap would turn a card over several times — an even number
  // of flips being no flip at all.
  const bound = new WeakSet<HTMLElement>();

  function render() {
    const recaps = sorted();
    const recap = active(recaps);
    if (recap && ui.activeRecapId !== recap.id) ui.activeRecapId = recap.id;

    return renderRecap({
      recap,
      recaps,
      entryCount: deps.getEntries().length,
      minEntries: MIN_ENTRIES_FOR_PORTRAIT,
      ui,
    });
  }

  function bind(root: HTMLElement) {
    const shell = root.querySelector<HTMLElement>('.journal-recap-shell');
    if (!shell || bound.has(shell)) return;
    bound.add(shell);

    // Press-and-hold saves one card (phones). The gesture also ends in a click,
    // which must not turn the card over as well.
    const press = bindLongPress(shell, (card) => { void saveCard(Number(card.dataset.recapCard)); });

    shell.addEventListener('click', (event) => {
      if (press.consumeClick()) return;
      const target = event.target as HTMLElement;

      if (target.closest('[data-recap-generate]')) { void generate({ event }); return; }
      if (target.closest('[data-recap-regenerate]')) { void generate({ event, force: true }); return; }
      if (target.closest('[data-recap-flip-all]')) { flipAll(shell, ui); return; }
      if (target.closest('[data-recap-export]')) { openExport(); return; }

      const view = target.closest<HTMLElement>('[data-recap-view]');
      if (view) { setPublic(view.dataset.recapView === 'public'); return; }

      const chip = target.closest<HTMLElement>('[data-recap-ref]');
      if (chip) { openRef(chip.dataset.recapRef ?? ''); return; }

      // Flip last: an evidence chip or button inside a card must not also turn it.
      const card = target.closest<HTMLElement>('[data-recap-card]');
      if (card) toggleCard(shell, ui, Number(card.dataset.recapCard));
    });

    // Keyboard parity for the cards, which are div[role=button].
    shell.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = (event.target as HTMLElement).closest<HTMLElement>('[data-recap-card]');
      if (!card) return;
      event.preventDefault();
      toggleCard(shell, ui, Number(card.dataset.recapCard));
    });
  }

  function handleDataChange() {
    const recaps = sorted();
    if (ui.activeRecapId && !recaps.some((r) => r.id === ui.activeRecapId)) {
      ui.activeRecapId = recaps[0]?.id ?? null;
      ui.flipped.clear();
    }
  }

  return { render, bind, handleDataChange };

  /* ── Interaction ───────────────────────────────────────────────────────── */

  function setPublic(next: boolean) {
    if (ui.publicMode === next) return;
    ui.publicMode = next;
    deps.requestRender();
  }

  function openRef(ref: string) {
    const recap = active(sorted());
    const entryId = recap?.refMap[ref];
    if (entryId && deps.openEntry) deps.openEntry(entryId);
  }

  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  /**
   * Generate, or reuse. A portrait the journal hasn't outgrown is what another
   * call would return, so re-opening the page costs nothing; only `force` (the
   * explicit Regenerate button) spends a credit on unchanged input.
   *
   * `event` must be the real click on the button. A programmatic `.click()` or
   * dispatchEvent (scripts, headless runs) is not trusted and never reaches the
   * model, so nothing but a person tapping can spend credit.
   */
  async function generate(opts: { event: Event; force?: boolean }) {
    if (!opts.event.isTrusted) return;
    if (ui.generating) return;
    const entries = deps.getEntries();
    const existing = active(sorted());

    if (!opts.force && existing && !isRecapStale(existing, entries)) {
      ui.activeRecapId = existing.id;
      deps.requestRender();
      return;
    }

    ui.error = '';
    ui.generating = true;
    deps.requestRender();

    try {
      const { draft, privacyReport } = await generateRecap(entries, { userInitiated: true });
      ui.privacyReport = privacyReport;
      // Overwrite the trip's portrait rather than accumulating versions: this
      // is a current read of the person, not a changelog. Sharing stays as the
      // owner left it so a regenerate doesn't silently re-publish or unpublish.
      const id = existing
        ? (await travelerRecapStore.update(existing.id, {
            ...draft,
            visibility: existing.visibility,
            slug: existing.slug,
          }), existing.id)
        : await travelerRecapStore.save(draft);
      ui.activeRecapId = id;
      ui.flipped.clear();
    } catch (error) {
      if (handleAiError(error)) return;
      console.error('Recap generation failed:', error);
      ui.error = t('recap.error.generate');
    } finally {
      ui.generating = false;
      deps.requestRender();
    }
  }

  /* ── Export ────────────────────────────────────────────────────────────── */

  /** The Export button: choose which cards go in, then make the long image. */
  function openExport() {
    const recap = active(sorted());
    if (recap) openExportSheet(recap);
  }

  /**
   * Press-and-hold on a card: save that card's BACK (the public wording) as one
   * image. A card whose text tripped an automatic check asks first — the owner's
   * call, made with the reason in front of them.
   */
  async function saveCard(index: number) {
    const recap = active(sorted());
    if (!recap) return;
    const candidates = exportCandidates(recap);
    const cand = candidates.find((c) => c.index === index);
    if (!cand) return;

    if (!cand.hasPublicText) { toast(t('recap.save.nopublic')); return; }
    if (cand.flags.length) {
      const ok = await confirmModal(
        t('recap.save.confirm', { reasons: cand.flags.map(flagLabel).join(' · ') }),
        t('recap.pick.make'), t('recap.pick.cancel'),
      );
      if (!ok) return;
    }

    try {
      await ensureCardFonts();
      const canvas = document.createElement('canvas');
      canvas.width = CARD_W;
      canvas.height = CARD_H;
      // Numbered by position in the deck, so a saved card is "04 / 09" like the
      // one on screen — saved one at a time they still assemble into a nine-grid.
      drawCardBack(canvas.getContext('2d')!, { card: cand.card, key: cand.key, page: index + 1, total: candidates.length });
      const outcome = await deliverImage(canvas, `on-the-road-portrait-${String(index + 1).padStart(2, '0')}.png`, t('recap.longimg.title'));
      if (outcome !== 'cancelled') toast(t('recap.save.saved'));
    } catch (error) {
      console.error('Saving a recap card failed:', error);
      toast(t('recap.save.failed'));
    }
  }

  /* ── Helpers ───────────────────────────────────────────────────────────── */

  function sorted() {
    return [...deps.getRecaps()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function active(recaps: StoredTravelerRecap[]) {
    return recaps.find((r) => r.id === ui.activeRecapId) ?? recaps[0] ?? null;
  }
}
