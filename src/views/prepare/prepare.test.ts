// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ==========================================================================
   Prepare landing ↔ section wiring.

   The Prepare page reads its rails and hero from the Checklist/Pack sections
   rather than subscribing itself, and hands the page to a section's editor on
   a row tap. Those seams only exist in the DOM, so this drives the real
   modules against the same in-memory Firestore mock the store tests use.
   ========================================================================== */

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
vi.stubGlobal('localStorage', new MemoryStorage());

const docs = new Map<string, Record<string, unknown>>();
type Listener = { colPath: string; cb: (snap: unknown) => void };
let listeners: Listener[] = [];

function colDocs(colPath: string) {
  const prefix = colPath + '/';
  return [...docs.entries()]
    .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
    .map(([, data]) => data);
}
function snapFor(colPath: string) {
  return { docs: colDocs(colPath).map((data) => ({ data: () => data })) };
}
function fireListeners(colPath: string) {
  listeners.filter((l) => l.colPath === colPath).forEach((l) => l.cb(snapFor(l.colPath)));
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path,
  doc: (colPath: string, id: string) => `${colPath}/${id}`,
  query: (colPath: string) => colPath,
  getDocs: async (colPath: string) => snapFor(colPath),
  getDoc: async (docPath: string) => {
    const data = docs.get(docPath);
    return { exists: () => data !== undefined, data: () => data };
  },
  setDoc: async (docPath: string, data: Record<string, unknown>) => {
    docs.set(docPath, data);
    fireListeners(docPath.slice(0, docPath.lastIndexOf('/')));
  },
  deleteDoc: async (docPath: string) => {
    docs.delete(docPath);
    fireListeners(docPath.slice(0, docPath.lastIndexOf('/')));
  },
  onSnapshot: (colPath: string, cb: (snap: unknown) => void) => {
    const l: Listener = { colPath, cb };
    listeners.push(l);
    return () => { listeners = listeners.filter((x) => x !== l); };
  },
}));

vi.mock('../../firebase/config.ts', () => ({ db: {} }));
vi.mock('../../firebase/auth.ts', () => ({ currentUser: () => ({ uid: 'alice' }) }));
vi.mock('../../core/api.ts', () => ({ postJson: vi.fn() }));
vi.mock('../../core/paywall.ts', () => ({ handleAiError: vi.fn() }));

// Deep links (e.g. Dashboard's "Open Pack ›") arrive as a nav intent.
let _pendingIntent: { listId?: string } | null = null;
vi.mock('../../core/app.ts', () => ({
  consumeNavIntent: () => { const i = _pendingIntent; _pendingIntent = null; return i; },
}));

// Trip context: one active trip with dates far enough out to be 'far' phase.
let _trip: { id: string; name: string; startDate?: string; endDate?: string } | null =
  { id: 't1', name: 'Euro Trip', startDate: '2099-01-01', endDate: '2099-01-10' };
vi.mock('../../data/trip-context.ts', () => ({
  currentTripId: () => 't1',
  currentTrip: () => _trip,
}));

import { checklistStore } from '../../data/stores/checklist-store.ts';
import { packStore } from '../../data/stores/pack-store.ts';
import type { PackItem } from '../../data/schema.ts';
import { initPrepare } from './prepare.ts';

/** A complete PackItem — the store's schema has no optional fields, so
 *  fixtures spell out the defaults the UI never sets by hand. */
function packItem(over: Partial<PackItem> & { id: string; name: string }): PackItem {
  return {
    category: 'Other', qty: 1, unitWeightG: 0, containerId: null,
    priority: 'essential', locked: false, packed: false, source: 'manual',
    order: 0, acquiredLegId: null, droppedLegId: null, consumable: false,
    ...over,
  };
}

function mountShell() {
  // eslint-disable-next-line no-restricted-syntax -- audited: static test shell, no interpolation
  document.body.innerHTML = `<div id="view-prep"><div class="prepare-root"></div></div>`;
}
const landing = () => document.querySelector<HTMLElement>('#prepare-landing')!;
const clZone = () => document.querySelector<HTMLElement>('#prepare-checklist-zone')!;
const pkZone = () => document.querySelector<HTMLElement>('#prepare-pack-zone')!;
const rows = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

