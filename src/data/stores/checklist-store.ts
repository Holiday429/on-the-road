/* ==========================================================================
   On the Road · Checklist store — Firestore-backed
   - Checklists: users/{uid}/trips/{tripId}/checklists  (trip-scoped)
   - Templates:  users/{uid}/checklistTemplates          (user-scoped)
   ========================================================================== */

import {
  type Checklist,
  type ChecklistTemplate,
  type ChecklistGroup,
  type ChecklistItem,
  type ChecklistTag,
  ChecklistSchema,
  ChecklistTemplateSchema,
} from '../schema.ts';
import { createCollectionStore, createUserCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';

export type StoredChecklist = WithMeta<Checklist>;
export type StoredTemplate  = WithMeta<ChecklistTemplate>;

/* ── Store factories ─────────────────────────────────────────────────────── */

function clStore() {
  return createCollectionStore(currentTripId(), 'checklists', ChecklistSchema);
}

function tplStore() {
  return createUserCollectionStore('checklistTemplates', ChecklistTemplateSchema);
}

/* ── Templates ───────────────────────────────────────────────────────────── */

export const templateStore = {
  peek: (): StoredTemplate[] => tplStore().peek() as StoredTemplate[],
  subscribe: (cb: (rows: StoredTemplate[]) => void) => tplStore().subscribe(cb as (rows: WithMeta<ChecklistTemplate>[]) => void),

  async get(id: string): Promise<StoredTemplate | undefined> {
    const rows = await tplStore().list();
    return (rows as StoredTemplate[]).find(t => t.id === id);
  },

  async create(input: { name: string; description?: string; tags?: ChecklistTag[]; groups?: ChecklistGroup[] }): Promise<string> {
    return tplStore().set({
      name: input.name,
      description: input.description ?? '',
      tags: input.tags ?? [],
      groups: input.groups ?? [],
    });
  },

  async update(id: string, patch: Partial<Pick<ChecklistTemplate, 'name' | 'description' | 'tags' | 'groups'>>): Promise<void> {
    return tplStore().update(id, patch);
  },

  async remove(id: string): Promise<void> {
    return tplStore().remove(id);
  },

  async seed(templates: Omit<StoredTemplate, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>[]): Promise<void> {
    const existing = tplStore().peek();
    if (existing.length > 0) return;
    for (const t of templates) {
      await tplStore().set({
        name: t.name,
        description: t.description ?? '',
        tags: t.tags ?? [],
        groups: t.groups ?? [],
      });
    }
  },
};

/* ── Checklists ──────────────────────────────────────────────────────────── */

export const checklistStore = {
  peek: (): StoredChecklist[] => clStore().peek() as StoredChecklist[],
  subscribe: (cb: (rows: StoredChecklist[]) => void) => clStore().subscribe(cb as (rows: WithMeta<Checklist>[]) => void),

  async get(id: string): Promise<StoredChecklist | undefined> {
    const rows = clStore().peek() as StoredChecklist[];
    return rows.find(c => c.id === id);
  },

  async create(input: { name: string; templateId?: string | null; tags?: ChecklistTag[]; groups?: ChecklistGroup[] }): Promise<string> {
    return clStore().set({
      name: input.name,
      templateId: input.templateId ?? null,
      tags: input.tags ?? [],
      groups: (input.groups ?? []).map((g, i) => ({
        ...g,
        id: g.id || genId(),
        order: g.order ?? i,
        items: (g.items ?? []).map((it, j) => ({
          ...it,
          id: it.id || genId(),
          done: false,
          order: it.order ?? j,
        })),
      })),
      completedAt: null,
    });
  },

  async put(checklist: StoredChecklist): Promise<void> {
    return clStore().update(checklist.id, checklist);
  },

  async rename(id: string, name: string): Promise<void> {
    return clStore().update(id, { name });
  },

  async remove(id: string): Promise<void> {
    return clStore().remove(id);
  },

  /* ── Group ops ─────────────────────────────────────────────────────────── */

  async addGroup(checklistId: string, name: string, icon = '📋'): Promise<ChecklistGroup | null> {
    const cl = await this.get(checklistId);
    if (!cl) return null;
    const group: ChecklistGroup = { id: genId(), name, icon, order: cl.groups.length, items: [] };
    await clStore().update(checklistId, { groups: [...cl.groups, group] });
    return group;
  },

  async updateGroup(checklistId: string, groupId: string, patch: Partial<Pick<ChecklistGroup, 'name' | 'icon'>>): Promise<void> {
    const cl = await this.get(checklistId);
    if (!cl) return;
    const groups = cl.groups.map(g => g.id === groupId ? { ...g, ...patch } : g);
    await clStore().update(checklistId, { groups });
  },

  async removeGroup(checklistId: string, groupId: string): Promise<void> {
    const cl = await this.get(checklistId);
    if (!cl) return;
    await clStore().update(checklistId, { groups: cl.groups.filter(g => g.id !== groupId) });
  },

  async reorderGroups(checklistId: string, orderedIds: string[]): Promise<void> {
    const cl = await this.get(checklistId);
    if (!cl) return;
    const groups = orderedIds
      .map((id, i) => { const g = cl.groups.find(g => g.id === id); return g ? { ...g, order: i } : null; })
      .filter(Boolean) as ChecklistGroup[];
    await clStore().update(checklistId, { groups });
  },

  /* ── Item ops ──────────────────────────────────────────────────────────── */

  async addItem(checklistId: string, groupId: string, text: string, note?: string): Promise<ChecklistItem | null> {
    const cl = await this.get(checklistId);
    if (!cl) return null;
    const group = cl.groups.find(g => g.id === groupId);
    if (!group) return null;
    const item: ChecklistItem = { id: genId(), text, note, done: false, order: group.items.length };
    const groups = cl.groups.map(g =>
      g.id === groupId ? { ...g, items: [...g.items, item] } : g
    );
    await clStore().update(checklistId, { groups });
    return item;
  },

  async toggleItem(checklistId: string, groupId: string, itemId: string): Promise<boolean> {
    const cl = await this.get(checklistId);
    if (!cl) return false;
    const groups = cl.groups.map(g =>
      g.id !== groupId ? g : {
        ...g,
        items: g.items.map(it => it.id === itemId ? { ...it, done: !it.done } : it),
      }
    );
    const allDone = groups.every(g => g.items.length > 0 && g.items.every(it => it.done));
    const completedAt = allDone ? (cl.completedAt ?? Date.now()) : null;
    await clStore().update(checklistId, { groups, completedAt });
    return allDone;
  },

  async updateItem(checklistId: string, groupId: string, itemId: string, patch: Partial<Pick<ChecklistItem, 'text' | 'note'>>): Promise<void> {
    const cl = await this.get(checklistId);
    if (!cl) return;
    const groups = cl.groups.map(g =>
      g.id !== groupId ? g : {
        ...g,
        items: g.items.map(it => it.id === itemId ? { ...it, ...patch } : it),
      }
    );
    await clStore().update(checklistId, { groups });
  },

  async removeItem(checklistId: string, groupId: string, itemId: string): Promise<void> {
    const cl = await this.get(checklistId);
    if (!cl) return;
    const groups = cl.groups.map(g =>
      g.id !== groupId ? g : { ...g, items: g.items.filter(it => it.id !== itemId) }
    );
    await clStore().update(checklistId, { groups });
  },

  async reorderItems(checklistId: string, groupId: string, orderedIds: string[]): Promise<void> {
    const cl = await this.get(checklistId);
    if (!cl) return;
    const groups = cl.groups.map(g => {
      if (g.id !== groupId) return g;
      const items = orderedIds
        .map((id, i) => { const it = g.items.find(it => it.id === id); return it ? { ...it, order: i } : null; })
        .filter(Boolean) as ChecklistItem[];
      return { ...g, items };
    });
    await clStore().update(checklistId, { groups });
  },
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
