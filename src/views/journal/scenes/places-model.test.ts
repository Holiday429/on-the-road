import { describe, expect, it } from 'vitest';
import { buildStops, byCountry, countryKey, countryName, flagOf, latestStop, mapPins, NO_PLACE, placeKey, resolveChosen, routeNodes, type LegLike } from './places-model.ts';
import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';

let n = 0;
const e = (destination: string, happenedOn: string): StoredJournalEntry => ({
  id: `p${++n}`, createdAt: 1, updatedAt: 1, schemaVersion: 1, tripId: null, title: '', body: 'x', template: 'moment',
  destination, tags: [], happenedOn, favorite: false, visibility: 'private', slug: '', images: [],
} as StoredJournalEntry);

describe('places model', () => {
  it('sets the stops out in the order they were reached, entries inside newest first', () => {
    const stops = buildStops([e('Paris', '2026-07-01'), e('Lisbon', '2026-06-02'), e('Lisbon', '2026-06-09'), e('Berlin', '2026-08-01')]);
    expect(stops.map((s) => s.label)).toEqual(['Lisbon', 'Paris', 'Berlin']);
    const lisbon = stops[0];
    expect(lisbon.entries).toHaveLength(2);
    expect(lisbon.entries[0].happenedOn).toBe('2026-06-09');
    expect([lisbon.from, lisbon.to]).toEqual(['2026-06-02', '2026-06-09']);
  });

  it('places a known city with its coordinates and country; an unknown one keeps its stop without a pin', () => {
    const [lisbon, nowhere] = buildStops([e('Lisbon', '2026-06-02'), e('Zzyzx Springs', '2026-06-03')]);
    expect(lisbon.iso).toBe('PT');
    expect(lisbon.lat).not.toBeNull();
    expect(nowhere.lat).toBeNull();
    expect(nowhere.iso).toBeNull();
    const { pins, countries } = mapPins([lisbon, nowhere]);
    expect(pins.map((p) => p.label)).toEqual(['Lisbon']);
    expect(countries).toEqual(['PT']);
  });

  it('entries with no place share one stop; compound labels use their first city', () => {
    const stops = buildStops([e('', '2026-06-02'), e('', '2026-06-03'), e('Lisbon / Sintra', '2026-06-04'), e('Lisbon', '2026-06-05')]);
    expect(stops.find((s) => s.label === NO_PLACE)!.entries).toHaveLength(2);
    expect(stops.filter((s) => s.key === 'lisbon')).toHaveLength(1);
    expect(placeKey('Lisbon / Sintra')).toBe('lisbon');
  });

  it('the latest stop is the one written about most recently', () => {
    const stops = buildStops([e('Lisbon', '2026-06-02'), e('Paris', '2026-07-01'), e('Lisbon', '2026-09-09')]);
    expect(latestStop(stops)!.label).toBe('Lisbon');
    expect(latestStop([])).toBeNull();
  });

  it('flag emoji from an ISO code', () => {
    expect(flagOf('PT')).toBe('🇵🇹');
    expect(flagOf(null)).toBe('📍');
    expect(flagOf('xx1')).toBe('📍');
  });

  it('gathers the stops by country, in the order the countries were reached', () => {
    const stops = buildStops([
      e('Paris', '2026-07-01'), e('Lisbon', '2026-06-02'), e('Porto', '2026-06-20'), e('Zzyzx Springs', '2026-06-03'),
    ]);
    const groups = byCountry(stops);
    expect(groups.map((g) => g.iso)).toEqual(['PT', 'FR', '']);
    expect(groups[0].stops.map((s) => s.label)).toEqual(['Lisbon', 'Porto']);
    expect(groups[0].entries).toBe(2);
    // the stops with no country of their own come last, under one heading
    expect(groups[2].stops[0].label).toBe('Zzyzx Springs');
  });

  it('names a country from its code, and leaves an unknown code alone', () => {
    expect(countryName('PT')).toBe('Portugal');
    expect(countryName('ZZ')).toBe('ZZ');
  });

  const leg = (city: string, country: string, dateFrom: string, dateTo: string): LegLike => ({ city, country, flag: '', dateFrom, dateTo });

  it('files a small place under the country of the leg it was written in, not under elsewhere', () => {
    const legs = [leg('Rome', 'Italy', '2026-08-01', '2026-08-10'), leg('Lisbon', 'Portugal', '2026-06-01', '2026-06-10')];
    const stops = buildStops([
      e('Lisbon', '2026-06-02'),
      e('Vernazza', '2026-08-04'),            // a village the city table does not know: by the calendar
      e('Cinque Terre, Italy', '2026-08-05'),  // a country named in the label
      e('Zzyzx Springs', '2026-12-25'),        // nowhere near any leg
    ], legs);
    expect(stops.find((s) => s.label === 'Vernazza')!.iso).toBe('IT');
    expect(stops.find((s) => s.label === 'Cinque Terre, Italy')!.iso).toBe('IT');
    const groups = byCountry(stops);
    expect(groups.map((g) => g.iso)).toEqual(['PT', 'IT', '']);
    expect(groups[1].stops.map((s) => s.label)).toEqual(['Vernazza', 'Cinque Terre, Italy']);
    expect(groups[2].stops.map((s) => s.label)).toEqual(['Zzyzx Springs']);
  });

  it('picks a whole country or one place inside it, falling back to the latest country', () => {
    const stops = buildStops([e('Lisbon', '2026-06-02'), e('Porto', '2026-06-20'), e('Paris', '2026-07-01')]);
    const groups = byCountry(stops);
    expect(resolveChosen(groups, stops, null).group.iso).toBe('FR');
    const pt = resolveChosen(groups, stops, countryKey('PT'));
    expect(pt.stop).toBeNull();
    expect(pt.entries).toHaveLength(2);
    const porto = resolveChosen(groups, stops, 'porto');
    expect(porto.group.iso).toBe('PT');
    expect(porto.stop!.label).toBe('Porto');
    expect(resolveChosen(groups, stops, 'c:XX').group.iso).toBe('FR');
  });

  it('puts the route stops in travel order, with the dates the map needs', () => {
    const nodes = routeNodes([
      leg('Paris', 'France', '2026-07-01', '2026-07-05'),
      leg('Lisbon', 'Portugal', '2026-06-01', '2026-06-10'),
      leg('Rome', 'Italy', '2026-08-01', '2026-08-10'),
    ]);
    expect(nodes.map((n) => n.iso)).toEqual(['PT', 'FR', 'IT']);
    // the dates ride along so route-layer can split the line at today
    expect(nodes.map((n) => n.dateFrom)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01']);
  });
});
