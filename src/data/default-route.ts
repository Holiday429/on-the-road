export interface RouteTransport {
  type: 'flight' | 'train' | 'bus' | 'ferry';
  from: string;
  to: string;
  date: string;
  time?: string;
  duration?: string;
  price?: string;
  confirmed: boolean;
  notes?: string;
}

export interface RouteAccommodation {
  name: string;
  address?: string;
  price?: string;
  confirmed: boolean;
  link?: string;
}

export interface RouteLegSeed {
  id: string;
  city: string;
  country: string;
  flag: string;
  dateFrom: string;
  dateTo: string;
  accommodation?: RouteAccommodation;
  arrivalTransport?: RouteTransport;
  notes?: string;
}

export const ROUTE_STORAGE_KEY = 'otr:route:legs';
const LEGACY_DEFAULT_ROUTE_IDS = [
  'leg-cph-start',
  'leg-berlin',
  'leg-amsterdam',
  'leg-brussels',
  'leg-paris',
  'leg-barcelona',
  'leg-lisbon',
  'leg-switzerland',
  'leg-italy',
  'leg-cph-end',
] as const;

export const DEFAULT_ROUTE_LEGS: RouteLegSeed[] = [
  {
    id: 'leg-cph-start',
    city: 'Copenhagen', country: 'Denmark', flag: '🇩🇰',
    dateFrom: '2026-06-25', dateTo: '2026-07-09',
    accommodation: { name: "Friend's place", confirmed: true },
    notes: 'Arriving from home. First and last stop of the trip.',
  },
  {
    id: 'leg-berlin',
    city: 'Berlin', country: 'Germany', flag: '🇩🇪',
    dateFrom: '2026-07-09', dateTo: '2026-07-14',
    arrivalTransport: { type: 'train', from: 'Copenhagen', to: 'Berlin', date: '2026-07-09', duration: '~5h', confirmed: false },
  },
  {
    id: 'leg-amsterdam',
    city: 'Amsterdam', country: 'Netherlands', flag: '🇳🇱',
    dateFrom: '2026-07-14', dateTo: '2026-07-18',
    arrivalTransport: { type: 'train', from: 'Berlin', to: 'Amsterdam', date: '2026-07-14', duration: '~6h', confirmed: false },
  },
  {
    id: 'leg-brussels',
    city: 'Brussels / Ghent', country: 'Belgium', flag: '🇧🇪',
    dateFrom: '2026-07-18', dateTo: '2026-07-21',
    arrivalTransport: { type: 'train', from: 'Amsterdam', to: 'Brussels', date: '2026-07-18', duration: '~3h', confirmed: false },
  },
  {
    id: 'leg-paris',
    city: 'Paris', country: 'France', flag: '🇫🇷',
    dateFrom: '2026-07-21', dateTo: '2026-07-27',
    arrivalTransport: { type: 'train', from: 'Brussels', to: 'Paris', date: '2026-07-21', duration: '~1.5h (Thalys)', confirmed: false },
  },
  {
    id: 'leg-barcelona',
    city: 'Barcelona', country: 'Spain', flag: '🇪🇸',
    dateFrom: '2026-07-27', dateTo: '2026-08-02',
    arrivalTransport: { type: 'flight', from: 'Paris CDG', to: 'Barcelona BCN', date: '2026-07-27', confirmed: false },
  },
  {
    id: 'leg-lisbon',
    city: 'Lisbon + Porto', country: 'Portugal', flag: '🇵🇹',
    dateFrom: '2026-08-02', dateTo: '2026-08-09',
    arrivalTransport: { type: 'train', from: 'Barcelona', to: 'Lisbon', date: '2026-08-02', duration: '~11h (night train)', confirmed: false },
  },
  {
    id: 'leg-switzerland',
    city: 'Bern / Grindelwald', country: 'Switzerland', flag: '🇨🇭',
    dateFrom: '2026-08-09', dateTo: '2026-08-14',
    arrivalTransport: { type: 'flight', from: 'Lisbon LIS', to: 'Zurich ZRH', date: '2026-08-09', confirmed: false },
  },
  {
    id: 'leg-italy',
    city: 'Milan → Venice → Florence → Rome', country: 'Italy', flag: '🇮🇹',
    dateFrom: '2026-08-14', dateTo: '2026-08-23',
    arrivalTransport: { type: 'train', from: 'Zurich', to: 'Milan', date: '2026-08-14', duration: '~3.5h', confirmed: false },
  },
  {
    id: 'leg-cph-end',
    city: 'Copenhagen', country: 'Denmark', flag: '🇩🇰',
    dateFrom: '2026-08-23', dateTo: '2026-09-06',
    arrivalTransport: { type: 'flight', from: 'Rome FCO', to: 'Copenhagen CPH', date: '2026-08-23', confirmed: false },
    accommodation: { name: "Friend's place", confirmed: true },
    notes: 'Final stretch. Decompression and work.',
  },
];

function upgradeLegacyIsoDate(iso: string | undefined): string | undefined {
  if (!iso || !iso.startsWith('2025-')) return iso;
  return `2026-${iso.slice(5)}`;
}

function isLegacyDefaultRouteLegs(legs: RouteLegSeed[]): boolean {
  return legs.length === LEGACY_DEFAULT_ROUTE_IDS.length && legs.every((leg, index) => (
    leg.id === LEGACY_DEFAULT_ROUTE_IDS[index]
    && leg.dateFrom.startsWith('2025-')
    && leg.dateTo.startsWith('2025-')
    && (!leg.arrivalTransport?.date || leg.arrivalTransport.date.startsWith('2025-'))
  ));
}

function upgradeLegacyRouteLegs<T extends RouteLegSeed>(legs: T[]): T[] {
  return legs.map((leg) => ({
    ...leg,
    dateFrom: upgradeLegacyIsoDate(leg.dateFrom) ?? leg.dateFrom,
    dateTo: upgradeLegacyIsoDate(leg.dateTo) ?? leg.dateTo,
    arrivalTransport: leg.arrivalTransport
      ? {
          ...leg.arrivalTransport,
          date: upgradeLegacyIsoDate(leg.arrivalTransport.date) ?? leg.arrivalTransport.date,
        }
      : undefined,
  }));
}

export function cloneRouteLegs<T>(legs: T[]): T[] {
  return JSON.parse(JSON.stringify(legs)) as T[];
}

export function loadStoredRouteLegs<T>(fallback: T[]): { legs: T[]; fromStorage: boolean } {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as T[];
      const upgraded = isLegacyDefaultRouteLegs(parsed as RouteLegSeed[])
        ? upgradeLegacyRouteLegs(parsed as RouteLegSeed[]) as T[]
        : parsed;
      if (upgraded !== parsed) {
        window.localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(upgraded));
      }
      return { legs: upgraded, fromStorage: true };
    }
  } catch { /* ignore */ }
  return { legs: cloneRouteLegs(fallback), fromStorage: false };
}
