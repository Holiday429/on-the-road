import { z } from 'zod';
import { doc } from './base.ts';

/* ── Prep (legacy — kept for migration) ──────────────────────────────────── */
export const PrepTaskSchema = doc({
  text: z.string(),
  note: z.string().optional(),
  done: z.boolean().default(false),
  category: z.string(),
  phase: z.enum(['60d', '30d', '14d', '7d', '1d']),
  order: z.number().default(0),
});
export type PrepTask = z.infer<typeof PrepTaskSchema>;

/* ── Checklist (new) ─────────────────────────────────────────────────────── */

export const ChecklistItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  note: z.string().optional(),
  done: z.boolean().default(false),
  order: z.number().default(0),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const ChecklistGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().default('📋'),
  order: z.number().default(0),
  items: z.array(ChecklistItemSchema).default([]),
});
export type ChecklistGroup = z.infer<typeof ChecklistGroupSchema>;

// Tags for quick filtering when selecting templates
export const ChecklistTagSchema = z.object({
  type: z.enum(['season', 'duration', 'region', 'custom']),
  value: z.string(),
});
export type ChecklistTag = z.infer<typeof ChecklistTagSchema>;

export const ChecklistTemplateSchema = doc({
  name: z.string(),
  description: z.string().default(''),
  tags: z.array(ChecklistTagSchema).default([]),
  groups: z.array(ChecklistGroupSchema).default([]),
});
export type ChecklistTemplate = z.infer<typeof ChecklistTemplateSchema>;

// A live checklist instance, either from a template or created from scratch
export const ChecklistSchema = doc({
  name: z.string(),
  templateId: z.string().nullable().default(null),
  tags: z.array(ChecklistTagSchema).default([]),
  groups: z.array(ChecklistGroupSchema).default([]),
  completedAt: z.number().nullable().default(null),
});
export type Checklist = z.infer<typeof ChecklistSchema>;
