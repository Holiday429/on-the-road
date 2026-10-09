/* ==========================================================================
   On the Road · /api/recap  — Vercel Serverless Function
   --------------------------------------------------------------------------
   Generates a TRAVELLER PORTRAIT from a trip's journal: "what kind of person
   records like this", as opposed to /api/story, which recaps the trip.

   The whole pipeline runs here (signals → evidence → model → privacy gate), so
   web and iOS share one implementation and cannot disagree about a portrait or
   about what is safe to share. Clients send their own entries and receive a
   finished document, which THEY write to Firestore — the server neither reads
   nor writes the database, so it can never be pointed at someone else's trip.

   Cross-device sync is Firestore's job, not this endpoint's: whichever device
   generates writes trips/{tripId}/travelerRecaps/{id}; every other device just
   subscribes to it.

   The prompt is built here, not on the client: it carries the anti-flattery
   rules and the privacy contract that produces the public text, and a
   client-built prompt would be a client-editable privacy contract.

   POST body:
     { entries: RecapEntry[], userInitiated: true, tripId?: string, lang?: string }
       userInitiated — must be literally true. Clients set it only inside the
                       handler of the Generate / Regenerate button, so no
                       script, test run, preview or background task can spend
                       model credit by calling this endpoint.
       RecapEntry = { id, happenedOn "YYYY-MM-DD", title, body, destination,
                      photoCount }   (extra fields such as tags are ignored)
   Response:
     { draft: RecapDraft, privacyReport: Record<chapterId, string[]> }

   Below MIN_ENTRIES_FOR_PORTRAIT the response is a numbers-only draft
   (source: "signals") and no credit is charged.

   Keys in .env (server-side only, no VITE_ prefix):
     DEEPSEEK_API_KEY
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyAndMeter } from './_guard';
import { checkRateLimit, respondRateLimited } from './_ratelimit';
import type { RecapEntry } from './_recap/signals';
import { limitsFor, type Limits } from './_recap/limits';
import { assemble, buildSignalsOnly, isPortraitReady, prepare, type PreparedRecap } from './_recap/portrait';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown>; method: string; headers: Record<string, string | string[] | undefined> };
type VercelResponse = ServerResponse & {
  json(data: unknown): void;
  status(code: number): VercelResponse;
  setHeader(k: string, v: string): void;
  end(): void;
};

const ALLOWED_LANGUAGES = new Set([
  'English', 'Simplified Chinese', 'Japanese', 'French', 'Spanish', 'Korean',
]);

function langInstruction(lang: unknown): string {
  const value = typeof lang === 'string' && ALLOWED_LANGUAGES.has(lang) ? lang : 'English';
  if (value === 'English') return '';
  return `\nWrite ALL human-readable text in ${value}. Keep every JSON key in English.`;
}

/** Hard ceilings on what a client may send, so one request can't inflate token spend or memory. */
const MAX_ENTRIES = 800;
const MAX_BODY_CHARS = 6000;

const CHAPTER_BRIEFS: Record<string, string> = {
  attention:   'Where their eye lands. What kind of thing they notice that another traveller would walk past.',
  method:      'How they get from a concrete scene to a judgement. The shape of the move, including how they tend to end.',
  relations:   'How they treat people — companions and strangers alike — and what they seem to want from contact with them.',
  friction:    'Their procedure when something goes wrong. What they do first, what they refuse to do, and what it costs them.',
  recording:   'What kind of writer they are, read from the writing itself: whether they write on the day or after leaving, how length and form change with how they feel about a place, whether they quote other people, how they end.',
  throughline: 'The concern that keeps resurfacing across unrelated entries, which they may not have noticed themselves.',
};

