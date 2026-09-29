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
