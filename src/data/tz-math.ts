/* ==========================================================================
   On the Road · Time-zone arithmetic
   --------------------------------------------------------------------------
   Small Intl-based helpers (no deps): the UTC offset of an IANA zone at an
   instant, converting a "wall-clock in zone X" string pair into an instant,
   and clock-hand angles. Pure — take the instant as a parameter.
   ========================================================================== */

export function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}

interface Parts { y: number; mo: number; d: number; h: number; mi: number; s: number }

function partsIn(tz: string, at: Date): Parts {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(at)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, mo: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
}

/** Minutes east of UTC for `tz` at instant `at` (Shanghai → 480). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const p = partsIn(tz, at);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The instant at which the wall clock in `tz` reads `iso` (YYYY-MM-DD) +
 *  `hhmm` (HH:MM). Handles DST by re-checking the offset at the first guess.
 *  Returns null for malformed input. */
export function wallTimeToInstant(iso: string, hhmm: string, tz: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!dm || !tm) return null;
  const naive = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
  const off1 = tzOffsetMinutes(tz, new Date(naive));
  let guess = naive - off1 * 60000;
  const off2 = tzOffsetMinutes(tz, new Date(guess));
  if (off2 !== off1) guess = naive - off2 * 60000;
  return new Date(guess);
}

/** Hour of `tz` ahead of (+) or behind (−) `ref`, in hours (may be fractional). */
export function offsetHoursBetween(tz: string, ref: string, at: Date): number {
  return (tzOffsetMinutes(tz, at) - tzOffsetMinutes(ref, at)) / 60;
}

/** "+6h", "−1h", "+5.5h", "±0". */
export function formatOffsetHours(h: number): string {
  if (h === 0) return '±0';
  const n = Math.abs(h);
  const body = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  return `${h > 0 ? '+' : '−'}${body}h`;
}

/** Analog-clock hand angles (degrees clockwise from 12) for `tz` at `at`. */
export function clockAngles(tz: string, at: Date): { hour: number; minute: number } {
  const p = partsIn(tz, at);
  return { hour: ((p.h % 12) + p.mi / 60) * 30, minute: p.mi * 6 };
}

/** Local calendar date (YYYY-MM-DD) in `tz` at `at`. */
export function isoDateIn(tz: string, at: Date): string {
  const p = partsIn(tz, at);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** "UTC+8", "UTC−3:30" for `tz` at `at`. */
export function utcLabel(tz: string, at: Date): string {
  const m = tzOffsetMinutes(tz, at);
  const a = Math.abs(m);
  return `UTC${m < 0 ? '−' : '+'}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
}
