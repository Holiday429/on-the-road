/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { isStampSeen, markStampsSeen, unseenStamps } from './stamp-seen.ts';

describe('stamp memory', () => {
  beforeEach(() => localStorage.clear());

  it('remembers what has been shown and reports only the new ones', () => {
    expect(unseenStamps(['a', 'b'])).toEqual(['a', 'b']);
    markStampsSeen(['a']);
    expect(isStampSeen('a')).toBe(true);
    expect(isStampSeen('b')).toBe(false);
    expect(unseenStamps(['a', 'b'])).toEqual(['b']);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('otr:stampsSeen', '{not json');
    expect(unseenStamps(['a'])).toEqual(['a']);
    markStampsSeen(['a']);
    expect(isStampSeen('a')).toBe(true);
  });

  it('marking nothing is a no-op', () => {
    markStampsSeen([]);
    expect(localStorage.getItem('otr:stampsSeen')).toBeNull();
  });
});
