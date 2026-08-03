/* ==========================================================================
   On the Road · Profile — account, emergency card, preferences
   --------------------------------------------------------------------------
   Replaces the old account modal + the standalone Safety view's emergency
   card sheet with one page, reached from the sidebar/mobile account button
   (see core/sidebar.ts). Not in NAV_ITEMS — same pattern as /calendar.
   ========================================================================== */

import './profile.css';
import { renderAccountSection, wireAccountSection } from './profile-account.ts';
import { renderEmergencySection, wireEmergencySection, subscribeEmergencySection } from './profile-emergency.ts';
import { mountPrefControls } from '../../core/pref-mounts.ts';
import { t } from '../../core/i18n.ts';

let _unsubEmergency: (() => void) | null = null;

function render(): void {
  const body = document.querySelector<HTMLElement>('#view-profile .profile-body');
  if (!body) return;

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N10)
  body.innerHTML = `
    <section class="profile-section">
      <h2 class="profile-section-title">${t('profile.sectionAccount')}</h2>
      ${renderAccountSection()}
    </section>

    <section class="profile-section">
      <h2 class="profile-section-title">${t('profile.sectionEmergency')}</h2>
      ${renderEmergencySection()}
    </section>

    <section class="profile-section">
      <h2 class="profile-section-title">${t('profile.sectionPreferences')}</h2>
      <div class="profile-prefs-mount" data-prefs-mount></div>
    </section>`;

  wireAccountSection(body);
  wireEmergencySection(body);

  const prefsMount = body.querySelector<HTMLElement>('[data-prefs-mount]');
  if (prefsMount) mountPrefControls(prefsMount);
}

export function initProfile(): void {
  _unsubEmergency?.();
  _unsubEmergency = subscribeEmergencySection(render);
  render();
}
