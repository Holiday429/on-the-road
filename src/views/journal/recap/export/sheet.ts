/* ==========================================================================
   On the Road · Recap export — "choose what to share"
   --------------------------------------------------------------------------
   The step between "Export" and the image. The owner ticks the cards that go in;
   nothing is decided for them. The automatic checks only inform the choice: a
   card whose public text tripped one starts unticked, shows what tripped, and
   can still be ticked.

   Everything exported is the PUBLIC wording — the sheet says so, because that is
   the thing people most need to know before they share.
   ========================================================================== */

import { t } from '../../../../core/i18n.ts';
import { openModal } from '../../../../core/modal.ts';
import type { StoredTravelerRecap } from '../../../../data/stores/traveler-recap-store.ts';
import { escHtml } from '../../shared/utils.ts';
import { ensureCardFonts } from '../../card/card-fonts.ts';
import { cardQuestion, flagLabel } from '../render.ts';
import { toneFor } from '../tones.ts';
import { renderLongImage } from './long.ts';
import { deliverImage } from './save.ts';
import { chosenCards, defaultSelection, exportCandidates, previewText, type ExportCandidate } from './select.ts';

const FILENAME = 'on-the-road-traveler-portrait.png';

function loadLogo(): Promise<HTMLImageElement | null> {
  const art = `${import.meta.env.BASE_URL}art/`.replace(/\/{2,}/g, '/');
  return new Promise((resolve) => {
    const img = new Image();
    // A logo that fails to load must never stop the export — the image just goes without it.
    const timer = window.setTimeout(() => resolve(null), 4000);
    img.onload = () => { window.clearTimeout(timer); resolve(img); };
    img.onerror = () => { window.clearTimeout(timer); resolve(null); };
    img.src = `${art}logo.png`;
  });
}

/** Build and deliver the long image for the given cards. Exported for the controller and tests. */
export async function exportLongImage(cards: ExportCandidate[]): Promise<'shared' | 'downloaded' | 'cancelled'> {
  await ensureCardFonts();
  const logo = await loadLogo();
  const canvas = renderLongImage({ cards: cards.map((c) => ({ card: c.card, key: c.key })), logo });
  return deliverImage(canvas, FILENAME, t('recap.longimg.title'));
}

function itemHtml(c: ExportCandidate, checked: boolean): string {
  const tone = toneFor(c.key);
  const disabled = !c.hasPublicText;
  const flagged = c.flags.length > 0;
  const reasons = c.flags.map((f) => escHtml(flagLabel(f))).join(' · ');

  return `
    <label class="recap-pick-item${flagged ? ' is-flagged' : ''}${disabled ? ' is-disabled' : ''}" style="--tone-l:${tone.light};--tone-d:${tone.dark}">
      <input type="checkbox" value="${c.index}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span class="recap-pick-swatch">${String(c.index + 1).padStart(2, '0')}</span>
      <span class="recap-pick-main">
        <span class="recap-pick-q">${escHtml(cardQuestion(c.card))}</span>
        <span class="recap-pick-text">${escHtml(disabled ? t('recap.pick.empty') : previewText(c))}</span>
        ${flagged ? `<span class="recap-pick-flag"><i></i>${escHtml(t('recap.pick.flagged'))} · ${reasons}</span>` : ''}
      </span>
    </label>`;
}

/** Open the selection sheet for a portrait. */
export function openExportSheet(recap: StoredTravelerRecap): void {
  const candidates = exportCandidates(recap);
  const selected = defaultSelection(candidates);
  const total = candidates.filter((c) => c.hasPublicText).length;

  const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 520px)').matches;
  const modal = openModal({
    title: t('recap.pick.title'),
    variant: phone ? 'sheet' : 'modal',
    className: 'recap-pick',
    body: `
      <p class="recap-pick-sub">${escHtml(t('recap.pick.sub'))}</p>
      <div class="recap-pick-tools">
        <button class="btn btn-ghost" data-act="all" type="button">${escHtml(t('recap.pick.all'))}</button>
        <button class="btn btn-ghost" data-act="none" type="button">${escHtml(t('recap.pick.none'))}</button>
        <span class="recap-pick-count" data-count></span>
      </div>
      <div class="recap-pick-list">${candidates.map((c) => itemHtml(c, selected.has(c.index))).join('')}</div>
      <p class="recap-pick-error" data-error hidden>${escHtml(t('recap.export.failed'))}</p>`,
    footer: `
      <button class="btn btn-ghost" data-act="cancel" type="button">${escHtml(t('recap.pick.cancel'))}</button>
      <button class="btn btn-primary" data-act="make" type="button">${escHtml(t('recap.pick.make'))}</button>`,
  });

  const root = modal.root;
  const boxes = () => Array.from(root.querySelectorAll<HTMLInputElement>('.recap-pick-list input[type="checkbox"]'));
  const make = root.querySelector<HTMLButtonElement>('[data-act="make"]')!;
  const count = root.querySelector<HTMLElement>('[data-count]')!;
  const error = root.querySelector<HTMLElement>('[data-error]')!;

  const sync = () => {
    selected.clear();
    for (const box of boxes()) if (box.checked) selected.add(Number(box.value));
    count.textContent = t('recap.pick.count', { n: selected.size, total });
    make.disabled = selected.size === 0;
  };
  sync();

  root.addEventListener('change', sync);
  root.querySelector('[data-act="all"]')?.addEventListener('click', () => {
    for (const box of boxes()) if (!box.disabled) box.checked = true;
    sync();
  });
  root.querySelector('[data-act="none"]')?.addEventListener('click', () => {
    for (const box of boxes()) box.checked = false;
    sync();
  });
  root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => modal.close());

  make.addEventListener('click', async () => {
    const cards = chosenCards(candidates, selected);
    if (!cards.length) return;
    error.hidden = true;
    make.disabled = true;
    const label = make.textContent;
    make.textContent = t('recap.exporting');
    try {
      const outcome = await exportLongImage(cards);
      if (outcome !== 'cancelled') modal.close();
      else { make.textContent = label; make.disabled = false; }
    } catch (err) {
      console.error('Recap export failed:', err);
      error.hidden = false;
      make.textContent = label;
      make.disabled = false;
    }
  });
}
