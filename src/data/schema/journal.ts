import { z } from 'zod';
import { doc } from './base.ts';


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
  coverImage: z.string().optional(), // data URL or remote URL
  imageRatio: z.number().optional(),  // width / height, e.g. 1.5 for 3:2
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
