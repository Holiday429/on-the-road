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

// ── Unsplash photos ───────────────────────────────────────────────────────────
// Used only for landmark-ish cards (attractions / city walks / experiences).
// Restaurants & cafés are skipped on purpose — Unsplash can't return the actual
// venue, only a generic mood shot, so we leave those imageless by design.

interface PhotoMeta { imageUrl: string; photographer: string; photographerUrl: string; }

const EMPTY_PHOTO: PhotoMeta = { imageUrl: '', photographer: '', photographerUrl: '' };

async function unsplashPhoto(query: string): Promise<PhotoMeta> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return EMPTY_PHOTO;
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape&content_filter=high`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
    if (!res.ok) return EMPTY_PHOTO;
    const data = await res.json() as {
      results?: { urls: { regular: string }; user: { name: string; links: { html: string } } }[];
    };
    const hit = data.results?.[0];
    if (!hit) return EMPTY_PHOTO;
    return {
      imageUrl: hit.urls.regular,
      photographer: hit.user?.name ?? '',
      photographerUrl: hit.user?.links?.html ?? '',
    };
  } catch {
    return EMPTY_PHOTO;
  }
}

// Attach an Unsplash photo to each card, in parallel. `city` is appended to the
// search so "Colosseum" → "Colosseum Rome" lands the right landmark.
async function addPhotos<T extends { title: string }>(items: T[], city: string): Promise<(T & PhotoMeta)[]> {
  return Promise.all(items.map(async (item) => ({
    ...item,
    ...(await unsplashPhoto(`${item.title} ${city}`)),
  })));
}

// ── Tavily search ─────────────────────────────────────────────────────────────

// Web search is the single biggest input-token cost: every snippet gets
// injected verbatim into a DeepSeek prompt. DeepSeek's own knowledge is more
// than enough for a travel guide, so this is OFF unless GUIDE_USE_TAVILY=1.
// When enabled, the context is trimmed hard to keep prompt tokens bounded.
async function tavilySearch(query: string): Promise<string> {
  if (process.env.GUIDE_USE_TAVILY !== '1') return '';
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
        max_results: 3,
        include_answer: true,
      }),
    });
    if (!res.ok) return '';
    const data = await res.json() as { answer?: string; results?: { content: string }[] };
    // Prefer the single distilled answer; cap total context to ~800 chars so a
    // wall of web text can't bloat the prompt.
    const snippets = (data.results ?? []).map(r => r.content).join('\n').slice(0, 800);
    return (data.answer ? `${data.answer}\n${snippets}` : snippets).slice(0, 800);
  } catch {
    return '';
  }
}

// ── DeepSeek call ─────────────────────────────────────────────────────────────

async function deepseek(prompt: string, maxTokens = 900): Promise<unknown> {
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
      // Cap output so a single section can't run away and burn tokens.
      max_tokens: maxTokens,
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
  return `Travel writer. JSON overview for ${city}, ${country}.${query ? ` Focus: "${query}".` : ''}${searchContext ? `\nContext:\n${searchContext}` : ''}
Return ONLY JSON. Each body 2 sentences, intro 3.
{
  "flag": "country flag emoji",
  "intro": "city character and vibe",
  "funFacts": ["fact","fact","fact"],
  "overviewSections": [
    {"icon":"🏛️","title":"History","body":"origins and key turning points"},
    {"icon":"🗺️","title":"Geography & Layout","body":"location, terrain, how it's laid out"},
    {"icon":"🎭","title":"Culture & Vibe","body":"local character and daily rhythm"},
    {"icon":"🍽️","title":"Food & Drink","body":"signature dishes and food culture"},
    {"icon":"📅","title":"When to Visit","body":"seasons, weather, best timing"},
    {"icon":"💶","title":"Practical Snapshot","body":"currency, language, rough daily budget"}
  ]
}`;
}

function knowPrompt(city: string, country: string, searchContext: string) {
  return `Travel writer. Cultural background JSON for ${city}, ${country}.${searchContext ? `\nContext:\n${searchContext}` : ''}
