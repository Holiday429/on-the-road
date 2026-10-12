import { describe, expect, it } from 'vitest';
import {
  isoForCountry, continentFor, haversineKm, pickAnchor, geocodeKey, EUROPE_CENTER, STALE_ANCHOR_KM,
} from './geo-index.ts';

describe('isoForCountry', () => {
  it('matches the picker label, case-insensitively', () => {
    expect(isoForCountry('Denmark')).toBe('DK');
    expect(isoForCountry('germany')).toBe('DE');
    expect(isoForCountry('  United   Kingdom ')).toBe('GB');
  });

  it('knows the aliases the destination picker lists as keywords', () => {
    expect(isoForCountry('Czechia')).toBe('CZ');
    expect(isoForCountry('UK')).toBe('GB');
    expect(isoForCountry('USA')).toBe('US');
    expect(isoForCountry('Holland')).toBe('NL');
    expect(isoForCountry('Korea')).toBe('KR');
    expect(isoForCountry('Türkiye')).toBe('TR');
    expect(isoForCountry('UAE')).toBe('AE');
    expect(isoForCountry('The Netherlands')).toBe('NL');
  });

  it('falls back to the flag emoji when the name is unknown', () => {
    expect(isoForCountry('Atlantis', '🇩🇰')).toBe('DK');
    expect(isoForCountry('Atlantis')).toBeNull();
    expect(isoForCountry('')).toBeNull();
  });

  it('finds a country name inside longer text, as a whole word', () => {
    expect(isoForCountry('Denmark (Copenhagen)')).toBe('DK');
    expect(isoForCountry('Trip to the Czech Republic')).toBe('CZ');
    expect(isoForCountry('Road trip, South Korea 2026')).toBe('KR');
    // a name only counts as a whole word: "Oman" is not found inside "Romania"
    expect(isoForCountry('Romanian highlands')).toBeNull();
    expect(isoForCountry('Romania')).toBe('RO');
  });
});

describe('continentFor / EUROPE_CENTER', () => {
  it('maps known ISOs and leaves unknown ones out', () => {
    expect(continentFor('DK')).toBe('Europe');
    expect(continentFor('JP')).toBe('Asia');
    expect(continentFor('ZZ')).toBeNull();
  });
  it('has a single Europe centre', () => {
    expect(EUROPE_CENTER.longitude).toBeGreaterThan(0);
    expect(EUROPE_CENTER.latitude).toBeGreaterThan(40);
  });
});

describe('haversineKm', () => {
  it('Paris → Rome is about 1100 km', () => {
    const d = haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 41.9028, lng: 12.4964 });
    expect(d).toBeGreaterThan(1080);
    expect(d).toBeLessThan(1130);
  });
});

describe('pickAnchor', () => {
  const paris = { lat: 48.8566, lng: 2.3522 };
  const rome = { lat: 41.9028, lng: 12.4964 };

  it('prefers the saved point (cheapest source)', () => {
    const near = { lat: paris.lat + 0.1, lng: paris.lng };
    expect(pickAnchor(near, paris)).toEqual(near);
  });
  it('uses the saved point when the city is not in any local table', () => {
    expect(pickAnchor(paris, null)).toEqual(paris);
  });
  it('uses the local lookup when nothing was saved', () => {
    expect(pickAnchor(undefined, rome)).toEqual(rome);
    expect(pickAnchor({}, rome)).toEqual(rome);
  });
  it('treats a saved point far from what the city resolves to as stale', () => {
    expect(haversineKm(paris, rome)).toBeGreaterThan(STALE_ANCHOR_KM);
    expect(pickAnchor(paris, rome)).toEqual(rome);
  });
  it('returns null when there is nothing', () => {
    expect(pickAnchor(undefined, null)).toBeNull();
  });
});

describe('geocodeKey', () => {
  it('is the bare lower-cased name without a hint', () => {
    expect(geocodeKey('  Bern ')).toBe('bern');
  });
  it('folds a country hint to its ISO so same-named cities do not collide', () => {
    expect(geocodeKey('Bern', 'Switzerland')).toBe('bern|CH');
    expect(geocodeKey('Bern', 'United States')).toBe('bern|US');
    expect(geocodeKey('Bern', 'Switzerland')).not.toBe(geocodeKey('Bern', 'United States'));
  });
  it('treats aliases of one country as the same key', () => {
    expect(geocodeKey('Leeds', 'UK')).toBe(geocodeKey('Leeds', 'United Kingdom'));
  });
  it('keeps an unknown hint as its lower-cased text', () => {
    expect(geocodeKey('Foo', 'Narnia')).toBe('foo|narnia');
  });
});
