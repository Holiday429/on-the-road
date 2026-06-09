/* ==========================================================================
   On the Road · /api/safety  — Vercel Serverless Function
   --------------------------------------------------------------------------
   POST body (generate city card):
     { mode: 'generate', city: string, country: string, nationality?: string }
   POST body (reverse geocode):
     { mode: 'geocode', lat: number, lng: number }

   Generate response: JSON { city safety data }
   Geocode response:  JSON { city: string, country: string, countryCode: string }

   Keys in .env (server-side only):
     DEEPSEEK_API_KEY
     TAVILY_API_KEY
     GOOGLE_GEOCODING_KEY   (optional — falls back to BigDataCloud if absent)
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown> };
type VercelResponse = ServerResponse & {
  json(data: unknown): void;
  status(code: number): VercelResponse;
  setHeader(k: string, v: string): void;
  end(): void;
};

// ── Tavily ────────────────────────────────────────────────────────────────────

async function tavilySearch(query: string): Promise<string> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, search_depth: 'basic', max_results: 4, include_answer: true }),
    });
    if (!res.ok) return '';
    const data = await res.json() as { answer?: string; results?: { content: string }[] };
    const snippets = (data.results ?? []).map(r => r.content).join('\n\n');
    return data.answer ? `${data.answer}\n\n${snippets}` : snippets;
  } catch { return ''; }
}

// ── DeepSeek ──────────────────────────────────────────────────────────────────

async function deepseek(prompt: string): Promise<unknown> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY not set');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return JSON.parse(data.choices[0].message.content);
}

// ── Geocode: lat/lng → city ───────────────────────────────────────────────────

async function reverseGeocode(lat: number, lng: number): Promise<{ city: string; country: string; countryCode: string }> {
  const googleKey = process.env.GOOGLE_GEOCODING_KEY;

  if (googleKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=locality|administrative_area_level_1&key=${googleKey}`;
      const res = await fetch(url);
      const data = await res.json() as {
        results?: { address_components: { long_name: string; short_name: string; types: string[] }[]; formatted_address: string }[];
        status: string;
      };
      if (data.status === 'OK' && data.results?.length) {
        const comps = data.results[0].address_components;
        const city = comps.find(c => c.types.includes('locality'))?.long_name
          ?? comps.find(c => c.types.includes('administrative_area_level_1'))?.long_name ?? '';
        const countryComp = comps.find(c => c.types.includes('country'));
        return { city, country: countryComp?.long_name ?? '', countryCode: countryComp?.short_name ?? '' };
      }
    } catch { /* fall through */ }
  }

  // BigDataCloud free fallback (no key needed)
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
    const res = await fetch(url);
    const data = await res.json() as { city?: string; locality?: string; countryName?: string; countryCode?: string };
    return {
      city: data.city ?? data.locality ?? '',
      country: data.countryName ?? '',
      countryCode: data.countryCode ?? '',
    };
  } catch {
    return { city: '', country: '', countryCode: '' };
  }
}

// ── Safety prompt ─────────────────────────────────────────────────────────────

function safetyPrompt(city: string, country: string, nationality: string, searchContext: string): string {
  const embassyLine = nationality
    ? `The traveller is a citizen of ${nationality}. For "embassy", provide the ${nationality} embassy or nearest consulate in ${city} — real name, address and phone number.`
    : `Leave embassy fields blank (nationality not set).`;

  return `You are a safety advisor for a solo female traveller arriving in ${city}, ${country}.
${embassyLine}
${searchContext ? `Recent verified web context (use for real phone numbers and addresses):\n${searchContext}\n` : ''}

Return ONLY valid JSON — no markdown, no commentary:
{
  "city": "${city}",
  "country": "${country}",
  "flag": "<country flag emoji>",
  "generalEmergency": "<single pan-emergency number, e.g. 112 in EU>",
  "emergencyNumbers": [
    {"label": "Police", "number": "<real local number, e.g. 17 in France>"},
    {"label": "Ambulance", "number": "<real local number>"},
    {"label": "Fire", "number": "<real local number>"},
    {"label": "Women's helpline", "number": "<real helpline or empty string if none>"}
  ],
  "embassy": {
    "nationality": "${nationality}",
    "name": "<official embassy/consulate name>",
    "address": "<full street address>",
    "phone": "<phone number with country code>",
    "website": "<official gov website URL>"
  },
  "hospitals": [
    {"name": "<hospital name>", "address": "<full address>", "phone": "<phone>", "is24h": true},
    {"name": "<24h pharmacy name>", "address": "<address>", "phone": "<phone>", "is24h": true}
  ],
  "trustedTransport": [
    "<which ride-hailing apps work here, e.g. Uber/Bolt/FreeNow>",
    "<night-travel advice specific to this city>"
  ],
  "areasToAvoid": [
    "<specific neighbourhood or area + time of day>",
    "<second area or situation to be cautious about>"
  ],
  "commonScams": [
    "<scam 1 specific to this city/region>",
    "<scam 2>",
    "<scam 3>"
  ],
  "phrases": [
    {"en": "Help", "local": "<translation>", "pronunciation": "<phonetic>"},
    {"en": "Call the police", "local": "<translation>", "pronunciation": "<phonetic>"},
    {"en": "I need a doctor", "local": "<translation>", "pronunciation": "<phonetic>"},
    {"en": "Leave me alone", "local": "<translation>", "pronunciation": "<phonetic>"}
  ],
  "womenTips": [
    "<concrete tip specific to solo women in ${city}>",
    "<tip 2>",
    "<tip 3>",
    "<tip 4>"
  ]
}

IMPORTANT: Use real, accurate phone numbers. If you are not certain of a number, use an empty string — do NOT guess. The emergencyNumbers must reflect this specific country's actual emergency services, not just 112 for everything.`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if ((req as unknown as { method: string }).method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if ((req as unknown as { method: string }).method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body;
  const mode = (body.mode as string) || 'generate';

  // ── Geocode mode ─────────────────────────────────────────────────────────
  if (mode === 'geocode') {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: 'lat and lng required' });
      return;
    }
    try {
      const result = await reverseGeocode(lat, lng);
      res.status(200).json(result);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
    return;
  }

  // ── Generate mode ─────────────────────────────────────────────────────────
  const city = (body.city as string ?? '').trim();
  const country = (body.country as string ?? '').trim();
  const nationality = (body.nationality as string ?? '').trim();

  if (!city) {
    res.status(400).json({ error: 'city is required' });
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  try {
    // Tavily: get real, current emergency numbers + embassy + hospital info
    const searchCtx = await tavilySearch(
      `${city} ${country} emergency number police ambulance women helpline embassy hospital 2024 2025`
    );

    const data = await deepseek(safetyPrompt(city, country, nationality, searchCtx));
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