beforeEach(() => {
  docs.clear();
  listeners = [];
  localStorage.clear();
  _pendingIntent = null;
  _trip = { id: 't1', name: 'Euro Trip', startDate: '2099-01-01', endDate: '2099-01-10' };
  mountShell();
});

describe('Prepare landing — rails read live store data', () => {
  it('starts with both empty cards, then shows a row per created list', async () => {
    initPrepare();

    expect(rows('.prep-empty').length).toBe(2);
    expect(rows('[data-cl]').length).toBe(0);
    expect(rows('[data-pk]').length).toBe(0);

    const id = await checklistStore.create({
      name: 'Paris Prep',
      groups: [{ id: 'g1', name: 'Docs', icon: '📋', order: 0, items: [
        { id: 'i1', text: 'Passport', done: false, order: 0 },
        { id: 'i2', text: 'Visa', done: false, order: 1 },
      ] }],
    });
    // create() always stores items unticked, so tick one the way the UI does.
    await checklistStore.toggleItem(id, 'g1', 'i1');

    const clRows = rows('[data-cl]');
    expect(clRows.length).toBe(1);
    expect(clRows[0].querySelector('.prep-row-name')!.textContent).toBe('Paris Prep');
    // Progress is computed from the stored items, not a placeholder.
    expect(clRows[0].querySelector('.prep-row-meta')!.textContent).toContain('1/2');
    // That rail is no longer empty, so its actions move back to the header.
    expect(document.querySelector('#prep-rail-checklist .prep-empty')).toBeNull();
    expect(document.querySelector('#prep-rail-checklist .prep-rail-actions')).not.toBeNull();
  });

  it('shows pack rows with bag/item counts and flags an over-limit list', async () => {
    initPrepare();

    await packStore.create({
      name: 'Main luggage',
      containers: [{ id: 'c1', label: 'Carry-on', kind: 'backpack', limitG: 1000, selfWeightG: 0 }],
      items: [
        packItem({ id: 'p1', name: 'Boots', unitWeightG: 900, containerId: 'c1', order: 0 }),
        packItem({ id: 'p2', name: 'Book', unitWeightG: 400, containerId: 'c1', order: 1 }),
      ],
    });

    const pkRows = rows('[data-pk]');
    expect(pkRows.length).toBe(1);
    expect(pkRows[0].querySelector('.prep-row-name')!.textContent).toBe('Main luggage');
    expect(pkRows[0].querySelector('.prep-row-sub')!.textContent).toContain('1');
    // 1300g in a 1000g bag → over limit, surfaced on the row and the hero.
    expect(pkRows[0].classList.contains('is-over')).toBe(true);
    expect(document.querySelector('.prep-row-badge.is-warn')).not.toBeNull();
    expect(document.querySelector('.prep-hero-stat.is-warn')).not.toBeNull();
  });

  it('aggregates both sections into the hero', async () => {
    initPrepare();
    const clId = await checklistStore.create({
      name: 'A',
      groups: [{ id: 'g1', name: 'G', icon: '📋', order: 0, items: [
        { id: 'i1', text: 'x', done: false, order: 0 },
        { id: 'i2', text: 'y', done: false, order: 1 },
        { id: 'i3', text: 'z', done: false, order: 2 },
      ] }],
    });
    await checklistStore.toggleItem(clId, 'g1', 'i1');
    await checklistStore.toggleItem(clId, 'g1', 'i2');
    await packStore.create({
      name: 'Bag',
      containers: [{ id: 'c1', label: 'Duffel', kind: 'suitcase', limitG: 20000, selfWeightG: 0 }],
      items: [packItem({ id: 'p1', name: 'Coat', unitWeightG: 2000, containerId: 'c1', order: 0 })],
    });

    const values = rows('.prep-hero-stat-value').map(el => el.textContent!.trim());
    expect(values[0]).toBe('2/3');       // checklist total across lists
    expect(values[1]).toContain('2');    // packed weight, not an em-dash
    expect(document.querySelector('.prep-hero--bare')).toBeNull();
  });
});

