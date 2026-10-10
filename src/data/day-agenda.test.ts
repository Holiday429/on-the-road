import { describe, it, expect } from 'vitest';
import { agendaForDay, kindsByDate, datePart, timePart, addDays, undatedTodos } from './day-agenda.ts';

const lisbon: any = {
  id: 'L', city: 'Lisbon', country: 'Portugal', flag: '🇵🇹', dateFrom: '2026-08-08', dateTo: '2026-08-12',
  accommodations: [{ id: 'a1', name: 'Surfbird', checkIn: '2026-08-08', checkOut: '2026-08-12 10:00', confirmed: true }],
};
const rome: any = {
  id: 'R', city: 'Rome', country: 'Italy', flag: '🇮🇹', dateFrom: '2026-08-12', dateTo: '2026-08-15',
  arrivalTransport: { type: 'flight', from: 'Lisbon', to: 'Rome', date: '2026-08-12', time: '14:55', service: 'TP836', confirmed: true },
  accommodations: [{ id: 'a2', name: 'Room in Rome', checkIn: '2026-08-12 16:00', checkOut: '2026-08-15', confirmed: false }],
  planDays: [{ id: 'day-x', date: '2026-08-12', label: '', notes: '', order: 0 }, { id: 'day-y', date: '2026-08-13', label: 'Museum day', notes: '', order: 1 }],
  plans: [
    { id: 'p1', title: 'Pantheon', category: 'museum', dayId: 'day-y', done: false, order: 1 },
    { id: 'p2', title: 'Coffee', category: 'cafe', dayId: 'day-y', done: true, order: 0 },
    { id: 'p3', title: 'Unassigned', category: '', dayId: null, done: false, order: 0 },
  ],
};
const src = (over: any = {}) => ({ legs: [rome, lisbon], journal: [], todos: [], expenses: [], ...over });

describe('date helpers', () => {
  it('parses date/time parts defensively', () => {
    expect(datePart('2026-08-12 16:00')).toBe('2026-08-12');
    expect(datePart('12/08')).toBeNull();
    expect(timePart('2026-08-12 16:00')).toBe('16:00');
    expect(timePart('2026-08-12')).toBeNull();
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });
});

describe('agendaForDay — change-of-city day', () => {
  const d = agendaForDay('2026-08-12', src());
  it('headlines the arriving leg and remembers the one being left', () => {
    expect(d.leg?.city).toBe('Rome');
    expect(d.leavingLeg?.city).toBe('Lisbon');
    expect(d.dayInLeg).toEqual({ n: 1, total: 4 });
    expect(d.flags.isArrival && d.flags.isDeparture).toBe(true);
  });
  it('orders check-out → flight → check-in across legs', () => {
    const order = d.items.filter((i) => i.kind !== 'context').map((i) => i.id);
    expect(order).toEqual(['stay-out-a1', 'transport-R', 'stay-in-a2']);   // 10:00, 14:55, 16:00
  });
});

describe('agendaForDay — other days', () => {
  it('mid-stay night yields a quiet untimed "Staying" card', () => {
    const d = agendaForDay('2026-08-10', src());
    expect(d.items.some((i) => i.id === 'stay-at-a1' && i.time === null)).toBe(true);
  });
  it('resolves plan items through planDays, in order, and ignores unassigned', () => {
    const d = agendaForDay('2026-08-13', src());
    expect(d.planDayLabel).toBe('Museum day');
    expect(d.items.filter((i) => i.kind === 'plan').map((i) => i.title)).toEqual(['Coffee', 'Pantheon']);
  });
  it('rolls spend into one card and keeps journal separate', () => {
    const exp = [
      { date: '2026-08-13', amount: 5, currency: 'EUR', baseAmount: 5, baseCurrency: 'EUR', description: 'coffee', category: 'food' },
      { date: '2026-08-13', amount: 20, currency: 'EUR', baseAmount: 20, baseCurrency: 'EUR', description: 'lunch', category: 'food' },
    ];
    const d = agendaForDay('2026-08-13', src({ expenses: exp, journal: [{ id: 'j', happenedOn: '2026-08-13', createdAt: 1 }] }));
    const spend = d.items.filter((i) => i.kind === 'spend');
    expect(spend).toHaveLength(1);
    expect(spend[0].subtitle).toBe('2 expenses');
    expect(spend[0].details[0].label).toBe('lunch');   // biggest first
    expect(d.journalEntries).toHaveLength(1);
  });
  it('only lists open to-dos due that day', () => {
    const todos: any[] = [{ id: 't1', text: 'Roma Pass', dueDate: '2026-08-13', done: false }, { id: 't2', text: 'x', dueDate: '2026-08-13', done: true }, { id: 't3', text: 'floating', dueDate: null, done: false }];
    const d = agendaForDay('2026-08-13', src({ todos }));
    expect(d.items.filter((i) => i.kind === 'todo').map((i) => i.title)).toEqual(['Roma Pass']);
    expect(undatedTodos(todos).map((t) => t.text)).toEqual(['floating']);
  });
  it('flags eve of departure and last day of trip', () => {
    expect(agendaForDay('2026-08-14', src()).flags.isEveOfDeparture).toBe(true);
    expect(agendaForDay('2026-08-15', src()).flags.isLastDayOfTrip).toBe(true);
  });
  it('is empty outside the trip', () => {
    const d = agendaForDay('2027-01-01', src());
    expect(d.isEmpty).toBe(true);
    expect(d.leg).toBeNull();
  });
});

describe('kindsByDate', () => {
  const m = kindsByDate(src({ journal: [{ happenedOn: '2026-08-13' }], expenses: [{ date: '2026-08-13' }] }));
  it('marks the same dates the cards appear on', () => {
    expect([...m.get('2026-08-12')!].sort()).toEqual(['stay', 'transport']);
    expect(m.get('2026-08-10')?.has('stay')).toBe(true);           // mid-stay
    expect([...m.get('2026-08-13')!].sort()).toEqual(['journal', 'plan', 'spend', 'stay']);
  });
});
