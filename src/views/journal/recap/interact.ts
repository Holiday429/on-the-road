/* ==========================================================================
   On the Road · Recap deck interaction
   --------------------------------------------------------------------------
   Flipping is done by toggling a class on the card that is already in the DOM,
   not by re-rendering the deck. A CSS transition only runs on a node that
   survives the change; going through a full render would make the animation a
   gamble on how the DOM differ treats the node. The render function still
   derives the same classes from `ui.flipped`, so a later re-render agrees with
   what this left behind.

   Shared by the real controller and the dev preview page, so the preview
   exercises the same code the app does.
   ========================================================================== */

import { t } from '../../../core/i18n.ts';
import type { RecapUiState } from './types.ts';

/** Long enough to cover the flip (620ms) plus its tail, short enough to feel instant. */
const FLIP_MS = 660;

export function cardsOf(shell: ParentNode): HTMLElement[] {
  return Array.from(shell.querySelectorAll<HTMLElement>('[data-recap-card]'));
}

function indexOf(card: HTMLElement): number {
  return Number(card.dataset.recapCard);
}

export function toggleCard(shell: ParentNode, ui: RecapUiState, index: number): void {
  const card = cardsOf(shell).find((c) => indexOf(c) === index);
  if (!card || card.classList.contains('recap-card--static')) return;

  const open = !card.classList.contains('is-flipped');
  card.classList.toggle('is-flipped', open);
  card.setAttribute('aria-pressed', String(open));
  if (open) ui.flipped.add(index); else ui.flipped.delete(index);

  // Mark mid-flip for the dip and sheen keyframes, and clear it afterwards.
  ui.flipping.add(index);
  card.classList.add('is-flipping');
  window.setTimeout(() => {
    ui.flipping.delete(index);
    card.classList.remove('is-flipping');
  }, FLIP_MS);

  syncProgress(shell);
}

/** Turn every card (except the cover, which is already showing) or put them all back. */
export function flipAll(shell: ParentNode, ui: RecapUiState): void {
  const cards = cardsOf(shell);
  const turnable = cards.filter((c) => indexOf(c) > 0);
  const allOpen = turnable.every((c) => c.classList.contains('is-flipped'));

  for (const card of cards) {
    const i = indexOf(card);
    if (i === 0) continue;
    const open = !allOpen;
    card.classList.toggle('is-flipped', open);
    card.setAttribute('aria-pressed', String(open));
    if (open) ui.flipped.add(i); else ui.flipped.delete(i);
  }
  // The cover returns to its archetype face on reshuffle.
  const cover = cards.find((c) => indexOf(c) === 0);
  if (cover && allOpen) { cover.classList.remove('is-flipped'); ui.flipped.delete(0); }

  syncProgress(shell);
}

/**
 * Cards counted as "turned": the cover always counts (it is showing from the
 * start), and every other card that is face-up.
 */
export function openCount(cards: HTMLElement[]): number {
  return cards.filter((c) => indexOf(c) === 0 || c.classList.contains('is-flipped')).length;
}

/** Refresh the dots, the label and the turn-all button to match the cards. */
export function syncProgress(shell: ParentNode): void {
  const cards = cardsOf(shell);
  const total = cards.length;
  const open = openCount(cards);

  shell.querySelectorAll<HTMLElement>('.recap-dot').forEach((dot, i) => {
    const card = cards[i];
    const on = card ? indexOf(card) === 0 || card.classList.contains('is-flipped') : false;
    dot.classList.toggle('is-on', on);
  });

  const label = shell.querySelector<HTMLElement>('[data-recap-progress-label]');
  if (label) label.textContent = t('recap.progress', { n: open, total });

  const all = shell.querySelector<HTMLElement>('[data-recap-flip-all]');
  if (all) {
    const turnable = cards.filter((c) => indexOf(c) > 0);
    const done = turnable.length > 0 && turnable.every((c) => c.classList.contains('is-flipped'));
    all.textContent = done ? t('recap.reset') : t('recap.turnAll');
  }
}
