/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeWeighIn, openWeighIn } from './weigh-scale.ts';
import type { BagWeighIn } from '../pack/weigh-in.ts';

const row = (id: string, weightG: number, limitG: number): BagWeighIn => ({
  id, label: id, kind: 'suitcase', weightG, limitG,
  verdict: !limitG ? 'nolimit' : weightG > limitG ? 'over' : 'pass',
  diffG: limitG ? limitG - weightG : 0,
});
const fmt = (g: number) => `${(g / 1000).toFixed(1)}kg`;

describe('weigh scale (reduced motion: everything is shown at once)', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { closeWeighIn(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

  it('modal: one chip per bag, the summary counts verdicts, last bag shown', () => {
    openWeighIn({ rows: [row('Backpack', 4400, 10000), row('Suitcase', 12600, 11000), row('Tote', 900, 0)], fmt, mode: 'all' });
    const chips = [...document.querySelectorAll<HTMLElement>('.ws-chip')];
    expect(chips.map((c) => c.dataset.verdict)).toEqual(['pass', 'over', 'nolimit']);
    expect(document.querySelector('.ws-summary')?.textContent).toMatch(/3.*1.*1/);
    expect(document.querySelector('.ws-num')?.textContent).toBe('0.9kg');
    expect(document.querySelector('.ws-tag-verdict')?.textContent).toBeTruthy();
  });

  it('shows the overweight verdict and how far over', () => {
    openWeighIn({ rows: [row('Suitcase', 12600, 11000)], fmt, mode: 'one' });
    expect((document.querySelector('.ws-card') as HTMLElement).dataset.verdict).toBe('over');
    expect(document.querySelector('.ws-tag-sub')?.textContent).toContain('1.6kg');
  });

  it('Escape closes it and only one scale exists at a time', () => {
    openWeighIn({ rows: [row('A', 1000, 2000)], fmt, mode: 'all' });
    openWeighIn({ rows: [row('B', 1000, 2000)], fmt, mode: 'all' });
    expect(document.querySelectorAll('.ws-overlay')).toHaveLength(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelectorAll('.ws-overlay')).toHaveLength(0);
  });

  it('does nothing for an empty list', () => {
    openWeighIn({ rows: [], fmt, mode: 'all' });
    expect(document.querySelector('.ws-overlay')).toBeNull();
  });
});
