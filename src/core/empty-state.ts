/* ==========================================================================
   On the Road · Empty-state component
   --------------------------------------------------------------------------
   One shared first-run empty state for every view: an icon, a one-line value
   prop, and a single primary call-to-action. Use it so all 12 modules teach
   the user the same way instead of each inventing its own blank screen.

   const el = emptyState({
     icon: '🧳',
     title: 'Pack light, travel right',
     desc: 'Set your bags and weight budget, then let the formula fill the rest.',
     cta: { label: 'Set up packing', onClick: () => openSetup() },
   });
   container.replaceChildren(el);
   ========================================================================== */

import './empty-state.css';
import { escHtml } from './utils.ts';

export interface EmptyStateOpts {
  /** Emoji or short glyph shown above the title. */
  icon: string;
  /** One-line value proposition (what this page is for). */
  title: string;
  /** A sentence of supporting copy. Optional. */
  desc?: string;
  /** Primary action. Optional — omit for a purely informational empty state. */
  cta?: { label: string; onClick: () => void };
  /** A secondary, lower-emphasis action. Optional. */
  secondary?: { label: string; onClick: () => void };
}

/** Build (don't mount) the empty-state element. Caller places it. */
export function emptyState(opts: EmptyStateOpts): HTMLElement {
  const el = document.createElement('div');
  el.className = 'otr-empty';
  el.innerHTML = `
    <div class="otr-empty-icon" aria-hidden="true">${opts.icon}</div>
    <div class="otr-empty-title">${escHtml(opts.title)}</div>
    ${opts.desc ? `<div class="otr-empty-desc">${escHtml(opts.desc)}</div>` : ''}
    ${opts.cta || opts.secondary ? `
      <div class="otr-empty-actions">
        ${opts.cta ? `<button type="button" class="btn btn-primary otr-empty-cta">${escHtml(opts.cta.label)}</button>` : ''}
        ${opts.secondary ? `<button type="button" class="btn btn-ghost otr-empty-secondary">${escHtml(opts.secondary.label)}</button>` : ''}
      </div>
    ` : ''}
  `;

  if (opts.cta) {
    el.querySelector<HTMLButtonElement>('.otr-empty-cta')!
      .addEventListener('click', opts.cta.onClick);
  }
  if (opts.secondary) {
    el.querySelector<HTMLButtonElement>('.otr-empty-secondary')!
      .addEventListener('click', opts.secondary.onClick);
  }
  return el;
}

/** Convenience: build the empty state straight into a container (clears it). */
export function renderEmptyState(container: HTMLElement, opts: EmptyStateOpts): void {
  container.replaceChildren(emptyState(opts));
}
