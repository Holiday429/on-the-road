/* ==========================================================================
   On the Road · Dashboard — city page drawer
   --------------------------------------------------------------------------
   Opened from the city name in the banner: a read-only summary of this stop as
   the Itinerary holds it — dates, how you get there, where you stay, the plan
   day by day, your notes — with a button into the full Itinerary page. (The
   Itinerary view is a full page with its own editors and state, so it is
   summarised here rather than mounted inside a drawer.)
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { navigateTo } from '../../core/app.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { legStays, tonightStay } from '../../data/trip-now.ts';
import { daysBetween } from '../../data/trip-phase.ts';
import { stayCard, transportBody, transportTitle } from './banner-drawers.ts';
import { bannerDateRange, nightsLabel } from './banner-format.ts';

function dayHeading(iso: string): string {
  try { return new Date(`${iso}T00:00:00`).toLocaleDateString(getLocale(), { weekday: 'short', month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

export interface CityDay { date: string; label: string; items: Array<{ title: string; done: boolean }> }

/** The leg's plan items grouped under their days (date order, items in order);
 *  items without a day come back separately. Pure. */
export function cityPlan(leg: Pick<StoredLeg, 'planDays' | 'plans'>): { days: CityDay[]; unscheduled: string[] } {
  const plans = [...(leg.plans ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const days = [...(leg.planDays ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    .map((d): CityDay => ({
      date: d.date, label: d.label,
      items: plans.filter((p) => p.dayId === d.id).map((p) => ({ title: p.title, done: !!p.done })),
    }))
    .filter((d) => d.items.length);
  const known = new Set((leg.planDays ?? []).map((d) => d.id));
  return { days, unscheduled: plans.filter((p) => !p.dayId || !known.has(p.dayId)).map((p) => p.title) };
}

export function openCityDrawer(leg: StoredLeg, todayIso: string, trigger: HTMLElement | null): void {
  const nights = Math.max(0, daysBetween(leg.dateFrom, leg.dateTo));
  const stays = legStays(leg);
  const tonight = tonightStay(leg, todayIso);
  const plan = cityPlan(leg);
  const notes = (leg.noteCards ?? []).filter((n) => n.title.trim() || n.body.trim());
  const legacyNote = leg.notes?.trim();

  const section = (title: string, html: string) => html ? `<h3 class="td-dh">${esc(title)}</h3>${html}` : '';

  const arrival = leg.arrivalTransport
    ? `<section class="td-dcard"><div class="td-dcard-title">${esc(transportTitle(leg.arrivalTransport))}</div>${transportBody(leg.arrivalTransport)}</section>` : '';
  const stayHtml = stays.map((s) => stayCard(s, s === tonight)).join('');
  const planHtml = plan.days.map((d) => `
      <section class="td-dcard">
        <div class="td-dcard-head"><div class="td-dcard-title">${esc(dayHeading(d.date))}</div>${d.label ? `<span class="td-dbadge">${esc(d.label)}</span>` : ''}</div>
        ${d.items.map((i) => `<div class="td-cd-item${i.done ? ' is-done' : ''}">${i.done ? '✅' : '📌'} ${esc(i.title)}</div>`).join('')}
      </section>`).join('')
    + (plan.unscheduled.length ? `<section class="td-dcard"><div class="td-dcard-title">${esc(t('dash.city.unscheduled'))}</div>${plan.unscheduled.map((x) => `<div class="td-cd-item">📌 ${esc(x)}</div>`).join('')}</section>` : '');
  const noteHtml = notes.map((n) => `<section class="td-dcard">${n.title.trim() ? `<div class="td-dcard-title">${esc(n.title)}</div>` : ''}<p class="jr-body">${esc(n.body.trim())}</p></section>`).join('')
    + (legacyNote ? `<section class="td-dcard"><p class="jr-body">${esc(legacyNote)}</p></section>` : '');

  const body = [
    section(t('dash.city.arrival'), arrival),
    section(t('dash.city.stays'), stayHtml),
    section(t('dash.city.plan'), planHtml),
    section(t('dash.city.notes'), noteHtml),
  ].join('') || `<p class="td-dempty">${esc(t('dash.city.empty'))}</p>`;

  const d = openDrawer({
    title: `${leg.flag} ${leg.city}`.trim(),
    subtitle: [leg.country, bannerDateRange(leg.dateFrom, leg.dateTo), nights ? nightsLabel(nights) : ''].filter(Boolean).join(' · '),
    body,
    footer: `<button type="button" class="btn btn-ghost" data-d-open>${esc(t('dash.banner.openItinerary'))}</button>`,
    returnFocus: trigger,
  });
  d.root.querySelector('[data-d-open]')?.addEventListener('click', () => { closeDrawer(); navigateTo('route', { legId: leg.id }); });
}
