/* ==========================================================================
   On the Road · Currency rates
   --------------------------------------------------------------------------
   One free, key-less exchange-rate source (frankfurter.app), cached per base
   per day in localStorage. Offline / fetch failure degrades to a built-in
   approximate table rather than breaking — a stale rate beats a crash.

   A "rate table" here maps an ISO code → "how many BASE units one unit of that
   currency is worth". So with base EUR, `table['USD']` answers "1 USD = ? EUR".
   To convert: baseAmount = amount * table[currency].
   ========================================================================== */

export interface Currency { code: string; symbol: string; flag: string; }

/** Currencies with a live rate from frankfurter.app (its full supported set).
 *  The trip base currency must be one of these. */
export const CURRENCIES: Currency[] = [
  { code: 'EUR', symbol: '€',   flag: '🇪🇺' },
  { code: 'CNY', symbol: '¥',   flag: '🇨🇳' },
  { code: 'USD', symbol: '$',   flag: '🇺🇸' },
  { code: 'GBP', symbol: '£',   flag: '🇬🇧' },
  { code: 'CHF', symbol: 'CHF', flag: '🇨🇭' },
  { code: 'DKK', symbol: 'kr',  flag: '🇩🇰' },
  { code: 'NOK', symbol: 'kr',  flag: '🇳🇴' },
  { code: 'SEK', symbol: 'kr',  flag: '🇸🇪' },
  { code: 'CZK', symbol: 'Kč',  flag: '🇨🇿' },
  { code: 'JPY', symbol: '¥',   flag: '🇯🇵' },
  { code: 'PLN', symbol: 'zł',  flag: '🇵🇱' },
  { code: 'HUF', symbol: 'Ft',  flag: '🇭🇺' },
  { code: 'RON', symbol: 'lei', flag: '🇷🇴' },
  { code: 'BGN', symbol: 'лв',  flag: '🇧🇬' },
  { code: 'ISK', symbol: 'kr',  flag: '🇮🇸' },
  { code: 'TRY', symbol: '₺',   flag: '🇹🇷' },
  { code: 'AUD', symbol: 'A$',  flag: '🇦🇺' },
  { code: 'CAD', symbol: 'C$',  flag: '🇨🇦' },
  { code: 'NZD', symbol: 'NZ$', flag: '🇳🇿' },
  { code: 'HKD', symbol: 'HK$', flag: '🇭🇰' },
  { code: 'SGD', symbol: 'S$',  flag: '🇸🇬' },
  { code: 'KRW', symbol: '₩',   flag: '🇰🇷' },
  { code: 'THB', symbol: '฿',   flag: '🇹🇭' },
  { code: 'MYR', symbol: 'RM',  flag: '🇲🇾' },
  { code: 'IDR', symbol: 'Rp',  flag: '🇮🇩' },
  { code: 'PHP', symbol: '₱',   flag: '🇵🇭' },
  { code: 'INR', symbol: '₹',   flag: '🇮🇳' },
  { code: 'ILS', symbol: '₪',   flag: '🇮🇱' },
  { code: 'ZAR', symbol: 'R',   flag: '🇿🇦' },
  { code: 'BRL', symbol: 'R$',  flag: '🇧🇷' },
  { code: 'MXN', symbol: 'Mex$', flag: '🇲🇽' },
];

/** Common currencies the live API does NOT cover. Built in so popular
 *  destinations work out of the box, but rates are static approximations
 *  (EUR_PER_UNIT) — users can override with a manual rate (customCurrencies). */