function buildPrompt(prep: PreparedRecap, lang: unknown, L: Limits): string {
  const chapterIds = Object.keys(CHAPTER_BRIEFS);

  const briefs = chapterIds.map((id) => `  - "${id}": ${CHAPTER_BRIEFS[id]}`).join('\n');
  const tiles = prep.tiles.map((t) => ({ topic: t.topic, value: t.value }));

  return `You are writing a portrait of a traveller, based on their own travel journal.

The subject is the PERSON, not the trip. Never summarise the itinerary. The
reader should finish this understanding how this person looks at the world and
handles things — something they could not easily have written about themselves.

You are given three kinds of material:
1. SIGNALS — how they wrote: how often, how long, how their length and form
   vary, whether they quote people, how they end a note. Already measured.
2. EVIDENCE — a sample of the writing itself, compressed by genre. "longform"
   is reduced to its reasoning skeleton; "notes" give only the opening and
   closing sentence of an entry (so you see what was seen and what was
   concluded, not the middle); "fragments" are verbatim; "dialogue" is quoted
   speech only; "titlesOnly" are entries that have photos and no text.
3. NUMBERS — figures already computed for an overview card.

WHAT YOU DO NOT KNOW, and must not claim:
- You cannot see the photos. Only how many accompany each note is known. Never
  describe what the photos show or how they are composed.
- You are not given tags, mood labels, favourites, or whether any optional field
  was filled in, and you must draw no conclusion from them. Those are skipped
  or filled for reasons that say nothing about the person. Every judgement must
  rest on what they wrote and how they wrote it.

Return ONLY valid JSON in exactly this shape:
{
  "archetype": { "label": "...", "tagline": "..." },
  "traits":  [ { "key": "...", "score": 0, "note": "..." } ],
  "numbers": [ { "label": "..." } ],
  "chapters":[ { "id": "...", "heading": "...", "body": "...", "bodyPublic": "...", "evidenceRefs": ["e01"] } ],
  "oneLine": "...",
  "questions": ["...", "...", "..."]
}

CHAPTERS — write one for each of these ids, in this order:
${briefs}

LENGTH LIMITS, in characters (hard — the layout breaks past them):
  archetype.label     <= ${L.label}, a noun phrase, not a job title
  archetype.tagline   <= ${L.tagline}
  traits              EXACTLY 4 items. key <= ${L.traitKey}, note <= ${L.traitNote}
  numbers             EXACTLY one item per entry in NUMBERS, same order.
                      label <= ${L.numLabel}. Write only the label — never the
                      figure itself; it is rendered separately.
  chapters[].heading  <= ${L.heading}
  chapters[].body     ${L.bodyMin}-${L.bodyMax}, and no shorter than its bodyPublic
  chapters[].bodyPublic  ${L.pubMin}-${L.pubMax}
  oneLine             <= ${L.oneLine}
  questions           EXACTLY 3, each <= ${L.question}

TRAITS — four independent dispositions of the person, each visible in how they
see, decide, relate or travel. Never a statistic about how they used the app,
and never two traits that are the same axis at opposite ends.

QUESTIONS — three questions to carry into the next trip, each from a different
angle, specific to this person rather than generic:
  1. about what to look at or notice
  2. about how to choose or act when something pulls them
  3. about how to keep or write down the trip, or who to share it with

HOW TO WRITE THE CHAPTERS:
- State conclusions about the person. Do not retell the events that led you
  there; the reader already lived them.
- Do not quote or restate the signal numbers. Use them to reach a judgement,
  then write only the judgement.
- Cite up to 4 evidence refs per chapter in "evidenceRefs", using ONLY ref ids
  present in the evidence. Never invent one.
- In EVERY chapter, in both "body" and "bodyPublic", wrap the one sentence that
  states the judgement in **double asterisks**, exactly once per text, e.g.
  "…。**你需要先离开，才能把一个地方说清楚。**…". The card draws it underlined.
  Do not use asterisks for anything else.
- Every chapter must name a cost, a limit, or a tension alongside what it
  praises. A portrait with no friction in it reads as flattery and the subject
  will not believe it — "they treat uncertainty as material" is only credible
  next to what that habit costs them.
- At most one trait score above 90, and at least one below 40. A person who is
  excellent at four things out of four has not been observed, only complimented.
- If the evidence is thin in some area, write less about it rather than
  inventing. Never state a biographical fact (age, job, relationship, home)
  that is not in the evidence.

THE TWO GRANULARITIES — this part is a privacy contract, not a style note:
Each chapter needs "body" and "bodyPublic".

  "body" is for the subject alone. It may reference specific incidents.

  "bodyPublic" is for a public share card that strangers will see. It must
  carry the SAME judgement with every identifying detail removed:
    - no personal names, and no initials standing in for names
    - no relationship words (partner, boyfriend, wife, ex, spouse)
    - no quoted speech of any kind, and no quotation marks
    - no money amounts, no addresses, no room or flat numbers
    - no health or body details
    - no lodging platforms, hosts, or business names
    - no single retellable incident: convert "the night this went wrong" into
      the method the person used, which is the part worth sharing anyway
  Write "bodyPublic" as the distilled version, not the censored one. It is
  usually the better sentence, because it states the principle instead of the
  anecdote. If a chapter cannot be abstracted this way, write the best
  "bodyPublic" you can and keep it free of the items above.

${langInstruction(lang)}
NUMBERS (write one label for each, in this order):
${JSON.stringify(tiles)}

SIGNALS:
${JSON.stringify(prep.compact)}

EVIDENCE:
${JSON.stringify(prep.evidence)}`;
}

