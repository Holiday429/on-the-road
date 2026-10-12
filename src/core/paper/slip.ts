/* ==========================================================================
   On the Road · Paper kit · printed slip
   --------------------------------------------------------------------------
   A till receipt that prints out in the corner of the screen and tears itself
   away a few seconds later — the "it worked" confirmation for anything that
   deserves more than a toast. One at a time: a new slip replaces the old one.

       showSlip({ title: 'Receipt', rows: [...], total: {...}, stamp: {...} })
   ========================================================================== */

import './paper.css';
import { paperReceipt, printIn, type PaperReceiptOpts } from './paper.ts';

export interface SlipOptions extends Omit<PaperReceiptOpts, 'zigzag' | 'className' | 'attrs'> {
  /** How long it stays, ms (default 3600). */
  ms?: number;
}

let current: { close: () => void } | null = null;

export function closeSlip(): void {
  current?.close();
}

export function showSlip(opts: SlipOptions): () => void {
  closeSlip();
  const host = document.createElement('div');
  host.className = 'paper-slip-host';
  host.setAttribute('role', 'status');
  // eslint-disable-next-line no-restricted-syntax -- audited: paperReceipt escapes every value
  host.innerHTML = paperReceipt({ ...opts, zigzag: true });
  document.body.appendChild(host);
  printIn(host.firstElementChild);

  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    host.classList.add('is-leaving');
    window.setTimeout(() => host.remove(), 240);
    if (current?.close === close) current = null;
  };
  host.addEventListener('click', close);
  timer = window.setTimeout(close, opts.ms ?? 3600);
  current = { close };
  return close;
}
