import { MAP_PALETTE } from '../../data/palette.ts';
import type { StoredJournalTemplate } from '../../data/stores/journal-template-store.ts';
import type { JournalTemplateKind as SchemaJournalTemplateKind } from '../../data/schema.ts';

export type JournalTemplateKind = SchemaJournalTemplateKind;

export type TemplateId = string;
export type CardFormat = 'polaroid' | 'postcard' | 'post' | 'ticket';

export interface JournalTemplate {
  id: TemplateId;
  label: string;
  emoji: string;
  kind: JournalTemplateKind;
  format: CardFormat;
  tint: string;
  placeholder: string;
  prompts: string[];
  focus: string;
  bodyLabel: string;
  destinationLabel: string;
  tagsLabel: string;
  imageLabel: string;
  builtin: boolean;
  fields: {
    destination: boolean;
    mood: boolean;
    tags: boolean;
    image: boolean;
  };
}

const BASE_TEMPLATE_BY_KIND: Record<JournalTemplateKind, Omit<JournalTemplate, 'id' | 'label' | 'emoji' | 'builtin'>> = {
  moment: {
    kind: 'moment',
    format: 'polaroid',
    tint: MAP_PALETTE[2],
    placeholder: 'A short moment, feeling, or line you want to keep…',
    prompts: ['What do you want to remember?', 'What feeling flashed by?', 'What tiny thing changed the mood?'],
    focus: 'Short lines, emotions, and passing sparks.',
    bodyLabel: 'Moment',
    destinationLabel: 'Where were you?',
    tagsLabel: 'Feeling / theme tags',
    imageLabel: 'Moment photo',
    fields: { destination: true, mood: true, tags: true, image: true },
  },
  place: {
    kind: 'place',
    format: 'postcard',
    tint: MAP_PALETTE[3],
    placeholder: 'What did this place feel like, beyond the name on the map?',
    prompts: ['What made this place stand out?', 'What detail captures its atmosphere?', 'Would you send someone else here?'],
    focus: 'A place plus your impression of it.',
    bodyLabel: 'Place impression',
    destinationLabel: 'Place / city',
    tagsLabel: 'Place tags',
    imageLabel: 'Place photo',
    fields: { destination: true, mood: false, tags: true, image: true },
  },
  note: {
    kind: 'note',
    format: 'ticket',
    tint: MAP_PALETTE[1],
    placeholder: 'Price, hours, route, reminder, booking tip…',
    prompts: ['What should future-you know?', 'What practical detail mattered?', 'What was worth noting down right away?'],
    focus: 'Useful facts, reminders, prices, and logistics.',
    bodyLabel: 'Useful note',
    destinationLabel: 'Linked place',
    tagsLabel: 'Practical tags',
    imageLabel: 'Receipt / reference photo',
    fields: { destination: true, mood: false, tags: true, image: true },
  },
  interesting: {
    kind: 'interesting',
    format: 'post',
    tint: MAP_PALETTE[0],
    placeholder: 'Something surprising, strange, funny, or sharply different…',
    prompts: ['What felt unexpectedly different?', 'What detail made you stop?', 'What observation would you tell a friend first?'],
    focus: 'Contrast, observation, and things that felt unexpectedly vivid.',
    bodyLabel: 'Observation',
    destinationLabel: 'Where did you notice it?',
    tagsLabel: 'Observation tags',
    imageLabel: 'Observation photo',
    fields: { destination: true, mood: false, tags: true, image: true },
  },
};

export const BUILTIN_TEMPLATE_KINDS: JournalTemplateKind[] = ['moment', 'note', 'interesting', 'place'];
export const DEFAULT_TEMPLATE: TemplateId = 'moment';

const BUILTIN_TEMPLATES: JournalTemplate[] = [
  {
    id: 'moment',
    label: 'Moments',
    emoji: '✨',
    builtin: true,
    ...BASE_TEMPLATE_BY_KIND.moment,
  },
  {
    id: 'note',
    label: 'Notes',
    emoji: '📝',
    builtin: true,
    ...BASE_TEMPLATE_BY_KIND.note,
  },
  {
    id: 'interesting',
    label: 'Interesting',
    emoji: '🤯',
    builtin: true,
    ...BASE_TEMPLATE_BY_KIND.interesting,
  },
  {
    id: 'place',
    label: 'Places',
    emoji: '📍',
    builtin: true,
    ...BASE_TEMPLATE_BY_KIND.place,
  },
];

let CUSTOM_TEMPLATES: JournalTemplate[] = [];

export function normalizeTemplateId(id: string): string {
  return id === 'spark' ? 'moment' : id;
}

export function setCustomTemplates(rows: StoredJournalTemplate[]) {
  CUSTOM_TEMPLATES = rows
    .map((row) => {
      const base = BASE_TEMPLATE_BY_KIND[row.kind];
      return {
        ...base,
        id: row.id,
        label: row.label.trim() || 'Custom',
        emoji: row.emoji.trim() || '✨',
        tint: row.tint.trim() || base.tint,
        placeholder: row.placeholder.trim() || base.placeholder,
        prompts: row.prompts.length ? row.prompts : base.prompts,
        builtin: false,
      } satisfies JournalTemplate;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function templates(): JournalTemplate[] {
  return [...BUILTIN_TEMPLATES, ...CUSTOM_TEMPLATES];
}

export function builtinTemplate(kind: JournalTemplateKind): JournalTemplate {
  return BUILTIN_TEMPLATES.find((item) => item.kind === kind) ?? BUILTIN_TEMPLATES[0];
}

export function template(id: string): JournalTemplate {
  const normalized = normalizeTemplateId(id);
  return templates().find((item) => item.id === normalized) ?? builtinTemplate('moment');
}
