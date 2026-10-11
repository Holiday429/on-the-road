import { describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { zh } from './zh.ts';

/* Every translation key the Dashboard (and the pieces it opens) asks for must
   exist in English and Chinese — the two languages new copy ships in. Other
   languages fall back to English at runtime. Keys built from a template
   (`dash.whereto.tab.${id}`) are checked by expanding the known values. */

// Sources are read as raw text through Vite (no node:fs — the project has no @types/node).
const SOURCES: Record<string, string> = {
  ...import.meta.glob('../../views/dashboard/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../views/profile/profile-home-tz.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../drawer.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../data/day-agenda.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;
const FILES = Object.keys(SOURCES).filter((f) => !f.endsWith('.test.ts'));

const EXPANSIONS: Record<string, string[]> = {
  'dash.whereto.tab.${id}': ['all', 'sights', 'food', 'coffee', 'work'].map((x) => `dash.whereto.tab.${x}`),
  'agenda.transport.${tr.type}': ['flight', 'train', 'bus', 'ferry'].map((x) => `agenda.transport.${x}`),
  'agenda.transport.${t_.type}': ['flight', 'train', 'bus', 'ferry'].map((x) => `agenda.transport.${x}`),
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

describe('dashboard translation keys', () => {
  const used = new Map<string, string>();
  for (const f of FILES) for (const k of keysIn(SOURCES[f])) used.set(k, f);

  it('found a plausible number of keys', () => {
    expect(used.size).toBeGreaterThan(100);
    // spot checks: a plain key, an expanded template key, a conditional key
    expect(used.has('dash.bagModal.title')).toBe(true);
    expect(used.has('dash.whereto.tab.work')).toBe(true);
    expect(used.has('dash.link.guide')).toBe(true);
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
