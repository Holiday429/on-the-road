/* ==========================================================================
   On the Road · Recap L3 — portrait assembly (server side)
   --------------------------------------------------------------------------
   Everything between "entries in" and "document out" except the model call
   itself: signals → compact prompt payload → parse/validate the model reply →
   privacy gate → a RecapDraft the client writes to Firestore verbatim.

   Lives on the server so web and iOS share ONE implementation. Clients send
   raw entries and receive a finished document; neither re-derives anything,
   which is what keeps two platforms from producing two different portraits
   (or two different redaction decisions) from the same journal.

   Mirrors the field shapes of TravelerRecapSchema in
   src/data/schema/journal.ts — keep the two in step (api/ never imports src/).
   ========================================================================== */

import { buildEvidence } from './evidence';
import { CJK_LIMITS, type Limits } from './limits';
import { normalizeEmphasis } from './emphasis';
import { applyPrivacyGate, type RecapChapter } from './redact';
import { computeSignals, MIN_ENTRIES_FOR_PORTRAIT, type RecapEntry, type RecapSignals } from './signals';

/** Bump when the prompt or schema changes, so stored portraits can be told apart. */
export const PROMPT_VERSION = 1;

export const RECAP_CHAPTER_IDS = [
  'attention', 'method', 'relations', 'friction', 'recording', 'throughline',
] as const;
type ChapterId = typeof RECAP_CHAPTER_IDS[number];

export interface RecapTrait { key: string; score: number; note: string }
/** `caption` is kept for older documents and clients; it is always empty now. */
export interface RecapNumber { label: string; value: string; caption: string }

export interface RecapDraft {
  tripId: string | null;
  sourceHash: string;
  entryCount: number;
  signals: Record<string, unknown>;
  archetype: { label: string; tagline: string };
  traits: RecapTrait[];
  numbers: RecapNumber[];
  chapters: RecapChapter[];
  oneLine: string;
  /** Up to three questions for the next trip, each from a different angle. */
  questions: string[];
  refMap: Record<string, string>;
  source: 'signals' | 'ai';
  visibility: 'private';
  slug: '';
  generatedAt: number;
}

export interface RecapResult {
  draft: RecapDraft;
  /** Per-chapter redaction reasons, so the share preview can say why one is held back. */
  privacyReport: Record<string, string[]>;
}

/* ── Prepared input ───────────────────────────────────────────────────────── */

export interface PreparedRecap {
  signals: RecapSignals;
  compact: ReturnType<typeof compactSignals>;
  /** The overview figures, so the model can write a label that fits each one. */
  tiles: NumberTile[];
  evidence: ReturnType<typeof buildEvidence>['pack'];
  refMap: Record<string, string>;
  hash: string;
  /** Plain bodies, for seeding the gate's name list. */
  bodies: string[];
}

export function prepare(entries: RecapEntry[]): PreparedRecap {
  const signals = computeSignals(entries);
  const { pack, refMap } = buildEvidence(entries);
  return {
    signals,
    compact: compactSignals(signals),
    tiles: deriveNumbers(signals),
    evidence: pack,
    refMap,
    hash: sourceHash(signals, refMap),
    bodies: entries.map((e) => e.body).filter(Boolean),
  };
}

/** Whether the journal is big enough for a model-written portrait. */
export function isPortraitReady(entryCount: number): boolean {
  return entryCount >= MIN_ENTRIES_FOR_PORTRAIT;
}

/* ── Signals-only card ────────────────────────────────────────────────────── */

/**
 * The honest floor: stat tiles and nothing else. Makes no claim about who the
 * person is — a heuristic archetype from a regex is worse than none, because
 * the value of this feature is the reader believing the read.
 */
export function buildSignalsOnly(prep: PreparedRecap, tripId: string | null): RecapResult {
  return {
    draft: {
      tripId,
      sourceHash: prep.hash,
      entryCount: prep.signals.entryCount,
      signals: prep.signals as unknown as Record<string, unknown>,
      archetype: { label: '', tagline: '' },
      traits: [],
      numbers: prep.tiles.map(stripTopic),
      chapters: [],
      oneLine: '',
      questions: [],
      refMap: prep.refMap,
      source: 'signals',
      visibility: 'private',
      slug: '',
      generatedAt: Date.now(),
    },
    privacyReport: {},
  };
}

/** A stat tile plus the topic the model is told it is about. `topic` is not stored. */
export interface NumberTile { topic: string; label: string; value: string }

const stripTopic = ({ label, value }: NumberTile): RecapNumber => ({ label, value, caption: '' });

/** 22044 → "22,044". Locale-free on purpose: the same string on every device. */
function fmt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The overview figures, up to six, in priority order. Values come from the
 * writing itself; the model supplies only a label for each, never the figure.
 * There is no caption: six figures in two rows leave no room for one, and a
 * number with its label is cleaner than a number with a sentence under it.
 *
 * Deliberately absent: anything about tags, moods or which fields were filled
 * in — those measure the app's prompts, not the traveller — and "entries with
 * no text", which reads as an accusation rather than a fact about the person.
 */