export const EXTRA_CURRENCIES: Currency[] = [
  { code: 'RSD', symbol: 'din', flag: '🇷🇸' },
  { code: 'ALL', symbol: 'L',   flag: '🇦🇱' },
  { code: 'MKD', symbol: 'ден', flag: '🇲🇰' },
  { code: 'BAM', symbol: 'KM',  flag: '🇧🇦' },
  { code: 'UAH', symbol: '₴',   flag: '🇺🇦' },
  { code: 'GEL', symbol: '₾',   flag: '🇬🇪' },
  { code: 'AMD', symbol: '֏',   flag: '🇦🇲' },
  { code: 'MDL', symbol: 'L',   flag: '🇲🇩' },
  { code: 'AED', symbol: 'AED', flag: '🇦🇪' },
  { code: 'EGP', symbol: 'E£',  flag: '🇪🇬' },
  { code: 'MAD', symbol: 'MAD', flag: '🇲🇦' },
  { code: 'VND', symbol: '₫',   flag: '🇻🇳' },
  { code: 'TWD', symbol: 'NT$', flag: '🇹🇼' },
  { code: 'KZT', symbol: '₸',   flag: '🇰🇿' },
  { code: 'ARS', symbol: 'AR$', flag: '🇦🇷' },
  { code: 'CLP', symbol: 'CL$', flag: '🇨🇱' },
  { code: 'COP', symbol: 'CO$', flag: '🇨🇴' },
  { code: 'PEN', symbol: 'S/',  flag: '🇵🇪' },
];

/** A user-defined currency, stored on the trip. `manualRate` = how many
 *  `rateBase` units one unit of this currency is worth (rateBase defaults to the
 *  trip base at entry time, so a later base change still converts correctly). */
export interface CustomCurrency {
  symbol: string;
  flag?: string;
  manualRate?: number;
  rateBase?: string;
}
type CustomSource = () => Record<string, CustomCurrency> | undefined;
let customSource: CustomSource = () => undefined;
/** trip-context registers a getter so rates.ts never imports it (no cycle). */
export function registerCustomCurrencySource(fn: CustomSource): void { customSource = fn; }
function customs(): Record<string, CustomCurrency> { return customSource() ?? {}; }

/** Built-in + approximate + user-defined, deduped by code (built-in wins). */
export function allCurrencies(): Currency[] {
  const out = [...CURRENCIES, ...EXTRA_CURRENCIES];
  const seen = new Set(out.map((c) => c.code));
  for (const [code, c] of Object.entries(customs())) {
    if (!seen.has(code)) out.push({ code, symbol: c.symbol || code, flag: c.flag ?? '💱' });
  }
  return out;
}

export function isKnownCurrency(code: string): boolean {
  return allCurrencies().some((c) => c.code === code);
}
/** True when `code` has no live feed (static approximation or manual rate). */
export function isApproxCurrency(code: string): boolean {
  return !CURRENCIES.some((c) => c.code === code) && isKnownCurrency(code);
}
export function currencyFlag(code: string): string {
  return allCurrencies().find((c) => c.code === code)?.flag ?? '';
}
export function currencySymbol(code: string): string {
  return allCurrencies().find((c) => c.code === code)?.symbol ?? code;
}

/** Map ISO code → euros per unit. Used as the offline fallback and to seed
 *  conversions for any base via cross-rates. Approximate; refreshed by the API. */
const EUR_PER_UNIT: Record<string, number> = {
  EUR: 1, CNY: 0.128, USD: 0.92, GBP: 1.17, CHF: 1.04,
  DKK: 0.134, NOK: 0.085, SEK: 0.086, CZK: 0.040, JPY: 0.0061,
  PLN: 0.23, HUF: 0.0025, RON: 0.2, BGN: 0.511, ISK: 0.0067, TRY: 0.027,
  AUD: 0.61, CAD: 0.67, NZD: 0.56, HKD: 0.118, SGD: 0.69, KRW: 0.00068,
  THB: 0.026, MYR: 0.21, IDR: 0.000057, PHP: 0.016, INR: 0.011, ILS: 0.25,
  ZAR: 0.05, BRL: 0.17, MXN: 0.046,
  // Approximate-only (no live feed)
  RSD: 0.0085, ALL: 0.0100, MKD: 0.0162, BAM: 0.511, UAH: 0.022, GEL: 0.34,
  AMD: 0.0023, MDL: 0.052, AED: 0.25, EGP: 0.019, MAD: 0.092, VND: 0.000036,
  TWD: 0.028, KZT: 0.0018, ARS: 0.001, CLP: 0.00097, COP: 0.00022, PEN: 0.25,
};

export type RateTable = Record<string, number>;

