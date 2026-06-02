/* ==========================================================================
   On the Road · Safety card AI generation (DeepSeek) + mock fallback
   Same call shape as the Guide view; a safety-focused prompt, and the user's
   nationality is injected so the embassy is the right one. Hard facts the AI
   can get wrong (emergency numbers) default to the pan-EU 112 and the user can
   correct any field afterwards.
   ========================================================================== */

import { nationalityLabel } from '../../data/nationalities.ts';
import type { CitySafety } from '../../data/schema.ts';

export type GeneratedSafety = Omit<
  CitySafety,
  'id' | 'createdAt' | 'updatedAt' | 'schemaVersion' | 'source'
>;

export async function fetchCitySafety(
  city: string,
  country: string,
  nationality: string,
): Promise<GeneratedSafety | null> {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY;
  const natLabel = nationality ? nationalityLabel(nationality) : '';
  if (!apiKey) return mockSafety(city, country, nationality);

  const embassyLine = natLabel
    ? `The traveller is a citizen of ${natLabel}. For "embassy", give the ${natLabel} embassy or nearest consulate that serves ${city}.`
    : `Leave the embassy fields blank (the traveller has not set a nationality yet).`;

  const prompt = `You are a safety advisor for a solo female traveller arriving in ${city}${country ? `, ${country}` : ''}.
${embassyLine}

Return ONLY valid JSON matching this exact shape (no markdown):
{
  "city": "${city}",
  "country": "${country || 'country name'}",
  "flag": "flag emoji",
  "generalEmergency": "the single pan-emergency number (112 in the EU)",
  "emergencyNumbers": [{"label": "Police", "number": "..."}, {"label": "Ambulance", "number": "..."}, {"label": "Fire", "number": "..."}, {"label": "Women's helpline", "number": "..."}],
  "embassy": {"nationality": "${natLabel}", "name": "embassy/consulate name", "address": "full address", "phone": "phone", "website": "url"},
  "hospitals": [{"name": "hospital or 24h pharmacy", "address": "address", "phone": "phone", "is24h": true}],
  "trustedTransport": ["which ride-hailing apps are reliable here", "night-travel advice"],
  "areasToAvoid": ["area + time of day to be cautious 1", "2"],
  "commonScams": ["scam targeting tourists/women 1", "2", "3"],
  "phrases": [{"en": "Help", "local": "...", "pronunciation": "..."}, {"en": "Call the police", "local": "...", "pronunciation": "..."}, {"en": "I need a doctor", "local": "...", "pronunciation": "..."}, {"en": "Leave me alone", "local": "...", "pronunciation": "..."}],
  "womenTips": ["concrete tip specific to solo women in ${city} 1", "2", "3", "4"]
}
Be accurate with phone numbers. If unsure of a number, use an empty string rather than guessing.`;

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.4,
      }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content) as GeneratedSafety;
  } catch (e) {
    console.error('DeepSeek (safety) error:', e);
    return null;
  }
}

function mockSafety(city: string, country: string, nationality: string): GeneratedSafety {
  const natLabel = nationality ? nationalityLabel(nationality) : '';
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
      'Use a licensed ride-hailing app (Bolt / FreeNow / Uber) rather than hailing on the street',
      'At night, share your trip with a contact and sit behind the driver',
    ],
    areasToAvoid: [
      'Quiet streets around the main station late at night',
      'Empty metro carriages after midnight — move toward the conductor',
    ],
    commonScams: [
      'Friendship-bracelet / petition distractions while a partner picks pockets',
      'Fake "police" asking to check your wallet — real police never do this',
      'Overpriced unmetered taxis at the airport',
    ],
    phrases: [
      { en: 'Help', local: '', pronunciation: '' },
      { en: 'Call the police', local: '', pronunciation: '' },
      { en: 'I need a doctor', local: '', pronunciation: '' },
      { en: 'Leave me alone', local: '', pronunciation: '' },
    ],
    womenTips: [
      'Trust your gut — leave any situation that feels off, you owe no one an explanation',
      'Keep a decoy wallet with old cards and a little cash',
      'Walk with purpose; duck into a café or shop if you feel followed',
      'Share your live location with a trusted contact, especially at night',
    ],
  };
}
