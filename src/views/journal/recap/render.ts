/* ==========================================================================
   On the Road · Recap rendering — a nine-card flip deck
   --------------------------------------------------------------------------
   The portrait is dealt as nine 3:4 cards the reader turns over one at a time,
   not as a page they scroll. Nine is the number a social post holds, and each
   card's BACK is built to stand alone as a share image.

   Every card has the same two faces:
     front   a question — what this card is about — on a wash of colour
     back    the answer, under a topic bar that repeats the question, so a card
             that has been turned (or saved) still says what it is answering

   Deck order (index → card):
     0  cover      front: the logo and "Traveler portrait"; back: the archetype
                   and six counted figures
     1  traits     four axes
     2-7 chapters  attention, method, relations, friction, recording, throughline
     8  closing    one line + three questions for the next trip

   Cards are a fixed 3:4 whatever they hold. A bottom bar anchors the lower edge
   of every back, so a short text sits in a finished card rather than at the top
   of an empty one.

   Flipping is CSS; interact.ts only toggles a class.
   ========================================================================== */

import type { StoredTravelerRecap } from '../../../data/stores/traveler-recap-store.ts';
import type { RecapChapter, RecapNumber, RecapTrait } from '../../../data/schema.ts';
import { t } from '../../../core/i18n.ts';
import { escHtml } from '../shared/utils.ts';
import { plainText, splitEmphasis } from './emphasis.ts';
import { toneFor } from './tones.ts';
import type { RecapUiState } from './types.ts';

export interface RecapRenderInput {
  recap: StoredTravelerRecap | null;
  recaps: StoredTravelerRecap[];
  entryCount: number;
  minEntries: number;
  ui: RecapUiState;
}

/** Small English kicker on every card. Kept in English in every locale — a design label, not copy. */
export const CHAPTER_KICKERS: Record<string, string> = {
  cover: 'Traveler portrait', traits: 'Traits',
  attention: 'Attention', method: 'Method', relations: 'People',
  friction: 'Friction', recording: 'Recording', throughline: 'Throughline',
  closing: 'One line',
};

/* ── Deck assembly ────────────────────────────────────────────────────────── */

export type Card =
  | { kind: 'cover'; label: string; tagline: string; notes: number; tiles: RecapNumber[] }
  | { kind: 'traits'; traits: RecapTrait[] }
  | { kind: 'chapter'; chapter: RecapChapter }
  | { kind: 'closing'; oneLine: string; questions: string[] };

export function buildDeck(recap: StoredTravelerRecap): Card[] {
  const cards: Card[] = [];

  if (recap.archetype.label || recap.numbers.length) {
    cards.push({
      kind: 'cover',
      label: recap.archetype.label,
      tagline: recap.archetype.tagline,
      notes: recap.entryCount,
      tiles: recap.numbers,
    });
  }
  // The radar has four axes; with fewer it would be a triangle that implies a
  // fourth reading we don't have, so the card is left out rather than faked.
  if (recap.traits.length >= 4) cards.push({ kind: 'traits', traits: recap.traits.slice(0, 4) });
  for (const chapter of recap.chapters) cards.push({ kind: 'chapter', chapter });
  if (recap.oneLine || recap.questions.length) {
    cards.push({ kind: 'closing', oneLine: recap.oneLine, questions: recap.questions.slice(0, 3) });
  }
  return cards;
}

export function deckSize(recap: StoredTravelerRecap): number {
  return buildDeck(recap).length;
}

/** The key a card's colour and kicker are looked up by: its identity, not its position. */
export function cardKey(card: Card): string {
  return card.kind === 'chapter' ? card.chapter.id : card.kind;
}

/** Why a chapter's public text was flagged (empty for every other card). */
export function flagsOf(card: Card): string[] {
  return card.kind === 'chapter' ? card.chapter.flags : [];
}

/** The question a card answers: shown on its front and again atop its back. */
export function cardQuestion(card: Card): string {
  switch (card.kind) {
    case 'cover':   return t('recap.cover.kicker');
    case 'traits':  return t('recap.traits.q');
    case 'closing': return t('recap.closing.q');
    case 'chapter': {
      const key = `recap.q.${card.chapter.id}`;
      const text = t(key);
      return text === key ? card.chapter.heading : text;
    }
  }
}

/* ── Shell ────────────────────────────────────────────────────────────────── */

