/* ==========================================================================
   On the Road · i18n — UI localization + AI output language
   --------------------------------------------------------------------------
   Source language is English. Users may switch the *functional UI* language
   and the language the AI generates content in. User-authored content (journal
   notes, expense memos, etc.) is never touched — people write in whatever
   language they like.

   Persistence (per the product decision):
     - localStorage  → instant, works logged-out and in viewer mode
     - users/{uid}   → multi-device sync once signed in (best-effort)

   Usage:

     import { t, getLocale, setLocale, onLocaleChange } from './i18n.ts';
     t('nav.today')                       // → localized string
     t('dash.daysToGo', { n: 3 })         // → with interpolation
     setLocale('zh');                     // switch + persist + broadcast
     onLocaleChange(() => render());      // re-render on change

   Translation tables live in ./i18n-strings.ts. A missing key falls back to
   English, then to the raw key, so the app never renders a blank.
   ========================================================================== */

import { STRINGS } from './i18n-strings.ts';

export type Locale = 'en' | 'zh' | 'ja' | 'fr' | 'es' | 'ko';

export interface LocaleMeta {
  code: Locale;
  /** Endonym shown in the picker (the language in its own script). */
  label: string;
  flag: string;
  /** Plain-English name handed to the AI: "Respond in <aiName>". */
  aiName: string;
}

/**
 * Single source of truth for the *offered* set (picker order = this order).
 * ja/fr/es/ko are ~30% translated (see ./i18n/*.ts) — t() falls back to
 * English for missing keys, so they're not broken, just a mixed-language
 * experience. Hidden from the picker until each is filled in; re-add its
 * entry here to bring it back. A user who already had one of those four set
 * as their preference (localStorage/profile) falls back to English on load
 * (see isLocale() below) — their original choice is left untouched in
 * storage, so restoring the entry here picks it back up automatically.
 */
export const LOCALES: LocaleMeta[] = [
  { code: 'en', label: 'English',  flag: '🇬🇧', aiName: 'English' },
  { code: 'zh', label: '中文',      flag: '🇨🇳', aiName: 'Simplified Chinese' },
];

const DEFAULT_LOCALE: Locale = 'en';
const STORAGE_KEY = 'otr_locale';

function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && LOCALES.some((l) => l.code === v);
}

/* ── State ─────────────────────────────────────────────────────────────────── */

let _locale: Locale = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
    // First visit: take a best-guess from the browser, but only if supported.
    const nav = (navigator.language || '').slice(0, 2).toLowerCase();
    if (isLocale(nav)) return nav;
  } catch { /* private mode / SSR */ }
  return DEFAULT_LOCALE;
})();

const listeners = new Set<() => void>();

/* ── Public read API ───────────────────────────────────────────────────────── */

export function getLocale(): Locale {
  return _locale;
}

export function getLocaleMeta(code: Locale = _locale): LocaleMeta {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}

/** Plain-English language name for AI prompts (e.g. "Simplified Chinese"). */
export function aiLanguage(): string {
  return getLocaleMeta().aiName;
}

/**
 * Translate a dotted key. Falls back: current locale → English → the key.
 * `vars` interpolates `{name}` placeholders in the string.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const table = STRINGS[_locale] ?? {};
  const raw = table[key] ?? STRINGS.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_m, name) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

/* ── Mutation ──────────────────────────────────────────────────────────────── */

export function setLocale(next: Locale): void {
  if (!isLocale(next) || next === _locale) return;
  _locale = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  document.documentElement.setAttribute('lang', next);
  void persistLocaleToProfile(next);
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.warn('locale listener failed', e); }
  }
}

/* ── Change subscription ───────────────────────────────────────────────────── */

/** Subscribe to locale changes. Returns an unsubscribe fn. */
export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ── Cloud sync (best-effort) ──────────────────────────────────────────────── */

/**
 * Pull the saved locale from users/{uid} on sign-in. localStorage is the source
 * of truth for an *explicit* local choice; we only adopt the cloud value when
 * the user hasn't set one on this device yet, so switching language here doesn't
 * get clobbered by an older profile value.
 */
export async function loadLocaleFromProfile(): Promise<void> {
  let hasLocalChoice = false;
  try { hasLocalChoice = isLocale(localStorage.getItem(STORAGE_KEY)); } catch { /* ignore */ }
  if (hasLocalChoice) return;

  try {
    const { currentUser } = await import('../firebase/auth.ts');
    const u = currentUser();
    if (!u) return;
    const { db: firestore } = await import('../firebase/config.ts');
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(firestore, `users/${u.uid}`));
    const code = snap.exists() ? (snap.data() as { locale?: unknown }).locale : null;
    if (isLocale(code) && code !== _locale) {
      _locale = code;
      try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
      document.documentElement.setAttribute('lang', code);
      for (const fn of listeners) { try { fn(); } catch { /* ignore */ } }
    }
  } catch (e) {
    console.warn('Could not load locale from profile:', e);
  }
}

async function persistLocaleToProfile(code: Locale): Promise<void> {
  try {
    const { currentUser } = await import('../firebase/auth.ts');
    const u = currentUser();
    if (!u) return;
    const { db: firestore } = await import('../firebase/config.ts');
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(firestore, `users/${u.uid}`), { locale: code, updatedAt: Date.now() }, { merge: true });
  } catch (e) {
    console.warn('Could not persist locale to profile:', e);
  }
}

// Reflect the initial locale on <html lang> for accessibility / CSS hooks.
try { document.documentElement.setAttribute('lang', _locale); } catch { /* ignore */ }
