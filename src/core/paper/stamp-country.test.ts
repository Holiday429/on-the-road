import { describe, expect, it } from 'vitest';
import { COUNTRY_SHAPES, renderCountryStamp, stayPhrase } from './stamp-country.ts';
import { renderStamp, type StampSpec } from './stamp.ts';
import { ICONS, iconFor } from './stamp-icons.ts';

const spec = (over: Partial<StampSpec> = {}): StampSpec => ({
  id: 'country:DE:t1', kind: 'country', city: 'Berlin', country: 'Germany', iso: 'DE', date: '2026-07-05', nights: 4,
  shape: 'hex', rotation: 3, ink: '#46433f', earned: true, ...over,
});

describe('stayPhrase', () => {
  it('follows the length of the stay', () => {
    expect([1, 2, 3, 4, 8, 9, 20].map(stayPhrase)).toEqual(['ONE NIGHT IN', 'WEEKEND IN', 'WEEKEND IN', 'A WEEK IN', 'A WEEK IN', '9 NIGHTS IN', '20 NIGHTS IN']);
  });
});

describe('iconFor', () => {
  it('own landmark, else continent motif, else compass; every key has artwork', () => {
    expect(iconFor('fr')).toBe('eiffel');
    expect(iconFor('PL')).toBe('castle');
    expect(iconFor('KE')).toBe('pyramid');
    expect(iconFor('ZZ')).toBe('compass');
    for (const iso of ['DK', 'BR', 'NZ', 'ZZ']) expect(ICONS[iconFor(iso)]).toBeTruthy();
  });
});

describe('renderCountryStamp', () => {
  it('draws every shape and routes country specs through renderStamp', () => {
    for (const shape of COUNTRY_SHAPES) {
      const html = renderStamp(spec({ shape }), { size: 100 });
      expect(html).toContain('GERMANY');
      expect(html).toContain('A WEEK IN');
      expect(html).toContain('5 JUL 2026');
    }
  });

  it('is deterministic and pressure sets the ink strength', () => {
    expect(renderCountryStamp(spec())).toBe(renderCountryStamp(spec()));
    // The arc id is document-unique, so compare the ink strength rather than whole markup.
    const o = (p: number) => /--ink-o:([\d.]+)/.exec(renderCountryStamp(spec({ pressure: p })))![1];
    expect(Number(o(1))).toBeGreaterThan(Number(o(0)));
  });

  it('escapes names', () => {
    expect(renderCountryStamp(spec({ country: '<b>x</b>' }))).not.toContain('<b>x</b>');
  });
});
