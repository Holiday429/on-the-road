// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ==========================================================================
   Budget & analysis · cap persistence.

   Regression cover for the bug where only the FIRST cap you typed survived a
   reopen. Each cap <input> commits on `change`, which fires on blur — and that
   blur is normally the user clicking straight into the next cap field. The old
   handler re-rendered the whole page at that moment, replacing the element
   that had just taken focus, so the second value was typed into a detached
   node whose `change` listener no longer reached the store.

   These tests drive the real module against an in-memory trip-context, using
   the same focus-then-blur ordering the browser produces. (The sheet was
   the budget editor before the Budget and Analysis views were merged; the
   rules are unchanged: inputs are never rebuilt while the user is typing.)
   ========================================================================== */

/* ── In-memory trip-context ──────────────────────────────────────────────── */

let countryCaps: Record<string, number> = {};
let categoryCaps: Record<string, number> = {};
let totalBudget: number | null = null;
let countryWrites = 0;
let failNextCountryWrite = false;

vi.mock('../../data/trip-context.ts', () => ({
  baseCurrency: () => 'EUR',
  tripBudget: () => totalBudget,
  setTripBudget: async (n: number | null) => { totalBudget = n; },
  countryBudgets: () => countryCaps,
  setCountryBudget: async (country: string, amount: number | null) => {
    if (failNextCountryWrite) {
      failNextCountryWrite = false;
      throw new Error('permission-denied');
    }
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

const {
  initBudgetAnalysis, openBudgetAnalysis, closeBudgetAnalysis, renderBudgetAnalysis,
} = await import('./budget-analysis.ts');

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
let jumped: string[] = [];

function setup() {
  countryCaps = {};
  categoryCaps = {};
  totalBudget = null;
  countryWrites = 0;
  failNextCountryWrite = false;
  renderFormCalls = 0;
  renderSummaryOnlyCalls = 0;
  jumped = [];
  // eslint-disable-next-line no-restricted-syntax -- audited: static test fixture, no interpolation
  document.body.innerHTML = `<div class="exp-analysis-panel"></div>`;

  initBudgetAnalysis({
    expenses: () => [],
    legs: () => LEGS,
    categories: () => CATEGORIES,
    inBase: () => 0,
    fmt: (n: number) => `€${Math.round(n)}`,
    timeHtml: () => '<div class="exp-cal-grid"><span class="exp-cal-cell" data-iso="2026-09-02">2</span></div>',
    calNav: () => {},
    onJumpDay: (iso) => { jumped.push(iso); },
    onSortUnsorted: () => {},
    renderSummaryOnly: () => { renderSummaryOnlyCalls++; },
    renderForm: () => { renderFormCalls++; },
  });
}

const capInputs = () =>
  [...document.querySelectorAll<HTMLInputElement>('.ba-cap')];

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

const flush = async (n = 6) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

describe('budget & analysis · country caps', () => {
  beforeEach(setup);

  it('persists a single cap', async () => {
    openBudgetAnalysis();
    await typeCap('country', 'Switzerland', '15000');
    expect(countryCaps).toEqual({ Switzerland: 15000 });
  });

  it('persists caps typed into several countries in a row', async () => {
    openBudgetAnalysis();
    // The regression: committing one cap rebuilt the page while the next field was
    // already focused and filled, so the later ones were dropped.
    await typeCaps('country', [['Switzerland', '15000'], ['Germany', '8000'], ['France', '9000']]);
    expect(countryCaps).toEqual({ Switzerland: 15000, Germany: 8000, France: 9000 });
  });

  it('leaves every cap input attached while the list is filled in', async () => {
    openBudgetAnalysis();
    const before = capInputs();
    await typeCaps('country', [['Switzerland', '15000'], ['Germany', '8000'], ['France', '9000']]);
    expect(before.every((i) => i.isConnected)).toBe(true);
    expect(capInputs()).toEqual(before);
  });

  it('keeps every cap after closing and reopening the sheet', async () => {
    openBudgetAnalysis();
    await typeCaps('country', [['Switzerland', '15000'], ['Germany', '8000']]);
    closeBudgetAnalysis();
    openBudgetAnalysis();
    expect(inputFor('country', 'Switzerland').value).toBe('15000');
    expect(inputFor('country', 'Germany').value).toBe('8000');
  });

  it('clears a cap when the field is emptied', async () => {
    openBudgetAnalysis();
    await typeCap('country', 'Switzerland', '15000');
    await typeCap('country', 'Switzerland', '');
    expect(countryCaps).toEqual({});
  });

  it('updates the row note and the allocated line in place', async () => {
    totalBudget = 50000;
    openBudgetAnalysis();
    const note = document.querySelector<HTMLElement>('[data-country-row="Switzerland"] [data-note]')!;
    await typeCap('country', 'Switzerland', '15000');
    expect(note.isConnected).toBe(true);
    expect(note.textContent).toContain('€15000');
    // 50000 - 15000 unallocated, shown with the other figures at the top.
    expect(document.querySelector('.ba-allocs')!.textContent).toContain('€35000');
  });

  it('repaints the summary on each cap edit and the till on country edits', async () => {
    openBudgetAnalysis();
    await typeCaps('country', [['Switzerland', '15000'], ['Germany', '8000']]);
    expect(renderSummaryOnlyCalls).toBe(2);
    expect(renderFormCalls).toBe(2);
  });

  it('auto-fill writes a cap per country from itinerary days', async () => {
    openBudgetAnalysis();
    (document.querySelector('#ba-daily-rate') as HTMLInputElement).value = '100';
    (document.querySelector('#ba-apply-daily') as HTMLElement).click();
    await flush(12);
    // 7d / 4d / 7d × €100
    expect(countryCaps).toEqual({ Switzerland: 700, Germany: 400, France: 700 });
  });

  /* ── Commit paths that `change` alone did not cover ────────────────────── */

  it('saves on Enter without any blur', async () => {
    openBudgetAnalysis();
    const input = inputFor('country', 'France');
    input.focus();
    input.value = '10000';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(countryCaps).toEqual({ France: 10000 });
  });

  it('saves after typing stops, with the field still focused', async () => {
    vi.useFakeTimers();
    try {
      openBudgetAnalysis();
      const input = inputFor('country', 'France');
      input.focus();
      input.value = '10000';
      input.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(500);
      expect(countryCaps).toEqual({ France: 10000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a pending edit when Escape is pressed in the field', async () => {
    openBudgetAnalysis();
    const input = inputFor('country', 'France');
    input.focus();
    input.value = '10000';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(countryCaps).toEqual({ France: 10000 });
  });

  it('surfaces a rejected write and retries it on the next commit', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      openBudgetAnalysis();
      const input = inputFor('country', 'France');
      failNextCountryWrite = true;
      input.value = '10000';
      input.dispatchEvent(new Event('change'));
      await flush();
      expect(countryCaps).toEqual({});
      expect(input.classList.contains('ba-cap-error')).toBe(true);
      expect(input.title).toContain('Not saved');
      input.dispatchEvent(new Event('change'));
      await flush();
      expect(countryCaps).toEqual({ France: 10000 });
      expect(input.classList.contains('ba-cap-error')).toBe(false);
    } finally {
      err.mockRestore();
    }
  });

  it('does not write twice when debounce and blur both fire', async () => {
    vi.useFakeTimers();
    try {
      openBudgetAnalysis();
      const input = inputFor('country', 'France');
      input.focus();
      input.value = '10000';
      input.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(500);
      input.dispatchEvent(new Event('change'));
      await vi.advanceTimersByTimeAsync(0);
      expect(countryWrites).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('budget & analysis · category caps and the total', () => {
  beforeEach(setup);

  it('persists caps typed into several categories in a row, inputs staying attached', async () => {
    openBudgetAnalysis();
    const before = capInputs();
    await typeCaps('cat', [['food', '2000'], ['stay', '3000'], ['train', '1200']]);
    expect(categoryCaps).toEqual({ food: 2000, stay: 3000, train: 1200 });
    expect(before.every((i) => i.isConnected)).toBe(true);
  });

  it('keeps country caps when category caps are edited on the same sheet', async () => {
    openBudgetAnalysis();
    await typeCap('country', 'Switzerland', '15000');
    await typeCap('cat', 'food', '2000');
    expect(countryCaps).toEqual({ Switzerland: 15000 });
    expect(categoryCaps).toEqual({ food: 2000 });
  });

  it('the total budget is edited in the overview and drives the remaining figure', async () => {
    openBudgetAnalysis();
    const total = document.querySelector<HTMLInputElement>('#ba-total')!;
    total.focus();
    total.value = '50000';
    total.dispatchEvent(new Event('change'));
    await flush();
    expect(totalBudget).toBe(50000);
    expect(document.querySelector('.ba-figs')!.textContent).toContain('€50000');
  });
});

describe('budget & analysis · live repaint', () => {
  beforeEach(setup);

  it('a repaint while a cap field has focus does not rebuild the fields', async () => {
    openBudgetAnalysis();
    const before = capInputs();
    const input = inputFor('country', 'France');
    input.focus();
    input.value = '9';            // mid-typing
    renderBudgetAnalysis();       // e.g. a spend landing from another device
    expect(capInputs()).toEqual(before);
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe('9');
  });

  it('closed: the panel is emptied', () => {
    openBudgetAnalysis();
    closeBudgetAnalysis();
    expect(document.querySelector('.exp-analysis-panel')!.innerHTML).toBe('');
  });
});

describe('budget & analysis · time column', () => {
  beforeEach(setup);

  it('clicking a calendar day closes the sheet and hands the day to the till', () => {
    openBudgetAnalysis();
    (document.querySelector('.exp-cal-cell[data-iso]') as HTMLElement).click();
    expect(jumped).toEqual(['2026-09-02']);
    expect(document.querySelector('.exp-analysis-panel')!.innerHTML).toBe('');
  });
});