describe('Prepare landing — row tap hands the page to an editor', () => {
  it('opens the checklist editor full-page and returns on Back', async () => {
    initPrepare();
    const id = await checklistStore.create({
      name: 'Paris Prep',
      groups: [{ id: 'g1', name: 'Docs', icon: '📋', order: 0, items: [] }],
    });

    document.querySelector<HTMLElement>(`[data-cl="${id}"]`)!.click();

    expect(landing().classList.contains('is-hidden')).toBe(true);
    expect(clZone().classList.contains('is-hidden')).toBe(false);
    expect(pkZone().classList.contains('is-hidden')).toBe(true);
    expect(clZone().querySelector('#back-to-list')).not.toBeNull();

    clZone().querySelector<HTMLElement>('#back-to-list')!.click();

    expect(landing().classList.contains('is-hidden')).toBe(false);
    expect(clZone().classList.contains('is-hidden')).toBe(true);
    expect(clZone().childElementCount).toBe(0); // editor torn down
  });

  it('opens the pack editor full-page and returns on Back', async () => {
    initPrepare();
    const id = await packStore.create({ name: 'Main luggage', containers: [], items: [] });

    document.querySelector<HTMLElement>(`[data-pk="${id}"]`)!.click();

    expect(landing().classList.contains('is-hidden')).toBe(true);
    expect(pkZone().classList.contains('is-hidden')).toBe(false);
    expect(pkZone().querySelector('#pk-back')).not.toBeNull();

    pkZone().querySelector<HTMLElement>('#pk-back')!.click();

    expect(landing().classList.contains('is-hidden')).toBe(false);
    expect(pkZone().classList.contains('is-hidden')).toBe(true);
  });

  it('reflects edits made inside an editor once back on the landing', async () => {
    initPrepare();
    const id = await checklistStore.create({
      name: 'Paris Prep',
      groups: [{ id: 'g1', name: 'Docs', icon: '📋', order: 0, items: [
        { id: 'i1', text: 'Passport', done: false, order: 0 },
      ] }],
    });
    expect(document.querySelector('[data-cl] .prep-row-meta')!.textContent).toContain('0/1');

    document.querySelector<HTMLElement>(`[data-cl="${id}"]`)!.click();
    await checklistStore.toggleItem(id, 'g1', 'i1');   // tick it off in the editor
    clZone().querySelector<HTMLElement>('#back-to-list')!.click();

    expect(document.querySelector('[data-cl] .prep-row-meta')!.textContent).toContain('1/1');
    expect(document.querySelector('[data-cl]')!.classList.contains('is-complete')).toBe(true);
  });

  it('falls back to the landing if the open list is deleted elsewhere', async () => {
    initPrepare();
    const id = await packStore.create({ name: 'Main luggage', containers: [], items: [] });
    document.querySelector<HTMLElement>(`[data-pk="${id}"]`)!.click();
    expect(landing().classList.contains('is-hidden')).toBe(true);

    await packStore.remove(id);   // e.g. removed on another device

    expect(landing().classList.contains('is-hidden')).toBe(false);
    expect(rows('[data-pk]').length).toBe(0);
    expect(document.querySelector('#prep-rail-pack .prep-empty')).not.toBeNull();
  });
});

describe('Prepare landing — deleting from a row', () => {
  it('removes the checklist and restores the empty card', async () => {
    vi.stubGlobal('confirm', () => true);
    initPrepare();
    const id = await checklistStore.create({ name: 'Temp', groups: [] });
    expect(rows('[data-cl]').length).toBe(1);

    document.querySelector<HTMLElement>(`[data-del-cl="${id}"]`)!.click();
    await vi.waitFor(() => expect(rows('[data-cl]').length).toBe(0));

    expect(document.querySelector('#prep-rail-checklist .prep-empty')).not.toBeNull();
    expect(landing().classList.contains('is-hidden')).toBe(false);
  });

  it('does not open the editor when the delete button is clicked', async () => {
    vi.stubGlobal('confirm', () => false);
    initPrepare();
    const id = await checklistStore.create({ name: 'Temp', groups: [] });

    document.querySelector<HTMLElement>(`[data-del-cl="${id}"]`)!.click();

    expect(landing().classList.contains('is-hidden')).toBe(false);
    expect(clZone().classList.contains('is-hidden')).toBe(true);
  });
});