Return ONLY JSON. Keep each entry to one line.
{
  "greetings": [{"phrase":"","pronunciation":"","meaning":""},{"phrase":"","pronunciation":"","meaning":""}],
  "customs": ["","",""],
  "taboos": ["",""],
  "neighborhoods": [{"name":"","vibe":""},{"name":"","vibe":""},{"name":"","vibe":""}],
  "safetyTips": ["","",""],
  "transport": ["",""]
}`;
}

function attractionsPrompt(city: string, searchContext: string, query: string) {
  return `Travel curator. 5 must-visit attractions in ${city}.${query ? ` Focus: "${query}".` : ''}${searchContext ? `\nContext:\n${searchContext}` : ''}
Return ONLY a JSON array. highlight 1 sentence, detail 2, background 1 short line.
[{"title":"","highlight":"","detail":"","background":"","address":"neighbourhood or ''","duration":"e.g. 1-2h","cost":"e.g. Free or €12","category":"museum|landmark|nature|viewpoint|shopping|other"}]`;
}

function cityWalksPrompt(city: string, searchContext: string, query: string) {
  return `Travel curator. 2 city walk routes in ${city}.${query ? ` Focus: "${query}".` : ''}${searchContext ? `\nContext:\n${searchContext}` : ''}
Return ONLY a JSON array. Each walk has 4-5 waypoints in walking order. Waypoint names MUST be real, mappable places (landmarks, squares, bridges) in ${city}, not vague directions. Keep notes to one short line.
[{"title":"","highlight":"","detail":"1-2 sentences","waypoints":[{"name":"e.g. Piazza della Signoria","note":""}],"background":"theme tying it together","duration":"e.g. 2-3h","distance":"e.g. 4 km"}]`;
}

function restaurantsPrompt(city: string, searchContext: string, query: string) {
  return `Food writer. 5 restaurants in ${city} across price ranges.${query ? ` Focus: "${query}".` : ''}${searchContext ? `\nContext:\n${searchContext}` : ''}
Return ONLY a JSON array. highlight 1 line, detail 2 sentences, background 1 short line.
[{"title":"","highlight":"cuisine + standout dish","detail":"","background":"","address":"neighbourhood","cost":"e.g. €€ or €15-25pp","category":"food"}]`;
}

function cafesPrompt(city: string, searchContext: string, query: string) {
  return `Café expert. 4 cafés in ${city}.${query ? ` Focus: "${query}".` : ''}${searchContext ? `\nContext:\n${searchContext}` : ''}
Return ONLY a JSON array. highlight 1 line, detail 2 sentences, background 1 short line.
[{"title":"","highlight":"vibe + signature drink","detail":"","background":"","address":"neighbourhood","cost":"e.g. €3-6","category":"cafe"}]`;
}

function experiencesPrompt(city: string, searchContext: string, query: string) {
  return `Experience curator. 4 unique experiences in ${city}.${query ? ` Focus: "${query}".` : ''}${searchContext ? `\nContext:\n${searchContext}` : ''}
Return ONLY a JSON array. highlight 1 line, detail 2 sentences, background 1 short line.
[{"title":"","highlight":"","detail":"how to do it, best time","background":"why locals love it","address":"area","duration":"e.g. half-day","cost":"e.g. €20 or Free","category":"experience"}]`;
}

function moneyTipsPrompt(city: string, searchContext: string) {
  return `Budget travel expert. 5 money-saving tips for ${city}.${searchContext ? `\nContext:\n${searchContext}` : ''}
