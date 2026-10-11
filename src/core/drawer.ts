/* ==========================================================================
   On the Road · Side drawer
   --------------------------------------------------------------------------
   The one "show me the details" surface for the Dashboard: slides in from the
   right on desktop, rises as a half-height sheet on narrow screens. Only one
   drawer is open at a time — opening a second replaces the first.

   Click the scrim / press Esc / hit ✕ to close. Focus is trapped inside while
   open and handed back to the element that opened it on close.

   Usage:
     const d = openDrawer({ title: 'Room in Rome', body: '<p>…</p>' });
     d.setBody(newHtml);   // repaint in place (e.g. after a store update)
     d.close();
   ========================================================================== */

import { escHtml } from './utils.ts';
import { t } from './i18n.ts';
import './drawer.css';

export interface DrawerHandle {
  /** The drawer panel — query your buttons/inputs from here. */
  root: HTMLElement;
  /** The scrollable body region. */
  body: HTMLElement;
  /** Replace the body HTML in place; scroll position is kept. */
  setBody: (html: string) => void;
  /** Close and tear down. Safe to call more than once. */
  close: () => void;
}

export interface DrawerOptions {
  /** Heading text (plain text — escaped for you). */
  title: string;
  /** Optional small line under the title (plain text — escaped). */
  subtitle?: string;
  /** Inner HTML for the body. Callers must escape their own interpolations. */
  body: string;
  /** Inner HTML for a sticky footer (usually action buttons). */
  footer?: string;
  /** Extra class on the panel, for per-call-site styling. */
  className?: string;
  /** Element to hand focus back to on close (default: the focused element at open). */
  returnFocus?: HTMLElement | null;
  /** Called after teardown. */
  onClose?: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let current: { close: () => void } | null = null;
// Set while a new drawer replaces the old one, so the old one doesn't steal focus back.
let replacing = false;

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

export function isDrawerOpen(): boolean { return current !== null; }

/** Close whatever drawer is open (no-op if none). */
export function closeDrawer(): void { current?.close(); }

export function openDrawer(opts: DrawerOptions): DrawerHandle {
  const returnTarget = opts.returnFocus !== undefined
    ? opts.returnFocus
    : (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement : null);
  // One at a time.
  if (current) { replacing = true; current.close(); replacing = false; }

  const scrim = document.createElement('div');
  scrim.className = 'otr-drawer-scrim';

  const subtitle = opts.subtitle
    ? `<div class="otr-drawer-sub">${escHtml(opts.subtitle)}</div>` : '';
  // eslint-disable-next-line no-restricted-syntax -- audited: title/subtitle escaped via escHtml; body/footer are caller-escaped HTML
  scrim.innerHTML = `
    <aside class="otr-drawer ${opts.className ?? ''}" role="dialog" aria-modal="true" aria-label="${escHtml(opts.title)}" tabindex="-1">
      <header class="otr-drawer-head">
        <div class="otr-drawer-titles">
          <div class="otr-drawer-title">${escHtml(opts.title)}</div>
          ${subtitle}
        </div>
        <button type="button" class="otr-drawer-close" data-otr-close aria-label="${escHtml(t('common.close'))}">✕</button>
      </header>
      <div class="otr-drawer-body">${opts.body}</div>
      ${opts.footer ? `<footer class="otr-drawer-foot">${opts.footer}</footer>` : ''}
    </aside>`;

  const root = scrim.querySelector<HTMLElement>('.otr-drawer')!;
  const bodyEl = scrim.querySelector<HTMLElement>('.otr-drawer-body')!;
  if (reducedMotion()) scrim.classList.add('otr-drawer-scrim--static');

  let closed = false;
  const handle: DrawerHandle = {
    root,
    body: bodyEl,
    setBody: (html) => {
      // eslint-disable-next-line no-restricted-syntax -- audited: caller-escaped HTML, same contract as `body`
      bodyEl.innerHTML = html;
    },
    close: () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      if (current === self) {
        current = null;
        document.body.classList.remove('otr-drawer-open');
      }
      if (!replacing && returnTarget && returnTarget.isConnected) returnTarget.focus();
      opts.onClose?.();
    },
  };
  const self = { close: handle.close };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); handle.close(); return; }
    if (e.key !== 'Tab') return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => !el.closest('[hidden]'));
    if (!items.length) { e.preventDefault(); root.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === root)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    else if (!root.contains(active)) { e.preventDefault(); first.focus(); }
  };

  scrim.addEventListener('click', (e) => { if (e.target === scrim) handle.close(); });
  root.querySelector('[data-otr-close]')!.addEventListener('click', () => handle.close());
  document.addEventListener('keydown', onKey, true);

  current = self;
  document.body.appendChild(scrim);
  document.body.classList.add('otr-drawer-open');
  // Start on the panel itself so screen readers announce the dialog, not a random control.
  root.focus({ preventScroll: true });

  return handle;
}
