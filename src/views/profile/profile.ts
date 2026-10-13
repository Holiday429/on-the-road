/* ==========================================================================
   On the Road · Profile — me, preferences, account
   --------------------------------------------------------------------------
   Reached from "Account & settings" in the sidebar's "My world" group (and from
   the phone's account button). Three sections, ordered from the traveller
   outwards: who they are, how they like the app to behave, and the account
   itself. The passport and the atlas are their own pages — they are not
   settings, so they are not repeated here.
   ========================================================================== */

import './profile.css';
import { renderAccountSection, wireAccountSection } from './profile-account.ts';
import { renderEmergencySection, wireEmergencySection, subscribeEmergencySection } from './profile-emergency.ts';
import { renderHomeTzSection, wireHomeTzSection } from './profile-home-tz.ts';
import { renderMeSection, wireMeSection, subscribeMeSection } from './profile-me.ts';
import { mountPrefControls } from '../../core/pref-mounts.ts';
import { t } from '../../core/i18n.ts';
import { navigateTo } from '../../core/app.ts';
import { NAV_ICON } from '../../core/icons.ts';

let _unsubEmergency: (() => void) | null = null;
let _unsubMe: (() => void) | null = null;

function render(): void {
  const body = document.querySelector<HTMLElement>('#view-profile .profile-body');
  if (!body) return;

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  body.innerHTML = `
    <section class="profile-section">
      <h2 class="profile-section-title">${t('profile.sectionMe')}</h2>
      ${renderMeSection()}
    </section>

    <!-- Phones have no sidebar, so the "My world" group lives here instead (hidden on wider screens). -->
    <section class="profile-section profile-world-links">
      <h2 class="profile-section-title">${t('nav.sectionMe')}</h2>
      <button type="button" class="profile-world-link" data-go="passport"><span aria-hidden="true">${NAV_ICON.passport}</span> ${t('nav.passport')} <span class="profile-world-go" aria-hidden="true">›</span></button>
      <button type="button" class="profile-world-link" data-go="atlas"><span aria-hidden="true">${NAV_ICON.atlas}</span> ${t('nav.atlas')} <span class="profile-world-go" aria-hidden="true">›</span></button>
    </section>

    <section class="profile-section">
      <h2 class="profile-section-title">${t('profile.sectionPreferences')}</h2>
      <div class="profile-prefs-mount" data-prefs-mount></div>
      ${renderHomeTzSection()}
    </section>

    <section class="profile-section">
      <h2 class="profile-section-title">${t('profile.sectionAccount')}</h2>
      ${renderAccountSection()}
      <h3 class="profile-subsection-title">${t('profile.sectionEmergency')}</h3>
      ${renderEmergencySection()}
    </section>`;

  wireMeSection(body, render);
  body.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => {
    b.addEventListener('click', () => { void navigateTo(b.dataset.go as 'passport' | 'atlas'); });
  });
  wireAccountSection(body);
  wireEmergencySection(body);
  wireHomeTzSection(body);

  const prefsMount = body.querySelector<HTMLElement>('[data-prefs-mount]');
  if (prefsMount) mountPrefControls(prefsMount);
}

export function initProfile(): void {
  _unsubEmergency?.();
  _unsubMe?.();
  _unsubEmergency = subscribeEmergencySection(render);
  // The identity is shared with the passport: a change there repaints here.
  _unsubMe = subscribeMeSection(render);
  render();
}
