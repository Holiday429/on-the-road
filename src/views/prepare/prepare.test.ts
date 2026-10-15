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
// setViewHome is the shell's: a view registers "my page title goes back to my
// landing", and the top bar draws that title as a button (see view-home.test.ts
// and topbar.ts). Here the mock stands in for the registry so these tests can
// press the title exactly as a user would.
const _viewHome = new Map<string, () => void>();
vi.mock('../../core/app.ts', () => ({
  consumeNavIntent: () => { const i = _pendingIntent; _pendingIntent = null; return i; },
  setViewHome: (id: string, fn: (() => void) | null) => {
    if (fn) _viewHome.set(id, fn); else _viewHome.delete(id);
  },
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
  _viewHome.clear();
}
/** Press the page title — the way back out of an editor, drawn by the top bar. */
const goBack = () => {
  const fn = _viewHome.get('prep');
  if (!fn) throw new Error('the page title is not offering a way back');
  fn();
};
/** Whether the title is currently offering that way back. */
const titleGoesBack = () => _viewHome.has('prep');
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

const GROUP = (items: { id: string; text: string; done?: boolean }[], over: Partial<{ id: string; name: string; icon: string; order: number }> = {}) => ({
  id: 'g1', name: 'Docs', icon: '📋', order: 0, ...over,
  items: items.map((i, n) => ({ id: i.id, text: i.text, done: false, order: n })),
});
const clipNames = () => rows('.prep-clip-name').map(el => el.textContent);
const clickScene = (sel: string) => document.querySelector<HTMLElement>(sel)!.click();

describe('Prepare landing — scenes read live store data', () => {
  it('starts with two empty scenes that are themselves the "new" buttons, then draws the clipboard', async () => {
    initPrepare();

    expect(document.querySelector('.prep-scene--cl.is-empty .prep-clip[data-act="new-cl"]')).not.toBeNull();
    expect(document.querySelector('.prep-scene--pk.is-empty .prep-floor[data-act="new-pk"]')).not.toBeNull();
    expect(document.querySelector('[data-open-cl]')).toBeNull();

    const id = await checklistStore.create({
      name: 'Paris Prep',
      groups: [GROUP([{ id: 'i1', text: 'Passport' }, { id: 'i2', text: 'Visa' }])],
    });
    // create() always stores items unticked, so tick one the way the UI does.
    await checklistStore.toggleItem(id, 'g1', 'i1');

    expect(document.querySelector('.prep-scene--cl.is-empty')).toBeNull();
    expect(clipNames()).toEqual(['Paris Prep']);
    // Progress is computed from the stored items, not a placeholder.
    expect(document.querySelector('.prep-clip-count')!.textContent).toBe('1/2');
    // Only what is still to do is on the clipboard.
    const clip = document.querySelector('.prep-clip')!.textContent!;
    expect(clip).toContain('Visa');
    expect(clip).not.toContain('Passport');
  });

  it('draws bags on the floor, flags an over-limit bag, and raises the banner alert', async () => {
    initPrepare();

    await packStore.create({
      name: 'Main luggage',
      containers: [{ id: 'c1', label: 'Carry-on', kind: 'backpack', limitG: 1000, selfWeightG: 0 }],
      items: [
        packItem({ id: 'p1', name: 'Boots', unitWeightG: 900, containerId: 'c1', order: 0 }),
        packItem({ id: 'p2', name: 'Book', unitWeightG: 400, containerId: 'c1', order: 1 }),
      ],
    });

    // 1300g in a 1000g bag → over limit: the bag, the banner stat and the alert all say so.
    expect(document.querySelector('.prep-bag[data-over="true"]')).not.toBeNull();
    expect(document.querySelector('.prep-hero-stat.is-warn')).not.toBeNull();
    expect(document.querySelector('#prep-hero-alert.is-over')).not.toBeNull();
    // The old status card, list rows and delete buttons are gone — the scene is the only way in.
    expect(document.querySelector('.prep-status, .prep-row, [data-del-pk]')).toBeNull();
  });

  it('aggregates both sections into the banner', async () => {
    initPrepare();
    const clId = await checklistStore.create({
      name: 'A',
      groups: [GROUP([{ id: 'i1', text: 'x' }, { id: 'i2', text: 'y' }, { id: 'i3', text: 'z' }])],
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
    expect(document.querySelector('.prep-hero-stat-meta')!.textContent).toBe('1 list');   // singular
  });

  it('a clipboard is always four lines, and says what is not shown', async () => {
    initPrepare();
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(x => ({ id: `i${x}`, text: `item-${x}` }));
    await checklistStore.create({ name: 'Long', groups: [GROUP(six)] });

    expect(rows('.prep-clip-row').length).toBe(4);
    expect(document.querySelector('.prep-clip-row.is-more')!.textContent).toContain('+3');
    expect(document.querySelector('.prep-clip')!.textContent).toContain('item-c');
    expect(document.querySelector('.prep-clip')!.textContent).not.toContain('item-d');
  });

  it('a list with nothing ticked off the end shows the stamp, not an empty page', async () => {
    initPrepare();
    const id = await checklistStore.create({ name: 'Done', groups: [GROUP([{ id: 'i1', text: 'Passport' }])] });
    await checklistStore.toggleItem(id, 'g1', 'i1');

    expect(document.querySelector('.prep-scene--cl.is-complete .prep-clip-stamp')).not.toBeNull();
    expect(rows('.prep-clip-row').length).toBe(4);
    expect(document.querySelector('.prep-clip')!.textContent).toContain('Passport');   // the done item, struck
  });

  it('an empty list says so on the clipboard', async () => {
    initPrepare();
    await checklistStore.create({ name: 'Blank', groups: [] });
    expect(document.querySelector('.prep-clip .prep-scene-hint')).not.toBeNull();
    expect(rows('.prep-clip-row').length).toBe(4);
  });

  it('the list with the most left to do is the one in front, and the chip steps between lists', async () => {
    initPrepare();
    await checklistStore.create({ name: 'Nearly', groups: [GROUP([{ id: 'i1', text: 'one' }])] });
    await checklistStore.create({ name: 'Lots', groups: [GROUP([{ id: 'i1', text: 'one' }, { id: 'i2', text: 'two' }, { id: 'i3', text: 'three' }])] });

    expect(clipNames()).toEqual(['Lots']);
    expect(document.querySelector('.prep-switch-n')!.textContent).toBe('2/2');

    document.querySelector<HTMLElement>('[data-switch="cl"] [data-switch-step="1"]')!.click();
    expect(clipNames()).toEqual(['Nearly']);
    expect(document.querySelector<HTMLElement>('.prep-clip')!.dataset.openCl).toBeTruthy();
  });

  it('more than three bags: the heaviest three stand on the floor, a tag counts the rest', async () => {
    initPrepare();
    const bag = (n: number) => ({ id: `c${n}`, label: `Bag ${n}`, kind: 'suitcase' as const, limitG: 0, selfWeightG: n * 100 });
    await packStore.create({ name: 'Big trip', containers: [1, 2, 3, 4, 5].map(bag), items: [] });

    expect(rows('.prep-bag').length).toBe(3);
    expect(document.querySelector('.prep-bag-tag')!.textContent).toContain('+2');
  });

  it('a pack list with no bags shows the empty suitcase outline and opens the list', async () => {
    initPrepare();
    const id = await packStore.create({ name: 'Empty', containers: [], items: [] });

    expect(document.querySelector('.prep-scene--pk.is-empty .lg-bag.is-ghost')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('.prep-floor')!.dataset.openPk).toBe(id);
    expect(document.querySelector('.prep-scene--pk [data-weigh-pk]')).toBeNull();   // nothing to weigh
    expect(document.querySelector('#prep-hero-alert')).toBeNull();
  });

  it('bags that were never weighed raise the banner alert, and it leads to the weigh-in', async () => {
    initPrepare();
    const id = await packStore.create({
      name: 'Main luggage',
      containers: [
        { id: 'c1', label: 'Carry-on', kind: 'backpack', limitG: 8000, selfWeightG: 0 },
        { id: 'c2', label: 'Check-in', kind: 'suitcase', limitG: 20000, selfWeightG: 0 },
      ],
      items: [packItem({ id: 'p1', name: 'Boots', unitWeightG: 900, containerId: 'c1', order: 0 })],
    });

    const alert = document.querySelector<HTMLElement>('#prep-hero-alert')!;
    expect(alert.dataset.alert).toBe('weigh');
    expect(alert.dataset.alertList).toBe(id);
    expect(alert.textContent).toContain('2 not weighed');

    alert.click();
    expect(pkZone().classList.contains('is-hidden')).toBe(false);
    expect(pkZone().querySelectorAll('.pkd-bag').length).toBe(2);
  });
});

describe('Prepare landing — a scene hands the page to an editor', () => {
  it('opens the checklist editor full-page and returns on Back', async () => {
    initPrepare();
    const id = await checklistStore.create({ name: 'Paris Prep', groups: [GROUP([])] });

    clickScene(`[data-open-cl="${id}"]`);

    expect(landing().classList.contains('is-hidden')).toBe(true);
    expect(clZone().classList.contains('is-hidden')).toBe(false);
    expect(pkZone().classList.contains('is-hidden')).toBe(true);
    // No back control inside the editor: the page title took that job.
    expect(clZone().querySelector('#back-to-list, .prep-crumb')).toBeNull();
    expect(titleGoesBack()).toBe(true);

    goBack();

    expect(landing().classList.contains('is-hidden')).toBe(false);
    expect(clZone().classList.contains('is-hidden')).toBe(true);
    expect(clZone().childElementCount).toBe(0); // editor torn down
    expect(titleGoesBack()).toBe(false);        // back on the landing, a plain heading again
  });

  it('opens the pack editor full-page and returns on Back', async () => {
    initPrepare();
    const id = await packStore.create({ name: 'Main luggage', containers: [], items: [] });

    clickScene(`[data-open-pk="${id}"]`);

    expect(landing().classList.contains('is-hidden')).toBe(true);
    expect(pkZone().classList.contains('is-hidden')).toBe(false);
    expect(pkZone().querySelector('#pk-back, .prep-crumb')).toBeNull();
    expect(titleGoesBack()).toBe(true);

    goBack();

    expect(landing().classList.contains('is-hidden')).toBe(false);
    expect(pkZone().classList.contains('is-hidden')).toBe(true);
  });

  it('Escape goes back from a checklist, but is spent on an open menu first', async () => {
    initPrepare();
    const id = await checklistStore.create({ name: 'Paris Prep', groups: [GROUP([])] });
    clickScene(`[data-open-cl="${id}"]`);

    clZone().querySelector<HTMLElement>('[data-menu-btn]')!.click();
    expect(clZone().querySelector('.prep-menu.is-open')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(clZone().querySelector('.prep-menu.is-open')).toBeNull();
    expect(landing().classList.contains('is-hidden')).toBe(true);   // still inside

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(landing().classList.contains('is-hidden')).toBe(false);
  });

  it('reflects edits made inside an editor once back on the landing', async () => {
    initPrepare();
    const id = await checklistStore.create({ name: 'Paris Prep', groups: [GROUP([{ id: 'i1', text: 'Passport' }])] });
    expect(document.querySelector('.prep-clip-count')!.textContent).toBe('0/1');

    clickScene(`[data-open-cl="${id}"]`);
    await checklistStore.toggleItem(id, 'g1', 'i1');   // tick it off in the editor
    // Completing the last item shows the celebration; leave through its back link.
    goBack();

    expect(document.querySelector('.prep-clip-count')!.textContent).toBe('1/1');
    expect(document.querySelector('.prep-scene--cl.is-complete')).not.toBeNull();
  });

  it('falls back to the landing if the open list is deleted elsewhere', async () => {
    initPrepare();
    const id = await packStore.create({ name: 'Main luggage', containers: [], items: [] });
    clickScene(`[data-open-pk="${id}"]`);
    expect(landing().classList.contains('is-hidden')).toBe(true);

    await packStore.remove(id);   // e.g. removed on another device

    expect(landing().classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('.prep-scene--pk.is-empty')).not.toBeNull();
  });
});

describe('Prepare — the page title is the only way back', () => {
  it('offers no way back from the landing itself', async () => {
    initPrepare();
    await checklistStore.create({ name: 'Paris Prep', groups: [GROUP([])] });
    expect(titleGoesBack()).toBe(false);
  });

  it('leaves the Core Kit screen too, not just the editors', async () => {
    initPrepare();
    await packStore.create({ name: 'Bag', containers: [], items: [] });
    document.querySelector<HTMLElement>('[data-act="kit"]')!.click();
    expect(pkZone().querySelector('#pk-kit-back')).toBeNull();   // no back button of its own
    expect(titleGoesBack()).toBe(true);

    goBack();
    expect(landing().classList.contains('is-hidden')).toBe(false);
    expect(titleGoesBack()).toBe(false);
  });

  it('stops offering it once the open list is deleted elsewhere', async () => {
    initPrepare();
    const id = await packStore.create({ name: 'Main luggage', containers: [], items: [] });
    clickScene(`[data-open-pk="${id}"]`);
    expect(titleGoesBack()).toBe(true);

    await packStore.remove(id);
    expect(titleGoesBack()).toBe(false);
  });
});

describe('Prepare editors — deleting lives in the ⋯ menu', () => {
  it('deletes the checklist from its editor and lands back on an empty Prepare', async () => {
    vi.stubGlobal('confirm', () => true);
    initPrepare();
    const id = await checklistStore.create({ name: 'Temp', groups: [] });
    clickScene(`[data-open-cl="${id}"]`);

    clZone().querySelector<HTMLElement>('[data-act="delete-cl"]')!.click();
    await vi.waitFor(() => expect(landing().classList.contains('is-hidden')).toBe(false));

    expect(document.querySelector('.prep-scene--cl.is-empty')).not.toBeNull();
  });

  it('keeps the checklist when the confirmation is declined', async () => {
    vi.stubGlobal('confirm', () => false);
    initPrepare();
    const id = await checklistStore.create({ name: 'Temp', groups: [] });
    clickScene(`[data-open-cl="${id}"]`);

    clZone().querySelector<HTMLElement>('[data-act="delete-cl"]')!.click();
    await Promise.resolve();

    expect(clZone().classList.contains('is-hidden')).toBe(false);
    expect(docs.get(`trips/t1/checklists/${id}`)).toBeDefined();
  });

  it('deletes a pack list from its editor', async () => {
    vi.stubGlobal('confirm', () => true);
    initPrepare();
    const id = await packStore.create({ name: 'Main luggage', containers: [], items: [] });
    clickScene(`[data-open-pk="${id}"]`);

    pkZone().querySelector<HTMLElement>('[data-act="delete-pk"]')!.click();
    await vi.waitFor(() => expect(landing().classList.contains('is-hidden')).toBe(false));

    expect(document.querySelector('.prep-scene--pk.is-empty')).not.toBeNull();
  });
});

describe('Prepare landing — create flows via the shared modal', () => {
  const modal = () => document.querySelector<HTMLElement>('.otr-modal')!;

  it('creates a checklist from the empty clipboard and lands in its editor', async () => {
    initPrepare();
    // The empty scene is the call to action.
    clickScene('.prep-scene--cl.is-empty .prep-clip');

    // The dialog is attached to document.body, so a store push can't wipe it.
    expect(modal().closest('body')).toBe(document.body);
    modal().querySelector<HTMLInputElement>('#new-checklist-name')!.value = 'Iceland Prep';
    modal().querySelector<HTMLElement>('[data-act="confirm"]')!.click();

    await vi.waitFor(() => expect(clZone().classList.contains('is-hidden')).toBe(false));
    expect(document.querySelector('.otr-modal')).toBeNull();  // closed after create
    expect(landing().classList.contains('is-hidden')).toBe(true);

    goBack();
    expect(clipNames()).toEqual(['Iceland Prep']);
  });

  it('the "+ New" menu offers the same actions, bound once', async () => {
    initPrepare();
    const items = rows('#prep-rail-checklist .prep-menu-item').map(el => el.dataset.act);
    expect(items).toEqual(['new-cl', 'tpl']);

    document.querySelector<HTMLElement>('#prep-rail-checklist [data-menu-btn]')!.click();
    expect(document.querySelector('#prep-rail-checklist .prep-menu.is-open')).not.toBeNull();
    document.querySelector<HTMLElement>('#prep-rail-checklist [data-act="new-cl"]')!.click();
    expect(document.querySelectorAll('.otr-modal').length).toBe(1);   // not opened twice
    expect(document.querySelector('.prep-menu.is-open')).toBeNull();
  });

  it('creates a pack list and lands in its editor', async () => {
    initPrepare();
    clickScene('.prep-scene--pk.is-empty .prep-floor');

    modal().querySelector<HTMLInputElement>('#pk-new-name')!.value = 'Cabin bag';
    modal().querySelector<HTMLElement>('[data-act="confirm"]')!.click();

    await vi.waitFor(() => expect(pkZone().classList.contains('is-hidden')).toBe(false));
    goBack();
    expect(document.querySelector<HTMLElement>('.prep-floor')!.dataset.openPk).toBeTruthy();
    expect(document.querySelector('.prep-scene--pk')!.textContent).toContain('Cabin bag');   // its name on the switcher-less scene's label
  });

  it('survives a store refresh while "Save as Template" is open', async () => {
    initPrepare();
    const id = await checklistStore.create({ name: 'Paris Prep', groups: [GROUP([])] });
    clickScene(`[data-open-cl="${id}"]`);
    clZone().querySelector<HTMLElement>('[data-act="save-tpl"]')!.click();

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

  it('keeps a standalone checklist on the landing alongside trip-scoped ones', async () => {
    initPrepare();
    clickScene('.prep-scene--cl.is-empty .prep-clip');
    modal().querySelector<HTMLInputElement>('#new-checklist-name')!.value = 'Not tied to a trip';
    modal().querySelector<HTMLInputElement>('input[name="cl-scope"][value="standalone"]')!.checked = true;
    modal().querySelector<HTMLElement>('[data-act="confirm"]')!.click();

    await vi.waitFor(() => expect(clZone().classList.contains('is-hidden')).toBe(false));
    goBack();
    // Stored under the standalone trip, still surfaced on this trip's landing.
    expect([...docs.keys()].some(k => k.startsWith('trips/standalone/checklists/'))).toBe(true);
    expect(clipNames()).toEqual(['Not tied to a trip']);
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
    clickScene(`[data-open-cl="${id}"]`);
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
    expect(rows('.prep-clip[data-open-cl]').length).toBe(1);
  });
});

describe('Checklist → Pack linkage', () => {
  async function seedBoth() {
    const clId = await checklistStore.create({
      name: 'Paris Prep',
      groups: [GROUP([{ id: 'i1', text: 'Charger' }, { id: 'i2', text: 'Adapter' }], { name: 'Tech & Comms', icon: '📱' })],
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
    clickScene(`[data-open-cl="${clId}"]`);

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

  it('shows the ticked item on the landing clipboard afterwards', async () => {
    initPrepare();
    const { clId } = await seedBoth();
    clickScene(`[data-open-cl="${clId}"]`);
    clZone().querySelector<HTMLElement>('.send-to-pack-btn')!.click();
    await vi.waitFor(() => expect(clZone().querySelectorAll('.send-to-pack-btn').length).toBe(1));

    goBack();

    expect(document.querySelector('.prep-clip-count')!.textContent).toBe('1/2');
  });

  it('offers no pack action when there is no pack list to receive the item', async () => {
    initPrepare();
    const clId = await checklistStore.create({
      name: 'Solo',
      groups: [GROUP([{ id: 'i1', text: 'Passport' }], { name: 'Documents', icon: '📄' })],
    });
    clickScene(`[data-open-cl="${clId}"]`);

    expect(clZone().querySelector('.send-to-pack-btn')).toBeNull();
  });

  it('offers no pack action on an already-ticked item', async () => {
    initPrepare();
    const { clId } = await seedBoth();
    await checklistStore.toggleItem(clId, 'g1', 'i1');
    clickScene(`[data-open-cl="${clId}"]`);

    const buttons = clZone().querySelectorAll('.send-to-pack-btn');
    expect(buttons.length).toBe(1);   // only the outstanding item keeps it
  });

  it('celebrates when the sent item was the last one outstanding', async () => {
    initPrepare();
    const clId = await checklistStore.create({
      name: 'Nearly done',
      groups: [GROUP([{ id: 'i1', text: 'Charger' }], { name: 'Tech', icon: '📱' })],
    });
    await packStore.create({ name: 'Bag', containers: [], items: [] });
    clickScene(`[data-open-cl="${clId}"]`);

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

    goBack();
    expect(landing().classList.contains('is-hidden')).toBe(false);
  });
});

describe('Checklist editor — one board, a left-pill, a combobox for new notes', () => {
  const two = () => ([
    GROUP([{ id: 'i1', text: 'Cold medicine' }, { id: 'i2', text: 'Painkillers' }], { id: 'gh', name: 'Health', icon: '💊', order: 0 }),
    GROUP([{ id: 'i3', text: 'Passport copy' }], { id: 'gd', name: 'Documents', icon: '📄', order: 1 }),
  ]);
  const open = async () => {
    initPrepare();
    const id = await checklistStore.create({ name: 'Europe', groups: two() });
    clickScene(`[data-open-cl="${id}"]`);
    return id;
  };

  it('has no filter chips any more, and no Next-up block in the middle of the page', async () => {
    await open();
    expect(clZone().querySelector('.group-preset-chip, .add-group-presets, .prep-next')).toBeNull();
    expect(clZone().querySelector('.prep-newnote')).not.toBeNull();
    expect(clZone().querySelector('.back-btn')).toBeNull();
  });

  it('the left-pill counts what is left and each chip jumps to its note', async () => {
    await open();
    const pill = clZone().querySelector('.prep-next-pill')!;
    expect(pill.textContent).toContain('3 left');
    const chips = [...pill.querySelectorAll<HTMLElement>('.prep-next-chip')];
    expect(chips.map(c => c.dataset.nuGroup)).toEqual(['gh', 'gd']);

    chips[1].click();
    expect(clZone().querySelector('.prep-group[data-group-id="gd"]')!.classList.contains('is-nudge')).toBe(true);
  });

  it('turns into a tick once everything is done', async () => {
    const id = await open();
    for (const [g, i] of [['gh', 'i1'], ['gh', 'i2'], ['gd', 'i3']]) await checklistStore.toggleItem(id, g, i);
    // all done → the celebration screen; go back to the editor-less landing is not needed: check the pill logic directly
    const { remainingByGroup } = await import('./checklist-section.ts');
    const cl = docs.get(`trips/t1/checklists/${id}`) as { groups: { id: string; name: string; icon: string; order: number; items: { done: boolean }[] }[] };
    expect(remainingByGroup(cl as never)).toEqual([]);
  });

  it('typing filters the presets, the ones already on the board are marked, Enter adds the highlighted one', async () => {
    const id = await open();
    const z = clZone();
    z.querySelector<HTMLElement>('#newnote-open')!.click();
    expect(z.querySelector('.prep-newnote')!.classList.contains('is-open')).toBe(true);

    const used = [...z.querySelectorAll<HTMLElement>('.prep-newnote-opt.is-used')].map(o => o.dataset.name);
    expect(used.sort()).toEqual(['Documents', 'Health']);

    const input = z.querySelector<HTMLInputElement>('#add-group-input')!;
    input.value = 'ins';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const visible = [...z.querySelectorAll<HTMLElement>('.prep-newnote-opt')].filter(o => !o.hidden).map(o => o.dataset.name);
    expect(visible).toEqual(['Insurance']);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => {
      const cl = docs.get(`trips/t1/checklists/${id}`) as { groups: { name: string; icon: string }[] };
      expect(cl.groups.map(g => g.name)).toContain('Insurance');
    });
    const cl = docs.get(`trips/t1/checklists/${id}`) as { groups: { name: string; icon: string }[] };
    expect(cl.groups.find(g => g.name === 'Insurance')!.icon).toBe('🛡️');
  });

  it('Enter with no highlighted preset adds the typed name as a custom note', async () => {
    const id = await open();
    const z = clZone();
    z.querySelector<HTMLElement>('#newnote-open')!.click();
    const input = z.querySelector<HTMLInputElement>('#add-group-input')!;
    input.value = 'Snacks';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => {
      const cl = docs.get(`trips/t1/checklists/${id}`) as { groups: { name: string }[] };
      expect(cl.groups.map(g => g.name)).toContain('Snacks');
    });
    // the tile folds away again after adding
    expect(clZone().querySelector('.prep-newnote')!.classList.contains('is-open')).toBe(false);
  });
});

describe('Pack editor — bags are drawn from their data', () => {
  const modal = () => document.querySelector<HTMLElement>('.otr-modal')!;

  it('adds a bag with the chosen kind, colour and size', async () => {
    initPrepare();
    const id = await packStore.create({ name: 'Main luggage', containers: [], items: [] });
    clickScene(`[data-open-pk="${id}"]`);

    pkZone().querySelector<HTMLElement>('#pk-open-add-bag')!.click();
    modal().querySelector<HTMLInputElement>('#pk-c-label')!.value = 'Weekender';
    modal().querySelector<HTMLElement>('.bagf-kind[data-kind="duffel"]')!.click();
    modal().querySelector<HTMLElement>('.bagf-swatch[data-tone="4"]')!.click();
    modal().querySelector<HTMLElement>('.bagf-size[data-size="L"]')!.click();
    // the live picture follows the choices
    expect(modal().querySelector('[data-preview] .lg-bag--duffel')!.getAttribute('data-tone')).toBe('4');
    modal().querySelector<HTMLElement>('[data-act="confirm"]')!.click();

    await vi.waitFor(() => {
      const l = docs.get(`trips/t1/packLists/${id}`) as { containers: Record<string, unknown>[] };
      expect(l.containers).toHaveLength(1);
    });
    const l = docs.get(`trips/t1/packLists/${id}`) as { containers: Record<string, unknown>[] };
    expect(l.containers[0]).toMatchObject({ label: 'Weekender', kind: 'duffel', tone: 4, size: 'L' });
  });

  it('a new bag starts on the next colour, so neighbours differ; size left on Auto is not stored as a choice', async () => {
    initPrepare();
    const id = await packStore.create({
      name: 'Main luggage',
      containers: [{ id: 'c1', label: 'One', kind: 'backpack', limitG: 0, selfWeightG: 0 }],
      items: [],
    });
    clickScene(`[data-open-pk="${id}"]`);
    pkZone().querySelector<HTMLElement>('#pk-open-add-bag')!.click();
    modal().querySelector<HTMLInputElement>('#pk-c-label')!.value = 'Two';
    modal().querySelector<HTMLElement>('[data-act="confirm"]')!.click();

    await vi.waitFor(() => {
      const l = docs.get(`trips/t1/packLists/${id}`) as { containers: Record<string, unknown>[] };
      expect(l.containers).toHaveLength(2);
    });
    const l = docs.get(`trips/t1/packLists/${id}`) as { containers: Record<string, unknown>[] };
    expect(l.containers[1].tone).toBe(1);
    expect(l.containers[1].size ?? null).toBeNull();
  });

  it('restyles an existing bag', async () => {
    initPrepare();
    const id = await packStore.create({
      name: 'Main luggage',
      containers: [{ id: 'c1', label: 'One', kind: 'backpack', limitG: 0, selfWeightG: 0 }],
      items: [],
    });
    clickScene(`[data-open-pk="${id}"]`);

    pkZone().querySelector<HTMLElement>('[data-edit-bag="c1"]')!.click();
    modal().querySelector<HTMLElement>('.bagf-swatch[data-tone="5"]')!.click();
    modal().querySelector<HTMLElement>('.bagf-size[data-size="S"]')!.click();
    modal().querySelector<HTMLElement>('[data-act="confirm"]')!.click();

    await vi.waitFor(() => {
      const l = docs.get(`trips/t1/packLists/${id}`) as { containers: Record<string, unknown>[] };
      expect(l.containers[0]).toMatchObject({ tone: 5, size: 'S' });
    });
    expect(pkZone().querySelector('.pkd-bag .lg-bag')!.getAttribute('data-tone')).toBe('5');
  });
});
