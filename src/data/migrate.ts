/* ==========================================================================
   On the Road · localStorage → Firestore migration
   --------------------------------------------------------------------------
   Runs once after first sign-in. For each feature, if the cloud collection is
   empty, push whatever lives in the old localStorage key. Non-destructive:
   old keys are kept (renamed to *:migrated) so nothing is lost if this errors.
   ========================================================================== */

import { createCollectionStore } from '../firebase/db.ts';
import { currentTripId } from './trip-context.ts';
import {
  PrepTaskSchema, LegSchema, ExpenseSchema, CityIntelSchema,
} from './schema.ts';

const MIGRATED_FLAG = 'otr:migrated:v1';

const OLD_KEYS = {
  prep: 'otr:prep:tasks',
  route: 'otr:route:legs',
  expenses: 'otr:expenses',
  cities: 'otr:cities',
} as const;

function readOld<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function archive(key: string) {
  const raw = localStorage.getItem(key);
  if (raw != null) {
    localStorage.setItem(`${key}:migrated`, raw);
    localStorage.removeItem(key);
  }
}

async function migrateCollection<S extends Parameters<typeof createCollectionStore>[2]>(
  name: string,
  schema: S,
  oldKey: string,
  normalize: (row: any, i: number) => object,
) {
  const store = createCollectionStore(currentTripId(), name, schema);
  const cloud = await store.list();
  if (cloud.length > 0) { archive(oldKey); return 0; }  // cloud wins; just clear old

  const old = readOld<any>(oldKey);
  if (old.length === 0) return 0;

  await store.bulkSet(old.map(normalize));
  archive(oldKey);
  return old.length;
}

/** Idempotent. Safe to call on every sign-in. */
export async function runMigration(): Promise<void> {
  if (localStorage.getItem(MIGRATED_FLAG)) return;

  await migrateCollection('prepTasks', PrepTaskSchema, OLD_KEYS.prep, (t, i) => ({
    id: t.id, text: t.text, note: t.note, done: !!t.done,
    category: t.category, phase: t.phase, order: i,
  }));

  await migrateCollection('legs', LegSchema, OLD_KEYS.route, (l, i) => ({
    id: l.id, city: l.city, country: l.country, flag: l.flag,
    dateFrom: l.dateFrom, dateTo: l.dateTo,
    accommodation: l.accommodation, arrivalTransport: l.arrivalTransport,
    notes: l.notes, order: i,
  }));

  await migrateCollection('expenses', ExpenseSchema, OLD_KEYS.expenses, (e) => ({
    id: e.id, amount: e.amount, currency: e.currency, amountEur: e.amountEur,
    description: e.description, category: e.category, city: e.city, date: e.date,
  }));

  await migrateCollection('cityIntel', CityIntelSchema, OLD_KEYS.cities, (c) => ({
    id: c.id, city: c.city, country: c.country, flag: c.flag,
    bannerColor: c.bannerColor, greetings: c.greetings, customs: c.customs,
    taboos: c.taboos, neighborhoods: c.neighborhoods, localFood: c.localFood,
    hiddenGems: c.hiddenGems, safetyTips: c.safetyTips, transport: c.transport,
  }));

  localStorage.setItem(MIGRATED_FLAG, String(Date.now()));
}
