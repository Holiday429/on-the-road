import { describe, expect, it } from 'vitest';
import {
  scopeToggleMarkup, statsMarkup, flightRowMarkup, legListMarkup, unlocatedMarkup, stageInnerMarkup,
} from './map-panel.ts';
import type { PlottedLeg } from './map-stats.ts';

const leg = (over: Partial<PlottedLeg>): PlottedLeg => ({
  id: 'l1', city: 'Paris', country: 'France', flag: '🇫🇷', dateFrom: '2026-10-10', dateTo: '2026-10-13',
  lat: 48.85, lng: 2.35, iso: 'FR', stops: [], ...over,
});

describe('legListMarkup', () => {
  const base = { scope: 'trip' as const, activeId: null, today: '2026-10-12', locale: 'en-US' };

  it('tags stops that start after today as Planned, and only those', () => {
    const html = legListMarkup([
      leg({ id: 'a', city: 'Paris', dateFrom: '2026-10-10', dateTo: '2026-10-12' }),
      leg({ id: 'b', city: 'Rome', dateFrom: '2026-10-13', dateTo: '2026-10-15' }),
    ], base);
    const rows = html.split('<button').slice(1);
    expect(rows[0]).not.toContain('planned');
    expect(rows[1]).toContain('leg-row-planned');
    expect(rows[1]).toContain('class="leg-row  planned"');
  });

  it('marks the active row and numbers the stops', () => {
    const html = legListMarkup([leg({ id: 'a' }), leg({ id: 'b', city: 'Rome' })], { ...base, activeId: 'b' });
    expect(html).toContain('leg-row-num">1<');
    expect(html).toContain('leg-row-num">2<');
    expect(html.match(/leg-row active/g)).toHaveLength(1);
  });

  it('adds a trip label whenever the trip changes in all-footprints mode', () => {
    const html = legListMarkup([
      leg({ id: 'a', tripId: 't1', tripName: 'Spring' }),
      leg({ id: 'b', tripId: 't1', tripName: 'Spring' }),
      leg({ id: 'c', tripId: 't2', tripName: 'Autumn' }),
    ], { ...base, scope: 'all' });
    expect(html.match(/leg-trip-label/g)).toHaveLength(2);
    expect(legListMarkup([leg({ tripId: 't1' })], base)).not.toContain('leg-trip-label');
  });

  it('escapes user text', () => {
    const html = legListMarkup([leg({ city: '<img onerror=x>' })], base);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('pluralises nights', () => {
    expect(legListMarkup([leg({ dateFrom: '2026-10-10', dateTo: '2026-10-11' })], base)).toContain('1 night<');
    expect(legListMarkup([leg({ dateFrom: '2026-10-10', dateTo: '2026-10-13' })], base)).toContain('3 nights<');
  });
});

describe('unlocatedMarkup', () => {
  it('renders nothing when every stop was placed', () => {
    expect(unlocatedMarkup([])).toBe('');
  });
  it('lists the stops that could not be placed, with a count', () => {
    const html = unlocatedMarkup([{ legId: 'a', place: 'Nowhere' }, { legId: 'b', place: 'Elsewhere' }]);
    expect(html).toContain('2 not on the map');
    expect(html).toContain('<li>Nowhere</li>');
    expect(html).toContain('<li>Elsewhere</li>');
  });
  it('escapes place names', () => {
    expect(unlocatedMarkup([{ legId: 'a', place: '<b>x</b>' }])).toContain('&lt;b&gt;');
  });
});

describe('scope toggle / stats / flight row / stage', () => {
  it('marks the current scope active', () => {
    expect(scopeToggleMarkup('all')).toMatch(/map-scope-btn active" data-scope="all"/);
    expect(scopeToggleMarkup('trip')).toMatch(/map-scope-btn active" data-scope="trip"/);
  });

  const summary = { cityCount: 4, countryCount: 3, continentCount: 1, nightCount: 12, distanceKm: 12500, legCount: 5 };
  it('shows two cards for a trip and six for all footprints', () => {
    expect(statsMarkup(summary, 'trip', 'en-US').match(/map-stat-num/g)).toHaveLength(2);
    const all = statsMarkup(summary, 'all', 'en-US');
    expect(all.match(/map-stat-num/g)).toHaveLength(6);
    expect(all).toContain('12.5k');
    expect(all).toContain('Continent<');
  });

  it('renders no flight row without a chain', () => {
    expect(flightRowMarkup(null, 'flight-outbound', null)).toBe('');
    const html = flightRowMarkup({ label: 'A → B', sub: 'A · B', waypoints: [] }, 'flight-outbound', 'flight-outbound');
    expect(html).toContain('leg-flight-row active');
  });

  it('has the ids map.ts wires up', () => {
    const html = stageInnerMarkup();
    for (const id of ['mapChart', 'mapReplay', 'mapExport', 'mapBack', 'mapZoomIn', 'mapZoomFit', 'mapZoomOut', 'mapLoading', 'mapTooltip']) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});