describe('Prepare landing — create flows via the shared modal', () => {
  const modal = () => document.querySelector<HTMLElement>('.otr-modal')!;

  it('creates a checklist from the empty card and lands in its editor', async () => {
    initPrepare();
    // Empty state: the CTA lives inside the empty card, not a rail header.
    document.querySelector<HTMLElement>('.prep-empty [data-act="new-cl"]')!.click();

    // The dialog is attached to document.body, so a store push can't wipe it.
    expect(modal().closest('body')).toBe(document.body);
    modal().querySelector<HTMLInputElement>('#new-checklist-name')!.value = 'Iceland Prep';
    modal().querySelector<HTMLElement>('[data-act="confirm"]')!.click();

    await vi.waitFor(() => expect(clZone().classList.contains('is-hidden')).toBe(false));
    expect(document.querySelector('.otr-modal')).toBeNull();  // closed after create
    expect(landing().classList.contains('is-hidden')).toBe(true);

    clZone().querySelector<HTMLElement>('#back-to-list')!.click();
    const names = rows('[data-cl] .prep-row-name').map(el => el.textContent);
    expect(names).toEqual(['Iceland Prep']);
  });

  it('creates a pack list and lands in its editor', async () => {
    initPrepare();
    document.querySelector<HTMLElement>('.prep-empty [data-act="new-pk"]')!.click();

    modal().querySelector<HTMLInputElement>('#pk-new-name')!.value = 'Cabin bag';
    modal().querySelector<HTMLElement>('[data-act="confirm"]')!.click();

    await vi.waitFor(() => expect(pkZone().classList.contains('is-hidden')).toBe(false));
    pkZone().querySelector<HTMLElement>('#pk-back')!.click();
    expect(rows('[data-pk] .prep-row-name').map(el => el.textContent)).toEqual(['Cabin bag']);
  });

  it('survives a store refresh while "Save as Template" is open', async () => {
    initPrepare();
    const id = await checklistStore.create({
      name: 'Paris Prep',
      groups: [{ id: 'g1', name: 'Docs', icon: '📋', order: 0, items: [] }],
    });
    document.querySelector<HTMLElement>(`[data-cl="${id}"]`)!.click();
    clZone().querySelector<HTMLElement>('#save-as-template-btn')!.click();

    const input = modal().querySelector<HTMLInputElement>('#save-tpl-name')!;
    input.value = 'Weekend template';

    // A snapshot lands mid-edit and repaints the editor. The dialog lives on
    // document.body, so it and the typed name must both survive.
    await checklistStore.rename(id, 'Paris Prep (renamed)');
    expect(document.querySelector('#save-tpl-name')).toBe(input);
    expect(input.value).toBe('Weekend template');

    modal().querySelector<HTMLElement>('[data-act="confirm"]')!.click();
    await vi.waitFor(() =>
      expect([...docs.keys()].some(k => k.startsWith('users/alice/checklistTemplates/'))).toBe(true));
  });

  it('keeps a standalone checklist in the rail alongside trip-scoped ones', async () => {
    initPrepare();
    document.querySelector<HTMLElement>('.prep-empty [data-act="new-cl"]')!.click();
    modal().querySelector<HTMLInputElement>('#new-checklist-name')!.value = 'Not tied to a trip';
    modal().querySelector<HTMLInputElement>('input[name="cl-scope"][value="standalone"]')!.checked = true;
    modal().querySelector<HTMLElement>('[data-act="confirm"]')!.click();

    await vi.waitFor(() => expect(rows('[data-cl]').length).toBe(1));
    // Stored under the standalone trip, still surfaced on this trip's landing.
    expect([...docs.keys()].some(k => k.startsWith('trips/standalone/checklists/'))).toBe(true);
    expect(document.querySelector('[data-cl] .prep-row-name')!.textContent).toBe('Not tied to a trip');
  });
});

