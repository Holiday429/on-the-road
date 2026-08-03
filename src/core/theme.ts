/* ==========================================================================
   On the Road · Theme (light / dark / system)
   --------------------------------------------------------------------------
   The stored *preference* is 'light' | 'dark' | 'system' (localStorage key
   otr_theme, mirrored to users/{uid}.theme). The DOM only ever sees the
   *resolved* theme: <html data-theme="light|dark">, set pre-paint by the
   inline script in app.html (keep key + meta colors in sync with it) and
   kept current here after boot.

   Applying a theme dispatches `otr:theme-change` on window; core/app.ts
   re-inits mounted views so JS-drawn colors (amCharts map, inline note
   tints) pick up the new palette.
   ========================================================================== */

import { t } from './i18n.ts';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'otr_theme';
const META_LIGHT = '#E8940A';
const META_DARK = '#191714';

const PREFS: ThemePref[] = ['light', 'dark', 'system'];

function isPref(v: unknown): v is ThemePref {
  return typeof v === 'string' && (PREFS as string[]).includes(v);
}

/** Resolve a stored preference + system state to a concrete theme. Pure. */
export function resolveTheme(stored: unknown, systemDark: boolean): ResolvedTheme {
  if (stored === 'dark') return 'dark';
  if (stored === 'light') return 'light';
  return systemDark ? 'dark' : 'light';
}

/* ── State ─────────────────────────────────────────────────────────────────── */

let _pref: ThemePref = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isPref(stored)) return stored;
  } catch { /* private mode */ }
  return 'system';
})();

function systemDark(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
  catch { return false; }
}

export function getThemePref(): ThemePref {
  return _pref;
}

export function currentTheme(): ResolvedTheme {
  return resolveTheme(_pref, systemDark());
}

/* ── Apply ─────────────────────────────────────────────────────────────────── */

function apply(): void {
  const theme = currentTheme();
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? META_DARK : META_LIGHT);
  try {
    window.dispatchEvent(new CustomEvent('otr:theme-change', { detail: { theme } }));
  } catch { /* ignore */ }
}

export function setThemePref(next: ThemePref): void {
  if (!isPref(next) || next === _pref) return;
  _pref = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  apply();
  void persistThemeToProfile(next);
}

/** Wire the system-preference listener. Call once at boot. */
export function initTheme(): void {
  try {
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => { if (_pref === 'system') apply(); });
  } catch { /* matchMedia unsupported */ }
  apply();
}

/* ── Cloud sync (mirrors i18n locale: explicit local choice wins) ──────────── */

export async function loadThemeFromProfile(): Promise<void> {
  let hasLocalChoice = false;
  try { hasLocalChoice = isPref(localStorage.getItem(STORAGE_KEY)); } catch { /* ignore */ }
  if (hasLocalChoice) return;

  try {
    const { currentUser } = await import('../firebase/auth.ts');
    const u = currentUser();
    if (!u) return;
    const { db: firestore } = await import('../firebase/config.ts');
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(firestore, `users/${u.uid}`));
    const pref = snap.exists() ? (snap.data() as { theme?: unknown }).theme : null;
    if (isPref(pref) && pref !== _pref) {
      _pref = pref;
      try { localStorage.setItem(STORAGE_KEY, pref); } catch { /* ignore */ }
      apply();
    }
  } catch (e) {
    console.warn('Could not load theme from profile:', e);
  }
}

async function persistThemeToProfile(pref: ThemePref): Promise<void> {
  try {
    const { currentUser } = await import('../firebase/auth.ts');
    const u = currentUser();
    if (!u) return;
    const { db: firestore } = await import('../firebase/config.ts');
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(firestore, `users/${u.uid}`), { theme: pref, updatedAt: Date.now() }, { merge: true });
  } catch (e) {
    console.warn('Could not persist theme to profile:', e);
  }
}

/* ── Toggle control (visual sibling of core/language-picker.ts) ────────────── */

const PREF_META: Record<ThemePref, { icon: string; key: string }> = {
  light:  { icon: '☀️', key: 'theme.light' },
  dark:   { icon: '🌙', key: 'theme.dark' },
  system: { icon: '🌓', key: 'theme.system' },
};

export interface ThemeToggleInstance {
  destroy(): void;
}

export function createThemeToggle(container: HTMLElement): ThemeToggleInstance {
  let open = false;
  let popover: HTMLElement | null = null;

  container.classList.add('lang-picker', 'theme-toggle');
  // eslint-disable-next-line no-restricted-syntax -- audited: static markup, no interpolation
  container.innerHTML = '';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-ghost lang-picker-btn theme-toggle-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  renderButton();
  container.appendChild(btn);

  function renderButton() {
    const meta = PREF_META[_pref];
    // eslint-disable-next-line no-restricted-syntax -- audited: values from the static PREF_META/i18n tables
    btn.innerHTML = `<span class="lang-picker-flag">${meta.icon}</span><span class="lang-picker-label">${t(meta.key)}</span>`;
    btn.title = t('theme.button');
    btn.setAttribute('aria-label', t('theme.button'));
  }

  function openPopover() {
    if (open) return;
    open = true;
    btn.setAttribute('aria-expanded', 'true');

    const el = document.createElement('div');
    el.className = 'dest-dropdown lang-picker-dropdown';
    el.setAttribute('role', 'listbox');
    // eslint-disable-next-line no-restricted-syntax -- audited: values from the static PREF_META/i18n tables
    el.innerHTML = `
      <div class="dest-dropdown-section">
        <div class="dest-dropdown-section-label">${t('theme.title')}</div>
        ${PREFS.map((p) => `
          <button type="button" class="dest-dropdown-item${p === _pref ? ' is-active' : ''}"
                  data-theme-pref="${p}" role="option" aria-selected="${p === _pref}">
            <span class="dest-dropdown-item-flag">${PREF_META[p].icon}</span>
            <span class="dest-dropdown-item-text">${t(PREF_META[p].key)}</span>
            ${p === _pref ? '<span class="dest-dropdown-item-type">✓</span>' : ''}
          </button>
        `).join('')}
      </div>`;

    el.querySelectorAll<HTMLButtonElement>('[data-theme-pref]').forEach((item) => {
      item.addEventListener('click', () => {
        setThemePref(item.dataset.themePref as ThemePref);
        renderButton();
        closePopover();
      });
    });

    container.appendChild(el);
    popover = el;

    setTimeout(() => {
      document.addEventListener('click', onDocClick, { capture: true });
      document.addEventListener('keydown', onKeydown);
    }, 0);
  }

  function closePopover() {
    if (!open) return;
    open = false;
    btn.setAttribute('aria-expanded', 'false');
    popover?.remove();
    popover = null;
    document.removeEventListener('click', onDocClick, { capture: true });
    document.removeEventListener('keydown', onKeydown);
  }

  function onDocClick(e: MouseEvent) {
    if (!container.contains(e.target as Node)) closePopover();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closePopover();
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (open) closePopover(); else openPopover();
  });

  return {
    destroy() {
      closePopover();
      // eslint-disable-next-line no-restricted-syntax -- audited: static markup, no interpolation
      container.innerHTML = '';
      container.classList.remove('lang-picker', 'theme-toggle');
    },
  };
}