export function deriveNumbers(s: RecapSignals): NumberTile[] {
  const candidates: Array<NumberTile | null> = [
    s.tripSpanDays > 1 ? {
      topic: 'days with at least one note, out of the trip length',
      label: 'Recording days', value: `${s.activeDays} / ${s.tripSpanDays}`,
    } : null,
    s.placeCount > 0 ? {
      topic: 'distinct places or cities written about',
      label: 'Places', value: String(s.placeCount),
    } : null,
    s.totalChars > 0 ? {
      topic: 'total characters written across all notes',
      label: 'Words written', value: fmt(s.totalChars),
    } : null,
    s.photoTotal > 0 ? {
      topic: 'photos attached across all notes',
      label: 'Photos', value: fmt(s.photoTotal),
    } : null,
    s.lengthRange[1] > 0 ? {
      topic: 'length in characters of the single longest note',
      label: 'Longest note', value: fmt(s.lengthRange[1]),
    } : null,
    s.dialogueRatio >= 0.05 ? {
      topic: 'share of notes that quote someone else speaking',
      label: 'Notes with voices', value: `${Math.round(s.dialogueRatio * 100)}%`,
    } : null,
    s.burstDays >= 3 ? {
      topic: 'days that carry two or more separate notes',
      label: 'Multi-note days', value: String(s.burstDays),
    } : null,
    s.entryCount > 0 && s.totalChars > 0 ? {
      topic: 'average characters per note',
      label: 'Average note', value: fmt(s.totalChars / s.entryCount),
    } : null,
  ];

  const tiles = candidates.filter((t): t is NumberTile => t !== null).slice(0, 6);
  if (!tiles.length) tiles.push({ topic: 'number of notes', label: 'Notes', value: String(s.entryCount) });
  return tiles;
}

/* ── Prompt payload ───────────────────────────────────────────────────────── */

/**
 * Signals, minus everything the model can't use. Raw ratios become the words
 * the model would otherwise have to infer (`tagDecay: 0.31` → "lapsed"),
 * because a model handed a number tends to recite it, and the chapters are
 * meant to contain the judgement, not the statistic (that's on a card already).
 */
export function compactSignals(s: RecapSignals) {
  return {
    notes: s.entryCount,
    spanDays: s.tripSpanDays,
    activeDays: s.activeDays,
    cadence: describe(s.cadence, [[0.75, 'near-daily'], [0.4, 'frequent'], [0.15, 'intermittent']], 'sparse'),
    multiNoteDays: s.burstDays,
    longestSilence: s.longestSilence,
    silenceFellIn: s.silencePosition,
    genreMix: s.lengthBuckets,
    shortestNote: s.lengthRange[0],
    longestNote: s.lengthRange[1],
    genreSpread: describe(s.styleSpread, [[0.7, 'very wide'], [0.45, 'wide'], [0.2, 'narrow']], 'single-genre'),
    places: s.placeCount,
    mostNotesFrom: s.densestPlace,
    longestNotesFrom: s.deepestPlace,
    // Only worth remarking on when they differ; the flag saves the model from
    // comparing two strings and getting it wrong.
    writesLongerAboutDifferentPlaceThanMostOften: s.depthDensityMismatch,
    photosPerNote: s.photosPerEntry,
    wordlessNotes: s.lengthBuckets.captionOnly,
    dialogueShare: describe(s.dialogueRatio, [[0.3, 'often quotes people'], [0.1, 'sometimes quotes people']], 'rarely quotes'),
    weVsI: describe(s.firstPersonPluralRatio, [[0.5, 'mostly we'], [0.2, 'mixed we/I']], 'mostly I'),
    recurringPeople: s.namedPeopleCount,
    structuredLists: s.listicleCount,
    endingsLeftOpen: describe(s.openEndedEndingRatio, [[0.4, 'usually'], [0.15, 'sometimes']], 'rarely'),
  };
}

function describe(value: number, bands: Array<[number, string]>, fallback: string): string {
  for (const [floor, label] of bands) if (value >= floor) return label;
  return fallback;
}

/* ── Model reply → draft ──────────────────────────────────────────────────── */

/**
 * Validate and assemble the model's JSON. Returns null when it isn't a usable
 * portrait (fewer than three chapters), so the caller can fail loudly rather
 * than store a stub over a good existing one.
 */
