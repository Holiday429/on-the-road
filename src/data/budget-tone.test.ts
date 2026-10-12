import { describe, expect, it } from 'vitest';
import { budgetBarColor, budgetTone } from './budget-tone.ts';

describe('budgetTone', () => {
  it('switches at 80% and 100%', () => {
    expect(budgetTone(0)).toBe('ok');
    expect(budgetTone(79)).toBe('ok');
    expect(budgetTone(80)).toBe('warn');
    expect(budgetTone(99)).toBe('warn');
    expect(budgetTone(100)).toBe('over');
  });
  it('maps every tone to a token colour', () => {
    expect(budgetBarColor(50)).toContain('var(');
    expect(budgetBarColor(90)).toContain('var(');
    expect(budgetBarColor(120)).toContain('var(');
  });
});
