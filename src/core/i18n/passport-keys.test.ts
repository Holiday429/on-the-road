import { describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { zh } from './zh.ts';

/* Every translation key the passport (and its entry points) asks for must exist in English and Chinese. */

const SOURCES = {
  ...import.meta.glob('../../views/passport/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../sidebar.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;
const FILES = Object.keys(SOURCES).filter((f) => !f.endsWith('.test.ts'));

describe('passport translation keys', () => {
  const used = new Map<string, string>();
  for (const f of FILES) {
    for (const m of SOURCES[f].matchAll(/\bt\(\s*['`](passport\.[\w.]+)['`]/g)) used.set(m[1], f);
  }

  it('finds the keys at all', () => {
    expect(used.size).toBeGreaterThan(15);
  });

  it.each([...used.keys()])('%s exists in en and zh', (key) => {
    expect(en[key], `en: ${key}`).toBeTruthy();
    expect(zh[key], `zh: ${key}`).toBeTruthy();
  });
});
