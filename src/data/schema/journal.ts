import { z } from 'zod';
import { doc } from './base.ts';

/** Max photos per journal entry (WeChat Moments caps at 9, and so do we). */
export const MAX_JOURNAL_IMAGES = 9;


/* ── Journal ─────────────────────────────────────────────────────────────── */
// `template` is the card preset (see src/views/journal/templates.ts) and is the
// primary discriminator going forward. It's a plain string — not an enum — so
// new templates can ship without a schema migration; the UI validates against
// the known registry and falls back gracefully for anything it doesn't know.
// `mood` is optional because only some templates surface it.
export const JournalEntrySchema = doc({
  // Which trip this entry belongs to. null = unclassified (legacy/global).
  // Flattened to users/{uid}/journalEntries so the calendar can show one trip
  // or scroll across all trips. See createTaggedCollectionStore.
  tripId: z.string().nullable().default(null),
  title: z.string().default(''),
  body: z.string(),
  template: z.string().default('moment'),
  destination: z.string().default(''),
  tags: z.array(z.string()).default([]),
  mood: z.string().optional(),
  happenedOn: z.string(), // ISO date
  favorite: z.boolean().default(false),
  // Sharing — a public entry is readable via /#/s/{slug} without auth.
  visibility: z.enum(['private', 'public']).default('private'),
  slug: z.string().default(''),
  // Photos, WeChat-Moments style: up to 9, in display order. Each is a remote
  // Storage download URL (users/{uid}/journal/...), never a data URL — 9 inline
  // data URLs would blow past Firestore's 1MB per-document ceiling.
  images: z.array(z.string()).max(MAX_JOURNAL_IMAGES).default([]),
  // Legacy single-photo field, kept so entries written before `images` existed
  // still render. Readers should go through `entryImages()`, which prefers
  // `images` and falls back to this. Writers set both: `images[0]` is mirrored
  // here so an older client (or the share card) still finds a photo.
  coverImage: z.string().optional(), // remote URL (legacy: may be a data URL)
  // width / height of the FIRST image, e.g. 1.5 for 3:2. Drives the cover
  // aspect ratio in the feed (portrait -> 3:4, landscape -> 4:3, else 1:1).
  imageRatio: z.number().optional(),
  linkedPlaces: z.array(z.string()).optional(), // Guide card ids saved for this entry
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export const JournalTemplateKindSchema = z.enum(['moment', 'place', 'note', 'interesting']);
export type JournalTemplateKind = z.infer<typeof JournalTemplateKindSchema>;

export const JournalTemplateSchema = doc({
  label: z.string(),
  emoji: z.string().default('✨'),
  kind: JournalTemplateKindSchema.default('moment'),
  placeholder: z.string().default(''),
  prompts: z.array(z.string()).default([]),
  tint: z.string().default(''),
});
export type JournalTemplate = z.infer<typeof JournalTemplateSchema>;

/* ── Albums ──────────────────────────────────────────────────────────────── */
// A user-made grouping of entries, created AFTER the fact. This is the counter-
// part to `template`: the template says what an entry is like (inferred, weak),
// an album says the user decided these belong together (explicit, strong).
//
// Membership lives here rather than as `albumIds` on each entry because an
// album is an ordered list the user arranges, and an entry can sit in several
// albums at once — both are awkward to express from the entry side. Same shape
// as JournalStory.entryIds, which already works this way.
export const JournalAlbumSchema = doc({
  tripId: z.string().nullable().default(null),
  title: z.string(),
  emoji: z.string().default('📁'),
  // Entry shown on the album tile; null = fall back to the first entry's photo.
  coverEntryId: z.string().nullable().default(null),
  // Ordered. May reference entries that were since deleted — readers filter.
  entryIds: z.array(z.string()).default([]),
  visibility: z.enum(['private', 'public']).default('private'),
  slug: z.string().default(''),
});
export type JournalAlbum = z.infer<typeof JournalAlbumSchema>;

export const JournalStoryModuleSchema = z.object({
  id: z.string(),
  type: z.string().default('module'),
  title: z.string(),
  summary: z.string(),
  entryIds: z.array(z.string()).default([]),
});
export type JournalStoryModule = z.infer<typeof JournalStoryModuleSchema>;

export const JournalStoryQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  answer: z.string().default(''),
  entryId: z.string().nullable().default(null),
});
export type JournalStoryQuestion = z.infer<typeof JournalStoryQuestionSchema>;

export const JournalStorySchema = doc({
  title: z.string(),
  subtitle: z.string().default(''),
  recapLine: z.string().default(''),
  travelerMode: z.string().default(''),
  scopeLabel: z.string().default('Whole trip'),
  entryIds: z.array(z.string()).default([]),
  modules: z.array(JournalStoryModuleSchema).default([]),
  questions: z.array(JournalStoryQuestionSchema).default([]),
  status: z.enum(['draft', 'published']).default('draft'),
  visibility: z.enum(['private', 'public']).default('private'),
  slug: z.string().default(''),
});
export type JournalStory = z.infer<typeof JournalStorySchema>;

