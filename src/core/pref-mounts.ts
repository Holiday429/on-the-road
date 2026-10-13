/* ==========================================================================
   On the Road · Preference controls mount
   --------------------------------------------------------------------------
   Mounts the language picker + theme toggle side by side into a host element
   (the global top bar and the Settings page). A host that is rebuilt via
   innerHTML gets its previous instances disposed before fresh ones mount.
   ========================================================================== */

import { createLanguagePicker, type LanguagePickerInstance } from './language-picker.ts';
import { createThemeToggle, type ThemeToggleInstance } from './theme.ts';

/** One pair per host, so the global top bar and the Settings page can both show the controls. */
const mounted = new WeakMap<HTMLElement, { lang: LanguagePickerInstance; theme: ThemeToggleInstance }>();

export function mountPrefControls(host: HTMLElement): void {
  const prev = mounted.get(host);
  prev?.lang.destroy();
  prev?.theme.destroy();
  host.classList.add('pref-controls');

  const themeMount = document.createElement('div');
  const langMount = document.createElement('div');
  host.append(themeMount, langMount);

  mounted.set(host, { theme: createThemeToggle(themeMount), lang: createLanguagePicker(langMount) });
}
