/* ==========================================================================
   On the Road · Journal albums — designing the cover
   --------------------------------------------------------------------------
   A live proof on the left, the choices on the right. Everything is a preset:
   four templates, six tones, a focal slider and three lines of copy — no free
   canvas, because a cover that can be dragged anywhere mostly gets dragged
   somewhere wrong.

   The panel re-renders from the draft on every change, so the proof is always
   the real cover component, not an approximation of it.
   ========================================================================== */

import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import type { JournalAlbumCover } from '../../../data/schema.ts';
import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { t } from '../../../core/i18n.ts';
import { escHtml } from '../shared/utils.ts';
import { COVER_TEMPLATES, COVER_TONES, coverOf, renderCover, type CoverTemplate } from './album-cover.ts';
import { coverArtOf } from './albums.ts';

/** A miniature of one template, drawn with the draft's own copy and tone. */
function templateChip(draft: JournalAlbumCover, album: StoredJournalAlbum, entries: StoredJournalEntry[], template: CoverTemplate): string {
  const on = draft.template === template;
  return `
    <button class="jce-chip${on ? ' is-on' : ''}" data-cover-template="${template}" type="button" aria-pressed="${on}" title="${escHtml(t(`journal.cover.tpl.${template}`))}">
      <span class="jce-chip-art">${renderCover({ ...draft, template, headline: draft.headline.trim() || album.title }, coverArtOf(album, entries))}</span>
      <span class="jce-chip-name">${escHtml(t(`journal.cover.tpl.${template}`))}</span>
    </button>`;
}

export function renderCoverEditor(album: StoredJournalAlbum, entries: StoredJournalEntry[], draft: JournalAlbumCover): string {
  const art = coverArtOf(album, entries);
  const lines = [0, 1, 2].map((i) => draft.lines[i] ?? '');
  // The proof shows what the cover WILL print: an empty headline field means
  // "keep using the album's title", so the preview fills it in.
  const shown: JournalAlbumCover = { ...draft, headline: draft.headline.trim() || album.title };

  return `
    <div class="jce" data-cover-editor="${escHtml(album.id)}">
      <div class="jce-proof">
        <div class="jce-proof-art">${renderCover(shown, art)}</div>
        ${art.photo ? `
          <label class="jce-focal">
            <span>${escHtml(t('journal.cover.focal'))}</span>
            <input type="range" min="0" max="100" value="${Math.round(draft.focalY * 100)}" data-cover-focal>
          </label>` : `<p class="jce-hint">${escHtml(t('journal.cover.noPhoto'))}</p>`}
      </div>

      <div class="jce-controls">
        <section class="jce-group">
          <h4 class="jce-label">${escHtml(t('journal.cover.template'))}</h4>
          <div class="jce-chips">${COVER_TEMPLATES.map((x) => templateChip(draft, album, entries, x)).join('')}</div>
        </section>

        <section class="jce-group">
          <h4 class="jce-label">${escHtml(t('journal.cover.tone'))}</h4>
          <div class="jce-tones">
            ${COVER_TONES.map((tone) => `
              <button class="jce-tone jc-tone--${tone}${draft.tone === tone ? ' is-on' : ''}" data-cover-tone="${tone}"
                type="button" aria-pressed="${draft.tone === tone}" aria-label="${escHtml(t(`journal.cover.tone.${tone}`))}"></button>`).join('')}
          </div>
        </section>

        <section class="jce-group">
          <h4 class="jce-label">${escHtml(t('journal.cover.words'))}</h4>
          <input class="input" data-cover-headline maxlength="40" placeholder="${escHtml(album.title)}" value="${escHtml(draft.headline)}">
          <input class="input" data-cover-kicker maxlength="80" placeholder="${escHtml(t('journal.cover.kickerHint'))}" value="${escHtml(draft.kicker)}">
        </section>

        <section class="jce-group">
          <h4 class="jce-label">${escHtml(t('journal.cover.lines'))}</h4>
          ${lines.map((line, i) => `
            <input class="input" data-cover-line="${i}" maxlength="40" placeholder="${escHtml(art.suggested[i] ?? t('journal.cover.lineHint'))}" value="${escHtml(line)}">`).join('')}
        </section>

        <div class="jce-actions">
          <button class="btn btn-ghost" data-cover-cancel type="button">${escHtml(t('journal.cancel'))}</button>
          <button class="btn btn-primary" data-cover-save type="button">${escHtml(t('journal.save'))}</button>
        </div>
      </div>
    </div>`;
}

/** The draft an editor opens with: whatever the album already prints. */
export function coverDraftFor(album: StoredJournalAlbum): JournalAlbumCover {
  // The headline defaults to the album title for DISPLAY, but the field itself
  // stays empty so the title keeps tracking a rename until something is typed.
  return { ...coverOf(album), headline: album.cover?.headline ?? '' };
}
