/* ==========================================================================
   On the Road · /api/check  — Vercel Serverless Function
   --------------------------------------------------------------------------
   Reviews a trip-prep checklist and flags critically-missing items.

   POST body: { summary: string }   (the checklist rendered as plain text)
   Response:  JSON { suggestions: string[] }

   Keys in .env (server-side only, no VITE_ prefix):
     DEEPSEEK_API_KEY
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyAndMeter } from './_guard';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown>; method: string; headers: Record<string, string | string[] | undefined> };
type VercelResponse = ServerResponse & {
  json(data: unknown): void;
  status(code: number): VercelResponse;
  setHeader(k: string, v: string): void;
  end(): void;
};

async function deepseek(prompt: string): Promise<{ suggestions: string[] }> {
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
      max_tokens: 400,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: { message: { content: string } }[] };
  const parsed = JSON.parse(data.choices[0].message.content) as { suggestions?: unknown };
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.filter((s): s is string => typeof s === 'string').slice(0, 5)
    : [];
  return { suggestions };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const uid = await verifyAndMeter(req as Parameters<typeof verifyAndMeter>[0], res as Parameters<typeof verifyAndMeter>[1]);
  if (!uid) return;

  const summary = (req.body.summary as string ?? '').trim();
  if (!summary) { res.status(400).json({ error: 'summary is required' }); return; }

  const prompt = `You are a travel preparation assistant. Review this trip preparation checklist and identify the most important items that might be missing. Be concise — list at most 5 suggestions, each in one short sentence. Only flag genuinely critical items most travelers overlook.

Checklist:
${summary}

Return ONLY valid JSON of the shape { "suggestions": ["...", "..."] }. If nothing important is missing, return { "suggestions": [] }.`;

  try {
    const data = await deepseek(prompt);
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