const TTL_KEY = (base: string, day: string) => `otr:rates:${base}:${day}`;
// Undated "last known good" cache, kept alongside the per-day one. If the
// user's offline when the day rolls over, the per-day key misses and we'd
// otherwise silently drop to the static EUR_PER_UNIT approximation — this
// keeps yesterday's real fetched rate available instead, which is closer to
// correct than a table that could be stale by months.
const LAST_GOOD_KEY = (base: string) => `otr:rates:${base}:last-good`;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Built-in fallback table for a given base, derived from the EUR cross-rates. */
function fallbackTable(base: string): RateTable {
  const eurPerBase = EUR_PER_UNIT[base] ?? 1;
  const table: RateTable = {};
  for (const { code } of [...CURRENCIES, ...EXTRA_CURRENCIES]) {
    const eurPerUnit = EUR_PER_UNIT[code];
    if (eurPerUnit != null) table[code] = eurPerUnit / eurPerBase; // base units per 1 unit of `code`
  }
  return table;
}

function readCache(base: string): RateTable | null {
  try {
    const raw = localStorage.getItem(TTL_KEY(base, today()));
    if (raw) return JSON.parse(raw) as RateTable;
  } catch { /* ignore */ }
  return null;
}

/** Yesterday-or-earlier's last successfully fetched table, if any. */
function readLastGood(base: string): RateTable | null {
  try {
    const raw = localStorage.getItem(LAST_GOOD_KEY(base));
    if (raw) return JSON.parse(raw) as RateTable;
  } catch { /* ignore */ }
  return null;
}

function writeCache(base: string, table: RateTable) {
  try {
    localStorage.setItem(TTL_KEY(base, today()), JSON.stringify(table));
    localStorage.setItem(LAST_GOOD_KEY(base), JSON.stringify(table));
  } catch { /* quota */ }
}

const inflight: Record<string, Promise<RateTable>> = {};

/** Layer the non-live currencies onto a cached/fetched table, at read time so a
 *  cache written before a currency existed (or before a manual rate changed)
 *  still resolves: static approximation for gaps, then user manual rates win. */
function finalize(table: RateTable, base: string): RateTable {
  const out: RateTable = { ...table };
  const fb = fallbackTable(base);
  for (const code of Object.keys(fb)) if (out[code] == null) out[code] = fb[code];
  for (const [code, c] of Object.entries(customs())) {
    if (!(c.manualRate && c.manualRate > 0)) continue;
    const via = c.rateBase ?? base;
    const viaInBase = via === base ? 1 : out[via];
    if (viaInBase != null) out[code] = c.manualRate * viaInBase;
  }
  return out;
}

/**
 * Resolve a rate table for `base`. Returns today's cached table immediately if
 * present; otherwise fetches once (deduped), caches, and falls back on error.
 * Always resolves — callers never need a try/catch.
 */
export async function getRateTable(base: string): Promise<RateTable> {
  const cached = readCache(base);
  if (cached) return finalize(cached, base);
  const pending = inflight[base];
  if (pending) return finalize(await pending, base);

  // No `symbols` filter: asking for an explicit list makes the whole request
  // 422 if frankfurter ever drops one of them. We take what it returns.
  const url = `https://api.frankfurter.app/latest?base=${base}`;

  inflight[base] = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`rates ${res.status}`);
      const json = (await res.json()) as { rates?: Record<string, number> };
      // frankfurter gives "units of X per 1 base"; we want the inverse
      // (base units per 1 X), so each entry is 1 / quoted.
      const table: RateTable = { [base]: 1 };
      for (const [code, perBase] of Object.entries(json.rates ?? {})) {
        if (perBase > 0) table[code] = 1 / perBase;
      }
      writeCache(base, table);
      return table;
    } catch {
      return readLastGood(base) ?? fallbackTable(base);
    } finally {
      delete inflight[base];
    }
  })();

  return finalize(await inflight[base], base);
}

/** Synchronous best-effort table: today's cache, else the last successfully
 *  fetched table, else the static fallback. For instant first paint before
 *  getRateTable() resolves, and for staying accurate while offline. */
export function peekRateTable(base: string): RateTable {
  return finalize(readCache(base) ?? readLastGood(base) ?? fallbackTable(base), base);
}
