/* ==========================================================================
   Design lint — keeps the visual language from drifting back.

   Two kinds of check:
   · hard rules (must stay 0): things that were unified once and have one
     source of truth now;
   · baselines (may only go DOWN): hard-coded literals that still exist. When
     you remove some, lower the number so the gain is locked in. Adding a new
     literal fails the test — use a token from base.css instead, or if it truly
     can't be a token, bump the baseline with a reason in the commit.
   ========================================================================== */

import { describe, expect, it } from 'vitest';

// Sources are read as raw text through Vite (the project has no @types/node).
const CSS_SRC = import.meta.glob('/src/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const TS_SRC = import.meta.glob('/src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const css = Object.keys(CSS_SRC);
const ts = Object.keys(TS_SRC).filter((f) => !f.endsWith('.test.ts'));
const read = (f: string) => CSS_SRC[f] ?? TS_SRC[f];
const rel = (f: string) => f.replace(/^\/src\//, '');

function count(files: string[], re: RegExp, skip: (f: string) => boolean = () => false): number {
  let n = 0;
  for (const f of files) if (!skip(f)) n += (read(f).match(re) ?? []).length;
  return n;
}
const notBase = (f: string) => rel(f) === 'core/base.css';
const isI18n = (f: string) => rel(f).startsWith('core/i18n');

describe('hard rules', () => {
  it('font-weight uses the --fw-* steps, never a number', () => {
    expect(count(css, /font-weight:\s*\d{3}\b/g)).toBe(0);
  });

  it('one symbol per action: no full-width ＋, no &times; or × as a close button', () => {
    expect(count([...ts, ...css], /＋/g)).toBe(0);
    expect(count(ts, /&times;/g)).toBe(0);
    expect(count(ts, />×<\/button>/g)).toBe(0);
  });

  it('transport / stay / plan-category emoji maps live only in core/icons.ts', () => {
    const offenders = ts
      .filter((f) => rel(f) !== 'core/icons.ts')
      .filter((f) => /const\s+TRANSPORT_ICONS?\s*[:=]\s*(Record|\{)/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('the old illustrated nav PNGs are no longer imported', () => {
    expect(count(ts, /from\s+['"][./]+icon\/[A-Za-z]+\.png['"]/g)).toBeLessThanOrEqual(1); // profile.png only
  });

  it('dark-mode safety: no hard-white translucent backgrounds (use a --surface mix); only the 3 over-photo overlays remain', () => {
    expect(count(css, /background(-color)?:\s*rgba\(\s*255/g)).toBeLessThanOrEqual(3);
  });

  it('dark-mode safety: text on a solid amber fill uses --on-accent, not --ink', () => {
    const bad: string[] = [];
    for (const f of css) {
      for (const m of read(f).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = m[2];
        if (/background:\s*var\(--(amber-(300|400|500)|accent)\b/.test(body) && /(^|;|\s)color:\s*var\(--ink\)/.test(body)) {
          bad.push(`${rel(f)}  ${m[1].trim().split('\n').pop()}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('baselines (can only go down)', () => {
  it('hex colour literals in CSS (outside base.css)', () => {
    expect(count(css, /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g, notBase)).toBeLessThanOrEqual(86);
  });

  it('hex colour literals in TS (outside i18n)', () => {
    expect(count(ts, /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g, isI18n)).toBeLessThanOrEqual(257);
  });

  it('rgb()/rgba() literals in CSS (outside base.css)', () => {
    expect(count(css, /rgba?\(\s*\d/g, notBase)).toBeLessThanOrEqual(175);
  });

  it('border-radius in px (use --r-* tokens)', () => {
    expect(count(css, /border-radius:\s*\d+px/g)).toBeLessThanOrEqual(43);
  });

  it('font-size in px (use --fs-* tokens)', () => {
    expect(count(css, /font-size:\s*\d+(\.\d+)?px/g, notBase)).toBeLessThanOrEqual(160);
  });
});
