/* ==========================================================================
   On the Road · Nomad — shared types and rating helpers
   ========================================================================== */

export interface NomadRatings {
  wifi: number;
  power: number;
  restroom: number;
  coffee: number;
  service: number;
}

export interface NomadSpot {
  id: string;
  name: string;
  city: string;
  country: string;
  type: 'Café' | 'Co-working' | 'Library' | 'Hotel lobby';
  ratings: NomadRatings;
  comment?: string;
  photos: string[];
  placeId?: string;
  mapsUrl?: string;
  address?: string;
  placePhotoUrl?: string;
}

export const RATING_DIMS: { key: keyof NomadRatings; label: string; emoji: string }[] = [
  { key: 'wifi',     label: 'WiFi',          emoji: '📶' },
  { key: 'power',    label: 'Power outlets', emoji: '🔌' },
  { key: 'restroom', label: 'Restroom',      emoji: '🚻' },
  { key: 'coffee',   label: 'Coffee',        emoji: '☕' },
  { key: 'service',  label: 'Service',       emoji: '🤝' },
];

export function composite(r: NomadRatings): number {
  const vals = RATING_DIMS.map(d => r[d.key]);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(avg * 10) / 10;
}

export function scoreClass(score: number): string {
  if (score >= 4.2) return 'score-great';
  if (score >= 3.2) return 'score-good';
  if (score >= 2.2) return 'score-ok';
  return 'score-poor';
}
