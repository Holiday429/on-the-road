import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every migration is mocked: these tests cover the scheduling contract (which
// steps run, when completion is recorded), not what each migration moves.
const m = vi.hoisted(() => ({
  multi: vi.fn(async () => 0),
  collab: vi.fn(async () => ({ trips: 0, docs: 0 })),
  publicView: vi.fn(async () => 0),
  route: vi.fn(async () => 0),
  expenses: vi.fn(async () => 0),
  stays: vi.fn(async () => 0),
  cityShared: vi.fn(async () => 0),
  journal: vi.fn(async () => 0),
  mark: vi.fn(async () => {}),
  flags: { collab: true, multi: true, publicView: true },
}));

vi.mock('./data/trip-context.ts', () => ({
  checkAndAcceptEmailInvites: vi.fn(async () => 0),
  markAccountMigrationsDone: m.mark,
}));
vi.mock('./data/migrate-multitrip.ts', () => ({ migrateMultiTrip: m.multi, isMultiTripMigrated: () => m.flags.multi }));
vi.mock('./data/migrate-collab.ts', () => ({ migrateCollab: m.collab, isCollabMigrated: () => m.flags.collab }));
vi.mock('./data/migrate-publicview.ts', () => ({ migratePublicView: m.publicView, isPublicViewMigrated: () => m.flags.publicView }));
vi.mock('./data/migrate-route.ts', () => ({ migrateRouteToCloud: m.route }));
vi.mock('./data/migrate-expenses.ts', () => ({ migrateExpensesToCloud: m.expenses }));
vi.mock('./data/migrate-stays.ts', () => ({ migrateStaysToCompares: m.stays }));
vi.mock('./data/migrate-city-shared.ts', () => ({ migrateCityShared: m.cityShared }));
vi.mock('./data/migrate-journal-templates.ts', () => ({ migrateJournalTemplatesToTags: m.journal }));

import { ACCOUNT_MIGRATIONS_VERSION, runMigrations } from './boot-migrations.ts';

const accountSteps = [m.multi, m.collab, m.publicView, m.stays, m.cityShared, m.journal];
const deviceSteps = [m.route, m.expenses];

beforeEach(() => {
  vi.clearAllMocks();
  m.flags.collab = m.flags.multi = m.flags.publicView = true;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('runMigrations', () => {
  it('runs every step and records completion when all account steps finish', async () => {
    const r = await runMigrations({ skipAccountLevel: false });
    [...accountSteps, ...deviceSteps].forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
    expect(r.accountComplete).toBe(true);
    expect(m.mark).toHaveBeenCalledWith(ACCOUNT_MIGRATIONS_VERSION);
  });

  it('skipAccountLevel drops account steps but still runs the per-device ones, and records nothing', async () => {
    const r = await runMigrations({ skipAccountLevel: true });
    accountSteps.forEach((fn) => expect(fn).not.toHaveBeenCalled());
    deviceSteps.forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
    expect(r.accountComplete).toBe(false);
    expect(m.mark).not.toHaveBeenCalled();
  });

  it('does not record completion when an account step throws', async () => {
    m.stays.mockRejectedValueOnce(new Error('permission-denied'));
    const r = await runMigrations({ skipAccountLevel: false });
    expect(r.accountComplete).toBe(false);
    expect(m.mark).not.toHaveBeenCalled();
    // later steps still ran — one failure must not abort the rest
    expect(m.cityShared).toHaveBeenCalled();
    expect(m.journal).toHaveBeenCalled();
  });

  it.each(['collab', 'multi', 'publicView'] as const)(
    'does not record completion when the %s done-flag is missing (silent failure)',
    async (flag) => {
      m.flags[flag] = false;
      const r = await runMigrations({ skipAccountLevel: false });
      expect(r.accountComplete).toBe(false);
      expect(m.mark).not.toHaveBeenCalled();
    },
  );

  it('a failing per-device step does not block recording the account completion', async () => {
    m.route.mockRejectedValueOnce(new Error('offline'));
    const r = await runMigrations({ skipAccountLevel: false });
    expect(r.accountComplete).toBe(true);
    expect(m.mark).toHaveBeenCalledTimes(1);
  });

  it('reports dataChanged when any step moved something', async () => {
    m.collab.mockResolvedValueOnce({ trips: 1, docs: 4 });
    expect((await runMigrations({ skipAccountLevel: false })).dataChanged).toBe(true);
    expect((await runMigrations({ skipAccountLevel: false })).dataChanged).toBe(false);
  });

  it('runs steps in dependency order: multi-trip → collab → … → route before city-shared', async () => {
    const order: string[] = [];
    const track = (n: string, v: unknown) => async () => { order.push(n); return v as never; };
    m.multi.mockImplementationOnce(track('multi', 0));
    m.collab.mockImplementationOnce(track('collab', { trips: 0, docs: 0 }));
    m.route.mockImplementationOnce(track('route', 0));
    m.cityShared.mockImplementationOnce(track('cityShared', 0));
    await runMigrations({ skipAccountLevel: false });
    expect(order).toEqual(['multi', 'collab', 'route', 'cityShared']);
  });
});
