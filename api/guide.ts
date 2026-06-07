/* ==========================================================================
   On the Road · /api/guide  — Vercel Serverless Function
   --------------------------------------------------------------------------
   POST body: { city: string, country: string, query?: string }
   Response:  Server-Sent Events stream. Each event is:
     data: { section: SectionKey, payload: <section data> }\n\n

   Sections emitted in order (city + country always present):
     "meta"        → { city, country, flag, bannerColor, intro, funFacts }
     "know"        → { greetings, customs, taboos, neighborhoods, safetyTips, transport }
     "attractions" → GuideCard[]
     "cityWalks"   → CityWalk[]
     "restaurants" → GuideCard[]
     "cafes"       → GuideCard[]
     "experiences" → GuideCard[]
     "moneyTips"   → GuideTip[]
     "done"        → {}

   Keys in .env (server-side only, no VITE_ prefix):
     DEEPSEEK_API_KEY
     TAVILY_API_KEY
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown> };
type VercelResponse = ServerResponse & { json(data: unknown): void; status(code: number): VercelResponse; write(chunk: string): boolean; flushHeaders(): void; setHeader(k: string, v: string): void; end(): void; };

// ── Types (inline — no shared import needed for serverless) ──────────────────

interface GuideCard {
  id: string; title: string; highlight: string; detail: string;
  background: string; searchUrl: string; address: string;
  duration: string; cost: string; category: string;
}

interface CityWalk {
  id: string; title: string; highlight: string; detail: string;
  background: string; searchUrl: string; duration: string; distance: string;
}

interface GuideTip { id: string; text: string; }

// ── Helpers ──────────────────────────────────────────────────────────────────

const BANNER_COLORS = [
  '#fde68a','#bae6fd','#bbf7d0','#e9d5ff',
  '#fecaca','#fed7aa','#cffafe','#fce7f3',
];

function randomBanner() {
  return BANNER_COLORS[Math.floor(Math.random() * BANNER_COLORS.length)];
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function searchUrl(title: string, city: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${title} ${city}`)}`;
}

function addSearchUrls<T extends { title: string; searchUrl?: string }>(items: T[], city: string): (T & { id: string; searchUrl: string })[] {
  return items.map((item, i) => ({
    ...item,
    id: (item as unknown as { id?: string }).id || `${slug(item.title)}-${i}`,
    searchUrl: searchUrl(item.title, city),
  }));
}

// ── Tavily search ─────────────────────────────────────────────────────────────

async function tavilySearch(query: string): Promise<string> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return '';

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    });
    if (!res.ok) return '';
    const data = await res.json() as { answer?: string; results?: { content: string }[] };
    const snippets = (data.results ?? []).map(r => r.content).join('\n\n');
    return data.answer ? `${data.answer}\n\n${snippets}` : snippets;
  } catch {
    return '';
  }
}

// ── DeepSeek call ─────────────────────────────────────────────────────────────

async function deepseek(prompt: string): Promise<unknown> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY not set');

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek ${res.status}: ${err}`);
  }
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return JSON.parse(data.choices[0].message.content);
}

// ── SSE helper ───────────────────────────────────────────────────────────────

function emit(res: VercelResponse, section: string, payload: unknown) {
  res.write(`data: ${JSON.stringify({ section, payload })}\n\n`);
}

// ── Prompts ───────────────────────────────────────────────────────────────────

function metaPrompt(city: string, country: string, searchContext: string, query: string) {
  return `You are a knowledgeable travel writer. Generate a JSON object for ${city}, ${country}.
${query ? `User's specific interest: "${query}"\n` : ''}
${searchContext ? `Recent web context:\n${searchContext}\n` : ''}

Return ONLY valid JSON:
{
  "flag": "country flag emoji",
  "intro": "3-4 engaging sentences about the city's character and vibe — not Wikipedia-dry",
  "funFacts": ["surprising fact 1", "surprising fact 2", "surprising fact 3", "surprising fact 4"],
  "overviewSections": [
    {"icon": "🏛️", "title": "History", "body": "2-3 sentences on the city's origins and key historical turning points"},
    {"icon": "🗺️", "title": "Geography & Layout", "body": "2-3 sentences on location, terrain, rivers, and how the city is laid out"},
    {"icon": "🎭", "title": "Culture & Vibe", "body": "2-3 sentences on the local character, art scene, and daily rhythm"},
    {"icon": "🍽️", "title": "Food & Drink", "body": "2-3 sentences on signature dishes, drinks, and food culture"},
    {"icon": "📅", "title": "When to Visit", "body": "2-3 sentences on seasons, weather, festivals, and best timing"},
    {"icon": "💶", "title": "Practical Snapshot", "body": "2-3 sentences on currency, language, rough daily budget, and getting in"}
  ]
}`;
}

function knowPrompt(city: string, country: string, searchContext: string) {
  return `You are a knowledgeable travel writer. Generate cultural background JSON for ${city}, ${country}.
${searchContext ? `Recent web context:\n${searchContext}\n` : ''}

Return ONLY valid JSON:
{
  "greetings": [{"phrase": "...", "pronunciation": "...", "meaning": "..."}],
  "customs": ["custom 1", "custom 2", "custom 3"],
  "taboos": ["taboo 1", "taboo 2"],
  "neighborhoods": [{"name": "...", "vibe": "1-sentence description"}],
  "safetyTips": ["tip 1", "tip 2", "tip 3"],
  "transport": ["tip 1", "tip 2"]
}`;
}

function attractionsPrompt(city: string, searchContext: string, query: string) {
  return `You are a travel curator. List 6 must-visit attractions in ${city}.
${query ? `User interest: "${query}"\n` : ''}
${searchContext ? `Recent web context:\n${searchContext}\n` : ''}

Return ONLY valid JSON array (no wrapper object):
[{
  "title": "Attraction name",
  "highlight": "One punchy sentence why it's worth visiting",
  "detail": "2-3 sentence description with what to see/do",
  "background": "1 sentence cultural or historical context",
  "address": "address or neighbourhood if known, else empty string",
  "duration": "e.g. 1-2h",
  "cost": "e.g. Free or €12",
  "category": "museum"
}]

Use these category values only: museum, landmark, nature, viewpoint, shopping, other`;
}

function cityWalksPrompt(city: string, searchContext: string, query: string) {
  return `You are a travel curator. Suggest 3 city walk routes in ${city}.
${query ? `User interest: "${query}"\n` : ''}
${searchContext ? `Recent web context:\n${searchContext}\n` : ''}

Return ONLY valid JSON array:
[{
  "title": "Walk route name",
  "highlight": "One sentence hook",
  "detail": "Description including 4-5 waypoints as a short list",
  "background": "Theme or historical thread tying the walk together",
  "duration": "e.g. 2-3h",
  "distance": "e.g. 4 km"
}]`;
}

function restaurantsPrompt(city: string, searchContext: string, query: string) {
  return `You are a food-savvy travel writer. Recommend 6 restaurants in ${city} across price ranges.
${query ? `User interest: "${query}"\n` : ''}
${searchContext ? `Recent web context:\n${searchContext}\n` : ''}

Return ONLY valid JSON array:
[{
  "title": "Restaurant name",
  "highlight": "One-liner: cuisine + standout dish",
  "detail": "2 sentences on atmosphere and what to order",
  "background": "Any interesting story or local significance",
  "address": "neighbourhood or address",
  "cost": "e.g. €€ or €15-25/person",
  "category": "food"
}]`;
}

function cafesPrompt(city: string, searchContext: string, query: string) {
  return `You are a specialty-coffee and café expert. Recommend 5 cafés in ${city}.
${query ? `User interest: "${query}"\n` : ''}
${searchContext ? `Recent web context:\n${searchContext}\n` : ''}

Return ONLY valid JSON array:
[{
  "title": "Café name",
  "highlight": "Vibe + signature drink in one sentence",
  "detail": "2 sentences: what makes it special, when to visit",
  "background": "Story or neighbourhood context",
  "address": "neighbourhood or address",
  "cost": "e.g. €3-6",
  "category": "cafe"
}]`;
}

function experiencesPrompt(city: string, searchContext: string, query: string) {
  return `You are a travel experience curator. Suggest 5 unique experiences in ${city}.
${query ? `User interest: "${query}"\n` : ''}
${searchContext ? `Recent web context:\n${searchContext}\n` : ''}

Return ONLY valid JSON array:
[{
  "title": "Experience name",
  "highlight": "What makes it memorable in one sentence",
  "detail": "2-3 sentences: how to do it, best time, tips",
  "background": "Cultural significance or why locals love it",
  "address": "location or area",
  "duration": "e.g. half-day",
  "cost": "e.g. €20 or Free",
  "category": "experience"
}]`;
}

function moneyTipsPrompt(city: string, searchContext: string) {
  return `You are a budget travel expert. Give 6 money-saving tips for ${city}.
${searchContext ? `Recent web context:\n${searchContext}\n` : ''}

Return ONLY valid JSON array:
[{"id": "tip-1", "text": "Actionable saving tip in 1-2 sentences"}]`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { city, country, query = '' } = req.body as {
    city: string; country: string; query?: string;
  };

  if (!city || !country) {
    res.status(400).json({ error: 'city and country required' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    // Run all Tavily searches in parallel
    const [metaCtx, knowCtx, attractCtx, walkCtx, foodCtx, cafeCtx, expCtx, moneyCtx] =
      await Promise.all([
        tavilySearch(`${city} ${country} travel highlights overview ${query}`),
        tavilySearch(`${city} ${country} customs culture etiquette travelers`),
        tavilySearch(`${city} best attractions must-see 2025 ${query}`),
        tavilySearch(`${city} best walking routes city walk 2025 ${query}`),
        tavilySearch(`${city} best restaurants local food 2025 ${query}`),
        tavilySearch(`${city} best cafes specialty coffee 2025 ${query}`),
        tavilySearch(`${city} unique experiences things to do 2025 ${query}`),
        tavilySearch(`${city} budget travel money saving tips 2025`),
      ]);

    // Fire all DeepSeek calls in parallel
    const [metaRaw, knowRaw, attrRaw, walkRaw, restRaw, cafeRaw, expRaw, moneyRaw] =
      await Promise.all([
        deepseek(metaPrompt(city, country, metaCtx, query)),
        deepseek(knowPrompt(city, country, knowCtx)),
        deepseek(attractionsPrompt(city, attractCtx, query)),
        deepseek(cityWalksPrompt(city, walkCtx, query)),
        deepseek(restaurantsPrompt(city, foodCtx, query)),
        deepseek(cafesPrompt(city, cafeCtx, query)),
        deepseek(experiencesPrompt(city, expCtx, query)),
        deepseek(moneyTipsPrompt(city, moneyCtx)),
      ]);

    const meta = metaRaw as {
      flag: string; intro: string; funFacts: string[];
      overviewSections?: { icon: string; title: string; body: string }[];
    };
    const know = knowRaw as {
      greetings: { phrase: string; pronunciation: string; meaning: string }[];
      customs: string[]; taboos: string[];
      neighborhoods: { name: string; vibe: string }[];
      safetyTips: string[]; transport: string[];
    };

    // Emit sections as they're ready (all parallel, so order is deterministic)
    emit(res, 'meta', {
      city, country,
      flag: meta.flag ?? '🗺️',
      bannerColor: randomBanner(),
      intro: meta.intro ?? '',
      funFacts: meta.funFacts ?? [],
      overviewSections: meta.overviewSections ?? [],
    });

    emit(res, 'know', know);

    emit(res, 'attractions', addSearchUrls(
      (Array.isArray(attrRaw) ? attrRaw : []) as GuideCard[], city
    ));
    emit(res, 'cityWalks', addSearchUrls(
      (Array.isArray(walkRaw) ? walkRaw : []) as CityWalk[], city
    ));
    emit(res, 'restaurants', addSearchUrls(
      (Array.isArray(restRaw) ? restRaw : []) as GuideCard[], city
    ));
    emit(res, 'cafes', addSearchUrls(
      (Array.isArray(cafeRaw) ? cafeRaw : []) as GuideCard[], city
    ));
    emit(res, 'experiences', addSearchUrls(
      (Array.isArray(expRaw) ? expRaw : []) as GuideCard[], city
    ));

    const tips = (Array.isArray(moneyRaw) ? moneyRaw : []) as GuideTip[];
    emit(res, 'moneyTips', tips.map((t, i) => ({ ...t, id: t.id || `tip-${i}` })));

    emit(res, 'done', {});
  } catch (err) {
    emit(res, 'error', { message: (err as Error).message });
  } finally {
    res.end();
  }
}