Return ONLY a JSON array. Each tip 1 sentence.
[{"id":"tip-1","text":""}]`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

// Allow up to 60s — 8 parallel DeepSeek calls can exceed the 10s default.
export const config = { maxDuration: 60 };

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
    // Each section is a fully independent pipeline: its own Tavily search →
    // DeepSeek call → emit. This means the overview (meta) flushes the instant
    // ITS two calls finish — it's never gated by the other sections' searches.
    // The client renders meta first and lazy-loads the rest as they stream in.

    const metaPipe = (async () => {
      const ctx = await tavilySearch(`${city} ${country} travel highlights overview ${query}`);
      const raw = await deepseek(metaPrompt(city, country, ctx, query), 800) as {
        flag: string; intro: string; funFacts: string[];
        overviewSections?: { icon: string; title: string; body: string }[];
      };
      emit(res, 'meta', {
        city, country,
        flag: raw.flag ?? '🗺️',
        bannerColor: randomBanner(),
        intro: raw.intro ?? '',
        funFacts: raw.funFacts ?? [],
        overviewSections: raw.overviewSections ?? [],
      });
    })();

    const knowPipe = (async () => {
      const ctx = await tavilySearch(`${city} ${country} customs culture etiquette travelers`);
      emit(res, 'know', await deepseek(knowPrompt(city, country, ctx), 600));
    })();

    const attractionsPipe = (async () => {
      const ctx = await tavilySearch(`${city} best attractions must-see 2025 ${query}`);
      const raw = await deepseek(attractionsPrompt(city, ctx, query), 1000);
      const items = await addPhotos(addSearchUrls((Array.isArray(raw) ? raw : []) as GuideCard[], city), city);
      emit(res, 'attractions', items);
    })();

    const cityWalksPipe = (async () => {
      const ctx = await tavilySearch(`${city} best walking routes city walk 2025 ${query}`);
      const raw = await deepseek(cityWalksPrompt(city, ctx, query), 900);
      const items = await addPhotos(addSearchUrls((Array.isArray(raw) ? raw : []) as CityWalk[], city), city);
      emit(res, 'cityWalks', items);
    })();

    const restaurantsPipe = (async () => {
      const ctx = await tavilySearch(`${city} best restaurants local food 2025 ${query}`);
      const raw = await deepseek(restaurantsPrompt(city, ctx, query), 900);
      emit(res, 'restaurants', addSearchUrls((Array.isArray(raw) ? raw : []) as GuideCard[], city));
    })();

    const cafesPipe = (async () => {
      const ctx = await tavilySearch(`${city} best cafes specialty coffee 2025 ${query}`);
      const raw = await deepseek(cafesPrompt(city, ctx, query), 700);
      emit(res, 'cafes', addSearchUrls((Array.isArray(raw) ? raw : []) as GuideCard[], city));
    })();

    const experiencesPipe = (async () => {
      const ctx = await tavilySearch(`${city} unique experiences things to do 2025 ${query}`);
      const raw = await deepseek(experiencesPrompt(city, ctx, query), 700);
      const items = await addPhotos(addSearchUrls((Array.isArray(raw) ? raw : []) as GuideCard[], city), city);
      emit(res, 'experiences', items);
    })();

    const moneyPipe = (async () => {
      const ctx = await tavilySearch(`${city} budget travel money saving tips 2025`);
      const raw = await deepseek(moneyTipsPrompt(city, ctx), 500);
      const tips = (Array.isArray(raw) ? raw : []) as GuideTip[];
      emit(res, 'moneyTips', tips.map((t, i) => ({ ...t, id: t.id || `tip-${i}` })));
    })();

    // Wait for every pipeline; a single section failing must not abort the rest,
    // so use allSettled and surface any failures as a non-fatal error event.
    const results = await Promise.allSettled([
      metaPipe, knowPipe, attractionsPipe, cityWalksPipe,
      restaurantsPipe, cafesPipe, experiencesPipe, moneyPipe,
    ]);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length === results.length) {
      // Everything failed — likely a bad API key or upstream outage.
      const first = failed[0] as PromiseRejectedResult;
      emit(res, 'error', { message: (first.reason as Error)?.message ?? 'generation failed' });
    }

    emit(res, 'done', {});
  } catch (err) {
    emit(res, 'error', { message: (err as Error).message });
  } finally {
    res.end();
  }
}
