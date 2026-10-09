/* ==========================================================================
   On the Road · Recap export — small UI helpers
   ========================================================================== */

import { openModal } from '../../../../core/modal.ts';

/** A brief, non-blocking notice (same shell as the app's other transient toasts). */
export function toast(message: string): void {
  const el = document.createElement('div');
  el.className = 'otr-pay-toast otr-pay-toast--warn';
  el.textContent = message;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 4500);
}

/** Ask a yes/no question; resolves false when dismissed. */
export function confirmModal(message: string, okLabel: string, cancelLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (value: boolean) => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

    const modal = openModal({
      variant: 'modal',
      body: `<p class="recap-confirm-text">${esc(message)}</p>`,
      footer: `
        <button class="btn btn-ghost" data-act="no" type="button">${esc(cancelLabel)}</button>
        <button class="btn btn-primary" data-act="yes" type="button">${esc(okLabel)}</button>`,
      onClose: () => answer(false),
    });
    modal.root.querySelector('[data-act="no"]')?.addEventListener('click', () => { answer(false); modal.close(); });
    modal.root.querySelector('[data-act="yes"]')?.addEventListener('click', () => { answer(true); modal.close(); });
  });
}