export function assemble(raw: unknown, prep: PreparedRecap, tripId: string | null, limits: Limits = CJK_LIMITS): RecapResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, any>;

  const chapters = parseChapters(data.chapters, new Set(Object.keys(prep.refMap)), limits);
  if (chapters.length < 3) return null;

  const gated = applyPrivacyGate(chapters, prep.bodies, limits.pubMax);

  return {
    draft: {
      tripId,
      sourceHash: prep.hash,
      entryCount: prep.signals.entryCount,
      signals: prep.signals as unknown as Record<string, unknown>,
      archetype: {
        label: str(data.archetype?.label, limits.label),
        tagline: str(data.archetype?.tagline, limits.tagline),
      },
      traits: parseTraits(data.traits, limits),
      numbers: mergeNumberCopy(prep.tiles, data.numbers, limits),
      chapters: gated.chapters,
      oneLine: str(data.oneLine, limits.oneLine),
      questions: parseQuestions(data.questions, limits),
      refMap: prep.refMap,
      source: 'ai',
      visibility: 'private',
      slug: '',
      generatedAt: Date.now(),
    },
    privacyReport: gated.report,
  };
}

function parseChapters(raw: unknown, validRefs: Set<string>, limits: Limits): RecapChapter[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<ChapterId>();
  const out: RecapChapter[] = [];

  for (const item of raw) {
    const id = item?.id as ChapterId;
    if (!RECAP_CHAPTER_IDS.includes(id) || seen.has(id)) continue;
    // A little slack on the private reading: the model counts characters loosely
    // and a cut mid-sentence reads worse than a few extra words.
    const body = str(item?.body, limits.bodyMax + 80);
    if (!body) continue;
    seen.add(id);
    out.push({
      id,
      heading: str(item?.heading, limits.heading),
      body: normalizeEmphasis(body),
      // The gate trims or rejects; the +40 leaves room for the marker's four
      // asterisks and a model that counts loosely.
      bodyPublic: normalizeEmphasis(str(item?.bodyPublic, limits.pubMax + 40)),
      evidenceRefs: Array.isArray(item?.evidenceRefs)
        ? item.evidenceRefs.filter((r: unknown) => typeof r === 'string' && validRefs.has(r)).slice(0, 4)
        : [],
      shareable: false, // never trusted from the model; applyPrivacyGate decides
      flags: [],
    });
  }
  return out.sort((a, b) => RECAP_CHAPTER_IDS.indexOf(a.id as ChapterId) - RECAP_CHAPTER_IDS.indexOf(b.id as ChapterId));
}

/**
 * Exactly four traits — the radar chart has four axes. Keys are capped by
 * script, because the same slot holds six CJK glyphs or twelve Latin letters:
 * a flat character limit would either truncate English mid-word or let Chinese
 * overflow the axis label.
 */
function parseTraits(raw: unknown, limits: Limits): RecapTrait[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t === 'object' && typeof t.key === 'string' && t.key.trim())
    .slice(0, 4)
    .map((t) => ({
      key: str(t.key, hasCjk(t.key) ? CJK_LIMITS.traitKey : limits.traitKey),
      score: Math.min(100, Math.max(0, Number(t.score) || 50)),
      note: str(t.note, limits.traitNote),
    }));
}

function hasCjk(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(text);
}

/** Up to three questions for the next trip; blanks and non-strings dropped. */
function parseQuestions(raw: unknown, limits: Limits): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((q) => str(q, limits.question)).filter(Boolean).slice(0, 3);
}

/** Keep our values, take the model's words. Values never come from the model. */
function mergeNumberCopy(tiles: NumberTile[], raw: unknown, limits: Limits): RecapNumber[] {
  const copy = Array.isArray(raw) ? raw : [];
  return tiles.map((tile, i) => ({
    value: tile.value,
    label: str(copy[i]?.label, limits.numLabel) || tile.label,
    caption: '',
  }));
}

function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  // In spaced scripts, back off to the last word boundary rather than ending
  // mid-word — unless that would throw away more than a third of the text.
  if (!hasCjk(cut) && trimmed[max] !== ' ') {
    const space = cut.lastIndexOf(' ');
    if (space > max * 0.66) return cut.slice(0, space).trim();
  }
  return cut.trim();
}

/* ── Fingerprint ──────────────────────────────────────────────────────────── */

/**
 * A stable fingerprint of the generation input, stored on the document so a
 * later change in the journal is detectable and a stored portrait can be traced
 * to the prompt version that made it. Clients do NOT recompute it — staleness
 * on the client is judged from entry count and update times, which are the same
 * on every platform.
 */
export function sourceHash(signals: RecapSignals, refMap: Record<string, string>): string {
  const material = JSON.stringify({
    v: PROMPT_VERSION,
    n: signals.entryCount,
    b: signals.lengthBuckets,
    c: signals.totalChars,
    d: [signals.firstDate, signals.lastDate],
    a: signals.activeDays,
    p: signals.placeCount,
    ph: signals.photoTotal,
    ids: Object.values(refMap),
  });
  return fnv1a(material);
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
