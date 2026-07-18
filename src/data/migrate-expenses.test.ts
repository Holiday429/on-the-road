import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal localStorage polyfill — this suite runs under vitest's node
// environment, which has no DOM/storage globals. migrate-expenses.ts reads
// legacy data via the real Web Storage API, so stub just enough of it.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}
vi.stubGlobal('localStorage', new MemoryStorage());

const list = vi.fn();
const set = vi.fn();

vi.mock('../firebase/db.ts', () => ({
  createCollectionStore: () => ({ list, set }),
}));
vi.mock('./trip-context.ts', () => ({
  currentTripId: () => 'trip1',
}));

const LEGACY_KEY = 'otr:expenses';

function setLegacy(rows: unknown[] | null) {
  if (rows === null) localStorage.removeItem(LEGACY_KEY);
  else localStorage.setItem(LEGACY_KEY, JSON.stringify(rows));
}

beforeEach(() => {
  vi.resetModules();
  list.mockReset();
  set.mockReset();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('migrateExpensesToCloud', () => {
  it('is idempotent: does nothing when the cloud collection already has data', async () => {
    list.mockResolvedValue([{ id: 'e1' }]);
    setLegacy([{ amount: 10, currency: 'USD', amountEur: 9, description: 'x', category: 'food', date: '2026-01-01' }]);
    const { migrateExpensesToCloud } = await import('./migrate-expenses');
    const n = await migrateExpensesToCloud();
    expect(n).toBe(0);
    expect(set).not.toHaveBeenCalled();
  });

  it('does nothing when there is no legacy localStorage data', async () => {
    list.mockResolvedValue([]);
    setLegacy(null);
    const { migrateExpensesToCloud } = await import('./migrate-expenses');
    const n = await migrateExpensesToCloud();
    expect(n).toBe(0);
    expect(set).not.toHaveBeenCalled();
  });

  it('uploads legacy rows and recovers the original→EUR rate from amountEur/amount', async () => {
    list.mockResolvedValue([]);
    setLegacy([
      { id: 'legacy-1', amount: 100, currency: 'USD', amountEur: 92, description: 'Hotel', category: 'stay', date: '2026-01-02' },
    ]);
    const { migrateExpensesToCloud } = await import('./migrate-expenses');
    const n = await migrateExpensesToCloud();
    expect(n).toBe(1);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      id: 'legacy-1',
      amount: 100,
      currency: 'USD',
      rate: 0.92,
      baseAmount: 92,
      baseCurrency: 'EUR',
    }));
  });

  it('falls back to rate=1 and baseAmount=amount when amountEur is missing/non-finite', async () => {
    list.mockResolvedValue([]);
    // amountEur omitted entirely — Number(undefined) is NaN, the real-world
    // shape of a legacy row that never had the field.
    setLegacy([
      { amount: 50, currency: 'EUR', description: '', category: '', date: '2026-01-03' },
    ]);
    const { migrateExpensesToCloud } = await import('./migrate-expenses');
    await migrateExpensesToCloud();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ rate: 1, baseAmount: 50 }));
  });

  it('skips malformed localStorage JSON instead of throwing', async () => {
    list.mockResolvedValue([]);
    localStorage.setItem(LEGACY_KEY, '{not json');
    const { migrateExpensesToCloud } = await import('./migrate-expenses');
    await expect(migrateExpensesToCloud()).resolves.toBe(0);
    expect(set).not.toHaveBeenCalled();
  });
});
