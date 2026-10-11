/* ==========================================================================
   On the Road · Country / city → IANA time zone
   --------------------------------------------------------------------------
   Used by the Dashboard banner for the two mini clocks (here vs. home), the
   "+6h" offset label, and to read a transport's wall-clock departure time in
   the zone it was actually written in.

   Keys are English country names as stored on legs. One zone per country
   (the capital's) except where a country spans several zones, where
   CITY_TZ below refines by city. A country we don't know → null, and the
   UI simply omits the clock rather than guessing.
   ========================================================================== */

const COUNTRY_TZ: Record<string, string> = {
  /* ── Europe ───────────────────────────────────────────────────────────── */
  Albania: 'Europe/Tirane', Andorra: 'Europe/Andorra', Austria: 'Europe/Vienna',
  Belarus: 'Europe/Minsk', Belgium: 'Europe/Brussels', 'Bosnia and Herzegovina': 'Europe/Sarajevo',
  Bulgaria: 'Europe/Sofia', Croatia: 'Europe/Zagreb', Cyprus: 'Asia/Nicosia',
  'Czech Republic': 'Europe/Prague', Denmark: 'Europe/Copenhagen', Estonia: 'Europe/Tallinn',
  Finland: 'Europe/Helsinki', France: 'Europe/Paris', Germany: 'Europe/Berlin',
  Greece: 'Europe/Athens', Hungary: 'Europe/Budapest', Iceland: 'Atlantic/Reykjavik',
  Ireland: 'Europe/Dublin', Italy: 'Europe/Rome', Kosovo: 'Europe/Belgrade',
  Latvia: 'Europe/Riga', Liechtenstein: 'Europe/Vaduz', Lithuania: 'Europe/Vilnius',
  Luxembourg: 'Europe/Luxembourg', Malta: 'Europe/Malta', Moldova: 'Europe/Chisinau',
  Monaco: 'Europe/Monaco', Montenegro: 'Europe/Podgorica', Netherlands: 'Europe/Amsterdam',
  'North Macedonia': 'Europe/Skopje', Norway: 'Europe/Oslo', Poland: 'Europe/Warsaw',
  Portugal: 'Europe/Lisbon', Romania: 'Europe/Bucharest', 'San Marino': 'Europe/San_Marino',
  Serbia: 'Europe/Belgrade', Slovakia: 'Europe/Bratislava', Slovenia: 'Europe/Ljubljana',
  Spain: 'Europe/Madrid', Sweden: 'Europe/Stockholm', Switzerland: 'Europe/Zurich',
  Turkey: 'Europe/Istanbul', Ukraine: 'Europe/Kyiv', 'United Kingdom': 'Europe/London',
  'Vatican City': 'Europe/Vatican', Russia: 'Europe/Moscow',

  /* ── Caucasus & Central Asia ──────────────────────────────────────────── */
  Armenia: 'Asia/Yerevan', Azerbaijan: 'Asia/Baku', Georgia: 'Asia/Tbilisi',
  Kazakhstan: 'Asia/Almaty', Kyrgyzstan: 'Asia/Bishkek', Tajikistan: 'Asia/Dushanbe',
  Uzbekistan: 'Asia/Tashkent',

  /* ── East & South-East Asia ───────────────────────────────────────────── */
  China: 'Asia/Shanghai', 'Hong Kong': 'Asia/Hong_Kong', Macau: 'Asia/Macau', Macao: 'Asia/Macau',
  Taiwan: 'Asia/Taipei', Japan: 'Asia/Tokyo', 'South Korea': 'Asia/Seoul',
  Mongolia: 'Asia/Ulaanbaatar', Singapore: 'Asia/Singapore', Malaysia: 'Asia/Kuala_Lumpur',
  Thailand: 'Asia/Bangkok', Vietnam: 'Asia/Ho_Chi_Minh', Cambodia: 'Asia/Phnom_Penh',
  Laos: 'Asia/Vientiane', Myanmar: 'Asia/Yangon', Philippines: 'Asia/Manila',
  Indonesia: 'Asia/Jakarta',

  /* ── South Asia ───────────────────────────────────────────────────────── */
  India: 'Asia/Kolkata', 'Sri Lanka': 'Asia/Colombo', Nepal: 'Asia/Kathmandu',
  Bangladesh: 'Asia/Dhaka', Pakistan: 'Asia/Karachi', Maldives: 'Indian/Maldives',
  Afghanistan: 'Asia/Kabul',

  /* ── Middle East ──────────────────────────────────────────────────────── */
  Israel: 'Asia/Jerusalem', 'United Arab Emirates': 'Asia/Dubai', Qatar: 'Asia/Qatar',
  Jordan: 'Asia/Amman', Lebanon: 'Asia/Beirut', Iraq: 'Asia/Baghdad', Iran: 'Asia/Tehran',
  Kuwait: 'Asia/Kuwait', Bahrain: 'Asia/Bahrain', Oman: 'Asia/Muscat',
  'Saudi Arabia': 'Asia/Riyadh', Yemen: 'Asia/Aden',

  /* ── Africa ───────────────────────────────────────────────────────────── */
  Egypt: 'Africa/Cairo', Morocco: 'Africa/Casablanca', Tunisia: 'Africa/Tunis',
  Algeria: 'Africa/Algiers', Kenya: 'Africa/Nairobi', Tanzania: 'Africa/Dar_es_Salaam',
  Uganda: 'Africa/Kampala', Ethiopia: 'Africa/Addis_Ababa', 'South Africa': 'Africa/Johannesburg',
  Nigeria: 'Africa/Lagos', Ghana: 'Africa/Accra', Senegal: 'Africa/Dakar',
  Zambia: 'Africa/Lusaka', Zimbabwe: 'Africa/Harare', Angola: 'Africa/Luanda',

  /* ── Americas ─────────────────────────────────────────────────────────── */
  'United States': 'America/New_York', Canada: 'America/Toronto', Mexico: 'America/Mexico_City',
  Brazil: 'America/Sao_Paulo', Argentina: 'America/Argentina/Buenos_Aires',
  Chile: 'America/Santiago', Colombia: 'America/Bogota', Peru: 'America/Lima',
  Ecuador: 'America/Guayaquil', Bolivia: 'America/La_Paz', Paraguay: 'America/Asuncion',
  Uruguay: 'America/Montevideo', Venezuela: 'America/Caracas', 'Costa Rica': 'America/Costa_Rica',
  Panama: 'America/Panama', Guatemala: 'America/Guatemala', Honduras: 'America/Tegucigalpa',
  Nicaragua: 'America/Managua', Cuba: 'America/Havana', Jamaica: 'America/Jamaica',

  /* ── Oceania ──────────────────────────────────────────────────────────── */
  Australia: 'Australia/Sydney', 'New Zealand': 'Pacific/Auckland',
};

