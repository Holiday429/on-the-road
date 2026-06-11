/* ==========================================================================
   On the Road · /api/story  — Vercel Serverless Function
   --------------------------------------------------------------------------
   Generates a playful travel-recap draft from journal entries.

   The client builds the prompt (it owns the payload shape + entry-id
   validation) and sends it here; the server only runs the LLM so the
   provider key never reaches the browser.

   POST body: { prompt: string }
   Response:  JSON — the model's raw recap object
              { title, subtitle, recapLine, travelerMode, modules[], questions[] }

   Keys in .env (server-side only, no VITE_ prefix):
     DEEPSEEK_API_KEY
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown>; method: string };
type VercelResponse = ServerResponse & {
  json(data: unknown): void;
  status(code: number): VercelResponse;
  setHeader(k: string, v: string): void;
  end(): void;
};

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
      temperature: 0.9,
      max_tokens: 1200,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return JSON.parse(data.choices[0].message.content);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const prompt = (req.body.prompt as string ?? '').trim();
  if (!prompt) { res.status(400).json({ error: 'prompt is required' }); return; }

  try {
    const data = await deepseek(prompt);
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
