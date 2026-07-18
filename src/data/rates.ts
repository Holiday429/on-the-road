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

/** Currencies we surface in the picker. The base can be any of these. */
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
];

export function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

/** Map ISO code → euros per unit. Used as the offline fallback and to seed
 *  conversions for any base via cross-rates. Approximate; refreshed by the API. */
const EUR_PER_UNIT: Record<string, number> = {
  EUR: 1, CNY: 0.128, USD: 0.92, GBP: 1.17, CHF: 1.04,
  DKK: 0.134, NOK: 0.085, SEK: 0.086, CZK: 0.040, JPY: 0.0061,
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
  for (const { code } of CURRENCIES) {
    const eurPerUnit = EUR_PER_UNIT[code] ?? 1;
    table[code] = eurPerUnit / eurPerBase; // base units per 1 unit of `code`
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

let inflight: Record<string, Promise<RateTable>> = {};

/**
 * Resolve a rate table for `base`. Returns today's cached table immediately if
 * present; otherwise fetches once (deduped), caches, and falls back on error.
 * Always resolves — callers never need a try/catch.
 */
export async function getRateTable(base: string): Promise<RateTable> {
  const cached = readCache(base);
  if (cached) return cached;
  const pending = inflight[base];
  if (pending) return pending;

  const symbols = CURRENCIES.map((c) => c.code).filter((c) => c !== base).join(',');
  const url = `https://api.frankfurter.app/latest?base=${base}&symbols=${symbols}`;

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
      // Backfill any currency the API didn't return from the fallback table.
      const fb = fallbackTable(base);
      for (const { code } of CURRENCIES) if (table[code] == null) table[code] = fb[code];
      writeCache(base, table);
      return table;
    } catch {
      return readLastGood(base) ?? fallbackTable(base);
    } finally {
      delete inflight[base];
    }
  })();

  return inflight[base];
}

/** Synchronous best-effort table: today's cache, else the last successfully
 *  fetched table, else the static fallback. For instant first paint before
 *  getRateTable() resolves, and for staying accurate while offline. */
export function peekRateTable(base: string): RateTable {
  return readCache(base) ?? readLastGood(base) ?? fallbackTable(base);
}
