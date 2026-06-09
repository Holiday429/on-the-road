/* ==========================================================================
   On the Road · Safety card generation — client-side DeepSeek call
   Used directly by the browser (local dev + fallback). Production uses
   /api/safety serverless function instead.
   ========================================================================== */

import { nationalityLabel } from '../../data/nationalities.ts';
import type { CitySafety } from '../../data/schema.ts';

export type GeneratedSafety = Omit<
  CitySafety,
  'id' | 'createdAt' | 'updatedAt' | 'schemaVersion' | 'source'
>;

function safetyPrompt(city: string, country: string, nationality: string): string {
  const embassyLine = nationality
    ? `The traveller is a citizen of ${nationality}. For "embassy", provide the ${nationality} embassy or nearest consulate in ${city} with real name, address and phone.`
    : `Leave embassy fields blank (nationality not set).`;

  return `You are a safety advisor for a solo female traveller arriving in ${city}${country ? `, ${country}` : ''}.
${embassyLine}

Return ONLY valid JSON — no markdown:
{
  "city": "${city}",
  "country": "${country || 'unknown'}",
  "flag": "<country flag emoji>",
  "generalEmergency": "<pan-emergency number, e.g. 112 in EU>",
  "emergencyNumbers": [
    {"label": "Police", "number": "<real local number, NOT just 112 — e.g. 17 in France, 110 in Germany>"},
    {"label": "Ambulance", "number": "<real local number>"},
    {"label": "Fire", "number": "<real local number>"},
    {"label": "Women's helpline", "number": "<real helpline or empty string>"}
  ],
  "embassy": {
    "nationality": "${nationality}",
    "name": "<official embassy name>",
    "address": "<full street address>",
    "phone": "<phone with country code>",
    "website": "<gov website URL>"
  },
  "hospitals": [
    {"name": "<hospital name>", "address": "<full address>", "phone": "<phone>", "is24h": true},
    {"name": "<24h pharmacy>", "address": "<address>", "phone": "<phone>", "is24h": true}
  ],
  "trustedTransport": ["<ride apps that work here>", "<night travel advice>"],
  "areasToAvoid": ["<area + time of day>", "<second area or situation>"],
  "commonScams": ["<scam 1>", "<scam 2>", "<scam 3>"],
  "phrases": [
    {"en": "Help", "local": "<translation>", "pronunciation": "<phonetic>"},
    {"en": "Call the police", "local": "<translation>", "pronunciation": "<phonetic>"},
    {"en": "I need a doctor", "local": "<translation>", "pronunciation": "<phonetic>"},
    {"en": "Leave me alone", "local": "<translation>", "pronunciation": "<phonetic>"}
  ],
  "womenTips": ["<tip 1>", "<tip 2>", "<tip 3>", "<tip 4>"]
}

CRITICAL: emergencyNumbers MUST reflect this country's actual services. Police in France = 17, Germany = 110, UK = 999, Spain = 091, Italy = 113, Netherlands = 112, Denmark = 112. Use correct numbers — do NOT write 112 for every service.`;
}

export async function fetchCitySafety(
  city: string,
  country: string,
  nationality: string,
): Promise<GeneratedSafety | null> {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY as string | undefined;
  const natLabel = nationality ? nationalityLabel(nationality) : '';

  if (!apiKey) {
    console.warn('[Safety] VITE_DEEPSEEK_API_KEY not set — using mock data');
    return mockSafety(city, country, natLabel);
  }

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: safetyPrompt(city, country, natLabel) }],
        response_format: { type: 'json_object' },
        temperature: 0.4,
      }),
    });

    if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(data.choices[0].message.content) as GeneratedSafety;
    return parsed;
  } catch (e) {
    console.error('[Safety] DeepSeek error:', e);
    return null;
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