/** Alternate spellings → canonical key above. */
const ALIASES: Record<string, string> = {
  uk: 'United Kingdom', britain: 'United Kingdom', 'great britain': 'United Kingdom',
  england: 'United Kingdom', scotland: 'United Kingdom', wales: 'United Kingdom',
  czechia: 'Czech Republic', czech: 'Czech Republic',
  usa: 'United States', us: 'United States', america: 'United States',
  uae: 'United Arab Emirates', dubai: 'United Arab Emirates',
  holland: 'Netherlands', 'the netherlands': 'Netherlands',
  türkiye: 'Turkey', turkiye: 'Turkey', korea: 'South Korea',
  macedonia: 'North Macedonia', bosnia: 'Bosnia and Herzegovina',
  vatican: 'Vatican City', 'hong kong sar': 'Hong Kong',
  '中国': 'China', '日本': 'Japan', '韩国': 'South Korea', '美国': 'United States',
  '英国': 'United Kingdom', '德国': 'Germany', '法国': 'France', '意大利': 'Italy',
  '西班牙': 'Spain', '葡萄牙': 'Portugal', '瑞士': 'Switzerland', '丹麦': 'Denmark',
  '泰国': 'Thailand', '新加坡': 'Singapore', '澳大利亚': 'Australia',
};

const LOWER = new Map(Object.keys(COUNTRY_TZ).map((k) => [k.toLowerCase(), k]));

/** Cities that sit in a different zone from their country's default (and the
 *  usual hubs of the multi-zone countries). Lower-case, matched as a whole
 *  word in the leg's city name. */