describe('Prepare landing — deep links and re-init', () => {
  it('opens straight into a pack list when arriving with a nav intent', async () => {
    // Seed the list first, then arrive as Dashboard's "Open Pack ›" would.
    initPrepare();
    const id = await packStore.create({ name: 'Main luggage', containers: [], items: [] });

    mountShell();
    _pendingIntent = { listId: id };
    initPrepare();

    expect(landing().classList.contains('is-hidden')).toBe(true);
    expect(pkZone().classList.contains('is-hidden')).toBe(false);
    expect(pkZone().textContent).toContain('Main luggage');
  });

  it('re-navigating with an intent while already mounted opens that list', async () => {
    initPrepare();
    const id = await packStore.create({ name: 'Second bag', containers: [], items: [] });
    expect(landing().classList.contains('is-hidden')).toBe(false);

    // app.ts fires this when a mounted view is re-activated with an intent.
    _pendingIntent = { listId: id };
    window.dispatchEvent(new CustomEvent('otr:nav-intent', { detail: { view: 'prep' } }));

    expect(pkZone().classList.contains('is-hidden')).toBe(false);
    expect(pkZone().textContent).toContain('Second bag');
  });

  it('returns to the landing after a trip switch re-init while an editor was open', async () => {
    initPrepare();
    const id = await checklistStore.create({ name: 'Paris Prep', groups: [] });
    document.querySelector<HTMLElement>(`[data-cl="${id}"]`)!.click();
    expect(landing().classList.contains('is-hidden')).toBe(true);

    // reinitForTripChange() re-runs the view init against the existing DOM.
    initPrepare();

    expect(landing().classList.contains('is-hidden')).toBe(false);
    expect(clZone().classList.contains('is-hidden')).toBe(true);
    expect(pkZone().classList.contains('is-hidden')).toBe(true);
    // The rebuilt landing reflects the new trip's data, and no editor markup
    // survives from the previous trip's session.
    expect(clZone().childElementCount).toBe(0);
    expect(document.querySelectorAll('.prepare-landing').length).toBe(1);
  });

  it('drops the previous store subscriptions on re-init instead of leaking them', async () => {
    initPrepare();
    const afterFirst = listeners.length;
    expect(afterFirst).toBeGreaterThan(0);

    initPrepare();
    initPrepare();

    // Every trip switch re-inits this view. Without teardown the listener
    // count would grow with each one, and every Firestore push would run the
    // render pipeline N times over.
    expect(listeners.length).toBe(afterFirst);

    await checklistStore.create({ name: 'Two', groups: [] });
    expect(rows('[data-cl]').length).toBe(1);
  });
});

