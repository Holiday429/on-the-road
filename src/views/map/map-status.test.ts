import { describe, it, expect } from 'vitest';
import { legStatus, PIN_COLORS } from './map-status.ts';

const L = (country: string, dateFrom: string, dateTo: string) => ({ country, dateFrom, dateTo });

describe('map status', () => {
  it('classifies a leg against today', () => {
    expect(legStatus(L('x', '2026-07-01', '2026-07-05'), '2026-07-10')).toBe('past');
    expect(legStatus(L('x', '2026-07-01', '2026-07-05'), '2026-07-05')).toBe('current');
    expect(legStatus(L('x', '2026-07-08', '2026-07-09'), '2026-07-05')).toBe('future');
  });
  it('has a distinct pin colour per status', () => {
    expect(new Set(Object.values(PIN_COLORS)).size).toBe(3);
  });
});
