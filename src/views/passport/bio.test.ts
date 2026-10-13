import { describe, expect, it } from 'vitest';
import { mrz, passportNumber } from './bio.ts';

describe('passportNumber', () => {
  it('is seven digits and fixed by the account', () => {
    expect(passportNumber('abc')).toMatch(/^\d{7}$/);
    expect(passportNumber('abc')).toBe(passportNumber('abc'));
    expect(passportNumber('abc')).not.toBe(passportNumber('abd'));
  });
});

describe('mrz', () => {
  it('two 44-character lines made only of capitals, digits and <', () => {
    for (const nick of ['Holiday', 'Anne-Marie O’Neil', '小明', '', 'José']) {
      const lines = mrz({ nickname: nick, nationality: 'CN', uid: 'u1' }, '2026-06-25');
      for (const l of lines) { expect(l).toHaveLength(44); expect(l).toMatch(/^[A-Z0-9<]+$/); }
    }
  });

  it('carries the name, the number and the issue date', () => {
    const [a, b] = mrz({ nickname: 'Holiday', nationality: 'CN', uid: 'u1' }, '2026-06-25');
    expect(a.startsWith('P<OTRHOLIDAY<<')).toBe(true);
    expect(b.startsWith(passportNumber('u1'))).toBe(true);
    expect(b).toContain('CN260625');
  });
});