describe('Checklist → Pack linkage', () => {
  async function seedBoth() {
    const clId = await checklistStore.create({
      name: 'Paris Prep',
      groups: [{ id: 'g1', name: 'Tech & Comms', icon: '📱', order: 0, items: [
        { id: 'i1', text: 'Charger', done: false, order: 0 },
        { id: 'i2', text: 'Adapter', done: false, order: 1 },
      ] }],
    });
    const pkId = await packStore.create({
      name: 'Main luggage',
      containers: [{ id: 'c1', label: 'Carry-on', kind: 'backpack', limitG: 8000, selfWeightG: 0 }],
      items: [],
    });
    return { clId, pkId };
  }

  it('sends an item to Unassigned, categorised from its group, and ticks it off', async () => {
    initPrepare();
    const { clId, pkId } = await seedBoth();
    document.querySelector<HTMLElement>(`[data-cl="${clId}"]`)!.click();

    clZone().querySelector<HTMLElement>('.send-to-pack-btn')!.click();

    await vi.waitFor(() => {
      const list = docs.get(`trips/t1/packLists/${pkId}`) as { items: Record<string, unknown>[] };
      expect(list.items).toHaveLength(1);
    });
    const list = docs.get(`trips/t1/packLists/${pkId}`) as { items: Record<string, unknown>[] };
    expect(list.items[0].name).toBe('Charger');
    // "Tech & Comms" → electronics, and it lands unassigned to a bag so its
    // weight isn't counted against any limit until the user places it.
    expect(list.items[0].category).toBe('electronics');
    expect(list.items[0].containerId).toBeNull();

    // The checklist item is now ticked off — deciding to bring it is done.
    const cl = docs.get(`trips/t1/checklists/${clId}`) as { groups: { items: { id: string; done: boolean }[] }[] };
    expect(cl.groups[0].items.find(i => i.id === 'i1')!.done).toBe(true);
    expect(cl.groups[0].items.find(i => i.id === 'i2')!.done).toBe(false);
  });

  it('surfaces the new pack item on the landing rail', async () => {
    initPrepare();
    const { clId } = await seedBoth();
    document.querySelector<HTMLElement>(`[data-cl="${clId}"]`)!.click();
    clZone().querySelector<HTMLElement>('.send-to-pack-btn')!.click();
    await vi.waitFor(() => expect(clZone().querySelectorAll('.send-to-pack-btn').length).toBe(1));

    clZone().querySelector<HTMLElement>('#back-to-list')!.click();

    expect(document.querySelector('[data-pk] .prep-row-sub')!.textContent).toContain('1');
    expect(document.querySelector('[data-cl] .prep-row-meta')!.textContent).toContain('1/2');
  });

  it('offers no pack action when there is no pack list to receive the item', async () => {
    initPrepare();
    const clId = await checklistStore.create({
      name: 'Solo',
      groups: [{ id: 'g1', name: 'Documents', icon: '📄', order: 0, items: [
        { id: 'i1', text: 'Passport', done: false, order: 0 },
      ] }],
    });
    document.querySelector<HTMLElement>(`[data-cl="${clId}"]`)!.click();

    expect(clZone().querySelector('.send-to-pack-btn')).toBeNull();
  });

  it('offers no pack action on an already-ticked item', async () => {
    initPrepare();
    const { clId } = await seedBoth();
    await checklistStore.toggleItem(clId, 'g1', 'i1');
    document.querySelector<HTMLElement>(`[data-cl="${clId}"]`)!.click();

    const buttons = clZone().querySelectorAll('.send-to-pack-btn');
    expect(buttons.length).toBe(1);   // only the outstanding item keeps it
  });

  it('celebrates when the sent item was the last one outstanding', async () => {
    initPrepare();
    const clId = await checklistStore.create({
      name: 'Nearly done',
      groups: [{ id: 'g1', name: 'Tech', icon: '📱', order: 0, items: [
        { id: 'i1', text: 'Charger', done: false, order: 0 },
      ] }],
    });
    await packStore.create({ name: 'Bag', containers: [], items: [] });
    document.querySelector<HTMLElement>(`[data-cl="${clId}"]`)!.click();

    clZone().querySelector<HTMLElement>('.send-to-pack-btn')!.click();

    await vi.waitFor(() => expect(clZone().querySelector('.celebrate-screen')).not.toBeNull());
    // Still a focused screen, so the landing stays hidden behind it.
    expect(landing().classList.contains('is-hidden')).toBe(true);
  });
});

describe('Prepare landing — Core Kit screen', () => {
  it('opens as its own full-page screen and returns to the landing', async () => {
    initPrepare();
    await packStore.create({ name: 'Bag', containers: [], items: [] });

    document.querySelector<HTMLElement>('[data-act="kit"]')!.click();

    expect(landing().classList.contains('is-hidden')).toBe(true);
    expect(pkZone().classList.contains('is-hidden')).toBe(false);
    expect(pkZone().querySelector('#pk-kit-add-row')).not.toBeNull();

    pkZone().querySelector<HTMLElement>('#pk-kit-back')!.click();
    expect(landing().classList.contains('is-hidden')).toBe(false);
  });
});
