/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { agendaForDay } from './day-agenda.ts';
import { setLocale } from '../core/i18n.ts';

const rome: any = {
  id: 'R', city: 'Rome', country: 'Italy', flag: '🇮🇹', dateFrom: '2026-08-12', dateTo: '2026-08-16',
  arrivalTransport: { type: 'flight', from: 'Lisbon', to: 'Rome', date: '2026-08-12', time: '14:55', service: 'TP836', confirmed: true },
  accommodations: [{ id: 'a2', name: 'Room in Rome', address: 'Via X', checkIn: '2026-08-12 16:00', checkOut: '2026-08-16', confirmed: false }],
};
const src = { legs: [rome], journal: [], todos: [], expenses: [] } as any;

describe('agenda text follows the locale', () => {
  it('translates subtitles and detail labels', () => {
    setLocale('zh');
    try {
      const d = agendaForDay('2026-08-12', src);
      const stayIn = d.items.find((i) => i.id === 'stay-in-a2')!;
      expect(stayIn.subtitle).toBe('入住 · Rome');
      expect(d.items.find((i) => i.id === 'transport-R')!.subtitle).toContain('航班');
      expect(stayIn.details.map((r) => r.label)).toContain('地址');
    } finally { setLocale('en'); }
    expect(agendaForDay('2026-08-12', src).items.find((i) => i.id === 'stay-in-a2')!.subtitle).toBe('Check in · Rome');
  });
});
