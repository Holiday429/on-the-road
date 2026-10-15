/* ==========================================================================
   On the Road · Prepare — small shared UI (menu, breadcrumb)
   --------------------------------------------------------------------------
   The landing's "+ New ▾" and both editors' "⋯" menu, so Checklist and Pack read
   as the same product. (Going back is the page title's job — see setViewHome.)
   Markup only; one document-level listener drives every menu, so re-rendering a
   screen never leaks handlers.
   ========================================================================== */

import { escHtml } from '../../core/utils.ts';

export interface MenuItem {
  /** Becomes `data-act`, so callers bind it like any other action button. */
  act: string;
  label: string;
  icon?: string;
  danger?: boolean;
}

/** A button that opens a small list of actions. `label` is the button's own text. */
export function renderMenu(label: string, items: MenuItem[], opts: { variant?: 'primary' | 'ghost' | 'icon'; title?: string } = {}): string {
  const variant = opts.variant ?? 'ghost';
  const cls = variant === 'primary' ? 'btn btn-primary' : variant === 'icon' ? 'btn btn-ghost prep-menu-icon' : 'btn btn-ghost';
  return `
    <div class="prep-menu">
      <button type="button" class="${cls} prep-menu-btn" data-menu-btn aria-haspopup="menu" aria-expanded="false"${opts.title ? ` title="${escHtml(opts.title)}" aria-label="${escHtml(opts.title)}"` : ''}>${escHtml(label)}</button>
      <div class="prep-menu-list" role="menu">
        ${items.map((i) => `
          <button type="button" role="menuitem" class="prep-menu-item${i.danger ? ' is-danger' : ''}" data-act="${escHtml(i.act)}">
            ${i.icon ? `<span aria-hidden="true">${escHtml(i.icon)}</span>` : ''}<span>${escHtml(i.label)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

let wired = false;

function setOpen(menu: Element, open: boolean): void {
  menu.classList.toggle('is-open', open);
  menu.querySelector('[data-menu-btn]')?.setAttribute('aria-expanded', String(open));
}

/** Installs the one listener every `.prep-menu` shares (safe to call on every render). */
export function wireMenus(): void {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const btn = target?.closest('[data-menu-btn]') ?? null;
    const own = btn?.closest('.prep-menu') ?? null;
    document.querySelectorAll('.prep-menu.is-open').forEach((m) => { if (m !== own) setOpen(m, false); });
    if (own) setOpen(own, !own.classList.contains('is-open'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const openMenus = document.querySelectorAll('.prep-menu.is-open');
    if (openMenus.length) e.preventDefault(); // this Escape was spent on closing the menu — nothing else should react to it
    openMenus.forEach((m) => {
      setOpen(m, false);
      m.querySelector<HTMLElement>('[data-menu-btn]')?.focus();
    });
  });
}
