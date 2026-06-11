/* ==========================================================================
   On the Road · Safety card generation
   --------------------------------------------------------------------------
   Calls the /api/safety serverless function (DeepSeek + Tavily, key kept
   server-side). On failure or offline, returns generic mock data so the SOS
   card is never blank — the user still gets 112 and sensible defaults.
   ========================================================================== */

import type { CitySafety } from '../../data/schema.ts';
import { postJson } from '../../core/api.ts';

export type GeneratedSafety = Omit<
  CitySafety,
  'id' | 'createdAt' | 'updatedAt' | 'schemaVersion' | 'source'
>;

export async function fetchCitySafety(
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
    });
  } catch (e) {
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
