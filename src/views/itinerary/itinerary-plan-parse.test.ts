import { describe, expect, it } from 'vitest';
import { costParts, dayLoad, loadLevel, parseHours, parseMinutes, parsePlanText } from './itinerary-plan-parse.ts';

describe('parseMinutes', () => {
  it.each([
    ['2h', 120], ['1.5h', 90], ['2h30', 150], ['2h 30min', 150], ['45min', 45], ['90 min', 90], ['2小时', 120], ['45m', 45],
  ])('%s → %i', (t, n) => expect(parseMinutes(t)).toBe(n));
  it('is 0 for unreadable text', () => {
    expect(parseMinutes('all day')).toBe(0);
    expect(parseMinutes(undefined)).toBe(0);
  });
  it('parseHours divides by 60', () => expect(parseHours('90min')).toBe(1.5));
});

describe('parsePlanText', () => {
  it('splits title, duration and a code-prefixed price', () => {
    expect(parsePlanText('Tivoli 3h kr170')).toEqual({ title: 'Tivoli', duration: '3h', cost: 'kr 170' });
  });
  it('reads symbols, minutes and a code after the amount', () => {
    expect(parsePlanText('Louvre €17 2h30')).toEqual({ title: 'Louvre', duration: '2.5h', cost: '€17' });
    expect(parsePlanText('Coffee 20min 4 eur')).toEqual({ title: 'Coffee', duration: '20min', cost: 'EUR 4' });
  });
  it('reads free and keeps a plain title untouched', () => {
    expect(parsePlanText('Nyhavn walk free 1h')).toEqual({ title: 'Nyhavn walk', duration: '1h', cost: 'free' });
    expect(parsePlanText('Round Tower')).toEqual({ title: 'Round Tower', duration: undefined, cost: undefined });
  });
  it('never returns an empty title', () => expect(parsePlanText('3h').title).toBe('3h'));
});

describe('costParts / dayLoad', () => {
  it('reads symbol, code-before and code-after prices', () => {
    expect(costParts('€18')).toEqual({ unit: '€', amount: 18 });
    expect(costParts('kr 170')).toEqual({ unit: 'kr', amount: 170 });
    expect(costParts('15 EUR')).toEqual({ unit: 'EUR', amount: 15 });
    expect(costParts('free')).toBeNull();
  });
  it('adds hours and sums cost per unit', () => {
    expect(dayLoad([{ duration: '3h', cost: '€18' }, { duration: '45min', cost: '€8' }, { cost: 'kr 100' }, {}]))
      .toEqual({ hours: 3.75, cost: '€26 + kr 100', items: 4 });
  });
  it('levels: roomy < 6h, full to 9h, over beyond', () => {
    expect([0, 3, 6, 9, 9.5].map(loadLevel)).toEqual(['empty', 'roomy', 'full', 'full', 'over']);
  });
});
