import { MAP_PALETTE } from '../../data/palette.ts';
import type { JournalTemplateKind as SchemaJournalTemplateKind } from '../../data/schema.ts';

export type JournalTemplateKind = SchemaJournalTemplateKind;

export type TemplateId = string;
export type CardFormat = 'polaroid' | 'postcard' | 'post' | 'ticket';

/**
 * A category an entry can carry. The user no longer picks one — it's inferred
 * on save (see classify.ts) — so what survives here is only what RENDERING an
 * existing entry needs: its label, emoji, tint, and card format. The composer
 * prompts, per-category field maps and placeholders are gone; they existed to
 * drive a choice the user no longer makes.
 */
export interface JournalTemplate {
  id: TemplateId;
  label: string;
  emoji: string;
  kind: JournalTemplateKind;
  format: CardFormat;
  tint: string;
  builtin: boolean;
}

const BASE_TEMPLATE_BY_KIND: Record<JournalTemplateKind, Omit<JournalTemplate, 'id' | 'label' | 'emoji' | 'builtin'>> = {
  moment:      { kind: 'moment',      format: 'polaroid', tint: MAP_PALETTE[2] },
  place:       { kind: 'place',       format: 'postcard', tint: MAP_PALETTE[3] },
  note:        { kind: 'note',        format: 'ticket',   tint: MAP_PALETTE[1] },
  interesting: { kind: 'interesting', format: 'post',     tint: MAP_PALETTE[0] },
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

export function normalizeTemplateId(id: string): string {
  return id === 'spark' ? 'moment' : id;
}

export function templates(): JournalTemplate[] {
  return BUILTIN_TEMPLATES;
}

export function builtinTemplate(kind: JournalTemplateKind): JournalTemplate {
  return BUILTIN_TEMPLATES.find((item) => item.kind === kind) ?? BUILTIN_TEMPLATES[0];
}

export function template(id: string): JournalTemplate {
  const normalized = normalizeTemplateId(id);
  return templates().find((item) => item.id === normalized) ?? builtinTemplate('moment');
}
