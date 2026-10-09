/* ==========================================================================
   On the Road · Recap privacy gate
   --------------------------------------------------------------------------
   The model is asked to write a public-safe `bodyPublic` for each chapter. This
   file assumes it sometimes won't.

   A chapter becomes shareable only if its bodyPublic survives every check here.
   Allow-list, not block-list: anything we can't clear stays private, including
   an empty bodyPublic, a model that ignored the instruction, and a schema we
   failed to parse. The cost of a false negative is a chapter the owner can
   still read; the cost of a false positive is someone's private life on a
   share card.

   What counts as unsafe is narrower than "sensitive": the chapter is SUPPOSED
   to say "they handle conflict by separating the problem from the person". It
   must not say which conflict, with whom, where, or what it cost.
   ========================================================================== */

import { normalizeEmphasis, stripEmphasis } from './emphasis';
import { extractNameCandidates } from './signals';

/** Server-side chapter shape; mirrors RecapChapterSchema in src/data/schema/journal.ts. */
export interface RecapChapter {
  id: string;
  heading: string;
  body: string;
  bodyPublic: string;
  evidenceRefs: string[];
  /** True when the public text passed every automatic check. Advisory — see `flags`. */
  shareable: boolean;
  /**
   * Why the public text did not pass: person-name, quoted-speech, money,
   * relationship-label, health, address, vendor, empty, too-short. The owner
   * decides what to share; these let them decide with the reason in front of them.
   */
  flags: string[];
}

export interface RedactionVerdict {
  ok: boolean;
  /** Machine-readable reasons, surfaced in the share preview so the owner can see why. */
  reasons: string[];
}

/* ── Patterns ─────────────────────────────────────────────────────────────── */

