/* ==========================================================================
   On the Road · Recap L2 — layered evidence pack
   --------------------------------------------------------------------------
   Pure, local, zero-token. Turns every entry into a budgeted corpus the model
   can actually read.

   The strategy that matters: sample BY GENRE at different compression rates,
   rather than ranking all entries and truncating the top N. Ranking optimises
   for "most important entries"; a portrait needs "widest evidence of how this
   person writes". A 26-character line and a 1900-character essay are both
   indispensable and need completely different treatment — the line is already
   as short as it gets, the essay should be reduced to its reasoning skeleton.

   Compression per layer:
     A longform   first para + headings + last para   (reasoning, worth tokens)
     B notes      first sentence + last sentence      (the leap, not the build-up)
     C fragments  verbatim                            (already dense)
     D dialogue   quoted lines only                   (how they treat people)
     E titlesOnly titles                               (blank body is a style)
     F allTitles  title + place + length               (global map, very cheap)
   ========================================================================== */

import { bucketOf, firstSentence, lastSentence, type RecapEntry } from './signals';

/** A title, or the first few words of the body when the entry has none. */
function titleFor(entry: RecapEntry): string {
  if (entry.title.trim()) return entry.title.trim();
  return entry.body.trim().split(/\s+/).slice(0, 6).join(' ') || 'Untitled';
}

/* ── Budget ───────────────────────────────────────────────────────────────── */

/**
 * Characters of evidence we're willing to send, scaled to how much the person
 * wrote. Someone with 10 entries and someone with 300 shouldn't cost the same,
 * and neither should be able to blow the context.
 *
 * ~1 token ≈ 2 chars for CJK, ≈4 for Latin; we budget in chars and stay on the
 * conservative (CJK) side, so 9000 chars is roughly 3-4.5k tokens.
 */
export function evidenceBudget(entryCount: number): number {
  return Math.min(9000, 2000 + entryCount * 90);
}

/** Per-layer caps. Hit before the budget on small trips, after it on large ones. */
const CAPS = {
  longform: 6,
  notes: 20,
  fragments: 15,
  dialogue: 10,
  titlesOnly: 20,
  allTitles: 120,
} as const;

/* ── Shape ────────────────────────────────────────────────────────────────── */

export interface EvidencePack {
  longform: Array<{ ref: string; place: string; text: string }>;
  notes: Array<{ ref: string; place: string; open: string; close: string }>;
  fragments: Array<{ ref: string; text: string }>;
  dialogue: Array<{ ref: string; lines: string[] }>;
  titlesOnly: string[];
  allTitles: Array<{ ref: string; title: string; place: string; chars: number }>;
  /** Entries that read as trouble-and-resolution; feeds the `friction` chapter. */
  frictionRefs: string[];
}

export interface BuiltEvidence {
  pack: EvidencePack;
  /** Short ref → real entry id. The whitelist for rejecting hallucinated refs. */
  refMap: Record<string, string>;
  /** Rough size of the serialised pack, for logging/telemetry. */
  chars: number;
}

/* ── Friction detection ───────────────────────────────────────────────────── */
// Entries where something went wrong AND the writer did something about it.
// Requiring both halves is what separates "this was annoying" from the thing
// the portrait wants, which is the person's procedure under pressure.

/**
 * Distress markers. Deliberately narrow: the first version of this list
 * included 没有 / 误 / 丢, which appear constantly in ordinary travel prose
 * ("没有游人", "不期而遇") and made every long entry look like a crisis. Only
 * words that are hard to write without something having actually gone wrong.
 */
