import { describe, expect, it } from 'vitest';
import {
  haversineKm, summarizeRoute, buildCountryStops,
  aggregateExpensesByIso, fmtKm, fmtSpend,
  type PlottedLeg, type FlightChain,
} from './map-stats.ts';

/* Minimal PlottedLeg factory — only the fields the stats functions read. */
function leg(over: Partial<PlottedLeg> & { iso: string | null; lat: number; lng: number }): PlottedLeg {
  return {
    id: over.id ?? 'l',
    city: over.city ?? 'City',
    country: over.country ?? 'Country',
    flag: '',
    dateFrom: over.dateFrom ?? '2026-01-01',
    dateTo: over.dateTo ?? '2026-01-03',
    lat: over.lat,
    lng: over.lng,
    iso: over.iso,
    stops: over.stops ?? [],
  };
}

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm({ lat: 48.85, lng: 2.35 }, { lat: 48.85, lng: 2.35 })).toBe(0);
  });

  it('matches the known Paris→Rome great-circle distance (~1100 km)', () => {
    const d = haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 41.9028, lng: 12.4964 });
    expect(d).toBeGreaterThan(1080);
    expect(d).toBeLessThan(1130);
  });

  it('is symmetric', () => {
    const a = { lat: 10, lng: 20 }, b = { lat: -30, lng: 100 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});

describe('summarizeRoute', () => {
  it('counts unique countries, continents, nights, and legs', () => {
    const legs = [
      leg({ id: 'a', iso: 'FR', country: 'France', lat: 48.85, lng: 2.35, dateFrom: '2026-01-01', dateTo: '2026-01-04', stops: [{ key: 'paris', name: 'Paris', lat: 48.85, lng: 2.35 }] }),
      leg({ id: 'b', iso: 'IT', country: 'Italy',  lat: 41.90, lng: 12.5, dateFrom: '2026-01-04', dateTo: '2026-01-06', stops: [{ key: 'rome', name: 'Rome', lat: 41.9, lng: 12.5 }] }),
    ];
    const s = summarizeRoute(legs);
    expect(s.legCount).toBe(2);
    expect(s.countryCount).toBe(2);
    expect(s.cityCount).toBe(2);
    expect(s.nightCount).toBe(5);          // 3 + 2 nights
    expect(s.distanceKm).toBeGreaterThan(1000); // Paris→Rome leg-to-leg hop
  });

  it('de-duplicates repeated countries and cities', () => {
    const legs = [
      leg({ id: 'a', iso: 'FR', country: 'France', lat: 48.85, lng: 2.35, stops: [{ key: 'paris', name: 'Paris', lat: 48.85, lng: 2.35 }] }),
      leg({ id: 'b', iso: 'FR', country: 'France', lat: 43.6, lng: 1.44, stops: [{ key: 'paris', name: 'Paris', lat: 48.85, lng: 2.35 }] }),
    ];
    const s = summarizeRoute(legs);
    expect(s.countryCount).toBe(1);
    expect(s.cityCount).toBe(1); // same iso:key → one unique city
  });

  it('adds the home-flight chains to the total distance when provided', () => {
    const legs = [leg({ id: 'a', iso: 'FR', country: 'France', lat: 48.85, lng: 2.35 })];
    const withoutChains = summarizeRoute(legs);
    const outbound: FlightChain = { label: '', sub: '', waypoints: [{ lat: 51.5, lng: -0.12 }, { lat: 48.85, lng: 2.35 }] };
    const withChain = summarizeRoute(legs, outbound);
    expect(withChain.distanceKm).toBeGreaterThan(withoutChains.distanceKm);
  });

  it('handles an empty route', () => {
    const s = summarizeRoute([]);
    expect(s).toEqual({ cityCount: 0, countryCount: 0, continentCount: 0, nightCount: 0, distanceKm: 0, legCount: 0 });
  });
});

describe('buildCountryStops', () => {
  it('returns distinct stops for the given country code only', () => {
    const legs = [
      leg({ id: 'a', iso: 'FR', country: 'France', lat: 48.85, lng: 2.35, stops: [
        { key: 'paris', name: 'Paris', lat: 48.85, lng: 2.35 },
        { key: 'lyon', name: 'Lyon', lat: 45.76, lng: 4.83 },
      ] }),
      leg({ id: 'b', iso: 'IT', country: 'Italy', lat: 41.9, lng: 12.5, stops: [
        { key: 'rome', name: 'Rome', lat: 41.9, lng: 12.5 },
      ] }),
      leg({ id: 'c', iso: 'FR', country: 'France', lat: 43.3, lng: 5.37, stops: [
        { key: 'paris', name: 'Paris', lat: 48.85, lng: 2.35 }, // dup key
      ] }),
    ];
    const fr = buildCountryStops(legs, 'FR');
    expect(fr.map((s) => s.key).sort()).toEqual(['lyon', 'paris']);
    expect(buildCountryStops(legs, 'IT').map((s) => s.key)).toEqual(['rome']);
  });
});

describe('aggregateExpensesByIso', () => {
  it('sums baseAmount per resolved ISO and skips unresolvable countries', () => {
    const rows = [
      { country: 'France', baseAmount: 100 },
      { country: 'France', baseAmount: 50 },
      { country: 'Italy', baseAmount: 30 },
      { country: 'Atlantis', baseAmount: 999 }, // no ISO → skipped
    ];
    const byIso = aggregateExpensesByIso(rows);
    expect(byIso.get('FR')).toBe(150);
    expect(byIso.get('IT')).toBe(30);
    expect(byIso.has('Atlantis')).toBe(false);
    expect([...byIso.keys()].sort()).toEqual(['FR', 'IT']);
  });

  it('treats a missing baseAmount as zero', () => {
    const byIso = aggregateExpensesByIso([{ country: 'France' }, { country: 'France', baseAmount: 20 }]);
    expect(byIso.get('FR')).toBe(20);
  });
});

describe('fmtKm', () => {
  it('groups thousands with a comma under 10k', () => {
    expect(fmtKm(8420)).toBe('8,420');
    expect(fmtKm(999)).toBe('999');
  });
  it('switches to a "k" suffix with one decimal at 10k+', () => {
    expect(fmtKm(12500)).toBe('12.5k');
    expect(fmtKm(10000)).toBe('10.0k');
  });
});

describe('fmtSpend', () => {
  it('formats as whole-unit currency in the given code', () => {
    expect(fmtSpend(1234, 'USD')).toBe('$1,234');
  });
  it('defaults to EUR when no currency is given', () => {
    expect(fmtSpend(1000)).toContain('1,000');
  });
  it('falls back to a rounded integer string for an invalid currency code', () => {
    expect(fmtSpend(42.7, 'NOT_A_CODE')).toBe('43');
  });
});