/** Quoted speech. A public chapter states the method; it never re-airs the words. */
const QUOTED_RE = /[“"「『][^”"」』\n]{2,}[”"」』]/;

/** Money, in any of the formats the journals actually use. */
const MONEY_RE = /(\d[\d,.]*\s*(?:元|块|塊|欧|歐|欧元|美元|刀|USD|EUR|DKK|CHF|GBP|RMB|CNY|JPY|KRW)|[$€£¥₩]\s*\d|\d+\s*(?:dollars?|euros?|yuan|pounds?))/i;

/**
 * Relationship labels. These are the single highest-risk tokens: "partner" or
 * "ex-husband" turns an abstract observation back into a disclosure about a
 * specific identifiable person who never agreed to be written about.
 */
const RELATION_RE = /(男友|女友|男朋友|女朋友|老公|老婆|丈夫|妻子|伴侣|伴侶|前夫|前妻|前任|对象|對象|未婚夫|未婚妻|爱人|愛人|情人|boyfriend|girlfriend|husband|wife|partner|spouse|fiancé|fiancée|ex-(?:husband|wife|boyfriend|girlfriend)|my ex)/i;

/** Health and body specifics. */
const HEALTH_RE = /(生病|发烧|發燒|感冒|受伤|受傷|过敏|過敏|中暑|腹泻|腹瀉|呕吐|嘔吐|失眠|抑郁|焦虑|焦慮|住院|吃药|吃藥|医院|醫院|急诊|急診|sick|fever|injur|allerg|vomit|insomnia|depress|anxiet|hospital|medication)/i;

/** Lodging / address specifics. A street or a flat number re-identifies a home. */
const ADDRESS_RE = /(门牌|門牌|房号|房號|几楼|幾樓|\d+\s*(?:号|號|室|楼|樓|F\b)|street|strasse|straße|avenue|(?:door|house|flat|apartment|room|street)\s*number|room\s*\d|flat\s*\d|apt\.?\s*\d|no\.\s*\d)/i;

/** Platform/host specifics that pin down one real listing or business. */
const VENDOR_RE = /(airbnb|booking\.com|agoda|hostelworld|房东|房東|host\b)/i;

/* ── Length ───────────────────────────────────────────────────────────────── */
// The ceiling is a layout constraint, not an editorial one. A share card is 3:4
// at 1080×1440; with the heading and footer taken out, body text at the 3.5% of
// width floor (~38px) holds roughly 190 CJK glyphs. 150 leaves the breathing
// room a share image needs and keeps the public text a distillation rather than
// a second copy of the private one. The floor exists because a two-word
// bodyPublic means the model gave up and the owner would be sharing a stub.

export const PUBLIC_BODY_MAX = 150;
export const PUBLIC_BODY_MIN = 24;

/* ── Main ─────────────────────────────────────────────────────────────────── */

/**
 * Judge one chapter's public text.
 *
 * `nameTokens` comes from the entries themselves (see extractNameCandidates),
 * which is what makes this better than a generic PII regex: it knows the actual
 * names this traveller writes about, so it catches "T. kept saying" even though
 * no fixed pattern would.
 */
export function judgePublicBody(text: string, nameTokens: Iterable<string>, max = PUBLIC_BODY_MAX): RedactionVerdict {
  // Measure and inspect the plain text: the emphasis marker is presentation.
  const body = stripEmphasis(text).trim();
  const reasons: string[] = [];

  if (!body) return { ok: false, reasons: ['empty'] };
  if (body.length < PUBLIC_BODY_MIN) reasons.push('too-short');
  if (body.length > max) reasons.push('too-long');
  if (QUOTED_RE.test(body)) reasons.push('quoted-speech');
  if (MONEY_RE.test(body)) reasons.push('money');
  if (RELATION_RE.test(body)) reasons.push('relationship-label');
  if (HEALTH_RE.test(body)) reasons.push('health');
  if (ADDRESS_RE.test(body)) reasons.push('address');
  if (VENDOR_RE.test(body)) reasons.push('vendor');

  for (const name of nameTokens) {
    // Word-boundary match so a name doesn't fire on a substring of a real word.
    if (new RegExp(`\\b${escapeRe(name)}\\b`).test(body)) {
      reasons.push('person-name');
      break;
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Apply the checks across a whole portrait, overwriting whatever `shareable` the
 * model claimed. The result is ADVICE: the owner chooses what to share, and a
 * flagged chapter reaches them with its reasons attached rather than being
 * withheld on their behalf.
 */
export function applyPrivacyGate(
  chapters: RecapChapter[],
  entryBodies: string[],
  maxPublic = PUBLIC_BODY_MAX,
): { chapters: RecapChapter[]; report: Record<string, string[]> } {
  const names = [...extractNameCandidates(entryBodies).entries()]
    .filter(([, count]) => count >= 2)
    .map(([token]) => token);

  const report: Record<string, string[]> = {};
  const gated = chapters.map((chapter) => {
    const verdict = judgePublicBody(chapter.bodyPublic, names, maxPublic);
    report[chapter.id] = verdict.reasons;
    // `too-long` is the one failure we can fix rather than flag: trimming at a
    // sentence boundary loses a clause, not the judgement. Everything else is a
    // disclosure that can't be trimmed out safely, so it is flagged for the owner.
    if (!verdict.ok && verdict.reasons.length === 1 && verdict.reasons[0] === 'too-long') {
      const trimmed = normalizeEmphasis(trimToSentence(chapter.bodyPublic, maxPublic));
      const recheck = judgePublicBody(trimmed, names, maxPublic);
      if (recheck.ok) {
        report[chapter.id] = ['trimmed'];
        return { ...chapter, bodyPublic: trimmed, shareable: true, flags: [] };
      }
    }
    return { ...chapter, shareable: verdict.ok, flags: verdict.reasons };
  });

  return { chapters: gated, report };
}

/** Cut at the last sentence end within `max`, falling back to a hard cut. */
function trimToSentence(text: string, max: number): string {
  const body = text.trim();
  if (body.length <= max) return body;
  const window = body.slice(0, max);
  const lastStop = Math.max(
    window.lastIndexOf('。'), window.lastIndexOf('.'),
    window.lastIndexOf('！'), window.lastIndexOf('!'),
    window.lastIndexOf('？'), window.lastIndexOf('?'),
  );
  if (lastStop > max * 0.5) return window.slice(0, lastStop + 1);
  return `${window.trim()}…`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
