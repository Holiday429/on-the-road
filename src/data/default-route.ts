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

export const DEFAULT_ROUTE_LEGS: RouteLegSeed[] = [
  {
    id: 'leg-cph-start',
    city: 'Copenhagen', country: 'Denmark', flag: '🇩🇰',
    dateFrom: '2025-06-25', dateTo: '2025-07-09',
    accommodation: { name: "Friend's place", confirmed: true },
    notes: 'Arriving from home. First and last stop of the trip.',
  },
  {
    id: 'leg-berlin',
    city: 'Berlin', country: 'Germany', flag: '🇩🇪',
    dateFrom: '2025-07-09', dateTo: '2025-07-14',
    arrivalTransport: { type: 'train', from: 'Copenhagen', to: 'Berlin', date: '2025-07-09', duration: '~5h', confirmed: false },
  },
  {
    id: 'leg-amsterdam',
    city: 'Amsterdam', country: 'Netherlands', flag: '🇳🇱',
    dateFrom: '2025-07-14', dateTo: '2025-07-18',
    arrivalTransport: { type: 'train', from: 'Berlin', to: 'Amsterdam', date: '2025-07-14', duration: '~6h', confirmed: false },
  },
  {
    id: 'leg-brussels',
    city: 'Brussels / Ghent', country: 'Belgium', flag: '🇧🇪',
    dateFrom: '2025-07-18', dateTo: '2025-07-21',
    arrivalTransport: { type: 'train', from: 'Amsterdam', to: 'Brussels', date: '2025-07-18', duration: '~3h', confirmed: false },
  },
  {
    id: 'leg-paris',
    city: 'Paris', country: 'France', flag: '🇫🇷',
    dateFrom: '2025-07-21', dateTo: '2025-07-27',
    arrivalTransport: { type: 'train', from: 'Brussels', to: 'Paris', date: '2025-07-21', duration: '~1.5h (Thalys)', confirmed: false },
  },
  {
    id: 'leg-barcelona',
    city: 'Barcelona', country: 'Spain', flag: '🇪🇸',
    dateFrom: '2025-07-27', dateTo: '2025-08-02',
    arrivalTransport: { type: 'flight', from: 'Paris CDG', to: 'Barcelona BCN', date: '2025-07-27', confirmed: false },
  },
  {
    id: 'leg-lisbon',
    city: 'Lisbon + Porto', country: 'Portugal', flag: '🇵🇹',
    dateFrom: '2025-08-02', dateTo: '2025-08-09',
    arrivalTransport: { type: 'train', from: 'Barcelona', to: 'Lisbon', date: '2025-08-02', duration: '~11h (night train)', confirmed: false },
  },
  {
    id: 'leg-switzerland',
    city: 'Bern / Grindelwald', country: 'Switzerland', flag: '🇨🇭',
    dateFrom: '2025-08-09', dateTo: '2025-08-14',
    arrivalTransport: { type: 'flight', from: 'Lisbon LIS', to: 'Zurich ZRH', date: '2025-08-09', confirmed: false },
  },
  {
    id: 'leg-italy',
    city: 'Milan → Venice → Florence → Rome', country: 'Italy', flag: '🇮🇹',
    dateFrom: '2025-08-14', dateTo: '2025-08-23',
    arrivalTransport: { type: 'train', from: 'Zurich', to: 'Milan', date: '2025-08-14', duration: '~3.5h', confirmed: false },
  },
  {
    id: 'leg-cph-end',
    city: 'Copenhagen', country: 'Denmark', flag: '🇩🇰',
    dateFrom: '2025-08-23', dateTo: '2025-09-06',
    arrivalTransport: { type: 'flight', from: 'Rome FCO', to: 'Copenhagen CPH', date: '2025-08-23', confirmed: false },
    accommodation: { name: "Friend's place", confirmed: true },
    notes: 'Final stretch. Decompression and work.',
  },
];

export function cloneRouteLegs<T>(legs: T[]): T[] {
  return JSON.parse(JSON.stringify(legs)) as T[];
}

export function loadStoredRouteLegs<T>(fallback: T[]): { legs: T[]; fromStorage: boolean } {
  try {
    const raw = window.localStorage.getItem(ROUTE_STORAGE_KEY);
    if (raw) return { legs: JSON.parse(raw) as T[], fromStorage: true };
  } catch { /* ignore */ }
  return { legs: cloneRouteLegs(fallback), fromStorage: false };
}
