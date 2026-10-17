/* ==========================================================================
   On the Road · Itinerary plan — ticket-machine parsing and day load
   --------------------------------------------------------------------------
   Plan items keep `duration` and `cost` as free text ("2h", "€15") because the
   iOS app shares that schema. This file reads them back as numbers for the
   day capacity bar, and reads "Tivoli 3h kr170" typed into the ticket machine
   into title + duration + cost. Pure.
   ========================================================================== */

export interface ParsedPlan { title: string; duration?: string; cost?: string }

const SYMBOLS = '€$¥£฿₫';
const CODES = 'kr|dkk|eur|usd|cny|rmb|thb|vnd|gbp|chf|jpy|sek|nok';

function num(s: string): number { return parseFloat(s.replace(',', '.')); }
function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}min`;
  return `${Math.round(h * 10) / 10}h`;
}

/** Minutes in a duration text: "2h", "1.5h", "2h30", "2h 30min", "45min", "90 min", "2小时". 0 when unreadable. */
export function parseMinutes(text: string | undefined): number {
  if (!text) return 0;
  const s = text.toLowerCase();
  const hm = s.match(/(\d+)\s*(?:h|hr|hrs|hours?|小时)\s*(\d{1,2})\b(?!\s*(?:h|hr))/);
  if (hm) return +hm[1] * 60 + +hm[2];
  let min = 0;
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hours?|小时)/);
  if (h) min += Math.round(num(h[1]) * 60);
  const m = s.match(/(\d+)\s*(?:m|min|mins|minutes?|分钟|分)(?![a-z])/);
  if (m) min += +m[1];
  return min;
}

export function parseHours(text: string | undefined): number {
  return parseMinutes(text) / 60;
}

/** Read "Tivoli 3h kr170" into a title plus the bits that look like a duration and a price. */
export function parsePlanText(raw: string): ParsedPlan {
  let s = raw.trim();
  let duration: string | undefined;
  let cost: string | undefined;

  const dm = s.match(/\d+(?:[.,]\d+)?\s*(?:h|hr|hrs|hours?|小时)(?:\s*\d{1,2}\s*(?:min|mins|minutes?|分钟|分)?)?(?![a-z])|\d+\s*(?:min|mins|minutes?|分钟)(?![a-z])/i);
  if (dm) {
    const minutes = parseMinutes(dm[0]);
    if (minutes > 0) { duration = fmtHours(minutes / 60); s = s.replace(dm[0], ' '); }
  }

  const sym = s.match(new RegExp(`([${SYMBOLS}])\\s?(\\d+(?:[.,]\\d+)?)`));
  const codeBefore = s.match(new RegExp(`\\b(${CODES})\\s?(\\d+(?:[.,]\\d+)?)`, 'i'));
  const codeAfter = s.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s?(${CODES})\\b`, 'i'));
  const yuan = s.match(/(\d+(?:[.,]\d+)?)\s?元/);
  if (sym) { cost = `${sym[1]}${sym[2].replace(',', '.')}`; s = s.replace(sym[0], ' '); }
  else if (codeBefore) { cost = `${label(codeBefore[1])} ${codeBefore[2].replace(',', '.')}`; s = s.replace(codeBefore[0], ' '); }
  else if (codeAfter) { cost = `${label(codeAfter[2])} ${codeAfter[1].replace(',', '.')}`; s = s.replace(codeAfter[0], ' '); }
  else if (yuan) { cost = `¥${yuan[1]}`; s = s.replace(yuan[0], ' '); }
  else if (/\bfree\b|免费/i.test(s)) { cost = 'free'; s = s.replace(/\bfree\b|免费/i, ' '); }

  const title = s.replace(/\s{2,}/g, ' ').trim();
  return { title: title || raw.trim(), duration, cost };
}

function label(code: string): string {
  const c = code.toLowerCase();
  return c === 'kr' ? 'kr' : c.toUpperCase();
}

/** One price as { unit, amount }: "€18" → €/18, "kr 170" → kr/170, "15 EUR" → EUR/15. Free text and "free" → null. */
export function costParts(text: string | undefined): { unit: string; amount: number } | null {
  if (!text) return null;
  const s = text.trim();
  const a = s.match(new RegExp(`^([${SYMBOLS}])\\s?(\\d+(?:[.,]\\d+)?)`));
  if (a) return { unit: a[1], amount: num(a[2]) };
  const b = s.match(new RegExp(`^(${CODES})\\s?(\\d+(?:[.,]\\d+)?)`, 'i'));
  if (b) return { unit: label(b[1]), amount: num(b[2]) };
  const c = s.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s?(${CODES})$`, 'i'));
  if (c) return { unit: label(c[2]), amount: num(c[1]) };
  return null;
}

export interface DayLoad { hours: number; cost: string; items: number }

/** Planned hours and the day's cost per unit ("€26 + kr 170") for the items on one day. */
export function dayLoad(items: { duration?: string; cost?: string }[]): DayLoad {
  const by = new Map<string, number>();
  let hours = 0;
  for (const it of items) {
    hours += parseHours(it.duration);
    const c = costParts(it.cost);
    if (c) by.set(c.unit, (by.get(c.unit) ?? 0) + c.amount);
  }
  const cost = [...by].map(([u, n]) => {
    const v = Math.round(n * 100) / 100;
    return /^[A-Za-z]/.test(u) ? `${u} ${v}` : `${u}${v}`;
  }).join(' + ');
  return { hours, cost, items: items.length };
}

/** Under 6h reads roomy, up to 9h full, beyond that over-packed. */
export type LoadLevel = 'empty' | 'roomy' | 'full' | 'over';
export function loadLevel(hours: number): LoadLevel {
  if (hours <= 0) return 'empty';
  if (hours < 6) return 'roomy';
  return hours <= 9 ? 'full' : 'over';
}

export function hoursLabel(hours: number): string {
  return fmtHours(hours);
}
