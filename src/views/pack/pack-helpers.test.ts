import { describe, expect, it } from 'vitest';
import { categoryForGroupName, PACK_CATEGORIES, DEFAULT_CATEGORY } from './pack-helpers.ts';

/* ==========================================================================
   Sending a checklist item to Pack has to guess a category from the item's
   group name — the checklist has no category of its own.
   ========================================================================== */

describe('categoryForGroupName', () => {
  it('maps the checklist view\'s own preset groups', () => {
    expect(categoryForGroupName('Documents')).toBe('documents');
    expect(categoryForGroupName('Tech & Comms')).toBe('electronics');
    expect(categoryForGroupName('Health')).toBe('health');
  });

  it('matches on a word inside a longer custom group name', () => {
    expect(categoryForGroupName('Cold weather clothing')).toBe('clothing');
    expect(categoryForGroupName('Snacks and food for the flight')).toBe('food');
  });

  it('is case-insensitive', () => {
    expect(categoryForGroupName('TOILETRIES')).toBe('toiletries');
    expect(categoryForGroupName('documents')).toBe('documents');
  });

  it('matches Chinese group names — groups are user-typed and the app ships zh', () => {
    expect(categoryForGroupName('证件')).toBe('documents');
    expect(categoryForGroupName('电子设备')).toBe('electronics');
    expect(categoryForGroupName('衣物')).toBe('clothing');
    expect(categoryForGroupName('洗漱用品')).toBe('toiletries');
  });

  it('falls back to the default for names it cannot place', () => {
    expect(categoryForGroupName('Last-minute')).toBe(DEFAULT_CATEGORY);
    expect(categoryForGroupName('')).toBe(DEFAULT_CATEGORY);
    expect(categoryForGroupName('Miscellaneous bits')).toBe(DEFAULT_CATEGORY);
  });

  it('only ever returns a category Pack actually knows about', () => {
    const known = new Set(PACK_CATEGORIES.map(c => c.value));
    ['Documents', 'Tech & Comms', '衣物', 'Health', 'nonsense', '']
      .forEach(name => expect(known).toContain(categoryForGroupName(name)));
  });
});
