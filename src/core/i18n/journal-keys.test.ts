import { describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { zh } from './zh.ts';

/* Every translation key the Journal asks for must exist in English and Chinese
   — the two languages new copy ships in; the others fall back to English at
   runtime. The Journal used to hold its copy as literals (half Chinese, half
   English, none switchable), so this guards the sweep that replaced them. */

// Sources are read as raw text through Vite (no node:fs — the project has no @types/node).
const SOURCES: Record<string, string> = {
  ...import.meta.glob('../../views/journal/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../views/journal/capture/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../views/journal/scenes/*.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;
const FILES = Object.keys(SOURCES).filter((f) => !f.endsWith('.test.ts'));

const EXPANSIONS: Record<string, string[]> = {
  'journal.view.${id}': ['feed', 'places', 'albums', 'gallery', 'calendar'].map((x) => `journal.view.${x}`),
  'journal.cover.tpl.${template}': ['wordmark', 'masthead', 'banner', 'frame'].map((x) => `journal.cover.tpl.${x}`),
  'journal.cover.tone.${tone}': ['paper', 'ink', 'amber', 'sky', 'sage', 'coral'].map((x) => `journal.cover.tone.${x}`),
};

function keysIn(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bt\(\s*(['`])([A-Za-z][\w.${}()\-]*)\1/g)) {
    const key = m[2];
    if (key.includes('${')) out.push(...(EXPANSIONS[key] ?? [`UNEXPANDED:${key}`]));
    else out.push(key);
  }
  // conditional keys: t(cond ? 'a.b' : 'c.d')
  for (const m of src.matchAll(/\bt\([^()\n]*?\?\s*'([\w.]+)'\s*:\s*'([\w.]+)'/g)) out.push(m[1], m[2]);
  return out;
}

describe('journal translation keys', () => {
  const used = new Map<string, string>();
  for (const f of FILES) for (const k of keysIn(SOURCES[f])) used.set(k, f);

  it('found a plausible number of keys', () => {
    expect(used.size).toBeGreaterThan(20);
    // spot checks: a plain key, an expanded template key, a conditional key
    expect(used.has('journal.new')).toBe(true);
    expect(used.has('journal.view.gallery')).toBe(true);
    expect(used.has('journal.edit')).toBe(true);
    expect([...used.keys()].filter((k) => k.startsWith('UNEXPANDED'))).toEqual([]);
  });
  it('every key exists in English', () => {
    const missing = [...used].filter(([k]) => !(k in en)).map(([k, f]) => `${k}  (${f})`);
    expect(missing).toEqual([]);
  });
  it('every key exists in Chinese', () => {
    const missing = [...used].filter(([k]) => !(k in zh)).map(([k, f]) => `${k}  (${f})`);
    expect(missing).toEqual([]);
  });
});
