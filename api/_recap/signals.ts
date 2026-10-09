/* ==========================================================================
   On the Road · Recap L1 — behavioural signals
   --------------------------------------------------------------------------
   Pure, zero-token. Turns a trip's entries into a ~1.5KB fingerprint of HOW the
   person writes, not what they wrote about.

   Half of a traveller portrait lives in behaviour rather than prose: how often
   they wrote, how far apart the shortest and longest notes are, whether the
   place they wrote about most is also the place they wrote about longest,
   whether they write on the day or after leaving. None of that needs a model,
   and the model would be worse at counting it than this file is.

   Two consequences worth stating, because they shape every function below:
   · A blank body is DATA, not a gap. Some people are photo-first; `captionOnly`
     is a positive signal and must never be filtered out as noise.
   · Nothing here reads `template`, tags, mood or favourites. Those are inferred
     or filled in by habit, so weighting them would make the portrait react to
     the app's own prompts rather than to the person.
   ========================================================================== */

/**
 * The minimal entry shape the portrait pipeline reads. Clients send exactly
 * this (never photo URLs — only how many), so the server never sees more of a
 * journal than the portrait needs, and iOS/web build the same payload.
 *
 * Tags, mood and favourites are deliberately absent. They are filled in or
 * skipped for reasons that say nothing about the person (forgetting, a busy
 * day, a UI that stopped asking), so a portrait built on them would be a
 * portrait of the app's prompts. Everything here is the writing itself, when it
 * was written, where, and how many photos went with it.
 */
export interface RecapEntry {
  id: string;
  happenedOn: string;   // YYYY-MM-DD
  title: string;
  body: string;
  destination: string;
  photoCount: number;
}

/** Minimum entries before an AI portrait is allowed; below this, numbers only. */
export const MIN_ENTRIES_FOR_PORTRAIT = 8;

/* ── Length buckets ───────────────────────────────────────────────────────── */
// Boundaries are chosen to separate GENRES, not to make an even spread. A note
// under ~60 chars is a line (a sentence, a caption, an overheard joke); past
// ~800 it's an essay with internal structure. Those are different kinds of
// writing by the same person, and the portrait's job is to notice that.

export const LENGTH_BUCKETS = {
  fragment: 60,
  note: 250,
  essay: 800,
} as const;

export type LengthBucket = 'captionOnly' | 'fragment' | 'note' | 'essay' | 'longform';

export function bucketOf(chars: number): LengthBucket {
  if (chars === 0) return 'captionOnly';
  if (chars < LENGTH_BUCKETS.fragment) return 'fragment';
  if (chars < LENGTH_BUCKETS.note) return 'note';
  if (chars < LENGTH_BUCKETS.essay) return 'essay';
  return 'longform';
}

/* ── Shape ────────────────────────────────────────────────────────────────── */

export interface PlaceProfile {
  place: string;
  n: number;
  avgChars: number;
  photos: number;
}

export interface RecapSignals {
  // Scale & rhythm
  entryCount: number;
  tripSpanDays: number;
  activeDays: number;
  cadence: number;              // activeDays / tripSpanDays, 0-1
  burstDays: number;            // days carrying ≥2 entries
  maxBurst: number;
  longestSilence: number;       // longest run of recorded-nothing days
  silencePosition: 'early' | 'mid' | 'late' | 'none';
  firstDate: string;
  lastDate: string;

  // Genre spread
  lengthBuckets: Record<LengthBucket, number>;
  lengthRange: [number, number];   // shortest/longest non-empty body
  totalChars: number;
  styleSpread: number;             // normalised entropy of the buckets, 0-1

  // Space
  placeCount: number;
  placeProfile: PlaceProfile[];    // top 8 by entry count
  densestPlace: string;            // most entries
  deepestPlace: string;            // highest average length (min 2 entries)
  depthDensityMismatch: boolean;   // ← a strong personality tell; see below

