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
    placeholder: '一句话抓住那个瞬间的感觉…',
    prompts: ['什么情绪一闪而过？', '哪个细节你不想忘掉？', '如果只能留一句话，是什么？'],
    focus: '短句、情绪、灵感——转瞬即逝的东西。',
    bodyLabel: 'Moment',
    destinationLabel: 'Where were you?',
    tagsLabel: 'Feeling / theme',
    imageLabel: 'Moment photo',
    fields: { destination: true, mood: true, tags: true, image: true },
  },
  place: {
    kind: 'place',
    format: 'postcard',
    tint: MAP_PALETTE[3],
    placeholder: '这个地方是什么感觉，超出地图上那个名字的部分…',
    prompts: ['什么让这里和别处不同？', '哪个细节最能代表这里的氛围？', '你会推荐给谁，为什么？'],
    focus: '地点 + 你对它的印象。',
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
    placeholder: '价格、开放时间、路线、提醒、订票技巧…',
    prompts: ['未来的自己需要知道什么？', '哪个实用细节值得留存？', '什么信息你查了好几次？'],
    focus: '实用信息：价格、提醒、路线、备忘。',
    bodyLabel: 'Note',
    destinationLabel: 'Linked place',
    tagsLabel: 'Practical tags',
    imageLabel: 'Receipt / reference photo',
    fields: { destination: true, mood: false, tags: true, image: true },
  },
  interesting: {
    kind: 'interesting',
    format: 'post',
    tint: MAP_PALETTE[0],
    placeholder: '什么事让你停下来？什么你从没想过会这样…',
    prompts: ['什么和你预期完全不同？', '哪个细节让你忍不住多看一眼？', '你会第一个告诉朋友什么？'],
    focus: '反差、观察——出乎意料、鲜活的东西。',
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
