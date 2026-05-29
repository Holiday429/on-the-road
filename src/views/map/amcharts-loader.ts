/* ==========================================================================
   On the Road · amCharts5 lazy loader
   --------------------------------------------------------------------------
   amCharts + geodata are several MB, so we load them from the CDN only when
   the map is first opened (not on every page). Scripts are loaded in order
   (core → map → theme → geodata) and cached after the first call.

   The 9 country geodatas give province-level drilldown — the same mechanism
   Marginalia uses for China (am5geodata_chinaHigh), generalized to Europe.
   ========================================================================== */

const CDN = 'https://cdn.amcharts.com/lib/5';

// Country code → geodata script + the global it defines.
export const DRILLDOWN_COUNTRIES: Record<string, { file: string; global: string }> = {
  DK: { file: 'denmarkLow',     global: 'am5geodata_denmarkLow' },
  DE: { file: 'germanyLow',     global: 'am5geodata_germanyLow' },
  NL: { file: 'netherlandsLow', global: 'am5geodata_netherlandsLow' },
  BE: { file: 'belgiumLow',     global: 'am5geodata_belgiumLow' },
  FR: { file: 'franceLow',      global: 'am5geodata_franceLow' },
  ES: { file: 'spainLow',       global: 'am5geodata_spainLow' },
  PT: { file: 'portugalLow',    global: 'am5geodata_portugalLow' },
  CH: { file: 'switzerlandLow', global: 'am5geodata_switzerlandLow' },
  IT: { file: 'italyLow',       global: 'am5geodata_italyLow' },
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

/** Preload all 9 drilldown countries in the background (after first paint). */
export function preloadDrilldownCountries(): void {
  Object.keys(DRILLDOWN_COUNTRIES).forEach((code) => {
    loadCountryGeodata(code).catch(() => { /* best-effort */ });
  });
}
