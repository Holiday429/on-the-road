import { describe, expect, it } from 'vitest';
import {
  resolvePlaceRef, textQuery, legGroups, nomadGroups, tripGroups, groupsPlaces, exportScopes,
  type ExportPlace,
} from './places-export.ts';
import type { Leg, NomadSpot } from './schema.ts';

const place = (over: Partial<ExportPlace> = {}): ExportPlace => ({ name: 'Louvre', source: 'plan', ...over });

describe('resolvePlaceRef', () => {
  it('prefers placeId over coords and text', () => {
    const ref = resolvePlaceRef(place({ placeId: 'ChIJabc', lat: 48.86, lng: 2.33, city: 'Paris' }));
    expect(ref).toEqual({ kind: 'placeId', query: 'Louvre, Paris', placeId: 'ChIJabc' });
  });

  it('falls back to coords, formatted to 6 dp', () => {
    expect(resolvePlaceRef(place({ lat: 48.8606, lng: 2.3376 }))).toEqual({ kind: 'coords', query: '48.860600,2.337600' });
  });

  it('treats lat=0 / lng=0 as valid coordinates', () => {
    expect(resolvePlaceRef(place({ lat: 0, lng: 0 }))?.kind).toBe('coords');
  });

  it('falls back to a text query', () => {
    expect(resolvePlaceRef(place({ address: 'Rue de Rivoli', city: 'Paris' }))).toEqual({
      kind: 'text', query: 'Louvre, Rue de Rivoli, Paris',
    });
  });

  it('returns null for a blank, coordinate-less place', () => {
    expect(resolvePlaceRef(place({ name: '  ' }))).toBeNull();
  });
});

describe('textQuery', () => {
  it('does not repeat a city already in the address', () => {
    expect(textQuery({ name: 'Cafe X', address: '1 Rue A, Paris', city: 'Paris' })).toBe('Cafe X, 1 Rue A, Paris');
  });

  it('does not repeat the name when the address starts with it', () => {
    expect(textQuery({ name: 'Hotel Z', address: 'Hotel Z, 5 Main St', city: '' })).toBe('Hotel Z, 5 Main St');
  });
});

/* Minimal Leg factory — only the fields the grouping reads. */
function leg(over: Partial<Leg> = {}): Leg {
  return {
    id: 'l1', city: 'Paris', country: 'France', flag: '', dateFrom: '2026-05-01', dateTo: '2026-05-04',
    tripId: null, order: 0, ...over,
  } as Leg;
}
const item = (id: string, title: string, dayId: string | null, order = 0) =>
  ({ id, title, dayId, order, category: '', done: false });

describe('legGroups', () => {
  const base = leg({
    planDays: [
      { id: 'd2', date: '2026-05-02', label: '', notes: '', order: 1 },
      { id: 'd1', date: '2026-05-01', label: 'Arrival', notes: '', order: 0 },
      { id: 'd3', date: '2026-05-03', label: '', notes: '', order: 2 },
    ],
    plans: [
      item('a', 'Orsay', 'd2', 1), item('b', 'Louvre', 'd1', 0), item('c', 'Orsay 2', 'd2', 0),
      item('p', 'Pool item', null), item('x', 'Orphan', 'gone'),
    ] as Leg['plans'],
    accommodations: [{ name: 'Hotel A', confirmed: false, order: 0 }, { name: '  ', confirmed: false, order: 1 }],
  });

  it('orders days by order and items within a day by order, skipping empty days', () => {
    const groups = legGroups(base).filter(g => g.kind === 'day');
    expect(groups.map(g => g.title)).toEqual([
      'Paris · Day 1 (2026-05-01) Arrival',
      'Paris · Day 2 (2026-05-02)',
    ]);
    expect(groups[1].places.map(p => p.name)).toEqual(['Orsay 2', 'Orsay']);
  });

  it('puts unassigned and orphaned-day items in the pool', () => {
    const pool = legGroups(base).find(g => g.kind === 'pool')!;
    expect(pool.places.map(p => p.name).sort()).toEqual(['Orphan', 'Pool item']);
  });

  it('includes non-blank stays, and omits them when asked', () => {
    expect(legGroups(base).find(g => g.kind === 'stays')!.places.map(p => p.name)).toEqual(['Hotel A']);
    expect(legGroups(base, { includeStays: false }).some(g => g.kind === 'stays')).toBe(false);
  });

  it('falls back to the legacy single accommodation', () => {
    const g = legGroups(leg({ accommodation: { name: 'Old Inn', confirmed: false, order: 0 } })).find(x => x.kind === 'stays');
    expect(g?.places[0].name).toBe('Old Inn');
  });
});

describe('nomadGroups / tripGroups', () => {
  const spot = (name: string, city: string, placeId?: string) =>
    ({ id: name, name, city, placeId, type: 'Café' }) as unknown as NomadSpot;

  it('groups nomad spots by city and keeps placeId', () => {
    const groups = nomadGroups([spot('A', 'Lisbon', 'p1'), spot('B', 'Porto'), spot('C', 'Lisbon')]);
    expect(groups.map(g => [g.city, g.places.length])).toEqual([['Lisbon', 2], ['Porto', 1]]);
    expect(groups[0].places[0].placeId).toBe('p1');
  });

  it('orders legs by order then date, with nomad groups last', () => {
    const l1 = leg({ id: 'l1', city: 'Rome', order: 1, plans: [item('a', 'Colosseum', null)] as Leg['plans'] });
    const l0 = leg({ id: 'l0', city: 'Paris', order: 0, plans: [item('b', 'Louvre', null)] as Leg['plans'] });
    const names = groupsPlaces(tripGroups([l1, l0], [spot('Cafe', 'Rome')]));
    expect(names.map(p => p.name)).toEqual(['Louvre', 'Colosseum', 'Cafe']);
  });
});

describe('exportScopes', () => {
  const spot = (name: string, city: string) => ({ id: name, name, city, type: 'Café' }) as unknown as NomadSpot;
  const paris = leg({ id: 'p', city: 'Paris', flag: '🇫🇷', order: 0, plans: [item('a', 'Louvre', null)] as Leg['plans'] });
  const empty = leg({ id: 'e', city: 'Nowhere', order: 1 });
  const rome = leg({ id: 'r', city: 'Rome', order: 2, plans: [item('b', 'Colosseum', null)] as Leg['plans'] });

  it('leads with the whole trip, then one scope per leg that has places', () => {
    const scopes = exportScopes([rome, empty, paris], [spot('Cafe', 'rome')]);
    expect(scopes.map(s => s.id)).toEqual(['trip', 'p', 'r']);
    expect(scopes[1].label).toBe('🇫🇷 Paris');
  });

  it('attaches nomad spots to the matching city case-insensitively', () => {
    const rome2 = exportScopes([rome], [spot('Cafe', ' ROME ')]).find(s => s.id === 'r')!;
    expect(groupsPlaces(rome2.groups).map(p => p.name)).toEqual(['Colosseum', 'Cafe']);
  });

  it('returns no scopes when nothing is exportable', () => {
    expect(exportScopes([empty])).toEqual([]);
  });
});