const TROUBLE_RE = /(出了问题|很麻烦|糟糕|倒霉|耽误|错过|取消|停运|延误|坏了|丢了|不见了|无奈|慌|焦虑|抱怨|受不了|忍不住|睡不着|堵得|赶不上|来不及|退房|投诉|退款|太热|太冷|吵得|没能|失误|cancel(?:led|ed)?|missed (?:the|my)|broke down|got lost|stuck|delayed|refund|complain|too hot|too cold|couldn'?t sleep|went wrong|ran out of)/;

/**
 * Evidence that the writer did something about it, rather than only recording
 * that it happened. Both halves are required, because the chapter this feeds
 * is about procedure under pressure — a pure complaint has no procedure in it.
 */
const RESOLVE_RE = /(于是|最后|最终|决定|解决|改签|换了|重新|好在|幸好|总算|学会|下次|终于|只好|不得不|so I|finally|ended up|decided|instead|managed to|turned out|lesson|in the end)/i;

function isFriction(body: string): boolean {
  return body.length >= 80 && TROUBLE_RE.test(body) && RESOLVE_RE.test(body);
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

export function buildEvidence(entries: RecapEntry[]): BuiltEvidence {
  const rows = [...entries].sort((a, b) => a.happenedOn.localeCompare(b.happenedOn));

  // Short refs save real tokens: a 32-char hex id costs ~16 tokens, `e07` costs
  // one. Across 80 entries referenced from six chapters that's the difference
  // between a few hundred tokens and a few thousand.
  const refMap: Record<string, string> = {};
  const refOf = new Map<string, string>();
  rows.forEach((entry, i) => {
    const ref = `e${String(i + 1).padStart(2, '0')}`;
    refMap[ref] = entry.id;
    refOf.set(entry.id, ref);
  });

  const ref = (e: RecapEntry) => refOf.get(e.id) ?? 'e00';
  const withBucket = rows.map((entry) => ({
    entry,
    body: entry.body.trim(),
    bucket: bucketOf(entry.body.trim().length),
  }));

  /* F — global map. Cheapest layer; gives the model the whole shape of the
       trip so it never mistakes the sample for the entirety. */
  const allTitles = rows.slice(0, CAPS.allTitles).map((entry) => ({
    ref: ref(entry),
    title: titleFor(entry).slice(0, 40),
    place: entry.destination.trim(),
    chars: entry.body.trim().length,
  }));

  /* A — longform. Deduped by place so six essays about one city don't crowd
       out the rest of the trip. */
  const longform = pickSpread(
    withBucket.filter((r) => r.bucket === 'longform' || r.bucket === 'essay'),
    CAPS.longform,
    (r) => r.entry.destination.trim(),
    (a, b) => b.body.length - a.body.length,
  ).map((r) => ({
    ref: ref(r.entry),
    place: r.entry.destination.trim(),
    text: skeleton(r.body),
  }));

  const longformRefs = new Set(longform.map((l) => l.ref));

  /* B — notes. First and last sentence. The opening says what was seen, the
       close says what was concluded; the middle is scaffolding the model can
       infer. This is the single biggest token saving in the pack. */
  const notes = withBucket
    .filter((r) => (r.bucket === 'note' || r.bucket === 'essay') && !longformRefs.has(ref(r.entry)))
    .slice(0, CAPS.notes)
    .map((r) => ({
      ref: ref(r.entry),
      place: r.entry.destination.trim(),
      open: firstSentence(r.body).slice(0, 90),
      close: lastSentence(r.body).slice(0, 90),
    }))
    .filter((n) => n.open || n.close);

  /* C — fragments. Verbatim; they're short by definition and carry the highest
       meaning-per-character of anything in the journal. */
  const fragments = withBucket
    .filter((r) => r.bucket === 'fragment')
    .slice(0, CAPS.fragments)
    .map((r) => ({ ref: ref(r.entry), text: r.body }));

  /* D — dialogue. Quoted speech only. The most efficient material there is for
       reading how someone relates to other people. */
  const dialogue = withBucket
    .map((r) => ({ ref: ref(r.entry), lines: quotedLines(r.body) }))
    .filter((d) => d.lines.length > 0)
    .slice(0, CAPS.dialogue);

  /* E — titles of blank-bodied entries. A photo-first recorder's whole corpus. */
  const titlesOnly = withBucket
    .filter((r) => r.bucket === 'captionOnly')
    .slice(0, CAPS.titlesOnly)
    .map((r) => {
      const place = r.entry.destination.trim();
      const photos = r.entry.photoCount;
      return `${titleFor(r.entry).slice(0, 40)}${place ? ` · ${place}` : ''}${photos ? ` · ${photos}📷` : ''}`;
    });

  // Longest first, not earliest: a trip's most telling piece of trouble is
  // rarely the one that happened first, and slicing by date was handing the
  // model whichever mishap came early in the itinerary.
  const frictionRefs = withBucket
    .filter((r) => isFriction(r.body))
    .sort((a, b) => b.body.length - a.body.length)
    .slice(0, 6)
    .map((r) => ref(r.entry));

  const pack = trimToBudget(
    { longform, notes, fragments, dialogue, titlesOnly, allTitles, frictionRefs },
    evidenceBudget(rows.length),
  );

  return { pack, refMap, chars: JSON.stringify(pack).length };
}

/* ── Compression ──────────────────────────────────────────────────────────── */

/**
 * A long entry reduced to its reasoning skeleton: opening paragraph, any
 * internal headings or numbered points, and the closing paragraph.
 *
 * What gets dropped is the elaboration in between, which is where a long entry
 * spends most of its characters and least of its information about the writer.
 * What survives is the part the portrait reads — what they noticed, how they
 * structured it, and where they landed.
 */
function skeleton(body: string, max = 700): string {
  if (body.length <= max) return body;

  const paras = body.split(/\n{1,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length <= 2) return `${body.slice(0, max - 40)}…\n${lastSentence(body)}`;

  const head = paras[0];
  const tail = paras[paras.length - 1];
  // Structural middles only: headings, numbered points, short declarative lines.
  const spine = paras
    .slice(1, -1)
    .filter((p) => /^(?:[0-9１-９]+[.、）)]|[-*•]|#{1,3}\s)/.test(p) || p.length <= 70)
    .slice(0, 5);

  const parts = [head, ...spine, tail];
  let out = parts.join('\n');
  if (out.length > max) {
    out = `${head.slice(0, Math.floor(max * 0.45))}…\n${spine.slice(0, 3).join('\n')}\n${tail.slice(0, Math.floor(max * 0.35))}`;
  }
  return out;
}

/** Quoted speech, deduped and capped. */
function quotedLines(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/[“"「『]([^”"」』\n]{2,60})[”"」』]/g)) {
    const line = m[1].trim();
    if (line && !out.includes(line)) out.push(line);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Take `limit` items, preferring one per distinct key before allowing seconds.
 * Keeps the longform layer from becoming six essays about the same city.
 */
function pickSpread<T>(
  items: T[],
  limit: number,
  keyOf: (item: T) => string,
  compare: (a: T, b: T) => number,
): T[] {
  const sorted = [...items].sort(compare);
  const picked: T[] = [];
  const usedKeys = new Set<string>();

  for (const item of sorted) {
    if (picked.length >= limit) break;
    const key = keyOf(item);
    if (key && usedKeys.has(key)) continue;
    picked.push(item);
    if (key) usedKeys.add(key);
  }
  for (const item of sorted) {
    if (picked.length >= limit) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked;
}

/**
 * Shrink the pack until it fits. Sacrifice order is F → E → C → B → A: drop
 * the cheap global map first, keep the long-form reasoning longest, because
 * that layer is the only one that shows how the person thinks.
 */
function trimToBudget(pack: EvidencePack, budget: number): EvidencePack {
  const size = () => JSON.stringify(pack).length;
  if (size() <= budget) return pack;

  const shrink: Array<() => boolean> = [
    () => cut(pack.allTitles, 40),
    () => cut(pack.titlesOnly, 8),
    () => cut(pack.fragments, 8),
    () => cut(pack.notes, 10),
    () => cut(pack.dialogue, 5),
    () => cut(pack.allTitles, 0),
    () => cut(pack.notes, 5),
    () => cut(pack.longform, 3),
  ];

  for (const step of shrink) {
    if (size() <= budget) break;
    step();
  }
  return pack;
}

function cut(list: unknown[], keep: number): boolean {
  if (list.length <= keep) return false;
  list.length = keep;
  return true;
}
