import { describe, it, expect } from 'vitest';
import { legStatus, countryStatuses } from './map-status.ts';

const L = (country: string, dateFrom: string, dateTo: string) => ({ country, dateFrom, dateTo });

describe('map status', () => {
  it('classifies a leg against today', () => {
    expect(legStatus(L('x', '2026-07-01', '2026-07-05'), '2026-07-10')).toBe('past');
    expect(legStatus(L('x', '2026-07-01', '2026-07-05'), '2026-07-05')).toBe('current');
    expect(legStatus(L('x', '2026-07-08', '2026-07-09'), '2026-07-05')).toBe('future');
  });
  it('colours countries: current wins, then any-future, else past', () => {
    const legs = [
      L('Denmark', '2026-07-01', '2026-07-05'),   // past
      L('Germany', '2026-07-05', '2026-07-09'),   // current
      L('Italy', '2026-07-01', '2026-07-02'),     // past …
      L('Italy', '2026-07-20', '2026-07-22'),     // … but revisited later → future
      L('Spain', '2026-07-30', '2026-08-02'),     // future
    ];
    const m = countryStatuses(legs, '2026-07-06');
    expect(m.get('DK')).toBe('past');
    expect(m.get('DE')).toBe('current');
    expect(m.get('IT')).toBe('future');
    expect(m.get('ES')).toBe('future');
  });
  it('ignores countries it cannot resolve', () => {
    expect(countryStatuses([L('Atlantis', '2026-07-01', '2026-07-02')], '2026-07-06').size).toBe(0);
  });
});