async function deepseek(prompt: string): Promise<unknown> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY not set');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      // Never the legacy 'deepseek-chat' alias — DeepSeek retired it 2026-07-24
      // and now routes it to a reasoning model that ignores max_tokens.
      model: process.env.DEEPSEEK_MODEL_LIGHT || 'deepseek-v4-flash',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      // Lower than /api/story's 0.9: a portrait is a claim about a real person,
      // and the failure mode of a high temperature here is confident invention.
      temperature: 0.6,
      // Six chapters at two granularities plus the card layer, with private
      // bodies up to 260 characters. /api/story's 1200 truncates this mid-JSON.
      max_tokens: 3200,
      thinking: { type: 'disabled' },
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return JSON.parse(data.choices[0].message.content);
}

/**
 * Validate and normalise the client's entries. Returns null for anything that
 * isn't a well-formed list; individual malformed rows are dropped rather than
 * failing the whole request, since a journal can carry one odd old entry.
 */
export function sanitizeEntries(raw: unknown): RecapEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RecapEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id || e.id.length > 128) continue;
    if (typeof e.happenedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.happenedOn)) continue;
    out.push({
      id: e.id,
      happenedOn: e.happenedOn,
      title: typeof e.title === 'string' ? e.title.slice(0, 200) : '',
      body: typeof e.body === 'string' ? e.body.slice(0, MAX_BODY_CHARS) : '',
      destination: typeof e.destination === 'string' ? e.destination.slice(0, 80) : '',
      photoCount: Math.min(9, Math.max(0, Math.floor(Number(e.photoCount) || 0))),
    });
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Spend only on a deliberate tap. Checked before everything else, so an
  // automated caller learns nothing and costs nothing.
  if (req.body?.userInitiated !== true) {
    res.status(400).json({ error: 'userInitiated is required: a portrait is only generated on a user tap' });
    return;
  }

  // Validate before the guard: a malformed request must not cost a credit.
  if (Array.isArray(req.body.entries) && req.body.entries.length > MAX_ENTRIES) {
    res.status(413).json({ error: `too many entries (max ${MAX_ENTRIES})` });
    return;
  }
  const entries = sanitizeEntries(req.body.entries);
  if (!entries || entries.length === 0) {
    res.status(400).json({ error: 'entries is required' });
    return;
  }

  const ready = isPortraitReady(entries.length);
  const tripId = typeof req.body.tripId === 'string' && req.body.tripId ? req.body.tripId.slice(0, 128) : null;

  const uid = await verifyAndMeter(
    req as Parameters<typeof verifyAndMeter>[0],
    res as Parameters<typeof verifyAndMeter>[1],
    // A numbers-only card needs no model, so it is free; auth is still verified.
    { tripId: tripId ?? undefined, chargeable: ready },
  );
  if (!uid) return;

  // Tighter than /api/story's 10/min. A portrait is a once-per-trip artifact,
  // not something a user iterates on, so this only has to leave room for a
  // couple of honest retries after a bad generation.
  const limit = await checkRateLimit(`recap:${uid}`, 3, 3600);
  if (!limit.ok) { respondRateLimited(res, limit.retryAfter); return; }

  const prep = prepare(entries);

  if (!ready) {
    res.status(200).json(buildSignalsOnly(prep, tripId));
    return;
  }

  try {
    const limits = limitsFor(req.body.lang);
    const raw = await deepseek(buildPrompt(prep, req.body.lang, limits));
    const result = assemble(raw, prep, tripId, limits);
    // Fail loudly rather than store a stub: the client keeps whatever portrait
    // it already has, instead of having it overwritten by a thinner one.
    if (!result) { res.status(502).json({ error: 'model returned an unusable portrait' }); return; }
    res.status(200).json(result);
  } catch (e) {
    console.error('recap generation failed:', e);
    res.status(502).json({ error: String(e) });
  }
}
