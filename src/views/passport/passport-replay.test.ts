// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { passportFor } from '../../data/passport.ts';
import { passportState } from '../../data/passport-state.ts';

const thunks = vi.fn();

vi.mock('./sound.ts', () => ({
  isSoundOn: () => true, setSoundOn: () => {}, playCover: () => {}, playFlip: () => {}, playThunk: (...a: unknown[]) => thunks(...a),
}));
vi.mock('../../firebase/auth.ts', () => ({ currentUser: () => null }));
vi.mock('../../core/app.ts', () => ({ consumeNavIntent: () => null, navigateTo: () => {} }));
vi.mock('../profile/profile-me.ts', () => ({ defaultNickname: () => 'Holiday' }));
vi.mock('./bio-edit.ts', () => ({ openBioEditor: () => {} }));
vi.mock('./visa-edit.ts', () => ({ openVisaEditor: () => {} }));
vi.mock('../../data/stores/journal-store.ts', () => ({ journalStore: { subscribeAll: () => () => {} } }));
vi.mock('../../data/stores/expense-store.ts', () => ({ expenseStore: { subscribeAll: () => () => {} } }));
vi.mock('../../data/stores/visa-store.ts', () => ({ visaStore: { subscribe: (cb: (r: unknown[]) => void) => { cb([]); return () => {}; } } }));
vi.mock('../../data/stores/safety-profile-store.ts', () => ({ safetyProfileStore: { subscribe: (cb: (r: unknown) => void) => { cb(null); return () => {}; } } }));
vi.mock('../../data/passport-feed.ts', async () => {
  const { feed } = await import('./passport-replay.fixture.ts');
  return { onPassport: (cb: (f: unknown) => void) => { cb(feed); return () => {}; }, peekFeedLegs: () => [] };
});
vi.mock('../../data/stores/passport-store.ts', async () => {
  const { placements } = await import('./passport-replay.fixture.ts');
  return {
    passportStore: { subscribe: (cb: (p: unknown) => void) => { cb({ placements }); return () => {}; }, save: async () => {}, peek: () => null },
    passportDocStore: { subscribe: () => () => {}, peek: () => null, save: async () => {} },
  };
});

void passportFor; void passportState;

const slots = () => [...document.querySelectorAll<HTMLElement>('.pp-slot[data-stamp]')];
const landed = () => document.querySelectorAll('.pp-slot[data-stamp] .pp-stamp.is-pressed').length;
const hidden = () => slots().filter((s) => s.hasAttribute('data-fresh')).length;
const replayButton = () => document.querySelector<HTMLButtonElement>('[data-pp-replay]')!;

/** The view wires its click handler once on its root, so the root stays and only the book inside is rebuilt. */
async function mount(): Promise<void> {
  if (!document.getElementById('view-passport')) {
    // eslint-disable-next-line no-restricted-syntax -- static test markup
    document.body.innerHTML = '<section id="view-passport"><div class="view-header"></div><div class="pp-body"></div></section>';
  }
  const { initPassport } = await import('./passport.ts');
  initPassport();
}

describe('replay', () => {
  beforeEach(() => { vi.useFakeTimers(); thunks.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('lifts every stamp off the pages first, then presses them back one at a time, one thunk each', async () => {
    await mount();
    const total = slots().length;
    expect(total).toBeGreaterThanOrEqual(6);
    expect(hidden()).toBe(0);                                  // before: all on the pages

    replayButton().click();
    await vi.advanceTimersByTimeAsync(100);
    expect(hidden()).toBe(total);                              // lifted off: nothing is on the pages
    expect(landed()).toBe(0);
    expect(thunks).not.toHaveBeenCalled();
    expect(replayButton().textContent).toBe('Stop');

    let sawPartial = false;
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(250);
      expect(thunks).toHaveBeenCalledTimes(landed());          // never a sound without a stamp landing
      if (landed() > 0 && landed() < total) sawPartial = true;
    }
    expect(sawPartial).toBe(true);
    expect(landed()).toBe(total);
    expect(hidden()).toBe(0);
    expect(thunks).toHaveBeenCalledTimes(total);               // and then the sound stops
    expect(replayButton().textContent).toBe('Replay');
    await vi.advanceTimersByTimeAsync(5000);
    expect(thunks).toHaveBeenCalledTimes(total);
  });

  it('Stop puts every stamp back at once and ends the sound', async () => {
    await mount();
    const total = slots().length;
    replayButton().click();
    await vi.advanceTimersByTimeAsync(2500);
    const sofar = thunks.mock.calls.length;
    replayButton().click();                                    // the same button, now "Stop"
    expect(hidden()).toBe(0);
    expect(slots()).toHaveLength(total);
    expect(replayButton().textContent).toBe('Replay');
    await vi.advanceTimersByTimeAsync(9000);
    expect(thunks).toHaveBeenCalledTimes(sofar);
  });
});