/* ── Traveler Recap ──────────────────────────────────────────────────────── */
// A portrait of the TRAVELLER, not of the trip — "what kind of person records
// like this". Distinct from JournalStory (above), which recaps the trip itself.
//
// Why a separate collection rather than more fields on JournalStory:
//   · different input — a story ranks the top ~18 entries and reads them at
//     high resolution; a portrait needs EVERY entry at low resolution, because
//     the behavioural signals (blank bodies, multi-entry days, when tagging
//     stopped) are what the portrait is actually built from.
//   · different output — fixed chapters with a public/private pair per chapter,
//     vs free-form modules + questions.
// See docs/AI_RECAP_架构设计.md.

/**
 * The six angles a portrait is written from. Fixed, not model-chosen, so the
 * share-card layouts can be designed up front and each chapter's length stays
 * predictable. Together they're the minimum complete set for "who is this":
 *   attention   — where their eye lands
 *   method      — how they get from a scene to a judgement
 *   relations   — how they treat companions and strangers
 *   friction    — what they do when something goes wrong
 *   recording   — what kind of record-keeper they are (signals-driven)
 *   throughline — the theme that keeps resurfacing
 */
export const RECAP_CHAPTER_IDS = [
  'attention', 'method', 'relations', 'friction', 'recording', 'throughline',
] as const;
export type RecapChapterId = typeof RECAP_CHAPTER_IDS[number];

export const RecapChapterSchema = z.object({
  id: z.enum(RECAP_CHAPTER_IDS),
  heading: z.string().default(''),
  /** Private reading. May quote entries, name people, cite specifics. */
  body: z.string().default(''),
  /**
   * The same judgement with every identifying detail removed — no names, no
   * quoted speech, no amounts, no addresses, no relationship labels. Not a
   * truncation of `body` but a distillation of it: the method without the
   * incident. This is the only text a share card ever renders.
   */
  bodyPublic: z.string().default(''),
  /** Short refs (e01…) into refMap, rendered as links back to the entries. */
  evidenceRefs: z.array(z.string()).default([]),
  /**
   * Whether the public text passed every automatic check (no names, quoted
   * speech, amounts, addresses…). ADVICE, not a lock: the owner chooses which
   * cards to share, and a flagged one is shown with `flags` so they decide with
   * the reason in front of them. Default false — a model that forgets to answer
   * is treated as unchecked.
   */
  shareable: z.boolean().default(false),
  /** Why it did not pass: person-name, quoted-speech, money, relationship-label, health, address, vendor, empty, too-short. */
  flags: z.array(z.string()).default([]),
});
export type RecapChapter = z.infer<typeof RecapChapterSchema>;

export const RecapTraitSchema = z.object({
  key: z.string().default(''),
  /**
   * 0-100. Exactly four traits ship, because the radar chart has four axes. Each
   * is a disposition visible in the writing — never a statistic about how the
   * person used the app (tags, moods and the like say nothing about them).
   */
  score: z.number().min(0).max(100).default(50),
  note: z.string().default(''),
});
export type RecapTrait = z.infer<typeof RecapTraitSchema>;

/**
 * An overview figure (up to six). `value` is computed from the writing, never by
 * the model; the model supplies only the label and a caption that fits it.
 */
export const RecapNumberSchema = z.object({
  label: z.string().default(''),
  value: z.string().default(''),
  caption: z.string().default(''),
});
export type RecapNumber = z.infer<typeof RecapNumberSchema>;

export const TravelerRecapSchema = doc({
  tripId: z.string().nullable().default(null),
  /**
   * hash(signals + evidence refs + promptVersion). Identical hash = identical
   * input, so a regenerate request can be answered from the stored doc instead
   * of the model. The one lever that makes this feature cheap to re-open.
   */
  sourceHash: z.string().default(''),
  /** Entry count the portrait was generated from (shown as "based on N notes"). */
  entryCount: z.number().default(0),
  /** The L1 signal block, stored verbatim so share cards can draw the numbers
   *  without re-reading every entry. */
  signals: z.record(z.string(), z.unknown()).default({}),
  archetype: z.object({
    label: z.string().default(''),
    tagline: z.string().default(''),
  }).default({ label: '', tagline: '' }),
  traits: z.array(RecapTraitSchema).default([]),
  numbers: z.array(RecapNumberSchema).default([]),
  chapters: z.array(RecapChapterSchema).default([]),
  oneLine: z.string().default(''),
  /** Up to three questions to carry into the next trip, each from a different angle. */
  questions: z.array(z.string()).default([]),
  /** Short ref → real entry id. Also the whitelist that rejects hallucinated refs. */
  refMap: z.record(z.string(), z.string()).default({}),
  /** 'signals' = heuristic/offline card only; 'ai' = full portrait. */
  source: z.enum(['signals', 'ai']).default('ai'),
  visibility: z.enum(['private', 'public']).default('private'),
  slug: z.string().default(''),
  generatedAt: z.number().default(0),
});
export type TravelerRecap = z.infer<typeof TravelerRecapSchema>;