  // Medium
  photoTotal: number;
  photosPerEntry: number;
  textOnlyRatio: number;
  photoOnlyRatio: number;
  maxPhotoEntries: number;         // entries using the full 9-photo grid

  // Language & voice (regex-level, no model)
  dialogueRatio: number;
  firstPersonPluralRatio: number;
  questionRatio: number;
  namedPeopleCount: number;
  listicleCount: number;
  openEndedEndingRatio: number;
}

/* ── Language probes ──────────────────────────────────────────────────────── */
// Deliberately shallow. These exist to spot a HABIT across dozens of entries,
// where a few misses per side wash out, not to parse any single sentence. CJK
// and Latin punctuation are both matched because entries are routinely mixed.

const QUOTE_RE = /["'“”「」『』]/;
const DIALOGUE_RE = /[“"「『][^”"」』]{2,}[”"」』]/;
const QUESTION_RE = /[?？]/;
const WE_RE = /(我们|我們|\bwe\b|\bus\b|\bour\b)/i;
const I_RE = /(我|\bI\b|\bmy\b|\bme\b)/i;
/** Numbered or bulleted lines, and markdown-ish headings. */
const LISTICLE_RE = /(^|\n)\s*(?:[0-9１-９]+[.、）)]|[-*•]|#{1,3}\s)/;
/** An ending that declines to close: "maybe", "next time", "we'll see". */
const OPEN_ENDED_RE = /(或许|也许|或許|說不定|说不定|下一次|下次|再来|再來|期待|等.{0,4}再|不知道|谁知道|誰知道|吧[。！!]?$|maybe|perhaps|next time|we'?ll see|who knows|someday)/i;

/* ── Main ─────────────────────────────────────────────────────────────────── */

export function computeSignals(entries: RecapEntry[]): RecapSignals {
  const rows = [...entries].sort((a, b) => a.happenedOn.localeCompare(b.happenedOn));
  if (!rows.length) return emptySignals();

  const bodies = rows.map((e) => e.body.trim());
  const lengths = bodies.map((b) => b.length);
  const nonEmpty = lengths.filter((n) => n > 0);

  /* Rhythm ------------------------------------------------------------------ */
  const dates = rows.map((e) => e.happenedOn);
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const perDay = new Map<string, number>();
  for (const d of dates) perDay.set(d, (perDay.get(d) ?? 0) + 1);

  const activeDays = perDay.size;
  const tripSpanDays = daysBetween(firstDate, lastDate) + 1;
  const burstCounts = [...perDay.values()];
  const { longest: longestSilence, position: silencePosition } = silenceRun(
    [...perDay.keys()].sort(), firstDate, lastDate,
  );

  /* Genre ------------------------------------------------------------------- */
  const lengthBuckets: Record<LengthBucket, number> = {
    captionOnly: 0, fragment: 0, note: 0, essay: 0, longform: 0,
  };
  for (const n of lengths) lengthBuckets[bucketOf(n)] += 1;

  /* Space ------------------------------------------------------------------- */
  const places = new Map<string, { n: number; chars: number; photos: number }>();
  rows.forEach((entry, i) => {
    const place = entry.destination.trim();
    if (!place) return;
    const acc = places.get(place) ?? { n: 0, chars: 0, photos: 0 };
    acc.n += 1;
    acc.chars += lengths[i];
    acc.photos += entry.photoCount;
    places.set(place, acc);
  });

  const placeProfile: PlaceProfile[] = [...places.entries()]
    .map(([place, v]) => ({ place, n: v.n, avgChars: Math.round(v.chars / v.n), photos: v.photos }))
    .sort((a, b) => b.n - a.n || b.avgChars - a.avgChars);

  const densestPlace = placeProfile[0]?.place ?? '';
  // Require ≥2 entries before a place can be "deepest": one 1900-char essay
  // written in a city visited once says more about that day than about a place.
  const deepestPlace = [...placeProfile]
    .filter((p) => p.n >= 2)
    .sort((a, b) => b.avgChars - a.avgChars)[0]?.place ?? densestPlace;

  /* Medium ------------------------------------------------------------------ */
  const photoCounts = rows.map((e) => e.photoCount);
  const photoTotal = photoCounts.reduce((a, b) => a + b, 0);

  /* Voice ------------------------------------------------------------------- */
  const withBody = bodies.filter(Boolean);
  const dialogue = withBody.filter((b) => DIALOGUE_RE.test(b)).length;
  const plural = withBody.filter((b) => WE_RE.test(b)).length;
  const singular = withBody.filter((b) => I_RE.test(b) && !WE_RE.test(b)).length;
  const questions = withBody.filter((b) => QUESTION_RE.test(b)).length;
  const listicles = withBody.filter((b) => LISTICLE_RE.test(b)).length;
  const openEnded = withBody.filter((b) => OPEN_ENDED_RE.test(lastSentence(b))).length;

  const ratio = (n: number) => (withBody.length ? round2(n / withBody.length) : 0);

  return {
    entryCount: rows.length,
    tripSpanDays,
    activeDays,
    cadence: round2(activeDays / Math.max(tripSpanDays, 1)),
    burstDays: burstCounts.filter((n) => n >= 2).length,
    maxBurst: Math.max(...burstCounts),
    longestSilence,
    silencePosition,
    firstDate,
    lastDate,

    lengthBuckets,
    lengthRange: nonEmpty.length ? [Math.min(...nonEmpty), Math.max(...nonEmpty)] : [0, 0],
    totalChars: lengths.reduce((a, b) => a + b, 0),
    styleSpread: entropy(Object.values(lengthBuckets)),

    placeCount: places.size,
    placeProfile: placeProfile.slice(0, 8),
    densestPlace,
    deepestPlace,
    depthDensityMismatch: Boolean(densestPlace && deepestPlace && densestPlace !== deepestPlace),

    photoTotal,
    photosPerEntry: round2(photoTotal / rows.length),
    textOnlyRatio: round2(rows.filter((_, i) => photoCounts[i] === 0 && lengths[i] > 0).length / rows.length),
    photoOnlyRatio: round2(rows.filter((_, i) => photoCounts[i] > 0 && lengths[i] === 0).length / rows.length),
    maxPhotoEntries: photoCounts.filter((n) => n >= 9).length,

    dialogueRatio: ratio(dialogue),
    firstPersonPluralRatio: plural + singular ? round2(plural / (plural + singular)) : 0,
    questionRatio: ratio(questions),
    namedPeopleCount: countNamedPeople(withBody),
    listicleCount: listicles,
    openEndedEndingRatio: ratio(openEnded),
  };
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function emptySignals(): RecapSignals {
  return {
    entryCount: 0, tripSpanDays: 0, activeDays: 0, cadence: 0, burstDays: 0,
    maxBurst: 0, longestSilence: 0, silencePosition: 'none', firstDate: '', lastDate: '',
    lengthBuckets: { captionOnly: 0, fragment: 0, note: 0, essay: 0, longform: 0 },
    lengthRange: [0, 0], totalChars: 0, styleSpread: 0,
    placeCount: 0, placeProfile: [], densestPlace: '', deepestPlace: '',
    depthDensityMismatch: false,
    photoTotal: 0, photosPerEntry: 0, textOnlyRatio: 0, photoOnlyRatio: 0, maxPhotoEntries: 0,
    dialogueRatio: 0, firstPersonPluralRatio: 0, questionRatio: 0, namedPeopleCount: 0,
    listicleCount: 0, openEndedEndingRatio: 0,
  };
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : 0;
}

/**
 * The longest stretch of consecutive unrecorded days, and where it falls in the
 * trip. Position matters more than length: a gap early reads as warming up, in
 * the middle as busy or weary, at the end as a trip that outlasted the impulse
 * to write about it. Three different people.
 */
function silenceRun(activeDates: string[], first: string, last: string) {
  let longest = 0;
  let gapStartOffset = 0;
  for (let i = 1; i < activeDates.length; i += 1) {
    const gap = daysBetween(activeDates[i - 1], activeDates[i]) - 1;
    if (gap > longest) {
      longest = gap;
      gapStartOffset = daysBetween(first, activeDates[i - 1]);
    }
  }
  const span = daysBetween(first, last) + 1;
  if (longest < 3 || span <= 1) return { longest, position: 'none' as const };
  const frac = gapStartOffset / span;
  return {
    longest,
    position: frac < 0.33 ? ('early' as const) : frac < 0.66 ? ('mid' as const) : ('late' as const),
  };
}

/** Shannon entropy of a distribution, normalised to 0-1 across its own bins. */
function entropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  const bins = counts.filter((n) => n > 0);
  if (total === 0 || bins.length <= 1) return 0;
  const h = -bins.reduce((acc, n) => {
    const p = n / total;
    return acc + p * Math.log2(p);
  }, 0);
  return round2(h / Math.log2(counts.length));
}

/**
 * How many distinct people recur across the entries.
 *
 * Capitalised Latin tokens appearing in ≥2 entries, which catches the
 * travelling-companion case this feeds (`relations`) while staying cheap. It
 * under-counts CJK names badly — there's no capitalisation to key off — so the
 * portrait treats a 0 here as "unknown", never as "travelled alone". That
 * reading is left to firstPersonPluralRatio, which is script-independent.
 *
 * Also the seed for the redaction scan: these names must never survive into a
 * bodyPublic. See redact.ts.
 */
const NAME_RE = /\b([A-Z][a-z]{2,11})\b/g;
const NAME_STOPWORDS = new Set([
  'The', 'This', 'That', 'There', 'Then', 'They', 'Their', 'These', 'Those',
  'And', 'But', 'For', 'Not', 'Now', 'When', 'What', 'Where', 'Which', 'While',
  'With', 'You', 'Your', 'Our', 'His', 'Her', 'Its', 'All', 'One', 'Two',
  'Airbnb', 'Google', 'Uber', 'Wifi', 'Euro', 'Euros', 'App', 'Apps',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
]);

export function extractNameCandidates(bodies: string[]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const body of bodies) {
    const inThisEntry = new Set<string>();
    for (const match of body.matchAll(NAME_RE)) {
      const token = match[1];
      if (NAME_STOPWORDS.has(token)) continue;
      inThisEntry.add(token);
    }
    for (const token of inThisEntry) seen.set(token, (seen.get(token) ?? 0) + 1);
  }
  return seen;
}

function countNamedPeople(bodies: string[]): number {
  let n = 0;
  for (const count of extractNameCandidates(bodies).values()) if (count >= 2) n += 1;
  return n;
}

/**
 * Sentence-ish pieces of a body, with the leftovers of punctuation-only
 * splitting dropped.
 *
 * The filter matters more than it looks: an entry that ends on a line of
 * dialogue splits into a final piece that is just a closing quote mark, and
 * feeding `"”"` to the model as "what this person concluded" spends a token to
 * say nothing. Requiring two meaningful characters removes those.
 */
function sentences(body: string): string[] {
  return body
    .trim()
    .split(/[.!?。！？\n]+/)
    .map((part) => part.trim())
    // Strip wrapping quote marks before measuring, so a quoted sentence still
    // counts but a bare delimiter doesn't.
    .filter((part) => part.replace(/["'“”「」『』\s]/g, '').length >= 2);
}

/** The last sentence of a body, for testing how the writer closes. */
export function lastSentence(body: string): string {
  const parts = sentences(body);
  return parts[parts.length - 1] ?? '';
}

/** First sentence — paired with lastSentence to show a reasoning arc cheaply. */
export function firstSentence(body: string): string {
  return sentences(body)[0] ?? '';
}

export function hasQuotes(text: string): boolean {
  return QUOTE_RE.test(text);
}

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
