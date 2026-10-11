/* ==========================================================================
   On the Road · Dashboard banner — small formatters (dates, nights, countdown)
   ========================================================================== */

import { t, getLocale } from '../../core/i18n.ts';
import { countdownTo, daysUntilDate } from '../../data/trip-now.ts';

function asDate(iso: string): Date { return new Date(iso + 'T00:00:00'); }

/** "Aug 12–16" / "Aug 30 – Sep 2"; just the start when there is no end. */
export function bannerDateRange(from: string, to?: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  try {
    const f = new Intl.DateTimeFormat(getLocale(), opts);
    if (!to || to === from) return f.format(asDate(from));
    return f.formatRange(asDate(from), asDate(to));
  } catch {
    return to && to !== from ? `${from} – ${to}` : from;
  }
}

export function nightsLabel(n: number): string {
  return t(n === 1 ? 'dash.banner.night1' : 'dash.banner.nightN', { n });
}

/** "in 2d 4h" for a timed departure; "tomorrow" / "in 3 days" for a date-only
 *  one. Empty when the moment has passed. */
export function countdownLabel(depAt: Date | null, dateIso: string, now: Date, todayIso: string): string {
  if (depAt) {
    const c = countdownTo(depAt, now);
    if (c.ms <= 0) return '';
    if (c.days > 0) return t('dash.banner.in.dh', { d: c.days, h: c.hours });
    if (c.hours > 0) return t('dash.banner.in.hm', { h: c.hours, m: c.minutes });
    return t('dash.banner.in.m', { m: Math.max(1, c.minutes) });
  }
  const d = daysUntilDate(dateIso, todayIso);
  if (d === 0) return t('dash.banner.in.today');
  if (d === 1) return t('dash.banner.in.tomorrow');
  return t('dash.banner.in.days', { d });
}
