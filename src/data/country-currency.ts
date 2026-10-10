/* ==========================================================================
   On the Road · Country → currency
   --------------------------------------------------------------------------
   Single source of truth for "which currency do they use in <country>".
   Keys are English country names as stored on legs/expenses. Lookup is
   case-insensitive and tolerant of common aliases (see ALIASES) so a leg typed
   as "UK" or "Czech" still resolves.
   ========================================================================== */

import { isKnownCurrency } from './rates.ts';

const EUR = 'EUR';

export const COUNTRY_CURRENCY: Record<string, string> = {
  /* ── Eurozone ─────────────────────────────────────────────────────────── */
  Austria: EUR, Belgium: EUR, Croatia: EUR, Cyprus: EUR, Estonia: EUR,
  Finland: EUR, France: EUR, Germany: EUR, Greece: EUR, Ireland: EUR,
  Italy: EUR, Latvia: EUR, Lithuania: EUR, Luxembourg: EUR, Malta: EUR,
  Netherlands: EUR, Portugal: EUR, Slovakia: EUR, Slovenia: EUR, Spain: EUR,
  Andorra: EUR, Monaco: EUR, 'San Marino': EUR, 'Vatican City': EUR,
  Montenegro: EUR, Kosovo: EUR,

  /* ── Other Europe ─────────────────────────────────────────────────────── */
  Denmark: 'DKK', Sweden: 'SEK', Norway: 'NOK', Iceland: 'ISK',
  Switzerland: 'CHF', Liechtenstein: 'CHF', 'United Kingdom': 'GBP',
  'Czech Republic': 'CZK', Poland: 'PLN', Hungary: 'HUF', Romania: 'RON',
  Bulgaria: 'EUR', // joined the euro on 2026-01-01
  Turkey: 'TRY', Serbia: 'RSD', Albania: 'ALL', 'North Macedonia': 'MKD',
  'Bosnia and Herzegovina': 'BAM', Ukraine: 'UAH', Moldova: 'MDL',
  Georgia: 'GEL', Armenia: 'AMD', Azerbaijan: 'AZN',

  /* ── Asia ─────────────────────────────────────────────────────────────── */
  China: 'CNY', 'Hong Kong': 'HKD', Macau: 'MOP', Taiwan: 'TWD', Japan: 'JPY',
  'South Korea': 'KRW', Singapore: 'SGD', Malaysia: 'MYR', Thailand: 'THB',
  Vietnam: 'VND', Indonesia: 'IDR', Philippines: 'PHP', India: 'INR',
  'Sri Lanka': 'LKR', Nepal: 'NPR', Cambodia: 'KHR', Laos: 'LAK',
  Mongolia: 'MNT', Kazakhstan: 'KZT', Uzbekistan: 'UZS',

  /* ── Middle East & Africa ─────────────────────────────────────────────── */
  Israel: 'ILS', 'United Arab Emirates': 'AED', Qatar: 'QAR', Jordan: 'JOD',
  Egypt: 'EGP', Morocco: 'MAD', Tunisia: 'TND', Kenya: 'KES', Tanzania: 'TZS',
  'South Africa': 'ZAR',

  /* ── Americas & Oceania ───────────────────────────────────────────────── */
  'United States': 'USD', Canada: 'CAD', Mexico: 'MXN', Brazil: 'BRL',
  Argentina: 'ARS', Chile: 'CLP', Colombia: 'COP', Peru: 'PEN',
  Australia: 'AUD', 'New Zealand': 'NZD',
};

/** Alternate spellings → the canonical key used above. */
const ALIASES: Record<string, string> = {
  uk: 'United Kingdom', britain: 'United Kingdom', 'great britain': 'United Kingdom',
  england: 'United Kingdom', scotland: 'United Kingdom', wales: 'United Kingdom',
  czechia: 'Czech Republic', czech: 'Czech Republic',
  usa: 'United States', us: 'United States', america: 'United States',
  uae: 'United Arab Emirates', dubai: 'United Arab Emirates',
  holland: 'Netherlands', 'the netherlands': 'Netherlands',
  türkiye: 'Turkey', turkiye: 'Turkey',
  korea: 'South Korea', macedonia: 'North Macedonia', bosnia: 'Bosnia and Herzegovina',
  'vatican': 'Vatican City', 'hong kong sar': 'Hong Kong',
};

const LOWER = new Map(Object.keys(COUNTRY_CURRENCY).map((k) => [k.toLowerCase(), k]));

/** ISO currency code used in `country`, or null if we don't know the country. */
export function currencyForCountry(country: string): string | null {
  const q = country.trim().toLowerCase();
  if (!q) return null;
  const exact = LOWER.get(q) ?? (ALIASES[q] ? ALIASES[q] : undefined);
  if (exact && COUNTRY_CURRENCY[exact]) return COUNTRY_CURRENCY[exact];
  // Tolerant fallback: "Republic of Serbia", "Serbia (Belgrade)" … Longest key
  // first so "South Korea" wins over a shorter accidental substring.
  const keys = [...LOWER.keys()].sort((a, b) => b.length - a.length);
  const hit = keys.find((k) => q.includes(k));
  return hit ? COUNTRY_CURRENCY[LOWER.get(hit)!] : null;
}

/** Like currencyForCountry, but only returns a code the app can actually price
 *  (built-in, approximate, or user-added). Use for defaults that feed a form. */
export function knownCurrencyForCountry(country: string): string | null {
  const c = currencyForCountry(country);
  return c && isKnownCurrency(c) ? c : null;
}
