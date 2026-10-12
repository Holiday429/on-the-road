import { describe, expect, it } from 'vitest';
import { en } from '../../core/i18n/en.ts';
import { zh } from '../../core/i18n/zh.ts';

/* Every `map.*` / `world.*` translation key the Map page's code mentions must exist in
   English and Chinese (the two languages new copy ships in). */

const SOURCES = import.meta.glob(['./*.ts', './world/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const FILES = Object.keys(SOURCES).filter((f) => !f.endsWith('.test.ts'));

describe('map translation keys', () => {
  const used = new Map<string, string>();
  for (const f of FILES) {
    for (const m of SOURCES[f].matchAll(/['`"]((?:map|world)\.[A-Za-z][\w.]*)['`"]/g)) used.set(m[1], f);
  }

  it('finds the keys', () => {
    expect(used.size).toBeGreaterThan(70);
    expect(used.has('map.replay')).toBe(true);
    expect(used.has('world.country.viewRoute')).toBe(true);
    expect(used.has('map.layer.expenses')).toBe(true);   // via LAYER_META, not t() directly
  });
  it('every key exists in English', () => {
    expect([...used].filter(([k]) => !(k in en)).map(([k, f]) => `${k} (${f})`)).toEqual([]);
  });
  it('every key exists in Chinese', () => {
    expect([...used].filter(([k]) => !(k in zh)).map(([k, f]) => `${k} (${f})`)).toEqual([]);
  });
  it('Chinese has no map key English lacks', () => {
    expect(Object.keys(zh).filter((k) => /^(map|world)\./.test(k) && !(k in en))).toEqual([]);
  });
});
