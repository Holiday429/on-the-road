import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_ICON, planCategoryIcon } from './plan-category-icon.ts';

describe('planCategoryIcon', () => {
  it('maps the built-in categories', () => {
    expect(planCategoryIcon('food')).toBe('🍽️');
    expect(planCategoryIcon('museum')).toBe('🖼️');
    expect(planCategoryIcon('Nature')).toBe('🌿');
  });
  it('falls back to the pin for custom, blank or missing categories', () => {
    expect(planCategoryIcon('my-custom-cat')).toBe(DEFAULT_PLAN_ICON);
    expect(planCategoryIcon('')).toBe(DEFAULT_PLAN_ICON);
    expect(planCategoryIcon(undefined)).toBe(DEFAULT_PLAN_ICON);
  });
});
