/* ==========================================================================
   On the Road · Modal / Sheet factory
   --------------------------------------------------------------------------
   One place to spin up a centred dialog or a bottom sheet. Handles the
   backdrop, ESC-to-close, click-outside-to-close, focus, and teardown so
   call sites only describe content and wire their own action buttons against
   the returned root element.

   Usage:
     const m = openModal({
       title: 'Trip budget',
       body: `<input class="input" id="amt">`,
       footer: `<button class="btn btn-primary" data-act="save">Save</button>`,
     });
     m.root.querySelector('[data-act="save"]')!.addEventListener('click', () => {
       ...; m.close();
     });
   ========================================================================== */

import { escHtml } from './utils.ts';

export interface ModalHandle {
  /** The backdrop element. */
  backdrop: HTMLElement;
  /** The inner dialog/sheet element — query your buttons/inputs from here. */
  root: HTMLElement;
  /** Remove the modal and detach listeners. Safe to call more than once. */
  close: () => void;
}

interface ModalOptions {
  /** Heading text (plain text — escaped for you). Omit for a chrome-less modal. */
  title?: string;
  /** Inner HTML for the body region. */
  body: string;
  /** Inner HTML for the footer (usually action buttons). Omit to hide the footer. */
  footer?: string;
  /** 'modal' = centred card · 'sheet' = bottom-anchored (mobile-style) sheet. */
  variant?: 'modal' | 'sheet';
  /** Extra class on the dialog element, for per-call-site styling. */
  className?: string;
  /** Called after teardown (e.g. to repaint the caller). */
  onClose?: () => void;
  /** Clicking the backdrop closes by default; set false to require a button. */
  closeOnBackdrop?: boolean;
  /** Show the ✕ close button in the header (default true when a title is set). */
  showClose?: boolean;
}

let _openCount = 0;

export function openModal(opts: ModalOptions): ModalHandle {
  const {
    title, body, footer, variant = 'modal', className = '',
    onClose, closeOnBackdrop = true, showClose,
  } = opts;

  const backdrop = document.createElement('div');
  backdrop.className = `otr-modal-backdrop otr-modal-backdrop--${variant}`;

  const wantsClose = showClose ?? !!title;
  const header = title
    ? `<div class="otr-modal-header">
         <div class="otr-modal-title">${escHtml(title)}</div>
         ${wantsClose ? '<button class="otr-modal-close" data-otr-close aria-label="Close">✕</button>' : ''}
       </div>`
    : '';

  backdrop.innerHTML = `
    <div class="otr-modal otr-modal--${variant} ${className}" role="dialog" aria-modal="true">
      ${header}
      <div class="otr-modal-body">${body}</div>
      ${footer ? `<div class="otr-modal-footer">${footer}</div>` : ''}
    </div>`;

  const root = backdrop.querySelector('.otr-modal') as HTMLElement;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    _openCount = Math.max(0, _openCount - 1);
    if (_openCount === 0) document.body.classList.remove('otr-modal-open');
    onClose?.();
  };

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

  backdrop.addEventListener('click', (e) => {
    if (closeOnBackdrop && e.target === backdrop) close();
  });
  root.querySelectorAll('[data-otr-close]').forEach((b) =>
    b.addEventListener('click', () => close()));
  document.addEventListener('keydown', onKey);

  document.body.appendChild(backdrop);
  _openCount += 1;
  document.body.classList.add('otr-modal-open');

  // Autofocus the first focusable control in the body, if any.
  root.querySelector<HTMLElement>('.otr-modal-body input, .otr-modal-body textarea, .otr-modal-body select')?.focus();

  return { backdrop, root, close };
}

/** Convenience wrapper for the bottom-sheet variant. */
export function openSheet(opts: Omit<ModalOptions, 'variant'>): ModalHandle {
  return openModal({ ...opts, variant: 'sheet' });
}
