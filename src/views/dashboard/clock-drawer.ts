/* ==========================================================================
   On the Road · Dashboard — world clocks drawer
   --------------------------------------------------------------------------
   Opened from the two banner clocks: shows each zone's current time and lets
   the traveller change it. "Here" is guessed from the stop's country/city —
   correct it per stop when the guess is wrong; "Home" is the Profile setting
   (shared with the Profile page). Both keep an "Auto" choice.
   ========================================================================== */

import { openDrawer } from '../../core/drawer.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { TIMEZONE_CHOICES, timezoneForPlace } from '../../data/country-timezone.ts';
import { hereTimezoneOverride, setHereTimezoneOverride } from '../../data/home-timezone.ts';
import { userPrefsStore } from '../../data/stores/user-prefs-store.ts';
import { utcLabel } from '../../data/tz-math.ts';

function timeIn(tz: string): string {
  try {
    return new Intl.DateTimeFormat(getLocale(), { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date());
  } catch { return ''; }
}

function options(current: string, autoLabel: string): string {
  const known = new Set<string>(TIMEZONE_CHOICES.map((c) => c.tz));
  const extra = (z: string | null) => (z && !known.has(z) ? `<option value="${esc(z)}" ${z === current ? 'selected' : ''}>${esc(z)} · ${esc(utcLabel(z, new Date()))}</option>` : '');
  return `
    <option value="" ${current === '' ? 'selected' : ''}>${esc(autoLabel)}</option>
    ${extra(current || null)}
    ${TIMEZONE_CHOICES.map((c) => `<option value="${esc(c.tz)}" ${c.tz === current ? 'selected' : ''}>${esc(c.label)} · ${esc(utcLabel(c.tz, new Date()))}</option>`).join('')}`;
}

export interface ClocksDrawerInput {
  /** The stop the "here" clock belongs to (null → only Home is editable). */
  leg: StoredLeg | null;
  /** Home zone as currently resolved (setting → home city → first flight). */
  homeTz: string | null;
  /** Called after a change so the dashboard can redraw the banner. */
  onChange: () => void;
  trigger?: HTMLElement | null;
}

export function openClocksDrawer(inp: ClocksDrawerInput): void {
  const { leg } = inp;
  const guess = leg ? timezoneForPlace(leg.city, leg.country) : null;
  const row = (id: 'here' | 'home', label: string, shownTz: string | null, select: string) => `
    <section class="td-dcard">
      <div class="td-dcard-head"><div class="td-dcard-title">${esc(label)}</div><span class="td-ck-time" data-ck-time="${id}">${shownTz ? esc(timeIn(shownTz)) : '—'}</span></div>
      <select class="input select td-ck-select" data-ck="${id}" aria-label="${esc(label)}">${select}</select>
    </section>`;

  const render = (): string => {
    const hereOverride = leg ? hereTimezoneOverride(leg.id) ?? '' : '';
    const homeSaved = userPrefsStore.peek()?.homeTimezone ?? '';
    const hereShown = hereOverride || guess;
    return [
      leg ? row('here', t('dash.clocks.here', { city: leg.city }), hereShown,
        options(hereOverride, guess ? t('dash.clocks.auto', { tz: guess }) : t('dash.clocks.autoNone'))) : '',
      row('home', t('dash.banner.home'), inp.homeTz,
        options(homeSaved, t('profile.homeTzAuto'))),
      `<p class="td-dempty td-sim-note">${esc(t('dash.clocks.note'))}</p>`,
    ].join('');
  };

  const d = openDrawer({
    title: `🕒 ${t('dash.clocks.title')}`,
    body: render(),
    returnFocus: inp.trigger,
  });

  d.root.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    if (!sel.matches('[data-ck]')) return;
    if (sel.dataset.ck === 'here' && leg) setHereTimezoneOverride(leg.id, sel.value || null);
    else if (sel.dataset.ck === 'home') void userPrefsStore.save({ homeTimezone: sel.value }).catch(() => { /* offline / signed out */ });
    // Keep the new times visible in the drawer; the dashboard redraws behind it.
    const tzOf = (id: string) => (id === 'here' ? (leg && (hereTimezoneOverride(leg.id) ?? guess)) : (sel.dataset.ck === 'home' && sel.value ? sel.value : inp.homeTz));
    d.root.querySelectorAll<HTMLElement>('[data-ck-time]').forEach((el) => { const z = tzOf(el.dataset.ckTime!); el.textContent = z ? timeIn(z) : '—'; });
    inp.onChange();
  });
}
