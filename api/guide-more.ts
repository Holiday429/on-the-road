/* ==========================================================================
   On the Road · /api/guide-more  — generate MORE items for one section
   --------------------------------------------------------------------------
   POST body: {
     city: string, country: string, section: SectionKey,
     existingTitles: string[], query?: string
   }
   section ∈ attractions | cityWalks | restaurants | cafes | experiences | moneyTips
   Returns: JSON { items: [...] }  (same shape as that section in /api/guide)

   Non-streaming — the client appends the returned items to what it already has.
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown> };
type VercelResponse = ServerResponse & {
  json(data: unknown): void;
  status(code: number): VercelResponse;
  setHeader(k: string, v: string): void;
  end(): void;
};

// ── Helpers (kept inline so the function is self-contained) ───────────────────

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function searchUrl(title: string, city: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${title} ${city}`)}`;
}

// Web search OFF unless GUIDE_USE_TAVILY=1 — it bloats prompt tokens.
async function tavilySearch(query: string): Promise<string> {
  if (process.env.GUIDE_USE_TAVILY !== '1') return '';
  const key = process.env.TAVILY_API_KEY;
  if (!key) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, search_depth: 'basic', max_results: 3, include_answer: true }),
    });
    if (!res.ok) return '';
    const data = await res.json() as { answer?: string; results?: { content: string }[] };
    const snippets = (data.results ?? []).map(r => r.content).join('\n').slice(0, 800);
    return (data.answer ? `${data.answer}\n${snippets}` : snippets).slice(0, 800);
  } catch { return ''; }
}

async function deepseek(prompt: string, maxTokens = 700): Promise<unknown> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY not set');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.9,   // a touch higher for variety on "more"
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return JSON.parse(data.choices[0].message.content);
}

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
    return { imageUrl: hit.urls.regular, photographer: hit.user?.name ?? '', photographerUrl: hit.user?.links?.html ?? '' };
  } catch { return EMPTY_PHOTO; }
}

// Sections that get Unsplash imagery (restaurants/cafés/moneyTips do not).
const PHOTO_SECTIONS = new Set<SectionKey>(['attractions', 'cityWalks', 'experiences']);

// ── Section config ────────────────────────────────────────────────────────────

type SectionKey = 'attractions' | 'cityWalks' | 'restaurants' | 'cafes' | 'experiences' | 'moneyTips';

interface SectionDef {
  count: number;
  searchQuery: (city: string, q: string) => string;
  // Build the "generate N more, excluding these" prompt.
  prompt: (city: string, ctx: string, q: string, exclude: string) => string;
}

const SHAPE_CARD = `{
  "title": "name",
  "highlight": "one punchy sentence",
  "detail": "2-3 sentences",
  "background": "1 sentence of context",
  "address": "neighbourhood or address",
  "duration": "e.g. 1-2h (or empty)",
  "cost": "e.g. Free / €12 / €€",
  "category": "see category note"
}`;

const SECTIONS: Record<SectionKey, SectionDef> = {
  attractions: {
    count: 4,
    searchQuery: (c, q) => `${c} lesser-known attractions hidden gems 2025 ${q}`,
    prompt: (c, ctx, q, ex) => `You are a travel curator. List 4 MORE must-visit or lesser-known attractions in ${c}, DIFFERENT from those already listed.
Already listed (do NOT repeat): ${ex || 'none'}.
${q ? `User interest: "${q}"\n` : ''}${ctx ? `Recent web context:\n${ctx}\n` : ''}
Return ONLY a valid JSON array of ${SHAPE_CARD}
category ∈ museum, landmark, nature, viewpoint, shopping, other`,
  },
  cityWalks: {
    count: 2,
    searchQuery: (c, q) => `${c} alternative walking routes neighbourhoods 2025 ${q}`,
    prompt: (c, ctx, q, ex) => `Suggest 2 MORE city walk routes in ${c}, DIFFERENT from those already listed.
Already listed (do NOT repeat): ${ex || 'none'}.
${q ? `User interest: "${q}"\n` : ''}${ctx ? `Recent web context:\n${ctx}\n` : ''}
Return ONLY a valid JSON array of {
  "title": "route name", "highlight": "one sentence hook",
  "detail": "1-2 sentence overall description of the route",
  "waypoints": [{"name": "real, mappable place in ${c}", "note": "one short line"}],
  "background": "theme tying it together",
  "duration": "e.g. 2-3h", "distance": "e.g. 4 km"
}
Give each walk 4-6 waypoints in walking order; names must be specific, geocodable places.`,
  },
  restaurants: {
    count: 4,
    searchQuery: (c, q) => `${c} more restaurants local favourites 2025 ${q}`,
    prompt: (c, ctx, q, ex) => `Recommend 4 MORE restaurants in ${c} across price ranges, DIFFERENT from those already listed.
Already listed (do NOT repeat): ${ex || 'none'}.
${q ? `User interest: "${q}"\n` : ''}${ctx ? `Recent web context:\n${ctx}\n` : ''}
Return ONLY a valid JSON array of ${SHAPE_CARD}
category must be "food"`,
  },
  cafes: {
    count: 4,
    searchQuery: (c, q) => `${c} more cafes coffee spots 2025 ${q}`,
    prompt: (c, ctx, q, ex) => `Recommend 4 MORE cafés in ${c}, DIFFERENT from those already listed.
Already listed (do NOT repeat): ${ex || 'none'}.
${q ? `User interest: "${q}"\n` : ''}${ctx ? `Recent web context:\n${ctx}\n` : ''}
Return ONLY a valid JSON array of ${SHAPE_CARD}
category must be "cafe"`,
  },
  experiences: {
    count: 4,
    searchQuery: (c, q) => `${c} more unique experiences activities 2025 ${q}`,
    prompt: (c, ctx, q, ex) => `Suggest 4 MORE unique experiences in ${c}, DIFFERENT from those already listed.
Already listed (do NOT repeat): ${ex || 'none'}.
${q ? `User interest: "${q}"\n` : ''}${ctx ? `Recent web context:\n${ctx}\n` : ''}
Return ONLY a valid JSON array of ${SHAPE_CARD}
category must be "experience"`,
  },
  moneyTips: {
    count: 4,
    searchQuery: (c, q) => `${c} more budget travel money saving tips 2025 ${q}`,
    prompt: (c, ctx, _q, ex) => `Give 4 MORE money-saving tips for ${c}, DIFFERENT from those already listed.
Already listed (do NOT repeat): ${ex || 'none'}.
${ctx ? `Recent web context:\n${ctx}\n` : ''}
Return ONLY a valid JSON array of {"text": "actionable saving tip in 1-2 sentences"}`,
  },
};

// ── Handler ───────────────────────────────────────────────────────────────────

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { city, section, existingTitles = [], query = '' } = req.body as {
    city: string; country?: string; section: SectionKey;
    existingTitles?: string[]; query?: string;
  };

  if (!city || !section || !SECTIONS[section]) {
    res.status(400).json({ error: 'city and a valid section are required' });
    return;
  }

  const def = SECTIONS[section];
  // Only the titles are needed to dedupe; cap the list so repeated "more"
  // clicks don't keep inflating the prompt.
  const exclude = (existingTitles as string[]).slice(0, 20).join('; ');

  try {
    const ctx = await tavilySearch(def.searchQuery(city, query));
    // cityWalks carries waypoints, so it needs more room than the others.
    const cap = section === 'cityWalks' ? 900 : 800;
    const raw = await deepseek(def.prompt(city, ctx, query, exclude), cap);
    let items = (Array.isArray(raw) ? raw : []) as Record<string, unknown>[];

    // Drop anything whose title collides with an existing one (case-insensitive).
    const seen = new Set((existingTitles as string[]).map(t => t.toLowerCase().trim()));
    items = items.filter(it => {
      const t = String(it.title ?? it.text ?? '').toLowerCase().trim();
      if (!t || seen.has(t)) return false;
      seen.add(t);
      return true;
    });

    // Attach ids + searchUrls (cards/walks have titles; tips only have text),
    // plus Unsplash photos for landmark-ish sections.
    const stamp = Date.now();
    const wantPhoto = PHOTO_SECTIONS.has(section);
    const out = await Promise.all(items.map(async (it, i) => {
      if (section === 'moneyTips') {
        return { id: `tip-more-${stamp}-${i}`, text: it.text ?? '' };
      }
      const title = String(it.title ?? '');
      const photo = wantPhoto ? await unsplashPhoto(`${title} ${city}`) : EMPTY_PHOTO;
      return { ...it, ...photo, id: `${slug(title)}-${stamp}-${i}`, searchUrl: searchUrl(title, city) };
    }));

    res.json({ items: out });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
