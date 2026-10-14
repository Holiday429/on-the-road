import { describe, expect, it } from 'vitest';
import { barcodeBars, defaultExpiry, headerNumber, hiddenDots, maskNumber, mrz, passportNumber, personalItem, travelLevel } from './bio.ts';

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

describe('maskNumber', () => {
  it('shows only the last four characters', () => {
    expect(maskNumber('E12345678')).toBe('••••• 5678');
    expect(maskNumber('123')).toBe('•••');
    expect(maskNumber('')).toBe('');
    expect(maskNumber('AB 12 CD 34 56 78')).toContain('5678');
    expect(maskNumber('AB 12 CD 34 56 78')).not.toContain('AB');
  });
});

describe('travelLevel', () => {
  it('rises with the countries visited, from 1 to 5', () => {
    expect([0, 1, 2, 5, 6, 11, 12, 24, 25, 90].map(travelLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe('barcodeBars', () => {
  it('is fixed by the account and always the same length', () => {
    expect(barcodeBars('u1')).toEqual(barcodeBars('u1'));
    expect(barcodeBars('u1')).not.toEqual(barcodeBars('u2'));
    expect(barcodeBars('u1', 20)).toHaveLength(20);
  });
});

describe('personalItem', () => {
  it('is the value when shown, dots of a similar length when hidden, a dash when there is nothing', () => {
    expect(personalItem('E12345678', true)).toEqual({ text: 'E12345678', hidden: false });
    const h = personalItem('E12345678', false);
    expect(h.hidden).toBe(true);
    expect(h.text).toMatch(/^•+$/);
    expect(h.text).not.toContain('E');
    expect(personalItem('  ', false)).toEqual({ text: '—', hidden: false });
  });

  it('hiddenDots has a floor and a ceiling so a short or long value does not give itself away', () => {
    expect(hiddenDots('AB')).toHaveLength(4);
    expect(hiddenDots('x'.repeat(40))).toHaveLength(14);
    expect(hiddenDots('')).toBe('—');
  });
});

describe('headerNumber', () => {
  it('is the made-up serial until a real number is entered, then the real one or dots', () => {
    expect(headerNumber('u1', { number: '', showNumber: true })).toEqual({ text: passportNumber('u1'), hidden: false });
    expect(headerNumber('u1', { number: 'E1234567', showNumber: true }).text).toBe('E1234567');
    const h = headerNumber('u1', { number: 'E1234567', showNumber: false });
    expect(h.hidden).toBe(true);
    expect(h.text).not.toContain('E1234567');
  });
});

describe('defaultExpiry', () => {
  it('is ten years less a day from the issue date', () => {
    expect(defaultExpiry('2026-06-25')).toBe('2036-06-24');
    expect(defaultExpiry('2026-01-01')).toBe('2035-12-31');
    expect(defaultExpiry('')).toBe('');
    expect(defaultExpiry('soon')).toBe('');
  });
});
