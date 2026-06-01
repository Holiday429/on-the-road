/* ==========================================================================
   On the Road · Journal templates
   --------------------------------------------------------------------------
   The single source of truth for journal card "templates". A template is a
   preset that shapes a card: its visual format, accent colour (drawn from the
   shared MAP_PALETTE so Journal matches the map + prep notes), prompt copy and
   which optional fields make sense for it.

   Adding a new template is a one-object change here — the picker, the feed
   styling (`journal-fmt-<format>`), the accent variables and the filters all
   read from this list. Keep `id` values in sync with JournalEntrySchema.template.
   ========================================================================== */

import { MAP_PALETTE } from '../../data/palette.ts';

export type TemplateId =
  | 'moment'
  | 'place'
  | 'note'
  | 'spark'
  | 'interesting';

/** Card silhouette. Each format has its own chrome in journal.css. */
export type CardFormat = 'polaroid' | 'postcard' | 'sticky' | 'post' | 'ticket';

export interface JournalTemplate {
  id: TemplateId;
  label: string;
  emoji: string;
  /** Card silhouette (drives layout/chrome). */
  format: CardFormat;
  /** Accent tint, taken from the shared map palette so colours stay in family. */
  tint: string;
  /** Placeholder for the body textarea when this template is active. */
  placeholder: string;
  /** Rotating writing prompts (kept short; emoji-led). */
  prompts: string[];
  /** Optional fields this template invites (drives progressive disclosure). */
  fields: {
    destination: boolean;
    mood: boolean;
    tags: boolean;
  };
}

/* MAP_PALETTE = lavender, blue-grey, sand, mint, rose, sage.
   Index into it so Journal shares the exact map / prep-note colours. */
export const JOURNAL_TEMPLATES: JournalTemplate[] = [
  {
    id: 'moment',
    label: 'Moment',
    emoji: '✨',
    format: 'polaroid',
    tint: MAP_PALETTE[2], // sand
    placeholder: 'A tiny thing from today…',
    prompts: ['What do you want to remember?', 'Best part of today?', 'What made you smile?'],
    fields: { destination: true, mood: true, tags: true },
  },
  {
    id: 'place',
    label: 'Place',
    emoji: '📍',
    format: 'postcard',
    tint: MAP_PALETTE[3], // mint
    placeholder: 'Where are you — and how does it feel?',
    prompts: ['What makes this spot special?', 'What does it smell and sound like?', 'Worth coming back?'],
    fields: { destination: true, mood: false, tags: true },
  },
  {
    id: 'note',
    label: 'Note',
    emoji: '📝',
    format: 'ticket',
    tint: MAP_PALETTE[1], // blue-grey
    placeholder: 'Hours, price, a tip to remember…',
    prompts: ['A tip for future-you?', 'Worth booking ahead?', 'What almost tripped you up?'],
    fields: { destination: true, mood: false, tags: true },
  },
  {
    id: 'spark',
    label: 'Spark',
    emoji: '💭',
    format: 'sticky',
    tint: MAP_PALETTE[4], // rose
    placeholder: 'One honest line. No editing.',
    prompts: ['How do you actually feel?', 'What line keeps replaying?', 'What shifted in you?'],
    fields: { destination: false, mood: true, tags: true },
  },
  {
    id: 'interesting',
    label: 'Interesting',
    emoji: '🤯',
    format: 'post',
    tint: MAP_PALETTE[0], // lavender
    placeholder: 'So different from back home…',
    prompts: ['What surprised you?', 'What would never fly back home?', 'Done totally differently here?'],
    fields: { destination: true, mood: false, tags: true },
  },
];

export const DEFAULT_TEMPLATE: TemplateId = 'moment';

const TEMPLATE_INDEX: Record<string, JournalTemplate> = Object.fromEntries(
  JOURNAL_TEMPLATES.map((t) => [t.id, t]),
);

/** Resolve a template by id, falling back to the default if unknown. */
export function template(id: string): JournalTemplate {
  return TEMPLATE_INDEX[id] ?? TEMPLATE_INDEX[DEFAULT_TEMPLATE];
}