const CITY_TZ: Record<string, string> = {
  // United States
  'new york': 'America/New_York', boston: 'America/New_York', washington: 'America/New_York',
  miami: 'America/New_York', atlanta: 'America/New_York', chicago: 'America/Chicago',
  houston: 'America/Chicago', dallas: 'America/Chicago', 'new orleans': 'America/Chicago',
  denver: 'America/Denver', phoenix: 'America/Phoenix', 'salt lake city': 'America/Denver',
  'los angeles': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles',
  'san diego': 'America/Los_Angeles', seattle: 'America/Los_Angeles', 'las vegas': 'America/Los_Angeles',
  portland: 'America/Los_Angeles', anchorage: 'America/Anchorage', honolulu: 'Pacific/Honolulu',
  // Canada
  vancouver: 'America/Vancouver', calgary: 'America/Edmonton', edmonton: 'America/Edmonton',
  winnipeg: 'America/Winnipeg', halifax: 'America/Halifax',
  // Australia
  perth: 'Australia/Perth', brisbane: 'Australia/Brisbane', adelaide: 'Australia/Adelaide',
  darwin: 'Australia/Darwin', cairns: 'Australia/Brisbane', melbourne: 'Australia/Melbourne',
  // Russia
  'saint petersburg': 'Europe/Moscow', 'st petersburg': 'Europe/Moscow', yekaterinburg: 'Asia/Yekaterinburg',
  novosibirsk: 'Asia/Novosibirsk', irkutsk: 'Asia/Irkutsk', vladivostok: 'Asia/Vladivostok',
  // Brazil / Mexico / Indonesia
  manaus: 'America/Manaus', cancun: 'America/Cancun', cancún: 'America/Cancun',
  tijuana: 'America/Tijuana', bali: 'Asia/Makassar', denpasar: 'Asia/Makassar',
  // Spain's Canaries, Portugal's Azores
  'las palmas': 'Atlantic/Canary', tenerife: 'Atlantic/Canary', 'ponta delgada': 'Atlantic/Azores',
  // Kazakhstan
  astana: 'Asia/Almaty', 'nur-sultan': 'Asia/Almaty',
};

/** Where a traveller might say they live — city names (English and Chinese)
 *  that aren't in COUNTRY_TZ's country list. Falls back to a country name
 *  inside the text ("Harbin, China"). */
const HOME_CITY_TZ: Record<string, string> = {
  harbin: 'Asia/Shanghai', '哈尔滨': 'Asia/Shanghai', beijing: 'Asia/Shanghai', '北京': 'Asia/Shanghai',
  shanghai: 'Asia/Shanghai', '上海': 'Asia/Shanghai', guangzhou: 'Asia/Shanghai', '广州': 'Asia/Shanghai',
  shenzhen: 'Asia/Shanghai', '深圳': 'Asia/Shanghai', chengdu: 'Asia/Shanghai', '成都': 'Asia/Shanghai',
  hangzhou: 'Asia/Shanghai', '杭州': 'Asia/Shanghai', wuhan: 'Asia/Shanghai', '武汉': 'Asia/Shanghai',
  nanjing: 'Asia/Shanghai', '南京': 'Asia/Shanghai', "xi'an": 'Asia/Shanghai', '西安': 'Asia/Shanghai',
  chongqing: 'Asia/Shanghai', '重庆': 'Asia/Shanghai', tianjin: 'Asia/Shanghai', '天津': 'Asia/Shanghai',
  shenyang: 'Asia/Shanghai', '沈阳': 'Asia/Shanghai', changchun: 'Asia/Shanghai', '长春': 'Asia/Shanghai',
  dalian: 'Asia/Shanghai', '大连': 'Asia/Shanghai', qingdao: 'Asia/Shanghai', '青岛': 'Asia/Shanghai',
  xiamen: 'Asia/Shanghai', '厦门': 'Asia/Shanghai', kunming: 'Asia/Shanghai', '昆明': 'Asia/Shanghai',
  '香港': 'Asia/Hong_Kong', '台北': 'Asia/Taipei', '东京': 'Asia/Tokyo', '首尔': 'Asia/Seoul',
  '伦敦': 'Europe/London', '巴黎': 'Europe/Paris', '纽约': 'America/New_York',
  tokyo: 'Asia/Tokyo', osaka: 'Asia/Tokyo', seoul: 'Asia/Seoul', taipei: 'Asia/Taipei',
  bangkok: 'Asia/Bangkok', singapore: 'Asia/Singapore', delhi: 'Asia/Kolkata', mumbai: 'Asia/Kolkata',
  london: 'Europe/London', paris: 'Europe/Paris', berlin: 'Europe/Berlin', madrid: 'Europe/Madrid',
  rome: 'Europe/Rome', amsterdam: 'Europe/Amsterdam', copenhagen: 'Europe/Copenhagen',
  zurich: 'Europe/Zurich', moscow: 'Europe/Moscow', istanbul: 'Europe/Istanbul', dubai: 'Asia/Dubai',
  sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', auckland: 'Pacific/Auckland',
  ...CITY_TZ,
};

