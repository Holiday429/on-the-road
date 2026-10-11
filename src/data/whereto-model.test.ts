import { describe, expect, it } from 'vitest';
import type { CityIntel, NomadSpot } from './schema.ts';
import { cityHasRecommendations, tripHasRecommendations, wtgCards } from './whereto-model.ts';

const card = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, highlight: 'h', cost: '', imageUrl: '', photographer: '', photographerUrl: '', ...extra });
const intel = [{
  city: 'Rome',
  attractions: [card('a1', 'Colosseum', { imageUrl: 'x.jpg' }), card('a2', 'Forum')],
  experiences: [card('e1', 'Vespa tour')],
  restaurants: [card('r1', 'Da Enzo'), card('r2', 'Roscioli')],
  cafes: [card('c1', 'Sant Eustachio')],
}] as unknown as CityIntel[];
const spots = [
  { id: 'n1', name: 'Co-work Roma', city: 'rome', type: 'Co-working', ratings: { wifi: 5, power: 4, restroom: 0, coffee: 3, service: 2 }, comment: 'Quiet' },
  { id: 'n2', name: 'Lisbon Lab', city: 'Lisbon', type: 'Café', ratings: {} },
] as unknown as NomadSpot[];

describe('wtgCards', () => {
  it('filters by tab; sights include experiences', () => {
    expect(wtgCards('sights', 'Rome', intel, spots).map((c) => c.title)).toEqual(['Colosseum', 'Forum', 'Vespa tour']);
    expect(wtgCards('food', 'Rome', intel, spots).map((c) => c.title)).toEqual(['Da Enzo', 'Roscioli']);
    expect(wtgCards('coffee', 'Rome', intel, spots).map((c) => c.title)).toEqual(['Sant Eustachio']);
  });
  it('work tab lists the traveller\'s spots (city match is case-insensitive) with the top three scores', () => {
    const w = wtgCards('work', 'Rome', intel, spots);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ type: 'work', icon: '💼', subtype: 'Co-working', highlight: 'Quiet' });
    expect(w[0].ratings).toEqual([['📶', 5], ['🔌', 4], ['☕', 3]]);
  });
  it('all mixes categories round-robin and respects the limit', () => {
    const all = wtgCards('all', 'Rome', intel, spots);
    expect(all.map((c) => c.type).slice(0, 5)).toEqual(['attraction', 'experience', 'restaurant', 'cafe', 'work']);
    expect(wtgCards('all', 'Rome', intel, spots, 3)).toHaveLength(3);
  });
  it('carries photo fields only when present', () => {
    const [first, second] = wtgCards('sights', 'Rome', intel, spots);
    expect(first.imageUrl).toBe('x.jpg');
    expect(second.imageUrl).toBeUndefined();
  });
  it('is empty for an unknown city or tab with nothing', () => {
    expect(wtgCards('all', 'Oslo', intel, spots)).toEqual([]);
    expect(wtgCards('work', 'Paris', intel, spots)).toEqual([]);
  });
});

describe('recommendation presence', () => {
  it('a city counts if it has guide picks or a work spot', () => {
    expect(cityHasRecommendations('Rome', intel, [])).toBe(true);
    expect(cityHasRecommendations('Lisbon', intel, spots)).toBe(true);   // work spot only
    expect(cityHasRecommendations('Oslo', intel, spots)).toBe(false);
  });
  it('the trip has some if any city does; none → hide the block', () => {
    expect(tripHasRecommendations(['Oslo', 'Rome'], intel, [])).toBe(true);
    expect(tripHasRecommendations(['Oslo', 'Bergen'], intel, spots)).toBe(false);
    expect(tripHasRecommendations([], intel, spots)).toBe(false);
  });
});
