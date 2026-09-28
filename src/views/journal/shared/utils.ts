import type { StoredLeg } from '../../../data/stores/route-store.ts';
import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { DEFAULT_TEMPLATE, template } from '../templates.ts';
export { escHtml } from '../../../core/utils.ts';

export const OTHER_DESTINATION = '__other__';

export const MOODS: { value: string; emoji: string }[] = [
  { value: 'spark', emoji: '⚡' },
  { value: 'calm', emoji: '🌊' },
  { value: 'wired', emoji: '🔥' },
  { value: 'soft', emoji: '🫧' },
];

export function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .filter((tag, index, list) => list.indexOf(tag) === index)
    .slice(0, 6);
}

export function excerpt(text: string, length = 180): string {
  const trimmed = text.trim();
  if (trimmed.length <= length) return trimmed;
  return `${trimmed.slice(0, length).trim()}…`;
}

export function titleFor(entry: StoredJournalEntry): string {
  if (entry.title.trim()) return entry.title.trim();
  const fallback = entry.body.trim().split(/\s+/).slice(0, 6).join(' ');
  return fallback || template(entry.template).label || template(DEFAULT_TEMPLATE).label;
}

export function prettyDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

export function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const next = new Date(Date.UTC(year, (month - 1) + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthKeyFromIso(iso: string): string {
  return iso.slice(0, 7);
}

export function moodEmoji(mood?: string): string {
  return MOODS.find((item) => item.value === mood)?.emoji ?? '';
}

export function slugifyEntry(entry: StoredJournalEntry): string {
  const base = titleFor(entry)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'note';
  return `${base}-${entry.id.slice(0, 6)}`;
}

export function shareUrl(slug: string): string {
  // The app is served at /app; pin shared-entry links there explicitly so they
  // resolve regardless of the current pathname (and so the marketing landing
  // page at / never intercepts them).
  return `${location.origin}/app#/s/${slug}`;
}

export function currentCity(legs: StoredLeg[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const active = legs.find((leg) => leg.dateFrom <= today && leg.dateTo >= today);
  return (active ?? [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))[0])?.city ?? '';
}

export function suggestedDestinations(entries: StoredJournalEntry[], legs: StoredLeg[]): string[] {
  const fromLegs = legs.map((leg) => leg.city.trim()).filter(Boolean);
  const fromEntries = entries.map((entry) => entry.destination.trim()).filter(Boolean);
  return [...new Set([...fromLegs, ...fromEntries])].slice(0, 12);
}

/** Cities visited on this trip, in itinerary order (earliest leg first), deduped. */
export function tripCities(legs: StoredLeg[]): string[] {
  const ordered = [...legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  return [...new Set(ordered.map((leg) => leg.city.trim()).filter(Boolean))];
}

export function sortEntries(entries: StoredJournalEntry[]): StoredJournalEntry[] {
  return [...entries].sort(
    (a, b) => b.happenedOn.localeCompare(a.happenedOn) || b.updatedAt - a.updatedAt,
  );
}

/* ── Photos ──────────────────────────────────────────────────────────────── */

export { MAX_JOURNAL_IMAGES } from '../../../data/schema/journal.ts';

/**
 * Every photo on an entry, in display order.
 *
 * Reads `images` first and falls back to the legacy single `coverImage`, so
 * entries written before multi-photo shipped still show their picture. Writers
 * mirror `images[0]` into `coverImage`; because `images` wins outright here,
 * that mirror never shows up as a duplicate tile.
 */
export function entryImages(entry: { images?: string[]; coverImage?: string }): string[] {
  const list = (entry.images ?? []).filter(Boolean);
  if (list.length) return list;
  return entry.coverImage ? [entry.coverImage] : [];
}

/** The photo that represents an entry in a grid/tile, or '' if it has none. */
export function entryCover(entry: { images?: string[]; coverImage?: string }): string {
  return entryImages(entry)[0] ?? '';
}

/**
 * WeChat-Moments grid shape for n photos: 1 -> big single, 2/3 -> one row,
 * 4 -> 2x2, 5..9 -> 3 per row. Returns the column count; CSS does the rest.
 */
export function photoGridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count === 4) return 2;
  if (count <= 3) return count;
  return 3;
}

export type CoverShape = 'portrait' | 'landscape' | 'square';

/**
 * Cover shape from the first photo's width/height ratio. The feed sizes its
 * hero by this so a portrait shot gets a tall 3:4 frame and a landscape shot a
 * wide 4:3 one, instead of everything being cropped into the same letterbox.
 * Unknown ratio (older entries never measured one) reads as portrait, which is
 * the dominant case for phone photos and the shape the magazine layout wants.
 */
export function coverShape(ratio: number | undefined): CoverShape {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) return 'portrait';
  if (ratio < 0.9) return 'portrait';
  if (ratio > 1.15) return 'landscape';
  return 'square';
}

/** CSS aspect-ratio value matching coverShape(). */
export function coverAspect(ratio: number | undefined): string {
  const shape = coverShape(ratio);
  return shape === 'portrait' ? '3 / 4' : shape === 'landscape' ? '4 / 3' : '1 / 1';
}