export function renderRecap(input: RecapRenderInput): string {
  const { recap, ui, entryCount, minEntries } = input;

  if (ui.generating) return shell(loadingHtml(entryCount));
  if (!recap) return shell(emptyHtml(entryCount, minEntries, ui));

  const cards = buildDeck(recap);
  return shell(`
    ${ui.error ? `<p class="recap-error">${escHtml(ui.error)}</p>` : ''}
    ${headerHtml(cards, ui)}
    <div class="recap-deck" data-recap-deck>
      ${cards.map((card, i) => cardHtml(card, i, cards.length, ui)).join('')}
    </div>
    ${footerHtml(cards)}
  `);
}

function shell(inner: string): string {
  return `<div class="journal-recap-shell">${inner}</div>`;
}

/* ── Cards ────────────────────────────────────────────────────────────────── */

function cardHtml(card: Card, index: number, total: number, ui: RecapUiState): string {
  // A cover with no archetype (the numbers-only fallback) has only one face, so
  // there is nothing to turn; it is dealt face-up and inert.
  const isStatic = card.kind === 'cover' && !card.label;
  const flipped = !isStatic && ui.flipped.has(index);
  const flags = ui.publicMode ? flagsOf(card) : [];
  const tone = toneFor(cardKey(card));

  const classes = [
    'recap-card',
    `recap-card--${card.kind}`,
    flipped ? 'is-flipped' : '',
    ui.flipping.has(index) ? 'is-flipping' : '',
    flags.length ? 'has-flag' : '',
    isStatic ? 'recap-card--static recap-card--open' : '',
  ].filter(Boolean).join(' ');

  const attrs = isStatic ? '' : `role="button" tabindex="0" aria-pressed="${flipped}"`;
  const style = `--tone-l:${tone.light};--tone-d:${tone.dark}`;

  return `
    <div class="${classes}" data-recap-card="${index}" ${attrs} style="${style}" aria-label="${escHtml(cardQuestion(card))}">
      <div class="recap-card-inner">
        ${isStatic ? '' : frontFace(card, index, total)}
        ${backFace(card, index, total, ui)}
      </div>
      ${flags.length ? flagBadge(flags) : ''}
    </div>
  `;
}

/** A small chip on a card whose public text needs the owner's eye before it is shared. */
function flagBadge(flags: string[]): string {
  const reasons = flags.map(flagLabel).join(' · ');
  return `<span class="recap-flag" title="${escHtml(reasons)}"><i></i>${escHtml(t('recap.flag'))}</span>`;
}

