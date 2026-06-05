/* ==========================================================================
   On the Road · amCharts5 lazy loader
   --------------------------------------------------------------------------
   amCharts + geodata are several MB, so we load them from the CDN only when
   the map is first opened (not on every page). Scripts are loaded in order
   (core → map → theme → geodata) and cached after the first call.

   Country geodatas give province-level drilldown for any country the user visits.
   Only the visited countries are preloaded; others load on demand when clicked.
   ========================================================================== */

const CDN = 'https://cdn.amcharts.com/lib/5';

// Country code → geodata script + the global it defines.
// Covers all countries for which amCharts publishes a *Low.js region file.
function _dc(file: string) { return { file: `${file}Low`, global: `am5geodata_${file}Low` }; }
export const DRILLDOWN_COUNTRIES: Record<string, { file: string; global: string }> = {
  // Europe
  AL: _dc('albania'),
  AD: _dc('andorra'),
  AM: _dc('armenia'),
  AT: _dc('austria'),
  AZ: _dc('azerbaijan'),
  BY: _dc('belarus'),
  BE: _dc('belgium'),
  BA: _dc('bosniaHerzegovina'),
  BG: _dc('bulgaria'),
  HR: _dc('croatia'),
  CY: _dc('cyprus'),
  CZ: _dc('czechRepublic'),
  DK: _dc('denmark'),
  EE: _dc('estonia'),
  FI: _dc('finland'),
  FR: _dc('france'),
  GE: _dc('georgia'),
  DE: _dc('germany'),
  GR: _dc('greece'),
  HU: _dc('hungary'),
  IS: _dc('iceland'),
  IE: _dc('ireland'),
  IT: _dc('italy'),
  XK: _dc('kosovo'),
  LV: _dc('latvia'),
  LI: _dc('liechtenstein'),
  LT: _dc('lithuania'),
  LU: _dc('luxembourg'),
  MT: _dc('malta'),
  MD: _dc('moldova'),
  MC: _dc('monaco'),
  ME: _dc('montenegro'),
  NL: _dc('netherlands'),
  MK: _dc('northMacedonia'),
  NO: _dc('norway'),
  PL: _dc('poland'),
  PT: _dc('portugal'),
  RO: _dc('romania'),
  RU: _dc('russia'),
  SM: _dc('sanMarino'),
  RS: _dc('serbia'),
  SK: _dc('slovakia'),
  SI: _dc('slovenia'),
  ES: _dc('spain'),
  SE: _dc('sweden'),
  CH: _dc('switzerland'),
  TR: _dc('turkey'),
  UA: _dc('ukraine'),
  GB: _dc('uk'),
  // Americas
  AR: _dc('argentina'),
  BO: _dc('bolivia'),
  BR: _dc('brazil'),
  CA: _dc('canada'),
  CL: _dc('chile'),
  CO: _dc('colombia'),
  CR: _dc('costaRica'),
  CU: _dc('cuba'),
  EC: _dc('ecuador'),
  GT: _dc('guatemala'),
  HN: _dc('honduras'),
  MX: _dc('mexico'),
  PA: _dc('panama'),
  PY: _dc('paraguay'),
  PE: _dc('peru'),
  UY: _dc('uruguay'),
  US: _dc('usa'),
  VE: _dc('venezuela'),
  // Asia & Middle East
  AF: _dc('afghanistan'),
  BD: _dc('bangladesh'),
  CN: _dc('china'),
  IN: _dc('india'),
  ID: _dc('indonesia'),
  IR: _dc('iran'),
  IQ: _dc('iraq'),
  IL: _dc('israel'),
  JP: _dc('japan'),
  JO: _dc('jordan'),
  KZ: _dc('kazakhstan'),
  KG: _dc('kyrgyzstan'),
  LB: _dc('lebanon'),
  MY: _dc('malaysia'),
  MM: _dc('myanmar'),
  PK: _dc('pakistan'),
  PH: _dc('philippines'),
  SA: _dc('saudiArabia'),
  KR: _dc('southKorea'),
  TW: _dc('taiwan'),
  TJ: _dc('tajikistan'),
  TH: _dc('thailand'),
  TM: _dc('turkmenistan'),
  AE: _dc('uae'),
  UZ: _dc('uzbekistan'),
  VN: _dc('vietnam'),
  // Africa
  DZ: _dc('algeria'),
  AO: _dc('angola'),
  CM: _dc('cameroon'),
  EG: _dc('egypt'),
  ET: _dc('ethiopia'),
  GH: _dc('ghana'),
  KE: _dc('kenya'),
  LY: _dc('libya'),
  MA: _dc('morocco'),
  MZ: _dc('mozambique'),
  NG: _dc('nigeria'),
  SN: _dc('senegal'),
  ZA: _dc('southAfrica'),
  SD: _dc('sudan'),
  TZ: _dc('tanzania'),
  TN: _dc('tunisia'),
  ZM: _dc('zambia'),
  ZW: _dc('zimbabwe'),
  // Oceania
  AU: _dc('australia'),
  NZ: _dc('newZealand'),
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-amsrc="${src}"]`);
    if (existing) {
      if (existing.getAttribute('data-loaded') === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`failed: ${src}`)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = false;                 // preserve execution order
    s.dataset.amsrc = src;
    s.addEventListener('load', () => { s.dataset.loaded = '1'; resolve(); });
    s.addEventListener('error', () => reject(new Error(`failed: ${src}`)));
    document.head.appendChild(s);
  });
}

let _corePromise: Promise<void> | null = null;

/** Load amCharts core + map + theme + world geodata. Idempotent. */
export function loadAmCharts(): Promise<void> {
  if (_corePromise) return _corePromise;
  _corePromise = (async () => {
    await loadScript(`${CDN}/index.js`);
    await loadScript(`${CDN}/map.js`);
    await loadScript(`${CDN}/themes/Animated.js`);
    await loadScript(`${CDN}/geodata/worldLow.js`);
  })();
  return _corePromise;
}

const _countryPromises = new Map<string, Promise<void>>();

/** Load a single country's province geodata (e.g. 'FR'). Idempotent. */
export function loadCountryGeodata(code: string): Promise<void> {
  const meta = DRILLDOWN_COUNTRIES[code];
  if (!meta) return Promise.reject(new Error(`No drilldown geodata for ${code}`));
  if (_countryPromises.has(code)) return _countryPromises.get(code)!;
  const p = loadScript(`${CDN}/geodata/${meta.file}.js`);
  _countryPromises.set(code, p);
  return p;
}

/** Preload geodata for the given country codes in the background (after first paint). */
export function preloadDrilldownCountries(codes: string[]): void {
  for (const code of codes) {
    if (DRILLDOWN_COUNTRIES[code]) {
      loadCountryGeodata(code).catch(() => { /* best-effort */ });
    }
  }
}
