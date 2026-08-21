// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ==========================================================================
   Dashboard alert bell.

   Covers the three things that aren't obvious from reading the renderer:
   which alerts fire at all, how dismissal keys are scoped (so a dismissed
   warning comes back when it gets worse), and that overdue to-dos join the
   budget alerts in the same list.
   ========================================================================== */

let caps: Record<string, number> = {};

vi.mock('../../data/trip-context.ts', () => ({
  baseCurrency: () => 'EUR',
  countryBudgets: () => caps,
  currentTripId: () => 'trip1',
}));
vi.mock('../../data/rates.ts', () => ({ currencySymbol: () => '€' }));
vi.mock('../../core/i18n.ts', () => ({
  // Echo the key + placeholders so assertions read against stable text.
  t: (k: string) => k,
}));

const { renderAlertBell } = await import('./dashboard-alert-bell.ts');

type Ctx = Parameters<typeof renderAlertBell>[0];

function ctx(over: Partial<Ctx> = {}): Ctx {
  return {
    expenses: [],
    legs: [],
    todos: [],
    today: '2026-08-21',
    inBase: (e: any) => e.baseAmount,
    ...over,
  } as Ctx;
}

const expense = (country: string, baseAmount: number) =>
  ({ id: `e${baseAmount}`, country, baseAmount, baseCurrency: 'EUR' }) as any;
const todo = (id: string, text: string, dueDate: string | null, done = false) =>
  ({ id, text, dueDate, done }) as any;

/** Count rendered alert rows. */
function rows(html: string): number {
  const el = document.createElement('div');
  // eslint-disable-next-line no-restricted-syntax -- test-only parse of markup we just rendered
  el.innerHTML = html;
  return el.querySelectorAll('.td-ba-row').length;
}
function keys(html: string): string[] {
  const el = document.createElement('div');
  // eslint-disable-next-line no-restricted-syntax -- test-only parse of markup we just rendered
  el.innerHTML = html;
  return [...el.querySelectorAll('[data-dismiss-alert]')]
    .map(n => n.getAttribute('data-dismiss-alert') ?? '');
}

beforeEach(() => {
  caps = {};
  localStorage.clear();
});

describe('budget alerts', () => {
  it('stays silent below 80% of a cap', () => {
    caps = { Italy: 1000 };
    expect(renderAlertBell(ctx({ expenses: [expense('Italy', 700)] }))).toBe('');
  });

  it('warns at 80%+ and flags over-budget separately', () => {
    caps = { Italy: 1000, Spain: 1000 };
    const html = renderAlertBell(ctx({
      expenses: [expense('Italy', 900), expense('Spain', 1200)],
    }));
    expect(rows(html)).toBe(2);
    // Over-budget sorts ahead of the warning.
    expect(keys(html)[0]).toBe('trip1:budget:Spain:over');
    expect(keys(html)[1]).toBe('trip1:budget:Italy:warn');
  });

  it('ignores countries with no cap set', () => {
    caps = { Italy: 0 };
    expect(renderAlertBell(ctx({ expenses: [expense('Italy', 500)] }))).toBe('');
  });
});

describe('overdue to-do alerts', () => {
  it('raises a to-do whose due date has passed', () => {
    const html = renderAlertBell(ctx({ todos: [todo('t1', 'Renew visa', '2026-08-19')] }));
    expect(rows(html)).toBe(1);
    expect(keys(html)[0]).toBe('trip1:todo:t1:2026-08-19');
  });

  it('ignores to-dos that are done, undated, or not yet due', () => {
    const html = renderAlertBell(ctx({ todos: [
      todo('t1', 'Done one', '2026-08-01', true),
      todo('t2', 'No date', null),
      todo('t3', 'Due today', '2026-08-21'),
      todo('t4', 'Future', '2026-09-01'),
    ] }));
    expect(html).toBe('');
  });

  it('lists overdue to-dos alongside budget alerts', () => {
    caps = { Italy: 1000 };
    const html = renderAlertBell(ctx({
      expenses: [expense('Italy', 900)],
      todos: [todo('t1', 'Renew visa', '2026-08-19')],
    }));
    expect(rows(html)).toBe(2);
    // The overdue to-do is urgent, so it outranks the 90% warning.
    expect(keys(html)[0]).toBe('trip1:todo:t1:2026-08-19');
  });
});

describe('dismissal', () => {
  it('hides an alert once its key is dismissed', () => {
    caps = { Italy: 1000 };
    const c = ctx({ expenses: [expense('Italy', 900)] });
    const key = keys(renderAlertBell(c))[0];

    localStorage.setItem('otr.alerts.dismissed', JSON.stringify([key]));
    expect(renderAlertBell(c)).toBe('');
  });

  it('re-raises a dismissed warning once the country goes over budget', () => {
    caps = { Italy: 1000 };
    const warn = ctx({ expenses: [expense('Italy', 900)] });
    localStorage.setItem('otr.alerts.dismissed', JSON.stringify(keys(renderAlertBell(warn))));
    expect(renderAlertBell(warn)).toBe('');

    // Same country, now actually over — different severity, different key.
    const over = ctx({ expenses: [expense('Italy', 1200)] });
    expect(rows(renderAlertBell(over))).toBe(1);
  });

  it('re-raises a dismissed to-do when it is rescheduled', () => {
    const first = ctx({ todos: [todo('t1', 'Renew visa', '2026-08-19')] });
    localStorage.setItem('otr.alerts.dismissed', JSON.stringify(keys(renderAlertBell(first))));
    expect(renderAlertBell(first)).toBe('');

    const moved = ctx({ todos: [todo('t1', 'Renew visa', '2026-08-20')] });
    expect(rows(renderAlertBell(moved))).toBe(1);
  });

  it('survives unreadable localStorage', () => {
    caps = { Italy: 1000 };
    localStorage.setItem('otr.alerts.dismissed', 'not json');
    expect(rows(renderAlertBell(ctx({ expenses: [expense('Italy', 900)] })))).toBe(1);
  });
});

describe('escaping', () => {
  it('escapes to-do text', () => {
    const html = renderAlertBell(ctx({
      todos: [todo('t1', '<img src=x onerror=alert(1)>', '2026-08-19')],
    }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
