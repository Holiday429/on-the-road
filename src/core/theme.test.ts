import { describe, expect, it } from 'vitest';
import { resolveTheme } from './theme.ts';

describe('resolveTheme', () => {
  it('honors an explicit preference regardless of the system state', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('follows the system for the "system" preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('treats missing or garbage storage as "system"', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(undefined, false)).toBe('light');
    expect(resolveTheme('DARK', true)).toBe('dark');   // unknown string → system
    expect(resolveTheme('blue', false)).toBe('light');
    expect(resolveTheme(42, true)).toBe('dark');
  });
});
