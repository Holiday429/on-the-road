/* ==========================================================================
   On the Road · Safety card generation
   --------------------------------------------------------------------------
   Three-tier resolution:
     1. Static library  — instant, offline, human-verified (major countries)
        → embassy and hospitals are always empty here (nationality-dependent /
          city-specific) and get filled by AI in the background.
     2. AI generation   — /api/safety serverless (DeepSeek + Tavily)
        → used when country not in static library, or to enrich embassy/hospitals
     3. Mock fallback   — generic sensible defaults when offline / API down
   ========================================================================== */

import type { CitySafety } from '../../data/schema.ts';
import { postJson } from '../../core/api.ts';
import { aiLanguage } from '../../core/i18n.ts';
import { staticSafetyForCountry } from '../../data/safety-static/countries.ts';

export type GeneratedSafety = Omit<
  CitySafety,
  'id' | 'createdAt' | 'updatedAt' | 'schemaVersion' | 'source'
>;

/**
 * Resolves safety data for a city.
 * - Static library countries: instant return, then kicks off a background AI
 *   call to fill in embassy + hospitals (persisted back via the caller).
 * - Unknown countries: full AI generation.
 * - Offline / AI error: generic mock.
 *
 * The `nationality` param is already the human-readable label (e.g. "Chinese").
 * Returns the best available data synchronously-as-possible; caller saves to store.
 */
export async function fetchCitySafety(
  city: string,
  country: string,
  nationality: string,
): Promise<GeneratedSafety | null> {
  const staticData = staticSafetyForCountry(city, country);

  if (staticData) {
    // Return static data immediately, then enrich embassy+hospitals via AI in background.
    enrichWithAi(city, country, nationality, staticData).catch(() => {/* silent */});
    return staticData;
  }

  // Unknown country — full AI generation.
  return fetchFromApi(city, country, nationality);
}

/** Fire-and-forget: fetch AI data and merge embassy+hospitals into the static base. */
async function enrichWithAi(
  city: string,
  country: string,
  nationality: string,
  base: GeneratedSafety,
): Promise<void> {
  const ai = await fetchFromApi(city, country, nationality);
  if (!ai) return;
  // Merge only the fields the static library left empty.
  if (ai.embassy?.name) base.embassy = ai.embassy;
  if (ai.hospitals?.length) base.hospitals = ai.hospitals;
}

async function fetchFromApi(
  city: string,
  country: string,
  nationality: string,
): Promise<GeneratedSafety | null> {
  try {
    return await postJson<GeneratedSafety>('/api/safety', {
      mode: 'generate',
      city,
      country,
      nationality,
      lang: aiLanguage(),
    });
  } catch (e) {
    const { handleAiError } = await import('../../core/paywall.ts');
    if (handleAiError(e)) return null; // paywall shown, caller checks for null
    console.error('[Safety] generation error — using mock data:', e);
    return mockSafety(city, country, nationality);
  }
}

function mockSafety(city: string, country: string, natLabel: string): GeneratedSafety {
  return {
    city,
    country: country || 'Europe',
    flag: '🛡️',
    generalEmergency: '112',
    emergencyNumbers: [
      { label: 'Police', number: '112' },
      { label: 'Ambulance', number: '112' },
      { label: 'Fire', number: '112' },
      { label: "Women's helpline", number: '' },
    ],
    embassy: natLabel
      ? { nationality: natLabel, name: `${natLabel} Embassy`, address: '', phone: '', website: '' }
      : { nationality: '', name: '', address: '', phone: '', website: '' },
    hospitals: [{ name: 'Nearest 24h hospital', address: '', phone: '', is24h: true }],
    trustedTransport: [
      'Use a licensed ride-hailing app (Bolt / FreeNow / Uber)',
      'At night, share your trip with a contact and sit behind the driver',
    ],
    areasToAvoid: [
      'Quiet streets around the main station late at night',
      'Empty metro carriages after midnight',
    ],
    commonScams: [
      'Friendship-bracelet / petition distractions while a partner picks pockets',
      'Fake "police" asking to check your wallet',
      'Overpriced unmetered taxis at the airport',
    ],
    phrases: [
      { en: 'Help', local: '', pronunciation: '' },
      { en: 'Call the police', local: '', pronunciation: '' },
      { en: 'I need a doctor', local: '', pronunciation: '' },
      { en: 'Leave me alone', local: '', pronunciation: '' },
    ],
    womenTips: [
      'Trust your gut — leave any situation that feels off',
      'Keep a decoy wallet with old cards and a little cash',
      'Walk with purpose; duck into a café or shop if you feel followed',
      'Share your live location with a trusted contact, especially at night',
    ],
  };
}
