/* ==========================================================================
   On the Road · Pack — the bag form (add / edit)
   --------------------------------------------------------------------------
   One dialog for making or restyling a bag: name, what kind of bag it is (drawn,
   not listed), its colour and size, and — when new — its empty weight and limit.
   A live picture on the side is the same renderBag the pack screen uses, so what
   you pick is what you get. No stores in here: the caller saves the values.
   ========================================================================== */

import type { PackContainer } from '../../data/schema.ts';
import { renderBag, bagWidth, bagSizeFor, BAG_TONES, type BagSize } from '../../core/paper/luggage.ts';
import { openModal } from '../../core/modal.ts';
import { escHtml } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';
import { KINDS, num } from '../pack/pack-helpers.ts';

export type BagKindValue = PackContainer['kind'];

export interface BagFormValues {
  label: string;
  kind: BagKindValue;
  /** null = pick automatically */
  tone: number | null;
  size: BagSize | null;
  /** Only set when adding (a bag's weights are edited inline afterwards). */
  selfWeightG?: number;
  limitG?: number;
}

export interface BagFormOpts {
  /** Present when restyling an existing bag. */
  existing?: PackContainer;
  /** The colour a new bag starts with. */
  defaultTone: number;
  /** "kg" / "lb" / "斤" — shown next to the weight boxes. */
  unitLabel: string;
  /** The user's unit → grams. */
  toGrams: (n: number) => number;
  onSave: (v: BagFormValues) => Promise<void> | void;
}

const SIZES: BagSize[] = ['S', 'M', 'L'];

/** The picture and its width for the current choices (size = auto falls back to the limit). */
export function bagPreview(kind: BagKindValue, tone: number, size: BagSize | null, limitG: number): string {
  const px = bagWidth(kind, true, size ?? bagSizeFor(limitG));
  return `<div class="bagf-art" style="width:${px}px">${renderBag(kind, { loadPct: 55, uid: 'bagf-preview', tone })}</div>`;
}

export function openBagForm(opts: BagFormOpts): void {
  const ex = opts.existing;
  let kind: BagKindValue = ex?.kind ?? 'backpack';
  let tone: number = ex?.tone ?? opts.defaultTone;
  let size: BagSize | null = ex?.size ?? null;

  const m = openModal({
    title: ex ? t('pack.bagForm.editTitle') : t('pack.bagForm.addTitle'),
    body: `
      <div class="bagf">
        <div class="bagf-fields">
          <label class="field-label" for="pk-c-label">${escHtml(t('pack.bagForm.name'))}</label>
          <input class="input" id="pk-c-label" placeholder="${escHtml(t('pack.bagForm.namePh'))}" value="${escHtml(ex?.label ?? '')}">

          <div class="field-label">${escHtml(t('pack.bagForm.kind'))}</div>
          <div class="bagf-kinds" role="radiogroup" aria-label="${escHtml(t('pack.bagForm.kind'))}">
            ${KINDS.map((k) => `
              <button type="button" role="radio" class="bagf-kind" data-kind="${k.value}" aria-checked="${k.value === kind}">
                <span class="bagf-kind-art">${renderBag(k.value, { loadPct: 0, uid: `bagf-k-${k.value}`, tone })}</span>
                <span>${escHtml(k.label)}</span>
              </button>`).join('')}
          </div>

          <div class="field-label">${escHtml(t('pack.bagForm.colour'))}</div>
          <div class="bagf-swatches" role="radiogroup" aria-label="${escHtml(t('pack.bagForm.colour'))}">
            ${Array.from({ length: BAG_TONES }, (_, i) => `<button type="button" role="radio" class="lg-swatch bagf-swatch" data-tone="${i}" aria-checked="${i === tone}" aria-label="${escHtml(t('pack.bagForm.colourN', { n: i + 1 }))}"></button>`).join('')}
          </div>

          <div class="field-label">${escHtml(t('pack.bagForm.size'))}</div>
          <div class="bagf-sizes" role="radiogroup" aria-label="${escHtml(t('pack.bagForm.size'))}">
            <button type="button" role="radio" class="bagf-size" data-size="" aria-checked="${size === null}">${escHtml(t('pack.bagForm.sizeAuto'))}</button>
            ${SIZES.map((s) => `<button type="button" role="radio" class="bagf-size" data-size="${s}" aria-checked="${s === size}">${s}</button>`).join('')}
          </div>

          ${ex ? '' : `
          <div class="bagf-weights">
            <div><label class="field-label" for="pk-c-self">${escHtml(t('pack.bagForm.empty', { u: opts.unitLabel }))}</label>
              <input class="input" id="pk-c-self" type="number" min="0" step="any" placeholder="0"></div>
            <div><label class="field-label" for="pk-c-limit">${escHtml(t('pack.bagForm.limit', { u: opts.unitLabel }))}</label>
              <input class="input" id="pk-c-limit" type="number" min="0" step="any" placeholder="0"></div>
          </div>`}
        </div>
        <div class="bagf-preview" data-preview aria-hidden="true"></div>
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-act="cancel">${escHtml(t('pack.bagForm.cancel'))}</button>
      <button class="btn btn-primary" data-act="confirm">${escHtml(ex ? t('pack.bagForm.save') : t('pack.bagForm.add'))}</button>`,
  });

  const root = m.root;
  const limitInput = root.querySelector<HTMLInputElement>('#pk-c-limit');
  const limitG = () => (ex ? ex.limitG : opts.toGrams(num(limitInput?.value || '0')));
  const paint = () => {
    const prev = root.querySelector<HTMLElement>('[data-preview]');
    // eslint-disable-next-line no-restricted-syntax -- audited: bagPreview builds markup from enums and numbers only
    if (prev) prev.innerHTML = bagPreview(kind, tone, size, limitG());
    root.querySelectorAll<HTMLElement>('.bagf-kind').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === kind)));
    root.querySelectorAll<HTMLElement>('.bagf-swatch').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.tone) === tone)));
    root.querySelectorAll<HTMLElement>('.bagf-size').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.size || null) === size)));
    root.querySelectorAll<HTMLElement>('.bagf-kind-art .lg-bag').forEach((svg) => svg.setAttribute('data-tone', String(tone)));
  };
  paint();

  root.querySelectorAll<HTMLElement>('.bagf-kind').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind as BagKindValue; paint(); }));
  root.querySelectorAll<HTMLElement>('.bagf-swatch').forEach((b) => b.addEventListener('click', () => { tone = Number(b.dataset.tone); paint(); }));
  root.querySelectorAll<HTMLElement>('.bagf-size').forEach((b) => b.addEventListener('click', () => { size = (b.dataset.size || null) as BagSize | null; paint(); }));
  limitInput?.addEventListener('input', paint);

  const label = root.querySelector<HTMLInputElement>('#pk-c-label');
  requestAnimationFrame(() => label?.focus());
  root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => m.close());
  const save = async () => {
    const name = (label?.value || '').trim();
    if (!name) { label?.focus(); return; }
    const values: BagFormValues = { label: name, kind, tone, size };
    if (!ex) {
      values.selfWeightG = opts.toGrams(num(root.querySelector<HTMLInputElement>('#pk-c-self')?.value || '0'));
      values.limitG = limitG();
    }
    m.close();
    await opts.onSave(values);
  };
  root.querySelector('[data-act="confirm"]')?.addEventListener('click', () => void save());
  label?.addEventListener('keydown', (e) => { if (e.key === 'Enter') void save(); });
}