export function flagLabel(reason: string): string {
  const key = `recap.flag.${reason}`;
  const text = t(key);
  return text === key ? reason : text;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/* ── Front faces ──────────────────────────────────────────────────────────── */

function frontFace(card: Card, index: number, total: number): string {
  const key = cardKey(card);
  const top = `
    <div class="recap-front-top">
      <span class="recap-front-idx">${pad(index + 1)}</span>
      <span class="recap-front-kicker">${escHtml(CHAPTER_KICKERS[key] ?? '')}</span>
    </div>`;
  const bottom = `
    <div class="recap-front-bottom">
      <span class="recap-cue"><span></span>${escHtml(t('recap.cue'))}</span>
      <span class="recap-pagenum">${pad(index + 1)} / ${pad(total)}</span>
    </div>`;

  if (card.kind === 'cover') {
    return `
      <div class="recap-card-face recap-card-front recap-front recap-front--cover">
        <i class="recap-sheen"></i>
        ${top}
        <div class="recap-cover-logo">${logoHtml()}</div>
        <div class="recap-front-qwrap">
          <h3 class="recap-front-q">${escHtml(t('recap.cover.kicker'))}</h3>
          <p class="recap-front-sub">${escHtml(t('recap.cover.basis', { n: card.notes }))}</p>
        </div>
        ${bottom}
      </div>
    `;
  }

  return `
    <div class="recap-card-face recap-card-front recap-front">
      <i class="recap-sheen"></i>
      ${top}
      <div class="recap-front-decor" aria-hidden="true">${markSvg(key)}</div>
      <div class="recap-front-qwrap">
        <h3 class="recap-front-q">${escHtml(cardQuestion(card))}</h3>
      </div>
      ${bottom}
    </div>
  `;
}

/**
 * The animated logo. A short mp4 (≈64KB, against 2.1MB for the gif); under
 * reduced motion the still is shown instead — both are rendered and CSS picks.
 */
function logoHtml(): string {
  const art = `${import.meta.env.BASE_URL}art/`.replace(/\/{2,}/g, '/');
  return `
    <video class="recap-logo-video" src="${art}logo.mp4" poster="${art}logo.png" autoplay muted loop playsinline preload="metadata" aria-hidden="true"></video>
    <img class="recap-logo-still" src="${art}logo.png" alt="" aria-hidden="true">
  `;
}

/* ── Back faces ───────────────────────────────────────────────────────────── */

/** The bar atop every back: the question it answers, so a turned card keeps its context. */
function topicBar(card: Card, index: number): string {
  return `
    <div class="recap-topic r1">
      <span class="recap-topic-idx">${pad(index + 1)}</span>
      <span class="recap-topic-q">${escHtml(cardQuestion(card))}</span>
      <span class="recap-topic-kicker">${escHtml(CHAPTER_KICKERS[cardKey(card)] ?? '')}</span>
    </div>`;
}

/** The bar along the bottom of every back; anchors the lower edge. */
function baseBar(left: string, index: number, total: number): string {
  return `
    <div class="recap-base r3">
      <div class="recap-base-left">${left}</div>
      <div class="recap-base-right"><i class="recap-mark-dot"></i><span>On the Road</span><span class="recap-pagenum">${index + 1}/${total}</span></div>
    </div>`;
}

function backFace(card: Card, index: number, total: number, ui: RecapUiState): string {
  const open = `<div class="recap-card-face recap-card-back"><i class="recap-sheen"></i>${topicBar(card, index)}`;

  switch (card.kind) {
    case 'cover':
      return `${open}
          ${card.label ? `
            <div class="recap-archetype r2">
              <h3 class="recap-cover-label">${escHtml(card.label)}</h3>
              ${card.tagline ? `<p class="recap-cover-tagline">${escHtml(card.tagline)}</p>` : ''}
            </div>` : ''}
          <div class="recap-tiles r2">
            ${card.tiles.map((tile) => `
              <div class="recap-tile">
                <span class="recap-tile-value">${escHtml(tile.value)}</span>
                <span class="recap-tile-label">${escHtml(tile.label)}</span>
              </div>`).join('')}
          </div>
          ${baseBar(escHtml(t('recap.cover.basis', { n: card.notes })), index, total)}
        </div>`;

    case 'traits':
      return `${open}
          <div class="recap-radar-wrap r2">${radarSvg(card.traits)}</div>
          <ul class="recap-trait-list r2">
            ${card.traits.map((trait) => `
              <li>
                <span class="recap-trait-key">${escHtml(trait.key)} <b>${Math.round(trait.score)}</b></span>
                <span class="recap-trait-note">${escHtml(trait.note)}</span>
              </li>`).join('')}
          </ul>
          ${baseBar(escHtml(t('recap.base.traits')), index, total)}
        </div>`;

    case 'chapter': {
      const chapter = card.chapter;
      // Public view shows what a friend would see; private shows the longer
      // reading and the entries it was drawn from.
      const text = ui.publicMode ? chapter.bodyPublic : chapter.body;
      const left = ui.publicMode
        ? escHtml(t('recap.base.public'))
        : chapter.evidenceRefs.map((ref) => `<button class="recap-evidence-chip" data-recap-ref="${escHtml(ref)}" type="button">${escHtml(ref)}</button>`).join('');
      // Heading and text are one block, centred between the topic bar and the
      // base bar: the space above and below it is even, and the heading stays
      // attached to what it heads.
      return `${open}
          <div class="recap-copy">
            <h3 class="recap-heading r1">${escHtml(chapter.heading)}</h3>
            <div class="recap-body-wrap r2">
              ${text
                ? `<p class="recap-body recap-body--${bodySize(text)}">${emphasisHtml(text)}</p>`
                : `<p class="recap-body recap-body--md recap-body--none">${escHtml(t('recap.nopublic'))}</p>`}
            </div>
          </div>
          ${baseBar(left, index, total)}
        </div>`;
    }

    case 'closing':
      return `${open}
          ${card.oneLine ? `<h3 class="recap-oneline r2">${highlightQuoted(card.oneLine)}</h3>` : ''}
          ${card.questions.length ? `
            <div class="recap-next r2">
              <span class="recap-next-label">${escHtml(t('recap.closing.next'))}</span>
              <ol class="recap-next-list">
                ${card.questions.map((q) => `<li>${escHtml(q)}</li>`).join('')}
              </ol>
            </div>` : ''}
          ${baseBar('', index, total)}
        </div>`;
  }
}

/** Escape text, drawing the one **marked** sentence as a highlighted span. */
function emphasisHtml(text: string): string {
  return splitEmphasis(text)
    .map((span) => (span.em ? `<b class="recap-em">${escHtml(span.text)}</b>` : escHtml(span.text)))
    .join('');
}

/**
 * How large to set a chapter's text. Public copy is a short distillation and the
 * private reading is longer, and one fixed size leaves the short one stranded in
 * the top half of its card. Latin text needs about twice the characters to fill
 * the same area, so its length is halved before comparing.
 */
export function bodySize(text: string): 'lg' | 'md' | 'sm' {
  const plain = plainText(text);
  const cjk = /[぀-ヿ㐀-鿿가-힯]/.test(plain);
  const units = cjk ? plain.length : plain.length / 2;
  if (units <= 95) return 'lg';
  if (units <= 160) return 'md';
  return 'sm';
}

/** Underline the phrase inside quotation marks, the way the share image does. */
function highlightQuoted(text: string): string {
  return text
    .split(/([“「][^”」]+[”」])/)
    .map((part) => (/^[“「]/.test(part) ? `<em>${escHtml(part)}</em>` : escHtml(part)))
    .join('');
}

/**
 * Four-axis radar. Four is not a stylistic choice — three axes render as a
 * sliver and five crowd the labels at this card size — which is why the schema
 * caps traits at exactly four.
 *
 * Clockwise from the top: up, right, down, left. A score of 100 reaches the
 * outer ring, 100 units from the centre. Every label sits OUTSIDE that ring, so
 * a high score can never run its dot into its own caption; the viewBox is
 * widened by 20 on each side so a six-glyph key on the left or right still fits.
 */
function radarSvg(traits: RecapTrait[]): string {
  const cx = 200;
  const cy = 185;
  const r = (score: number) => Math.max(8, Math.min(100, score));
  const [a, b, c, d] = traits.slice(0, 4).map((trait) => r(trait.score));
  const pts: Array<[number, number]> = [[cx, cy - a], [cx + b, cy], [cx, cy + c], [cx - d, cy]];
  const ring = (k: number) => `M${cx} ${cy - k}L${cx + k} ${cy}L${cx} ${cy + k}L${cx - k} ${cy}Z`;

  const label = (trait: RecapTrait, x: number, y: number, anchor: string) => `
    <text class="recap-radar-key" x="${x}" y="${y}" text-anchor="${anchor}">${escHtml(trait.key)}</text>
    <text class="recap-radar-score" x="${x}" y="${y + 24}" text-anchor="${anchor}">${Math.round(trait.score)}</text>`;

  return `
    <svg class="recap-radar" viewBox="-20 0 440 370" role="img" aria-label="${escHtml(t('recap.traits.title'))}">
      <path class="recap-radar-ring" d="${ring(100)}" opacity=".75"/>
      <path class="recap-radar-ring" d="${ring(75)}" opacity=".6"/>
      <path class="recap-radar-ring" d="${ring(50)}" opacity=".5"/>
      <path class="recap-radar-axis" d="M${cx} ${cy - 100}V${cy + 100}M${cx - 100} ${cy}h200"/>
      <path class="recap-radar-shape" d="M${pts.map(([x, y]) => `${x} ${y}`).join('L')}Z"/>
      ${pts.map(([x, y]) => `<circle class="recap-radar-pt" cx="${x}" cy="${y}" r="5"/>`).join('')}
      ${label(traits[0], cx, 22, 'middle')}
      ${label(traits[1], cx + 114, cy - 4, 'start')}
      ${label(traits[2], cx, cy + 128, 'middle')}
      ${label(traits[3], cx - 114, cy - 4, 'end')}
    </svg>
  `;
}

/* ── Marks (the large line drawing on a card front) ───────────────────────── */

const MARKS: Record<string, string> = {
  traits: '<path d="M20 3 37 20 20 37 3 20Z"/><path d="M20 10 30 20 20 30 10 20Z" opacity=".5"/>',
  attention: '<circle cx="20" cy="20" r="16"/><circle cx="20" cy="20" r="3.4" fill="currentColor"/><path d="M20 4v8M20 28v8M4 20h8M28 20h8"/>',
  method: '<path d="M5 32C12 32 14 8 21 8s9 24 15 24"/><circle cx="5" cy="32" r="2.4" fill="currentColor"/><circle cx="36" cy="32" r="2.4" fill="currentColor"/>',
  relations: '<circle cx="14" cy="20" r="9"/><circle cx="26" cy="20" r="9" opacity=".6"/>',
  friction: '<path d="M5 30 14 14l7 9 14-17"/><circle cx="35" cy="6" r="2.4" fill="currentColor"/>',
  recording: '<path d="M7 10h26M7 18h26M7 26h16M7 34h9"/>',
  throughline: '<path d="M20 6a14 14 0 1 1-13.3 9.7"/><path d="M6 6v10h10"/>',
  closing: '<path d="M6 28h28"/><path d="M12 12h16" opacity=".5"/><path d="M18 20h4" opacity=".5"/>',
};

function markSvg(key: string): string {
  const inner = MARKS[key] ?? MARKS.recording;
  return `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/* ── Chrome ───────────────────────────────────────────────────────────────── */

function headerHtml(cards: Card[], ui: RecapUiState): string {
  const total = cards.length;
  const open = cards.reduce((n, _card, i) => (i === 0 || ui.flipped.has(i) ? n + 1 : n), 0);
  const turnable = cards.map((_card, i) => i).filter((i) => i > 0);
  const done = turnable.length > 0 && turnable.every((i) => ui.flipped.has(i));

  return `
    <div class="recap-header">
      <div class="recap-header-text">
        <h2 class="recap-title">${escHtml(t('recap.title'))}</h2>
        <p class="recap-sub">${escHtml(ui.publicMode ? t('recap.sub.public') : t('recap.sub.private'))}</p>
      </div>
      <div class="recap-header-actions">
        <div class="recap-progress">
          <div class="recap-dots">
            ${cards.map((_card, i) => `<i class="recap-dot${i === 0 || ui.flipped.has(i) ? ' is-on' : ''}"></i>`).join('')}
          </div>
          <span class="recap-progress-label" data-recap-progress-label>${escHtml(t('recap.progress', { n: open, total }))}</span>
        </div>
        <div class="recap-segment" role="group">
          <button class="${ui.publicMode ? 'is-on' : ''}" data-recap-view="public" type="button">${escHtml(t('recap.view.public'))}</button>
          <button class="${ui.publicMode ? '' : 'is-on'}" data-recap-view="private" type="button">${escHtml(t('recap.view.private'))}</button>
        </div>
        <button class="btn btn-ghost" data-recap-flip-all type="button">${escHtml(done ? t('recap.reset') : t('recap.turnAll'))}</button>
      </div>
    </div>
  `;
}

function footerHtml(cards: Card[]): string {
  const flagged = cards.filter((c) => flagsOf(c).length > 0).length;

  return `
    <div class="recap-footer">
      <p class="recap-privacy-note">
        ${flagged ? `<b>${escHtml(t('recap.flagNote', { n: flagged }))}</b> · ` : ''}${escHtml(t('recap.shareNote2'))}
        <span class="recap-save-hint">${escHtml(t('recap.hint.save'))}</span>
      </p>
      <div class="recap-footer-actions">
        <button class="btn btn-ghost" data-recap-regenerate type="button">${escHtml(t('recap.regenerate'))}</button>
        <button class="btn btn-primary" data-recap-export type="button">${escHtml(t('recap.export'))}</button>
      </div>
    </div>
  `;
}

/* ── Pre-portrait states ──────────────────────────────────────────────────── */

function emptyHtml(entryCount: number, minEntries: number, ui: RecapUiState): string {
  const ready = entryCount >= minEntries;
  return `
    ${ui.error ? `<p class="recap-error">${escHtml(ui.error)}</p>` : ''}
    <div class="recap-empty">
      <div class="recap-empty-deck" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <h3>${escHtml(t('recap.empty.title'))}</h3>
      <p>${escHtml(t('recap.empty.body'))}</p>
      ${ready ? `
        <button class="btn btn-primary" data-recap-generate type="button">${escHtml(t('recap.empty.generate'))}</button>
        <span class="recap-basis">${escHtml(t('recap.empty.basis', { n: entryCount }))}</span>
      ` : `
        <p class="recap-locked">${escHtml(t('recap.empty.locked', { n: entryCount, min: minEntries }))}</p>
        <div class="recap-progress-bar"><i style="width:${Math.round((entryCount / minEntries) * 100)}%"></i></div>
      `}
    </div>
  `;
}

function loadingHtml(entryCount: number): string {
  return `
    <div class="recap-empty is-loading">
      <div class="recap-empty-deck is-dealing" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <h3>${escHtml(t('recap.loading.title', { n: entryCount }))}</h3>
      <p>${escHtml(t('recap.loading.body'))}</p>
    </div>
  `;
}
