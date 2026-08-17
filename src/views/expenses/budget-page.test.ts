// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ==========================================================================
   Budget overlay · cap persistence.

   Regression cover for the bug where only the FIRST cap you typed survived a
   reopen. Each cap <input> commits on `change`, which fires on blur — and that
   blur is normally the user clicking straight into the next cap field. The old
   handler re-rendered the whole page at that moment, replacing the element
   that had just taken focus, so the second value was typed into a detached
   node whose `change` listener no longer reached the store.

   These tests drive the real module against an in-memory trip-context, using
   the same focus-then-blur ordering the browser produces.
   ========================================================================== */

/* ── In-memory trip-context ──────────────────────────────────────────────── */

let countryCaps: Record<string, number> = {};
let categoryCaps: Record<string, number> = {};
let totalBudget: number | null = null;
let countryWrites = 0;

vi.mock('../../data/trip-context.ts', () => ({
  baseCurrency: () => 'EUR',
  tripBudget: () => totalBudget,
  setTripBudget: async (n: number | null) => { totalBudget = n; },
  countryBudgets: () => countryCaps,
  setCountryBudget: async (country: string, amount: number | null) => {
    countryWrites++;
    if (amount != null && amount > 0) countryCaps[country] = amount;
    else delete countryCaps[country];
  },
  categoryBudgets: () => categoryCaps,
  setCategoryBudget: async (id: string, amount: number | null) => {
    if (amount != null && amount > 0) categoryCaps[id] = amount;
    else delete categoryCaps[id];
  },
}));

// Pulls in expenseStore (Firestore) otherwise; only legCountries is needed.
vi.mock('./expense-defaults.ts', () => ({
  legCountries: (legs: { country?: string }[]) =>
    [...new Set(legs.map((l) => l.country).filter(Boolean))],
}));

const {
  initBudgetPage, openBudgetPage, closeBudgetPage, renderBudgetPage, isBudgetOpen,
} = await import('./budget-page.ts');

/* ── Harness ─────────────────────────────────────────────────────────────── */

const LEGS = [
  { country: 'Switzerland', flag: '🇨🇭', dateFrom: '2026-09-01', dateTo: '2026-09-08' },
  { country: 'Germany',     flag: '🇩🇪', dateFrom: '2026-09-08', dateTo: '2026-09-12' },
  { country: 'France',      flag: '🇫🇷', dateFrom: '2026-09-12', dateTo: '2026-09-19' },
] as never[];

const CATEGORIES = [
  { id: 'food',  label: 'Food',  icon: '🍜', color: '#f00', builtin: true },
  { id: 'stay',  label: 'Stay',  icon: '🏨', color: '#0f0', builtin: true },
  { id: 'train', label: 'Train', icon: '🚆', color: '#00f', builtin: true },
];

let renderFormCalls = 0;
let renderSummaryOnlyCalls = 0;

function setup() {
  countryCaps = {};
  categoryCaps = {};
  totalBudget = null;
  countryWrites = 0;
  renderFormCalls = 0;
  renderSummaryOnlyCalls = 0;
  // eslint-disable-next-line no-restricted-syntax -- audited: static test fixture, no interpolation
  document.body.innerHTML = `<div class="exp-budget-panel"></div>`;

  initBudgetPage({
    expenses: () => [],
    legs: () => LEGS,
    categories: () => CATEGORIES,
    inBase: () => 0,
    fmt: (n: number) => `€${Math.round(n)}`,
    renderSummaryOnly: () => { renderSummaryOnlyCalls++; },
    // The real one repaints the budget page when it is open. Mirroring that
    // here is what makes the regression reproducible.
    renderSummaryRoot: () => { if (isBudgetOpen()) renderBudgetPage(); },
    renderForm: () => { renderFormCalls++; },
  });
}

const capInputs = () =>
  [...document.querySelectorAll<HTMLInputElement>('.exp-budget-row-input')];