function canonicalCountry(country: string): string | null {
  const q = country.trim().toLowerCase();
  if (!q) return null;
  const hit = LOWER.get(q) ?? ALIASES[q];
  if (hit && COUNTRY_TZ[hit]) return hit;
  // Tolerant fallback: "Republic of Serbia", "Serbia (Belgrade)". Longest key first.
  const keys = [...LOWER.keys()].sort((a, b) => b.length - a.length);
  const sub = keys.find((k) => q.includes(k));
  return sub ? LOWER.get(sub)! : null;
}

function cityZone(text: string, table: Record<string, string>): string | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  if (table[q]) return table[q];
  // Whole-word-ish containment, longest key first ("new york" before "york").
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  const hit = keys.find((k) => (/^[ -~]+$/.test(k) ? new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`).test(q) : q.includes(k)));
  return hit ? table[hit] : null;
}

/** IANA zone for a leg: a known city wins (multi-zone countries), else the
 *  country's default. null when neither is recognised. */
export function timezoneForPlace(city: string, country: string): string | null {
  const byCity = cityZone(city, CITY_TZ);
  if (byCity) return byCity;
  const c = canonicalCountry(country);
  return c ? COUNTRY_TZ[c] : null;
}

/** Best guess at the traveller's home zone from free text like "Harbin" or
 *  "Harbin, China" (the trip's homeCity, or the first flight's origin). */
export function timezoneForHomeText(text: string | undefined | null): string | null {
  if (!text) return null;
  return cityZone(text, HOME_CITY_TZ) ?? (() => {
    const c = canonicalCountry(text);
    return c ? COUNTRY_TZ[c] : null;
  })();
}

/** Zones offered in the Profile "home time zone" picker — a short, readable
 *  list rather than all ~400 IANA names. `label` is the English city name. */
export const TIMEZONE_CHOICES: Array<{ tz: string; label: string }> = [
  { tz: 'Asia/Shanghai', label: 'Beijing / Shanghai' },
  { tz: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { tz: 'Asia/Taipei', label: 'Taipei' },
  { tz: 'Asia/Tokyo', label: 'Tokyo' },
  { tz: 'Asia/Seoul', label: 'Seoul' },
  { tz: 'Asia/Singapore', label: 'Singapore' },
  { tz: 'Asia/Bangkok', label: 'Bangkok' },
  { tz: 'Asia/Kolkata', label: 'India' },
  { tz: 'Asia/Dubai', label: 'Dubai' },
  { tz: 'Europe/Moscow', label: 'Moscow' },
  { tz: 'Europe/Istanbul', label: 'Istanbul' },
  { tz: 'Europe/London', label: 'London' },
  { tz: 'Europe/Paris', label: 'Paris / Berlin / Rome' },
  { tz: 'Europe/Athens', label: 'Athens / Helsinki' },
  { tz: 'America/Sao_Paulo', label: 'São Paulo' },
  { tz: 'America/New_York', label: 'New York' },
  { tz: 'America/Chicago', label: 'Chicago' },
  { tz: 'America/Denver', label: 'Denver' },
  { tz: 'America/Los_Angeles', label: 'Los Angeles' },
  { tz: 'Pacific/Honolulu', label: 'Honolulu' },
  { tz: 'Australia/Perth', label: 'Perth' },
  { tz: 'Australia/Sydney', label: 'Sydney / Melbourne' },
  { tz: 'Pacific/Auckland', label: 'Auckland' },
];
