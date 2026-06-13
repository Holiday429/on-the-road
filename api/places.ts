/* ==========================================================================
   On the Road · /api/places  — Vercel Serverless Function
   --------------------------------------------------------------------------
   Server-side proxy for Google Places so the API key NEVER reaches the browser
   (a client-side key is trivially scraped from the Network tab and abused on
   your bill). The browser calls this endpoint; we call Google with the key.

   GET ?op=autocomplete&q=<text>&session=<token>
   GET ?op=details&placeId=<id>&session=<token>
   GET ?op=photo&ref=<photo_reference>     → 302 redirect to the photo bytes

   Key in .env (server-side ONLY — no VITE_ prefix):
     GOOGLE_PLACES_KEY
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';

type VercelRequest  = IncomingMessage & { query: Record<string, string | string[] | undefined>; method?: string };
type VercelResponse = ServerResponse & {
  json(data: unknown): void;
  status(code: number): VercelResponse;
  setHeader(k: string, v: string): void;
  redirect(code: number, url: string): void;
  end(): void;
};

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) { res.status(503).json({ error: 'Places not configured' }); return; }

  const op = str(req.query.op);
  const session = str(req.query.session);

  try {
    if (op === 'autocomplete') {
      const q = str(req.query.q);
      if (q.length < 3) { res.status(200).json({ predictions: [] }); return; }
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json`
        + `?input=${encodeURIComponent(q)}&types=establishment&key=${key}`
        + (session ? `&sessiontoken=${encodeURIComponent(session)}` : '');
      const data = await (await fetch(url)).json() as { predictions?: unknown[] };
      const predictions = (data.predictions ?? []).slice(0, 5).map((p) => {
        const r = p as Record<string, any>;
        return {
          description: r.description,
          mainText: r.structured_formatting?.main_text ?? r.description,
          secondaryText: r.structured_formatting?.secondary_text ?? '',
          placeId: r.place_id,
        };
      });
      res.status(200).json({ predictions });
      return;
    }

    if (op === 'details') {
      const placeId = str(req.query.placeId);
      if (!placeId) { res.status(400).json({ error: 'placeId required' }); return; }
      const fields = 'formatted_address,geometry,url,photos';
      const url = `https://maps.googleapis.com/maps/api/place/details/json`
        + `?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${key}`
        + (session ? `&sessiontoken=${encodeURIComponent(session)}` : '');
      const data = await (await fetch(url)).json() as { result?: Record<string, any> };
      const r = data.result;
      if (!r) { res.status(200).json({ result: null }); return; }
      res.status(200).json({
        result: {
          address: r.formatted_address ?? '',
          mapsUrl: r.url ?? `https://maps.google.com/?place_id=${placeId}`,
          lat: r.geometry?.location?.lat ?? 0,
          lng: r.geometry?.location?.lng ?? 0,
          photoRef: r.photos?.[0]?.photo_reference,
        },
      });
      return;
    }

    if (op === 'photo') {
      const ref = str(req.query.ref);
      if (!ref) { res.status(400).json({ error: 'ref required' }); return; }
      // Resolve the redirect server-side so the key isn't in the <img> src. The
      // Places photo endpoint 302s to the actual image; forward that location.
      const url = `https://maps.googleapis.com/maps/api/place/photo`
        + `?maxwidth=800&photo_reference=${encodeURIComponent(ref)}&key=${key}`;
      const upstream = await fetch(url, { redirect: 'manual' });
      const loc = upstream.headers.get('location');
      if (loc) { res.redirect(302, loc); return; }
      res.status(502).json({ error: 'No photo location' });
      return;
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    console.error('[places] error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
}