const inputFor = (attr: 'country' | 'cat', value: string) =>
  capInputs().find((i) => i.dataset[attr] === value)!;

/**
 * Fill several cap fields in one pass, in the ORDER a browser produces: the
 * user clicks into field B, and that focus is what blurs field A — so A's
 * `change` (and its async store write) runs while B is already focused and
 * holding typed text.
 *
 * The element is captured before the previous commit is awaited, and never
 * re-queried afterwards. That is deliberate: if a commit rebuilds the pane, the
 * node the user is typing into is torn out of the document, and re-querying
 * here would quietly swap in the replacement and hide the data loss.
 */
async function typeCaps(attr: 'country' | 'cat', entries: [string, string][]) {
  let pending: HTMLInputElement | null = null;

  for (const [key, value] of entries) {
    const el = inputFor(attr, key);
    el.focus();
    el.value = value;

    if (pending) {
      pending.dispatchEvent(new Event('change'));
      await Promise.resolve();
      await Promise.resolve();
    }
    pending = el;
  }

  if (pending) {
    pending.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();
  }
}

/** Single-field convenience wrapper over typeCaps. */
async function typeCap(attr: 'country' | 'cat', key: string, value: string) {
  await typeCaps(attr, [[key, value]]);
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe('budget page · country caps', () => {
  beforeEach(setup);

  it('persists a single cap', async () => {
    openBudgetPage('country');
    await typeCap('country', 'Switzerland', '15000');
    expect(countryCaps).toEqual({ Switzerland: 15000 });
  });

  it('persists caps typed into several countries in a row', async () => {
    openBudgetPage('country');

    // The regression: committing Switzerland rebuilt the page while Germany
    // was already focused and filled, so Germany and France were dropped.
    await typeCaps('country', [
      ['Switzerland', '15000'],
      ['Germany', '8000'],
      ['France', '9000'],
    ]);

    expect(countryCaps).toEqual({
      Switzerland: 15000,
      Germany: 8000,
      France: 9000,
    });
  });

  it('leaves every cap input attached while the list is filled in', async () => {
    openBudgetPage('country');
    // Snapshot the nodes up front; the user types into these exact elements.
    const before = capInputs();

    await typeCaps('country', [
      ['Switzerland', '15000'],
      ['Germany', '8000'],
      ['France', '9000'],
    ]);

    // If any commit had rebuilt the pane, the fields the user was still typing
    // into would now be detached and their input lost.
    expect(before.every((i) => i.isConnected)).toBe(true);
    expect(capInputs()).toEqual(before);
  });

  it('keeps every cap after closing and reopening the page', async () => {
    openBudgetPage('country');
    await typeCaps('country', [['Switzerland', '15000'], ['Germany', '8000']]);
    closeBudgetPage();

    openBudgetPage('country');
    expect(inputFor('country', 'Switzerland').value).toBe('15000');
    expect(inputFor('country', 'Germany').value).toBe('8000');
  });

  it('does not detach the input the user is editing', async () => {
    openBudgetPage('country');
    const germany = inputFor('country', 'Germany');
    await typeCap('country', 'Switzerland', '15000');
    // Same element still in the document → its listener is still wired.
    expect(germany.isConnected).toBe(true);
    expect(inputFor('country', 'Germany')).toBe(germany);
  });

  it('clears a cap when the field is emptied', async () => {
    openBudgetPage('country');
    await typeCap('country', 'Switzerland', '15000');
    await typeCap('country', 'Switzerland', '');
    expect(countryCaps).toEqual({});
  });

  it('refreshes the compare bars without a full re-render', async () => {
    totalBudget = 50000;
    openBudgetPage('country');
    await typeCap('country', 'Switzerland', '15000');

    const compare = document.querySelector('.exp-budget-compare')!;
    expect(compare.textContent).toContain('Switzerland');
    // Allocated footer recomputed in place: 50000 - 15000 unallocated.
    expect(document.querySelector('.exp-budget-flex')!.textContent).toContain('€35000');
  });

  it('repaints the summary and form on each cap edit', async () => {
    openBudgetPage('country');
    await typeCaps('country', [['Switzerland', '15000'], ['Germany', '8000']]);
    expect(renderSummaryOnlyCalls).toBe(2);
    expect(renderFormCalls).toBe(2);
  });

  it('auto-estimate writes a cap per country from itinerary days', async () => {
    openBudgetPage('country');
    (document.querySelector('#bm-daily-rate') as HTMLInputElement).value = '100';
    (document.querySelector('#bm-apply-daily') as HTMLElement).click();
    for (let i = 0; i < 12; i++) await Promise.resolve();

    // 7d / 4d / 7d × €100
    expect(countryCaps).toEqual({
      Switzerland: 700,
      Germany: 400,
      France: 700,
    });
  });

  /* ── Commit paths that `change` alone did not cover ────────────────────── */

  it('saves on Enter without any blur', async () => {
    openBudgetPage('country');
    const input = inputFor('country', 'France');
    input.focus();
    input.value = '10000';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(countryCaps).toEqual({ France: 10000 });
  });

  it('saves after typing stops, with the field still focused', async () => {
    vi.useFakeTimers();
    try {
      openBudgetPage('country');
      const input = inputFor('country', 'France');
      input.focus();
      input.value = '10000';
      input.dispatchEvent(new Event('input'));

      // Never blurred, never Entered — just stopped typing.
      await vi.advanceTimersByTimeAsync(500);
      expect(countryCaps).toEqual({ France: 10000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a pending edit when Escape closes the panel', async () => {
    openBudgetPage('country');
    const input = inputFor('country', 'France');
    input.focus();
    input.value = '10000';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(countryCaps).toEqual({ France: 10000 });
  });

  it('does not write twice when debounce and blur both fire', async () => {
    vi.useFakeTimers();
    try {
      openBudgetPage('country');
      const input = inputFor('country', 'France');
      input.focus();
      input.value = '10000';
      input.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(500);   // debounce commits
      input.dispatchEvent(new Event('change')); // blur follows
      await vi.advanceTimersByTimeAsync(0);

      expect(countryWrites).toBe(1);
      expect(countryCaps).toEqual({ France: 10000 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('budget page · category caps', () => {
  beforeEach(setup);

  it('persists caps typed into several categories in a row', async () => {
    openBudgetPage('category');
    await typeCaps('cat', [['food', '2000'], ['stay', '3000'], ['train', '1200']]);

    expect(categoryCaps).toEqual({ food: 2000, stay: 3000, train: 1200 });
  });

  it('leaves every cap input attached while the list is filled in', async () => {
    openBudgetPage('category');
    const before = capInputs();
    await typeCaps('cat', [['food', '2000'], ['stay', '3000'], ['train', '1200']]);

    expect(before.every((i) => i.isConnected)).toBe(true);
    expect(capInputs()).toEqual(before);
  });

  it('keeps every cap after closing and reopening the page', async () => {
    openBudgetPage('category');
    await typeCaps('cat', [['food', '2000'], ['stay', '3000']]);
    closeBudgetPage();

    openBudgetPage('category');
    expect(inputFor('cat', 'food').value).toBe('2000');
    expect(inputFor('cat', 'stay').value).toBe('3000');
  });
});

describe('budget page · country and category caps together', () => {
  beforeEach(setup);

  it('keeps country caps when category caps are edited afterwards', async () => {
    openBudgetPage('country');
    await typeCap('country', 'Switzerland', '15000');

    // Switch tabs the way the user does, then edit on the other tab.
    (document.querySelector('.exp-budget-tab[data-tab="category"]') as HTMLElement).click();
    await typeCap('cat', 'food', '2000');

    expect(countryCaps).toEqual({ Switzerland: 15000 });
    expect(categoryCaps).toEqual({ food: 2000 });
  });
});
