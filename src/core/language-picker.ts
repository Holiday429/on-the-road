/* ==========================================================================
   On the Road · Language picker
   --------------------------------------------------------------------------
   A single-select language menu mounted as a button + popover. It reuses the
   country dropdown's visual language (.dest-dropdown / .dest-dropdown-item from
   destination-input.css) so it matches the rest of the app.

     import { createLanguagePicker } from './language-picker.ts';
     createLanguagePicker(document.getElementById('lang-mount')!);

   Selecting a language calls setLocale(), which persists the choice and
   broadcasts to every onLocaleChange subscriber (the shell re-renders).
   ========================================================================== */

import './destination-input.css';
import { LOCALES, getLocale, setLocale, t, type Locale } from './i18n.ts';

export interface LanguagePickerInstance {
  destroy(): void;
}

export function createLanguagePicker(container: HTMLElement): LanguagePickerInstance {
  let open = false;
  let popover: HTMLElement | null = null;

  container.classList.add('lang-picker');
  container.innerHTML = '';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-ghost lang-picker-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  renderButton();
  container.appendChild(btn);

  function renderButton() {
    const meta = LOCALES.find((l) => l.code === getLocale()) ?? LOCALES[0];
    btn.innerHTML = `<span class="lang-picker-flag">${meta.flag}</span><span class="lang-picker-label">${meta.label}</span>`;
    btn.title = t('lang.button');
    btn.setAttribute('aria-label', t('lang.button'));
  }

  function openPopover() {
    if (open) return;
    open = true;
    btn.setAttribute('aria-expanded', 'true');

    const current = getLocale();
    const el = document.createElement('div');
    el.className = 'dest-dropdown lang-picker-dropdown';
    el.setAttribute('role', 'listbox');
    el.innerHTML = `
      <div class="dest-dropdown-section">
        <div class="dest-dropdown-section-label">${t('lang.title')}</div>
        ${LOCALES.map((l) => `
          <button type="button" class="dest-dropdown-item${l.code === current ? ' is-active' : ''}"
                  data-lang="${l.code}" role="option" aria-selected="${l.code === current}">
            <span class="dest-dropdown-item-flag">${l.flag}</span>
            <span class="dest-dropdown-item-text">${l.label}</span>
            ${l.code === current ? '<span class="dest-dropdown-item-type">✓</span>' : ''}
          </button>
        `).join('')}
      </div>`;

    el.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((item) => {
      item.addEventListener('click', () => {
        setLocale(item.dataset.lang as Locale);
        renderButton();
        closePopover();
      });
    });

    container.appendChild(el);
    popover = el;

    // Close on outside click / Escape.
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
    open ? closePopover() : openPopover();
  });

  return {
    destroy() {
      closePopover();
      container.innerHTML = '';
      container.classList.remove('lang-picker');
    },
  };
}
