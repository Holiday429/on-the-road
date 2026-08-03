/* ==========================================================================
   On the Road · Preference controls mount
   --------------------------------------------------------------------------
   Mounts the language picker + theme toggle side by side into a host element
   (today: the Dashboard greeting row's [data-lang-mount]; later also the
   Profile page). The host is rebuilt via innerHTML on every dashboard render,
   so previous instances are disposed before mounting fresh ones.
   ========================================================================== */

import { createLanguagePicker, type LanguagePickerInstance } from './language-picker.ts';
import { createThemeToggle, type ThemeToggleInstance } from './theme.ts';

let _lang: LanguagePickerInstance | null = null;
let _theme: ThemeToggleInstance | null = null;

export function mountPrefControls(host: HTMLElement): void {
  _lang?.destroy();
  _theme?.destroy();
  host.classList.add('pref-controls');

  const themeMount = document.createElement('div');
  const langMount = document.createElement('div');
  host.append(themeMount, langMount);

  _theme = createThemeToggle(themeMount);
  _lang = createLanguagePicker(langMount);
}
