import type { StoredLeg } from '../../../data/stores/route-store.ts';
import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { DEFAULT_TEMPLATE, template } from '../templates.ts';
export { escHtml } from '../../../core/utils.ts';

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
  return `${location.origin}${location.pathname}#/s/${slug}`;
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

export function sortEntries(entries: StoredJournalEntry[]): StoredJournalEntry[] {
  return [...entries].sort(
    (a, b) => b.happenedOn.localeCompare(a.happenedOn) || b.updatedAt - a.updatedAt,
  );
}
