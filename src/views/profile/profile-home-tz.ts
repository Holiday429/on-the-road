/* ==========================================================================
   On the Road · Profile — home time zone
   --------------------------------------------------------------------------
   The zone the Dashboard's second ("home") clock shows. Stored on the user
   (users/{uid}/userPrefs/me), not the trip. Blank = infer from the trip's
   home city; never the browser zone, which follows the traveller abroad.
   ========================================================================== */

import { userPrefsStore } from '../../data/stores/user-prefs-store.ts';
import { TIMEZONE_CHOICES } from '../../data/country-timezone.ts';
import { tzOffsetMinutes } from '../../data/tz-math.ts';
import { currentUser } from '../../firebase/auth.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';

function utcLabel(tz: string): string {
  const m = tzOffsetMinutes(tz, new Date());
  const sign = m < 0 ? '−' : '+';
  const a = Math.abs(m);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
}

export function renderHomeTzSection(): string {
  if (!currentUser()) return '';
  const cur = userPrefsStore.peek()?.homeTimezone ?? '';
  // A saved zone outside the short list (set elsewhere) still shows as itself.
  const extra = cur && !TIMEZONE_CHOICES.some((c) => c.tz === cur)
    ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : '';
  const opts = TIMEZONE_CHOICES.map((c) =>
    `<option value="${esc(c.tz)}" ${c.tz === cur ? 'selected' : ''}>${esc(c.label)} · ${esc(utcLabel(c.tz))}</option>`).join('');
  return `
    <div class="profile-field profile-hometz">
      <label class="field-label" for="pf-hometz">${esc(t('profile.homeTz'))}</label>
      <select class="input select" id="pf-hometz" data-hometz>
        <option value="" ${cur ? '' : 'selected'}>${esc(t('profile.homeTzAuto'))}</option>
        ${extra}${opts}
      </select>
      <div class="profile-hint">${esc(t('profile.homeTzHint'))}</div>
    </div>`;
}

export function wireHomeTzSection(root: HTMLElement): void {
  const sel = root.querySelector<HTMLSelectElement>('[data-hometz]');
  sel?.addEventListener('change', () => {
    void userPrefsStore.save({ homeTimezone: sel.value }).catch(() => {
      // Offline / signed out: put the control back so it doesn't claim a save that didn't happen.
      sel.value = userPrefsStore.peek()?.homeTimezone ?? '';
    });
  });
}
