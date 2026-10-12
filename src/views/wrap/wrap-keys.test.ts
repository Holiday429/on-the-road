import { describe, expect, it } from 'vitest';
import { en } from '../../core/i18n/en.ts';
import { zh } from '../../core/i18n/zh.ts';

/* Every `wrap.*` / `nav.wrap` key the wrap page — and the Dashboard pieces that link to it — asks for
   must exist in English and Chinese (the two languages new copy ships in). */

const SOURCES = {
  ...import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob(['../dashboard/dashboard-banner.ts', '../../core/sidebar.ts'], { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;
const FILES = Object.keys(SOURCES).filter((f) => !f.endsWith('.test.ts'));

describe('wrap translation keys', () => {
  const used = new Map<string, string>();
  for (const f of FILES) {
    for (const m of SOURCES[f].matchAll(/['`"]((?:wrap\.[A-Za-z][\w.]*|nav\.wrap))['`"]/g)) used.set(m[1], f);
    // chapter labels are built from the id: t(`wrap.ch.${id}`)
    if (/wrap\.ch\.\$\{/.test(SOURCES[f])) for (const id of ['cover', 'route', 'passport', 'stays', 'spend', 'pack', 'journal', 'end']) used.set(`wrap.ch.${id}`, f);
  }

  it('finds the keys', () => {
    expect(used.size).toBeGreaterThan(40);
    expect(used.has('wrap.open')).toBe(true);
    expect(used.has('wrap.ch.pack')).toBe(true);
  });
  it('every key exists in English', () => {
    expect([...used].filter(([k]) => !(k in en)).map(([k, f]) => `${k} (${f})`)).toEqual([]);
  });
  it('every key exists in Chinese', () => {
    expect([...used].filter(([k]) => !(k in zh)).map(([k, f]) => `${k} (${f})`)).toEqual([]);
  });
  it('Chinese has no wrap key English lacks, and the placeholders match', () => {
    const extra = Object.keys(zh).filter((k) => /^wrap\./.test(k) && !(k in en));
    expect(extra).toEqual([]);
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    const bad = Object.keys(en).filter((k) => /^wrap\./.test(k) && ph(en[k as keyof typeof en] as string) !== ph(zh[k as keyof typeof zh] as string));
    expect(bad).toEqual([]);
  });
  it('no dead keys: every wrap.* string is used somewhere', () => {
    const src = FILES.map((f) => SOURCES[f]).join('\n');
    const dead = Object.keys(en).filter((k) => /^wrap\./.test(k) && !k.startsWith('wrap.ch.') && !src.includes(`'${k}'`));
    expect(dead).toEqual([]);
  });
});
