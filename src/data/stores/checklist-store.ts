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

/* ── Built-in templates ──────────────────────────────────────────────────── */

export const BUILT_IN_TEMPLATES: { name: string; description: string; tags: ChecklistTag[]; groups: ChecklistGroup[] }[] = [
  {
    name: 'Europe Trip — Full Prep',
    description: 'Documents, money, health, packing and logistics for a European trip.',
    tags: [
      { type: 'region', value: 'Europe' },
      { type: 'duration', value: 'long' },
    ],
    groups: [
      {
        id: 'tpl-docs', name: 'Documents', icon: '📄', order: 0,
        items: [
          { id: genId(), text: 'Check passport expiry (6mo+ required)', note: 'Most EU countries require 6 months validity beyond arrival', done: false, order: 0 },
          { id: genId(), text: 'Apply for Schengen visa if needed', done: false, order: 1 },
          { id: genId(), text: 'Upload scans to cloud (Google Drive / iCloud)', note: 'Email copies to yourself too', done: false, order: 2 },
          { id: genId(), text: 'Note embassy contacts for each country', done: false, order: 3 },
          { id: genId(), text: 'Photocopy passport as physical backup', done: false, order: 4 },
          { id: genId(), text: 'Passport in carry-on, NOT checked luggage', done: false, order: 5 },
        ],
      },
      {
        id: 'tpl-money', name: 'Money & Cards', icon: '💳', order: 1,
        items: [
          { id: genId(), text: 'Get no-FX-fee card (Wise, Revolut, or Schwab)', done: false, order: 0 },
          { id: genId(), text: 'Inform bank of travel dates', done: false, order: 1 },
          { id: genId(), text: 'Load Wise / Revolut with EUR', done: false, order: 2 },
          { id: genId(), text: 'Keep small cash reserve for first day', done: false, order: 3 },
        ],
      },
      {
        id: 'tpl-insurance', name: 'Insurance', icon: '🛡️', order: 2,
        items: [
          { id: genId(), text: 'Research travel insurance options', note: 'World Nomads or SafetyWing for long-term', done: false, order: 0 },
          { id: genId(), text: 'Purchase travel insurance', done: false, order: 1 },
          { id: genId(), text: 'Save policy number + emergency hotline', done: false, order: 2 },
        ],
      },
      {
        id: 'tpl-health', name: 'Health', icon: '💊', order: 3,
        items: [
          { id: genId(), text: 'Fill prescriptions & pack medications', done: false, order: 0 },
          { id: genId(), text: 'Pack basic first-aid kit', done: false, order: 1 },
          { id: genId(), text: 'Check if vaccines / health advisories apply', done: false, order: 2 },
        ],
      },
      {
        id: 'tpl-comms', name: 'Comms & Tech', icon: '📱', order: 4,
        items: [
          { id: genId(), text: 'Get EU SIM or check roaming plan', note: 'EU roaming included in most European carriers', done: false, order: 0 },
          { id: genId(), text: 'Download offline maps', note: 'Maps.me or Google Maps offline', done: false, order: 1 },
          { id: genId(), text: 'Charge all devices + power banks', done: false, order: 2 },
          { id: genId(), text: 'Download entertainment for flight', done: false, order: 3 },
          { id: genId(), text: 'Set up emergency contact in phone', done: false, order: 4 },
        ],
      },
      {
        id: 'tpl-logistics', name: 'Logistics', icon: '✈️', order: 5,
        items: [
          { id: genId(), text: 'Book major flights', done: false, order: 0 },
          { id: genId(), text: 'Book accommodation for first 3 nights', done: false, order: 1 },
          { id: genId(), text: 'Confirm all bookings', done: false, order: 2 },
          { id: genId(), text: 'Online check-in for flights', done: false, order: 3 },
          { id: genId(), text: 'Arrange airport transport', done: false, order: 4 },
        ],
      },
      {
        id: 'tpl-pack', name: 'Packing', icon: '🎒', order: 6,
        items: [
          { id: genId(), text: 'Lay out all items 2 weeks before', done: false, order: 0 },
          { id: genId(), text: 'Weigh bag — target under 10kg for carry-on', done: false, order: 1 },
          { id: genId(), text: 'Final pack & check against this list', done: false, order: 2 },
          { id: genId(), text: 'Take photo of bag contents (for insurance)', done: false, order: 3 },
        ],
      },
      {
        id: 'tpl-misc', name: 'Last-minute', icon: '⏰', order: 7,
        items: [
          { id: genId(), text: 'Notify family / friends of itinerary', done: false, order: 0 },
          { id: genId(), text: 'Pause local subscriptions if needed', done: false, order: 1 },
          { id: genId(), text: 'Set two alarms', done: false, order: 2 },
          { id: genId(), text: 'Sleep early the night before', done: false, order: 3 },
        ],
      },
    ],
  },
  {
    name: 'Shopping — Gear & Supplies',
    description: 'Things to buy before the trip.',
    tags: [{ type: 'custom', value: 'shopping' }],
    groups: [
      {
        id: 'tpl-sh-gear', name: 'Travel Gear', icon: '🎒', order: 0,
        items: [
          { id: genId(), text: 'Daypack / backpack', done: false, order: 0 },
          { id: genId(), text: 'Packing cubes', done: false, order: 1 },
          { id: genId(), text: 'Universal power adapter', done: false, order: 2 },
          { id: genId(), text: 'Portable power bank (20,000mAh)', done: false, order: 3 },
          { id: genId(), text: 'TSA-approved lock', done: false, order: 4 },
        ],
      },
      {
        id: 'tpl-sh-clothes', name: 'Clothing', icon: '👕', order: 1,
        items: [
          { id: genId(), text: 'Merino wool base layers', done: false, order: 0 },
          { id: genId(), text: 'Rain jacket / windbreaker', done: false, order: 1 },
          { id: genId(), text: 'Comfortable walking shoes', done: false, order: 2 },
        ],
      },
      {
        id: 'tpl-sh-health', name: 'Health & Toiletries', icon: '🧴', order: 2,
        items: [
          { id: genId(), text: 'Travel-size toiletries (<100ml)', done: false, order: 0 },
          { id: genId(), text: 'Sunscreen SPF 50+', done: false, order: 1 },
          { id: genId(), text: 'Blister plasters', done: false, order: 2 },
          { id: genId(), text: 'Hand sanitizer', done: false, order: 3 },
        ],
      },
    ],
  },
  {
    name: 'Visa Application',
    description: 'Documents checklist for Schengen or other visa applications.',
    tags: [{ type: 'region', value: 'Europe' }, { type: 'custom', value: 'visa' }],
    groups: [
      {
        id: 'tpl-visa-docs', name: 'Required Documents', icon: '📋', order: 0,
        items: [
          { id: genId(), text: 'Valid passport (6mo+ validity, 2 blank pages)', done: false, order: 0 },
          { id: genId(), text: 'Completed visa application form', done: false, order: 1 },
          { id: genId(), text: 'Passport-size photos (biometric spec)', done: false, order: 2 },
          { id: genId(), text: 'Flight itinerary / confirmed bookings', done: false, order: 3 },
          { id: genId(), text: 'Hotel / accommodation proof', done: false, order: 4 },
          { id: genId(), text: 'Travel insurance certificate', done: false, order: 5 },
          { id: genId(), text: 'Bank statements (last 3 months)', done: false, order: 6 },
          { id: genId(), text: 'Proof of employment / income', done: false, order: 7 },
          { id: genId(), text: 'Cover letter explaining trip purpose', done: false, order: 8 },
        ],
      },
      {
        id: 'tpl-visa-steps', name: 'Steps', icon: '✅', order: 1,
        items: [
          { id: genId(), text: 'Check which embassy / consulate handles your application', done: false, order: 0 },
          { id: genId(), text: 'Book appointment at embassy', done: false, order: 1 },
          { id: genId(), text: 'Pay visa fee', done: false, order: 2 },
          { id: genId(), text: 'Submit application', done: false, order: 3 },
          { id: genId(), text: 'Track application status', done: false, order: 4 },
          { id: genId(), text: 'Collect passport with visa', done: false, order: 5 },
        ],
      },
    ],
  },
];
